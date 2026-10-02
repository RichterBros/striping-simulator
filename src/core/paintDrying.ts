/**
 * Tracks which recently-sprayed points are still wet. Real traffic paint
 * needs real time to cure — matches that rather than a shortcut like
 * "dry once the player drives far enough away".
 */

export const PAINT_DRY_TIME_SEC = 5 * 60; // ~5 minutes, matches real traffic-paint cure time

interface WetPoint {
  x: number;
  z: number;
  paintedAtSec: number;
}

export class WetPaintField {
  private points: WetPoint[] = [];
  private readonly wetRadiusFt: number;
  private readonly minSampleSpacingFt: number;
  private lastRecordedPoint: { x: number; z: number } | null = null;

  constructor(wetRadiusFt: number, minSampleSpacingFt = 0.5) {
    this.wetRadiusFt = wetRadiusFt;
    this.minSampleSpacingFt = minSampleSpacingFt;
  }

  /** Call every time the nozzle actually sprays. Thinned to one sample per
   * `minSampleSpacingFt` of travel so a long stationary or slow spray doesn't
   * pile up redundant points. */
  recordPaint(x: number, z: number, nowSec: number): void {
    if (this.lastRecordedPoint) {
      const d = Math.hypot(x - this.lastRecordedPoint.x, z - this.lastRecordedPoint.z);
      if (d < this.minSampleSpacingFt) return;
    }
    this.points.push({ x, z, paintedAtSec: nowSec });
    this.lastRecordedPoint = { x, z };
  }

  /** Call once per frame to drop fully-dried entries (points are appended in
   * non-decreasing time order, so this is a cheap prefix trim). */
  prune(nowSec: number): void {
    let i = 0;
    while (i < this.points.length && nowSec - this.points[i].paintedAtSec > PAINT_DRY_TIME_SEC) {
      i++;
    }
    if (i > 0) this.points.splice(0, i);
  }

  isWetAt(x: number, z: number): boolean {
    const r2 = this.wetRadiusFt * this.wetRadiusFt;
    for (const p of this.points) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }
}
