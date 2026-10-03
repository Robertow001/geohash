/**
 * Encode a latitude/longitude pair into a geohash and decode it back.
 *
 * This is a self-contained implementation of the standard base-32 geohash
 * algorithm. It uses the conventional character set `0123456789bcdefghjkmnpqrstuvwxyz`
 * (which omits the vowels `a`, `i`, `l`, `o` to avoid transcription errors) and
 * the bit-interleaving scheme where the longitude bit comes first, then the
 * latitude bit, repeating for every character.
 *
 * The trade-off here is simplicity over speed: we build the bit string one bit
 * at a time using arithmetic comparisons rather than packing with SIMD-style
 * tricks. For the string lengths people actually use (typically 7-12 chars),
 * this is fast enough and far easier to audit.
 */

/**
 * The base-32 alphabet used by every conforming geohash implementation.
 * Exported so callers can validate input against the exact character set
 * rather than maintaining a private copy that could drift out of sync.
 */
export const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Lookup map from base-32 character to its 5-bit value, precomputed at module
 * load. Precomputing avoids a per-bit `indexOf` call in the hot decode loop;
 * the map is frozen after construction so callers cannot corrupt it.
 */
const lookup = (() => {
  const map = {};
  for (let i = 0; i < BASE32.length; i++) {
    map[BASE32[i]] = i;
  }
  return Object.freeze(map);
})();

/**
 * Re-exported under a clearer name for users who want to build the lookup
 * themselves or inspect the mapping. Frozen so it matches `lookup`.
 */
export const BASE32_DICT = lookup;

/**
 * Encode a coordinate into a geohash string.
 *
 * @param {number} latitude - Decimal degrees in [-90, 90]. Values outside
 *   this range are clamped; the caller is responsible for noticing because
 *   a wrapped coordinate is still a valid, decodable hash. Clamping is chosen
 *   over throwing because the geometric meaning of e.g. latitude 91 is
 *   unambiguous (it is the pole) and rejecting it would punish callers who
 *   derived coordinates from arithmetic.
 * @param {number} longitude - Decimal degrees in [-180, 180]. Clamped to
 *   [-180, 180) on the high end; see note below on the asymmetric longitude
 *   bound.
 * @param {number} [precision=12] - Number of base-32 characters to produce.
 *   Each character adds 5 bits of resolution. The default of 12 is the
 *   de-facto standard because it yields cells roughly 3.7cm on a side, which
 *   is finer than any practical consumer GPS can resolve.
 * @returns {string} The geohash. Always exactly `precision` characters long.
 */
export function encode(latitude, longitude, precision = 12) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError('latitude and longitude must be finite numbers');
  }
  if (!Number.isInteger(precision) || precision <= 0) {
    throw new TypeError('precision must be a positive integer');
  }

  // Longitude is clamped to [-180, 180) rather than [-180, 180]. The decode
  // side never reproduces 180 exactly because the cell edge sits at the
  // antimeridian; accepting +180 on encode would create hashes that do not
  // round-trip, which is worse than clamping silently.
  let lat = Math.max(-90, Math.min(90, latitude));
  let lon = Math.max(-180, Math.min(179.99999999999994, longitude));

  const latRange = [-90, 90];
  const lonRange = [-180, 180];
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true; // longitude bit first, by convention

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonRange[0] = mid;
      } else {
        ch = ch << 1;
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latRange[0] = mid;
      } else {
        ch = ch << 1;
        latRange[1] = mid;
      }
    }
    evenBit = !evenBit;
    bit++;
    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/**
 * Decode a geohash string back to a coordinate.
 *
 * Because a geohash identifies a cell, not a point, the returned coordinate is
 * the centre of that cell. Callers needing the cell bounds should use
 * {@link encodeBounds}.
 *
 * @param {string} hash - A string of base-32 geohash characters. Case is
 *   normalised to lowercase before lookup, because the canonical alphabet is
 *   lowercase and uppercase input is a common transcription artifact.
 * @returns {{latitude: number, longitude: number}} The centre of the decoded
 *   cell. The values are midpoints of the cell, not exact original inputs; see
 *   the README for the precision table.
 * @throws {TypeError} If `hash` is not a non-empty string.
 * @throws {RangeError} If `hash` contains a character outside the base-32
 *   alphabet (after lowercasing).
 */
export function decode(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new TypeError('hash must be a non-empty string');
  }

  const latRange = [-90, 90];
  const lonRange = [-180, 180];
  let evenBit = true;

  for (const char of hash) {
    const lower = char.toLowerCase();
    const idx = lookup[lower];
    if (idx === undefined) {
      throw new RangeError(`invalid geohash character: '${char}'`);
    }
    for (let i = 4; i >= 0; i--) {
      const bit = (idx >> i) & 1;
      if (evenBit) {
        const mid = (lonRange[0] + lonRange[1]) / 2;
        if (bit === 1) lonRange[0] = mid;
        else lonRange[1] = mid;
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (bit === 1) latRange[0] = mid;
        else latRange[1] = mid;
      }
      evenBit = !evenBit;
    }
  }

  return {
    latitude: (latRange[0] + latRange[1]) / 2,
    longitude: (lonRange[0] + lonRange[1]) / 2,
  };
}

/**
 * Decode a geohash and return the bounding box of the cell it identifies.
 *
 * The bounds are inclusive on the low side and exclusive on the high side;
 * this matches the half-open intervals the encoder actually narrowed to, and
 * it means adjacent hashes touch without overlap. Callers comparing a point
 * to these bounds should use `lo <= point && point < hi`.
 *
 * @param {string} hash - A base-32 geohash string; same rules as {@link decode}.
 * @returns {{minLat: number, maxLat: number, minLon: number, maxLon: number}}
 *   The half-open cell bounds.
 */
export function encodeBounds(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new TypeError('hash must be a non-empty string');
  }

  const latRange = [-90, 90];
  const lonRange = [-180, 180];
  let evenBit = true;

  for (const char of hash) {
    const lower = char.toLowerCase();
    const idx = lookup[lower];
    if (idx === undefined) {
      throw new RangeError(`invalid geohash character: '${char}'`);
    }
    for (let i = 4; i >= 0; i--) {
      const bit = (idx >> i) & 1;
      if (evenBit) {
        const mid = (lonRange[0] + lonRange[1]) / 2;
        if (bit === 1) lonRange[0] = mid;
        else lonRange[1] = mid;
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (bit === 1) latRange[0] = mid;
        else latRange[1] = mid;
      }
      evenBit = !evenBit;
    }
  }

  return {
    minLat: latRange[0],
    maxLat: latRange[1],
    minLon: lonRange[0],
    maxLon: lonRange[1],
  };
}
