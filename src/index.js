/**
 * Re-exports the public API of the geohash library.
 *
 * The split between `core.js` and `index.js` is deliberate: core holds the
 * pure algorithmic primitives with no opinion about how they are surfaced,
 * while this module is the single import path users depend on. Keeping them
 * separate means the algorithm can be unit-tested in isolation without
 * pulling in a barrel file that might later grow side-effectful re-exports.
 */
export { encode, decode, encodeBounds } from './core.js';
export { BASE32, BASE32_DICT } from './core.js';
