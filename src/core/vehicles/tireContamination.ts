/**
 * Models wet paint getting picked up on the tires and gradually worn back
 * off as the rig keeps rolling, leaving tire-track marks behind it in the
 * meantime. Deliberately simplified to one contamination level for the
 * whole rig (not per-wheel) — any wheel touching wet paint contaminates all
 * of them. Revisit if independent per-wheel tracking is ever needed.
 */

import { RIG_SPEC } from './stripingRig.ts';

export const TIRE_SPEC = {
  // A wheel has to actually overlap the painted stripe to pick anything up,
  // not just pass near it — half the stripe's own width, plus a small
  // allowance (~0.4in) for the tire's own contact-patch width. Do not make
  // this much bigger than the stripe's half-width or wheels will register
  // as "in the paint" while still visibly clear of it.
  pickupRadiusFt: RIG_SPEC.stripeLineWidthFt / 2 + 0.03,
  depletionDistanceFt: 20, // contamination fully wears off after rolling this far
  trackWidthFt: 0.12,
  maxTrackAlpha: 0.55,
};

export interface TireContaminationState {
  level: number; // 0 (clean) .. 1 (freshly loaded with wet paint)
}

export function createTireContaminationState(): TireContaminationState {
  return { level: 0 };
}

export function updateTireContamination(
  state: TireContaminationState,
  wheels: { x: number; z: number }[],
  isWetAt: (x: number, z: number) => boolean,
  distanceTraveledFt: number,
): TireContaminationState {
  if (wheels.some((w) => isWetAt(w.x, w.z))) {
    return { level: 1 };
  }
  if (state.level <= 0) return state;
  const level = Math.max(0, state.level - distanceTraveledFt / TIRE_SPEC.depletionDistanceFt);
  return { level };
}
