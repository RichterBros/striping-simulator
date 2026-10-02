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

export class CoverageTracker {
  private samples: CoverageSample[] = [];
  private readonly captureRadiusFt: number;

  constructor(requiredLines: LineSegment[], sampleSpacingFt: number, captureRadiusFt: number) {
    this.captureRadiusFt = captureRadiusFt;
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

  recordSpray(x: number, z: number): void {
    const r2 = this.captureRadiusFt * this.captureRadiusFt;
    for (const sample of this.samples) {
      if (sample.covered) continue;
      const dx = sample.x - x;
      const dz = sample.z - z;
      if (dx * dx + dz * dz <= r2) sample.covered = true;
    }
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
