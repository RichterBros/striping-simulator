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
 * zero and could show a faint residual wobble. The two units visibly
 * articulate apart around the hitch point while unlocked, same as a real
 * towed trailer swinging out through a turn.
 *
 * While locked, a quick TAP of steer (press and release within
 * `tapHoldThresholdSec`) does NOT break the lock or turn anything — it
 * nudges the whole rig sideways by a small fixed distance
 * (`nudgeDistanceFt`), for fine-positioning the stripe without having to
 * fight the full turning physics over it. HOLDING steer past that
 * threshold breaks the lock and hands off to normal steering, same as
 * before. See the tap/hold bookkeeping (`tapSteerDir`/`tapHoldSec`) in
 * `stepRig` for the exact state machine.
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
  // Tap/hold disambiguation while locked: the steer direction (-1/0/1) of
  // the press currently being timed, and how long it's been held so far.
  // 0/0 when nothing is pending (always true while unlocked).
  tapSteerDir: number;
  tapHoldSec: number;
  nozzleOn: boolean;
}

export const RIG_SPEC = {
  maxForwardSpeedFtPerSec: 9, // ~6 mph, a realistic striping crawl speed
  maxReverseSpeedFtPerSec: 5,
  accelFtPerSec2: 10,
  brakeFtPerSec2: 16,
  maxTurnRateRadPerSec: 2.6,
  // Steering ramps up to full authority by this speed, NOT by
  // maxForwardSpeedFtPerSec — a full-range ramp meant turning only felt
  // sharp at top speed and sluggish everywhere below it. This is well
  // under max speed so normal cruising already gets full turn rate.
  turnRampSpeedFtPerSec: 2.5,
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
  // Tap-vs-hold threshold while locked: a steer press released before this
  // many seconds elapse is a tap (nudge); held past it becomes a normal
  // steering hold (breaks the lock). Short enough not to feel laggy on a
  // deliberate hold, long enough to reliably catch a quick tap.
  tapHoldThresholdSec: 0.15,
  // World-space lateral distance a single completed tap nudges the whole
  // (locked, so still rigid) rig sideways.
  nudgeDistanceFt: 0.1,
  // Heading change applied by a single Q/E rotate-nudge (see nudgeRotate).
  rotateNudgeRad: 0.02, // ~1.15 deg
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
    tapSteerDir: 0,
    tapHoldSec: 0,
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

  // --- Lock / tap-vs-hold / nudge state machine -----------------------
  // While locked, a steer press doesn't immediately do anything — we wait
  // to see whether it's a quick tap (nudge, lock stays) or a sustained hold
  // (breaks the lock, hands off to normal steering below). While already
  // unlocked, steering is immediate as always; no tap/hold bookkeeping.
  let locked = state.locked;
  let tapSteerDir = 0;
  let tapHoldSec = 0;
  let steeringActive = !locked;
  let nudgeFt = 0;

  if (locked) {
    if (steer !== 0) {
      if (state.tapSteerDir === steer) {
        tapHoldSec = state.tapHoldSec + dt;
      } else {
        // New press (or a direction change mid-press, which just restarts
        // the timer for the new direction rather than firing a nudge for
        // whatever was pending before).
        tapHoldSec = dt;
      }
      tapSteerDir = steer;

      if (tapHoldSec >= spec.tapHoldThresholdSec) {
        // Graduated into a hold: break the lock and steer immediately,
        // this same frame.
        locked = false;
        steeringActive = true;
        tapSteerDir = 0;
        tapHoldSec = 0;
      }
    } else if (state.tapSteerDir !== 0 && state.tapHoldSec < spec.tapHoldThresholdSec) {
      // Key released before the hold threshold: a completed tap.
      nudgeFt = state.tapSteerDir * spec.nudgeDistanceFt;
    }
  }

  // No steering authority while essentially stopped, like real handlebars
  // that need rolling speed to actually turn the rig — but full authority
  // well before max speed (see turnRampSpeedFtPerSec above).
  const speedFraction = clamp(Math.abs(speedFtPerSec) / spec.turnRampSpeedFtPerSec, 0, 1);
  const turnDir = speedFtPerSec >= 0 ? 1 : -1;
  // Negated: with heading 0 pointing toward +Z, increasing heading curves
  // toward +X, which is screen-left for a camera facing +Z. Flip so that
  // steer > 0 (D / right) turns right on screen, steer < 0 (A / left) turns left.
  const headingDelta = steeringActive ? -steer * spec.maxTurnRateRadPerSec * speedFraction * turnDir * dt : 0;
  const striperHeading = state.striperHeading + headingDelta;

  const sf = forwardVector(striperHeading);
  let striperX = state.striperX + sf.x * speedFtPerSec * dt;
  let striperZ = state.striperZ + sf.z * speedFtPerSec * dt;

  if (nudgeFt !== 0) {
    // Nudge is lateral only — both units are still rigidly aligned at this
    // point (we're still locked), so shifting the striper's reference
    // point sideways and re-deriving the buggy from it (below) moves the
    // whole rig sideways together, heading unchanged.
    const r = rightVector(striperHeading);
    striperX += r.x * nudgeFt;
    striperZ += r.z * nudgeFt;
  }

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
    tapSteerDir,
    tapHoldSec,
    nozzleOn: input.spray,
  };
}

/**
 * A single discrete rotate-nudge (Q/E keys), separate from the steer-driven
 * tap/hold system above since there's no competing "hold" behavior to
 * disambiguate from — every keydown (including the browser's natural
 * key-repeat while held) just applies one nudge. `dir` follows the same
 * sign convention as `RigInput.steer`: +1 = right (E), -1 = left (Q). A
 * no-op while unlocked — fine-rotating only makes sense once the two units
 * are aligned, same precondition as the lateral nudge.
 *
 * Rotates around the striper's own position (its handlebars are what's
 * conceptually being nudged), re-deriving the buggy from it via the same
 * hitch-arm formula `stepRig` uses — identical in spirit to how normal
 * steering already moves the striper and lets the buggy follow.
 */
export function nudgeRotate(state: RigState, dir: number): RigState {
  if (!state.locked) return state;

  const striperHeading = state.striperHeading - dir * RIG_SPEC.rotateNudgeRad;
  const buggyHeading = striperHeading; // still locked/aligned
  const bf = forwardVector(buggyHeading);
  const buggyX = state.striperX - bf.x * RIG_SPEC.frameLengthFt;
  const buggyZ = state.striperZ - bf.z * RIG_SPEC.frameLengthFt;

  return {
    ...state,
    striperHeading,
    buggyHeading,
    buggyX,
    buggyZ,
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
