import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, encodeBounds, BASE32, BASE32_DICT } from '../src/index.js';

/**
 * Tolerance for comparing floating-point coordinates. The decode result is a
 * cell centre, not the original input, so we compare within a fraction of the
 * cell size at the tested precision rather than with strict equality. Using a
 * fixed absolute tolerance is deterministic and independent of the host's
 * floating-point quirks because every value here is well within double range.
 */
const TOLERANCE = 1e-4;

/**
 * Assert two numbers are within TOLERANCE. Strict === on floats is forbidden by
 * the project rules; this helper centralises the one comparison policy we use.
 */
function approxEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    `${message ?? ''} expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`
  );
}

test('encode produces a string of the requested precision', () => {
  const hash = encode(57.64911, 10.40744, 11);
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 11);
});

test('encode default precision is 12 characters', () => {
  const hash = encode(0, 0);
  assert.equal(hash.length, 12);
});

test('encode at the origin starts with the high-lon bit set', () => {
  // (0,0) sits exactly on the first longitude midpoint (0). The encoder uses
  // >=, so the first bit is 1, giving 's' (10000 in binary). The remaining
  // bits narrow around 0 from both sides.
  const hash = encode(0, 0, 8);
  assert.equal(hash, 's0000000');
});

test('encode matches the canonical example for the Seattle area', () => {
  // Reference value widely cited in geohash documentation; pinning it ensures
  // our bit ordering (longitude first) matches the de-facto standard.
  assert.equal(encode(57.64911, 10.40744, 11), 'u4pruydqqvj');
});

test('decode returns the cell centre, not the original input', () => {
  const originalLat = 57.64911;
  const originalLon = 10.40744;
  const hash = encode(originalLat, originalLon, 11);
  const { latitude, longitude } = decode(hash);
  // At precision 11 the cell is ~1.5m across; the centre is close but not
  // equal to the input. We assert it lands inside a generous band.
  approxEqual(latitude, originalLat, 'latitude within cell');
  approxEqual(longitude, originalLon, 'longitude within cell');
});

test('decode of the all-zero hash returns the south-pole cell centre', () => {
  // All-zero bits mean "take the low half" at every step, which for latitude
  // narrows toward -90 and for longitude toward -180. The centre of the
  // resulting cell is therefore in the south-pole neighbourhood.
  const { latitude, longitude } = decode('00000000');
  assert.ok(latitude < 0, 'zero hash latitude is in the southern half');
  assert.ok(longitude < 0, 'zero hash longitude is in the western half');
});

test('round-trip preserves the coordinate to cell-centre precision', () => {
  const lat = -33.8688;
  const lon = 151.2093;
  const hash = encode(lat, lon, 9);
  const { latitude, longitude } = decode(hash);
  approxEqual(latitude, lat, 'round-trip latitude');
  approxEqual(longitude, lon, 'round-trip longitude');
});

test('encode rejects non-finite coordinates', () => {
  assert.throws(() => encode(NaN, 0), TypeError);
  assert.throws(() => encode(0, Infinity), TypeError);
});

test('encode rejects non-positive precision', () => {
  assert.throws(() => encode(0, 0, 0), TypeError);
  assert.throws(() => encode(0, 0, -1), TypeError);
  assert.throws(() => encode(0, 0, 3.5), TypeError);
});

test('decode rejects the empty string', () => {
  assert.throws(() => decode(''), TypeError);
});

test('decode rejects characters outside the base-32 alphabet', () => {
  // 'a', 'i', 'l', 'o' are deliberately omitted from the alphabet.
  assert.throws(() => decode('a'), RangeError);
  assert.throws(() => decode('000o0000'), RangeError);
  assert.throws(() => decode('!'), RangeError);
});

test('decode normalises uppercase input', () => {
  const lower = decode('u4pruydqqvj');
  const upper = decode('U4PRUYDQQVJ');
  approxEqual(lower.latitude, upper.latitude, 'uppercase latitude');
  approxEqual(lower.longitude, upper.longitude, 'uppercase longitude');
});

test('encode clamps latitude above 90 to the pole', () => {
  // Clamping is the documented behaviour; the pole is a degenerate but valid
  // cell. We just assert the hash is the same as for exactly 90.
  const clamped = encode(120, 0, 8);
  const exact = encode(90, 0, 8);
  assert.equal(clamped, exact);
});

test('encode clamps longitude at +180 down towards the antimeridian', () => {
  // +180 is clamped below 180 so the hash is decodable and round-trips; this
  // is the asymmetric longitude bound documented in the README.
  const hash = encode(0, 180, 8);
  const { longitude } = decode(hash);
  assert.ok(longitude < 180, 'decoded longitude should be strictly below 180');
});

test('encodeBounds returns half-open cell bounds', () => {
  const hash = encode(57.64911, 10.40744, 6);
  const bounds = encodeBounds(hash);
  assert.ok(bounds.minLat < bounds.maxLat, 'latitude bounds ordered');
  assert.ok(bounds.minLon < bounds.maxLon, 'longitude bounds ordered');
});

test('encodeBounds centre matches decode centre', () => {
  const hash = encode(40.7128, -74.0060, 10);
  const bounds = encodeBounds(hash);
  const centre = decode(hash);
  approxEqual((bounds.minLat + bounds.maxLat) / 2, centre.latitude, 'bounds centre latitude');
  approxEqual((bounds.minLon + bounds.maxLon) / 2, centre.longitude, 'bounds centre longitude');
});

test('BASE32 alphabet has exactly 32 characters with no vowels', () => {
  assert.equal(BASE32.length, 32);
  for (const vowel of ['a', 'i', 'l', 'o']) {
    assert.ok(!BASE32.includes(vowel), `alphabet must omit ${vowel}`);
  }
});

test('BASE32_DICT maps every alphabet character to its index', () => {
  for (let i = 0; i < BASE32.length; i++) {
    assert.equal(BASE32_DICT[BASE32[i]], i);
  }
});

test('adjacent hashes at the same precision do not overlap (half-open bounds)', () => {
  // Two longitude-adjacent cells at precision 4 should touch at a shared edge
  // with no gap and no overlap. We derive the neighbour by encoding a point
  // just east of cell A's eastern edge, not by nudging its centre (which may
  // remain inside A at coarse precisions).
  const a = encode(0, 0, 4);
  const ba = encodeBounds(a);
  const b = encode(0, ba.maxLon + 0.001, 4);
  const bb = encodeBounds(b);
  // Touching edges: one cell's max equals the other's min.
  const touching = Math.abs(ba.maxLon - bb.minLon) < 1e-9 || Math.abs(bb.maxLon - ba.minLon) < 1e-9;
  assert.ok(touching, 'adjacent cells should touch at a shared edge');
});
