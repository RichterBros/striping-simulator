import { STANDARD_STALL_WIDTH_FT, STANDARD_STALL_DEPTH_FT } from './measurements.ts';

export interface StallLayoutSpec {
  rows: number;
  stallsPerRow: number;
  stallWidthFt: number;
  stallDepthFt: number;
  aisleWidthFt: number;
}

export interface LineSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export const DEFAULT_LOT_LAYOUT: StallLayoutSpec = {
  rows: 2,
  stallsPerRow: 10,
  stallWidthFt: STANDARD_STALL_WIDTH_FT,
  stallDepthFt: STANDARD_STALL_DEPTH_FT,
  aisleWidthFt: 24,
};

/**
 * Generates the required stripe centerlines for a simple double-loaded row
 * parking layout: two rows of stalls facing each other across a drive aisle,
 * each stall separated by a single perpendicular divider line.
 * Origin (0,0) is the layout's bottom-left corner; rows extend along +x,
 * depth extends along +z.
 */
export function generateStallLines(spec: StallLayoutSpec): LineSegment[] {
  const lines: LineSegment[] = [];

  for (let row = 0; row < spec.rows; row++) {
    const rowStartZ = row * (spec.stallDepthFt + spec.aisleWidthFt);
    const rowEndZ = rowStartZ + spec.stallDepthFt;

    // Divider line between each stall (including the two outer edges).
    for (let i = 0; i <= spec.stallsPerRow; i++) {
      const x = i * spec.stallWidthFt;
      lines.push({ x1: x, z1: rowStartZ, x2: x, z2: rowEndZ });
    }
  }

  return lines;
}

export function lotFootprint(spec: StallLayoutSpec): { widthFt: number; depthFt: number } {
  return {
    widthFt: spec.stallsPerRow * spec.stallWidthFt,
    depthFt: spec.rows * spec.stallDepthFt + Math.max(0, spec.rows - 1) * spec.aisleWidthFt,
  };
}
