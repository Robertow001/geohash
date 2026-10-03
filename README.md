# geohash

Convert latitude/longitude pairs to base-32 geohash strings and back. Pure ESM, zero dependencies.

## Usage

```js
import { encode, decode, encodeBounds } from './src/index.js';

const hash = encode(57.64911, 10.40744, 11);
// 'u4pruydqqvj'

const { latitude, longitude } = decode(hash);
// { latitude: 57.64911..., longitude: 10.40744... }

const cell = encodeBounds(hash);
// { minLat, maxLat, minLon, maxLon } — half-open bounds of the cell
```

## Why

Existing geohash libraries vary in bit-ordering convention, in how they handle the antimeridian, and in whether `decode` returns a cell centre or a cell corner. This library picks one answer to each and sticks to it: longitude bit first, `decode` returns the cell centre, and the longitude range is treated as `[-180, 180)` so that `+180` always clamps to a decodable value. The cost of this strictness is that encoding exactly `180.0` will not round-trip to `180.0`; it returns a point just west of the antimeridian. That is the right trade-off: a hash that fails to decode is worse than a hash that lands a nanometre off.

## The awkward edge

A geohash identifies a rectangular cell, not a point. `decode` returns the centre of that cell, so `decode(encode(lat, lon))` will not equal your input — it will equal the centre of the cell your input fell into. At precision 12 (the default) the cell is roughly 3.7 cm on a side, which is finer than consumer GPS resolves, so the difference is usually invisible. At precision 6 it is about 1.2 km, and the discrepancy is obvious. If you need the cell itself rather than a representative point, use `encodeBounds`.

The second awkward edge is the antimeridian. Longitude `+180` is clamped to just under `180` on encode, because the decode side can never reproduce `180` exactly — the cell edge sits there, not its centre. Callers who absolutely need `+180` to survive a round-trip should store the original coordinate separately.

## Exports

- `encode(latitude, longitude, precision = 12)` → `string`
- `decode(hash)` → `{ latitude, longitude }` (cell centre)
- `encodeBounds(hash)` → `{ minLat, maxLat, minLon, maxLon }` (half-open)
- `BASE32` — the 32-character alphabet string
- `BASE32_DICT` — frozen `char → index` lookup over `BASE32`

## Running the tests

```
node --test
```
