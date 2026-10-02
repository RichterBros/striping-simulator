import type { LineSegment } from './layout.ts';

/**
 * Engine-independent completion tracking: discretizes the required stripe
 * centerlines into sample points, then marks a sample "covered" once a
 * sprayed point lands within `captureRadiusFt` of it. Completion % is just
 * covered samples / total samples.
 */

export interface CoverageSample {
  x: number;
  z: number;
  covered: boolean;
}

export interface SprayResult {
  /** How many previously-uncovered samples this exact spray point just
   * covered — 0 means this spray didn't move completion % at all (already
   * covered ground, or nowhere near the required line). Drives the
   * "making a connection" audio feedback: it should only react to genuine
   * new progress, not just any spraying. */
  newlyCovered: number;
  /** Perpendicular distance from this spray point to the nearest required
   * line *segment* (not to a discrete sample dot — distance-to-sample is
   * bounded below by roughly half the sample spacing even when dead-on the
   * line, which made a tight precision threshold nearly unreachable).
   * Drives the "PERFECT!" precision celebration. */
  lineDistanceFt: number;
}

export class CoverageTracker {
  private samples: CoverageSample[] = [];
  private readonly captureRadiusFt: number;
  private readonly lines: LineSegment[];

  constructor(requiredLines: LineSegment[], sampleSpacingFt: number, captureRadiusFt: number) {
    this.captureRadiusFt = captureRadiusFt;
    this.lines = requiredLines;
    for (const line of requiredLines) {
      const len = Math.hypot(line.x2 - line.x1, line.z2 - line.z1);
      const steps = Math.max(1, Math.round(len / sampleSpacingFt));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        this.samples.push({
          x: line.x1 + (line.x2 - line.x1) * t,
          z: line.z1 + (line.z2 - line.z1) * t,
          covered: false,
        });
      }
    }
  }

  private distanceToLinesFt(x: number, z: number): number {
    let nearestDist2 = Infinity;
    for (const line of this.lines) {
      const dx = line.x2 - line.x1;
      const dz = line.z2 - line.z1;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq === 0 ? 0 : ((x - line.x1) * dx + (z - line.z1) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = line.x1 + dx * t;
      const pz = line.z1 + dz * t;
      const ddx = x - px;
      const ddz = z - pz;
      const dist2 = ddx * ddx + ddz * ddz;
      if (dist2 < nearestDist2) nearestDist2 = dist2;
    }
    return this.lines.length === 0 ? Infinity : Math.sqrt(nearestDist2);
  }

  recordSpray(x: number, z: number): SprayResult {
    const r2 = this.captureRadiusFt * this.captureRadiusFt;
    let newlyCovered = 0;

    for (const sample of this.samples) {
      if (sample.covered) continue;
      const dx = sample.x - x;
      const dz = sample.z - z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 <= r2) {
        sample.covered = true;
        newlyCovered++;
      }
    }

    return {
      newlyCovered,
      lineDistanceFt: this.distanceToLinesFt(x, z),
    };
  }

  completionFraction(): number {
    if (this.samples.length === 0) return 0;
    let covered = 0;
    for (const sample of this.samples) if (sample.covered) covered++;
    return covered / this.samples.length;
  }

  allSamples(): readonly CoverageSample[] {
    return this.samples;
  }
}
