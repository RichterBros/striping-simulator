/**
 * Engine-independent physics/state for the two-part striping rig.
 *
 * Per the reference photos (`reference images/lindedriver_appl_02.png`), the
 * striping machine leads at the FRONT and the ride-on buggy trails at the
 * REAR — direction of travel is toward the striper. The nozzle hangs off
 * the striper's front-right corner, not centered at the rear.
 *
 * The two are joined by an ARTICULATED hitch, not a rigid frame — and
 * critically, steering and propulsion are split across the two halves:
 * the operator sits on the buggy and controls SPEED with foot pedals, but
 * steers via handlebars mounted on the striper. So the striper is the
 * directly-steered "lead" reference (like a bicycle's front wheel), and the
 * buggy has no steering input of its own — its heading instead evolves to
 * trail the striper through the hitch pivot, via the same kinematics used
 * for a car towing a trailer (just with the labels swapped: the steered,
 * lead unit is physically in front here, same as a real tractor-trailer,
 * but it isn't the one providing propulsion).
 *
 * On top of that trailing physics sits an explicit LOCK state
 * (`RigState.locked`): while the player holds no steer input and the two
 * units are aligned, they're pinned perfectly straight (buggyHeading forced
 * to equal striperHeading exactly) rather than left to the trailer
 * equation's asymptotic convergence, which technically never reaches exact
 * zero and could show a faint residual wobble. Any steer input immediately
 * breaks the lock and hands control back to the trailer equation, which
 * re-engages the lock on its own once it has settled back within
 * `RIG_SPEC.lockEngageThresholdRad` of alignment. The two units visibly
 * articulate apart around the hitch point while unlocked, same as a real
 * towed trailer swinging out through a turn.
 */

import { forwardVector, rightVector } from '../heading.ts';

export interface RigInput {
  throttle: number; // -1 (full reverse) .. 1 (full forward)
  steer: number; // -1 (left) .. 1 (right)
  spray: boolean;
}

export interface RigState {
  // Striper: directly steered (handlebars), leads the rig.
  striperX: number;
  striperZ: number;
  striperHeading: number;
  // Shared forward speed, from the buggy's pedals.
  speedFtPerSec: number;
  // Buggy: no steering of its own; trails the striper through the hitch
  // pivot via trailer-following kinematics (see stepRig).
  buggyX: number;
  buggyZ: number;
  buggyHeading: number;
  // True when pinned perfectly straight (no steer input, settled aligned);
  // see the module doc comment above for the full lock/unlock behavior.
  locked: boolean;
  nozzleOn: boolean;
}

