import { describe, expect, it } from 'vitest';
import { zonalCloseness } from '../depthZones';

/** Builds a closeness map: constant `value` everywhere except the given
 *  override region (x0..x1, y0..y1 of a unit box). */
function makeMap(w: number, h: number, value: number, override?: { x0: number; x1: number; y0: number; y1: number; value: number }): Float32Array {
  const map = new Float32Array(w * h).fill(value);
  if (override) {
    for (let y = Math.floor(override.y0 * h); y < override.y1 * h; y++) {
      for (let x = Math.floor(override.x0 * w); x < override.x1 * w; x++) {
        map[y * w + x] = override.value;
      }
    }
  }
  return map;
}

describe('zonalCloseness (depth worker postprocess)', () => {
  const W = 300;
  const H = 300;

  it('reports close obstacle on the left only in the left zone', () => {
    // Left third close (0.95), rest far (0.1)
    const map = makeMap(W, H, 0.1, { x0: 0, x1: 1 / 3, y0: 0.3, y1: 0.6, value: 0.95 });
    const r = zonalCloseness(map, W, H);
    expect(r.closeness.left).toBeGreaterThan(0.8);
    expect(r.closeness.center).toBeLessThan(0.2);
    expect(r.closeness.right).toBeLessThan(0.2);
  });

  it('reports close obstacle on the right only in the right zone', () => {
    const map = makeMap(W, H, 0.1, { x0: 2 / 3, x1: 1, y0: 0.3, y1: 0.6, value: 0.9 });
    const r = zonalCloseness(map, W, H);
    expect(r.closeness.right).toBeGreaterThan(0.75);
    expect(r.closeness.left).toBeLessThan(0.2);
  });

  it('ground band only counts the lower-center region', () => {
    // Close surface across the whole BOTTOM quarter → ground should fire
    const map = makeMap(W, H, 0.05, { x0: 0, x1: 1, y0: 0.8, y1: 1, value: 0.95 });
    const r = zonalCloseness(map, W, H);
    expect(r.closenessGround).toBeGreaterThan(0.8);
    // Zone p90s stay low: bottom band is ~25% of each column, p90 of a
    // uniform column is below the band value
    expect(r.closeness.center).toBeLessThan(0.95);
  });

  it('ignores ground-band pixels in the outer thirds (left/right walls are zone hazards, not trip hazards)', () => {
    // Close surface in bottom-LEFT corner only
    const map = makeMap(W, H, 0.05, { x0: 0, x1: 1 / 6, y0: 0.8, y1: 1, value: 0.95 });
    const r = zonalCloseness(map, W, H);
    expect(r.closenessGround).toBeLessThan(0.5);
    expect(r.closeness.left).toBeGreaterThan(0.5); // still a left-zone hazard via p90
  });

  it('returns zeros for empty zones', () => {
    const map = makeMap(10, 10, 0.5);
    const r = zonalCloseness(map, 10, 10);
    expect(r.closeness.left).toBe(0.5);
    expect(r.closenessGround).toBeGreaterThan(0);
  });

  it('skips non-finite values without crashing', () => {
    const map = makeMap(W, H, 0.3);
    map[0] = NaN;
    const r = zonalCloseness(map, W, H);
    expect(r.closeness.left).toBeGreaterThan(0);
  });
});
