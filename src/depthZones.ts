// Zonal postprocessing for the depth worker: reduces a normalized closeness
// map (0..1, higher = closer — from Depth Anything V2) to per-zone p90
// closeness + a ground-band closeness. Pure function so it is unit-testable
// without a worker environment.

export type DepthZone = 'left' | 'center' | 'right';

export function zonalCloseness(
  values: Float32Array | number[],
  width: number,
  height: number,
): { closeness: Record<DepthZone, number>; closenessGround: number } {
  const zones: Record<DepthZone, number[]> = { left: [], center: [], right: [] };
  const ground: number[] = [];
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const v = values[y * width + x];
      if (!Number.isFinite(v)) continue;
      const zone: DepthZone = x < width / 3 ? 'left' : x < (width * 2) / 3 ? 'center' : 'right';
      zones[zone].push(v);
      // Ground band: lower quarter of the frame, center two-thirds.
      if (y > height * 0.75 && x > width / 6 && x < (width * 5) / 6) ground.push(v);
    }
  }
  const p90 = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(arr.length - 1, Math.floor(sorted.length * 0.9))];
  };
  return {
    closeness: {
      left: p90(zones.left),
      center: p90(zones.center),
      right: p90(zones.right),
    },
    closenessGround: p90(ground),
  };
}