export const RIG_SPEC = {
  maxForwardSpeedFtPerSec: 9, // ~6 mph, a realistic striping crawl speed
  maxReverseSpeedFtPerSec: 5,
  accelFtPerSec2: 10,
  brakeFtPerSec2: 16,
  maxTurnRateRadPerSec: 1.6,
  frameLengthFt: 7, // hitch arm length: striper pivot to buggy pivot
  nozzleForwardOffsetFt: 2, // nozzle sits ahead of the striper pivot, near its front
  // Clearly outboard of every wheel's own right offset below (1.0-1.25) —
  // on a real rig the nozzle oversails the wheel tracks so the rig doesn't
  // normally drive through its own fresh line on a straight pass. Keep this
  // bigger than any wheel's *RightFt value.
  nozzleRightOffsetFt: 2.0,
  stripeLineWidthFt: 4 / 12,
  // Ground-contact points used for tire/wet-paint checks. Matches the rear
  // wheels in vehicleMesh.ts's buildBuggyMesh/buildStriperMesh.
  buggyWheelForwardFt: -1.0,
  buggyWheelRightFt: 1.25,
  striperWheelForwardFt: 0.2,
  striperWheelRightFt: 1.0,
  // How close buggyHeading must settle to striperHeading (via the trailer
  // equation) before the lock re-engages after a turn. Small enough to be
  // visually imperceptible as a snap.
  lockEngageThresholdRad: 0.02,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Shortest signed angle from `a` to `b`, in (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function createInitialRigState(x: number, z: number, headingRad: number): RigState {
  const f = forwardVector(headingRad);
  return {
    striperX: x,
    striperZ: z,
    striperHeading: headingRad,
    speedFtPerSec: 0,
    buggyX: x - f.x * RIG_SPEC.frameLengthFt,
    buggyZ: z - f.z * RIG_SPEC.frameLengthFt,
    buggyHeading: headingRad,
    locked: true,
    nozzleOn: false,
  };
}

export function stepRig(state: RigState, input: RigInput, dt: number): RigState {
  const spec = RIG_SPEC;
  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);

  const targetSpeed =
    throttle >= 0 ? throttle * spec.maxForwardSpeedFtPerSec : throttle * spec.maxReverseSpeedFtPerSec;
  const accel = Math.abs(targetSpeed) > Math.abs(state.speedFtPerSec) ? spec.accelFtPerSec2 : spec.brakeFtPerSec2;
  const speedDelta = clamp(targetSpeed - state.speedFtPerSec, -accel * dt, accel * dt);
  const speedFtPerSec = state.speedFtPerSec + speedDelta;

  // No steering authority while essentially stopped, like real handlebars
  // that need rolling speed to actually turn the rig.
  const speedFraction = clamp(Math.abs(speedFtPerSec) / spec.maxForwardSpeedFtPerSec, 0, 1);
  const turnDir = speedFtPerSec >= 0 ? 1 : -1;
  // Negated: with heading 0 pointing toward +Z, increasing heading curves
  // toward +X, which is screen-left for a camera facing +Z. Flip so that
  // steer > 0 (D / right) turns right on screen, steer < 0 (A / left) turns left.
  const headingDelta = -steer * spec.maxTurnRateRadPerSec * speedFraction * turnDir * dt;
  const striperHeading = state.striperHeading + headingDelta;

  const sf = forwardVector(striperHeading);
  const striperX = state.striperX + sf.x * speedFtPerSec * dt;
  const striperZ = state.striperZ + sf.z * speedFtPerSec * dt;

  // Any steer input breaks the lock immediately, full stop.
  let locked = state.locked && steer === 0;

  let buggyHeading: number;
  if (locked) {
    // Pinned exactly straight — no residual wobble from the trailer
    // equation's asymptotic convergence.
    buggyHeading = striperHeading;
  } else {
    // Trailer-following kinematics: the buggy has no steering input of its
    // own. Its heading evolves so its wheels roll without slipping while
    // trailing a pivot moving at `speedFtPerSec` along `striperHeading` —
    // the standard "car towing a trailer" equation. Stable equilibrium at
    // buggyHeading == striperHeading (straight driving re-aligns them);
    // diverges during reverse, same as a real trailer.
    const diff = angleDiff(state.buggyHeading, striperHeading);
    const buggyHeadingRate = (speedFtPerSec / spec.frameLengthFt) * Math.sin(diff);
    buggyHeading = state.buggyHeading + buggyHeadingRate * dt;

    // Re-engage the lock once settled back into alignment, but only if the
    // player isn't actively steering (otherwise it'd re-lock mid-turn the
    // instant the trailer equation happened to cross the threshold).
    if (steer === 0 && Math.abs(angleDiff(buggyHeading, striperHeading)) < spec.lockEngageThresholdRad) {
      locked = true;
      buggyHeading = striperHeading;
    }
  }

  const bf = forwardVector(buggyHeading);
  // The hitch pivot is the striper's own reference point; the buggy trails
  // a fixed arm length behind it along its (independently evolving) heading.
  const buggyX = striperX - bf.x * spec.frameLengthFt;
  const buggyZ = striperZ - bf.z * spec.frameLengthFt;

  return {
    striperX,
    striperZ,
    striperHeading,
    speedFtPerSec,
    buggyX,
    buggyZ,
    buggyHeading,
    locked,
    nozzleOn: input.spray,
  };
}

export function nozzleWorldPosition(state: RigState): { x: number; z: number } {
  const f = forwardVector(state.striperHeading);
  const r = rightVector(state.striperHeading);
  return {
    x: state.striperX + f.x * RIG_SPEC.nozzleForwardOffsetFt + r.x * RIG_SPEC.nozzleRightOffsetFt,
    z: state.striperZ + f.z * RIG_SPEC.nozzleForwardOffsetFt + r.z * RIG_SPEC.nozzleRightOffsetFt,
  };
}

function offsetPoint(
  baseX: number,
  baseZ: number,
  heading: number,
  forwardFt: number,
  rightFt: number,
): { x: number; z: number } {
  const f = forwardVector(heading);
  const r = rightVector(heading);
  return {
    x: baseX + f.x * forwardFt + r.x * rightFt,
    z: baseZ + f.z * forwardFt + r.z * rightFt,
  };
}

/** The four ground-contact points used for wet-paint/tire checks: buggy's
 * two rear wheels and the striper's two wheels. */
export function wheelContacts(state: RigState): { x: number; z: number }[] {
  const spec = RIG_SPEC;
  return [
    offsetPoint(state.buggyX, state.buggyZ, state.buggyHeading, spec.buggyWheelForwardFt, spec.buggyWheelRightFt),
    offsetPoint(state.buggyX, state.buggyZ, state.buggyHeading, spec.buggyWheelForwardFt, -spec.buggyWheelRightFt),
    offsetPoint(
      state.striperX,
      state.striperZ,
      state.striperHeading,
      spec.striperWheelForwardFt,
      spec.striperWheelRightFt,
    ),
    offsetPoint(
      state.striperX,
      state.striperZ,
      state.striperHeading,
      spec.striperWheelForwardFt,
      -spec.striperWheelRightFt,
    ),
  ];
}

/** World position of the hitch pivot — where the buggy and striper connect.
 * Currently just the striper's own reference point; exposed separately so
 * the renderer can draw a hitch bar between it and the buggy without
 * assuming that equivalence directly. */
export function hitchPivotPosition(state: RigState): { x: number; z: number } {
  return { x: state.striperX, z: state.striperZ };
}
