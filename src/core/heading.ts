/**
 * Shared heading-vector convention: heading 0 points toward +Z, increasing
 * heading rotates toward +X. "Right" is defined relative to someone facing
 * `forward` — at heading 0 that's -X (see stripingRig.ts for the derivation
 * tying this to screen-right in the chase camera).
 */

export function forwardVector(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export function rightVector(heading: number): { x: number; z: number } {
  return { x: -Math.cos(heading), z: Math.sin(heading) };
}
