/**
 * Tracks consecutive precisely-placed spray hits to drive the "PERFECT!"
 * celebration — deliberately NOT one celebration per precise hit (at 60fps
 * that would fire dozens of times a second while tracking a line
 * carefully, which reads as spam, not a reward). Instead it only fires
 * once a run of consecutive precise *new* coverage reaches
 * `streakLengthNeeded`, then resets, so it celebrates roughly every
 * `streakLengthNeeded` feet of expertly-painted line (at 1 sample/ft).
 */

export const PERFECT_PRECISION_FT = 0.05;
const STREAK_LENGTH_NEEDED = 5;

export interface PerfectStreakState {
  count: number;
}

export function createPerfectStreakState(): PerfectStreakState {
  return { count: 0 };
}

/**
 * `newlyCovered`/`lineDistanceFt` come straight from
 * `CoverageTracker.recordSpray`, called once per render frame (~60/sec)
 * while spraying. A given sample only crosses into capture radius on a
 * single frame — every other frame along a dead-on pass has
 * `newlyCovered === 0` simply because there's nothing left nearby to newly
 * cover, not because the player did anything wrong. So "no new coverage"
 * only breaks the streak if it's ALSO off-line (drifted away from the
 * required line with nothing to show for it); if still on-line it's
 * treated as neutral — preserves the streak without advancing it — so a
 * precise pass can actually reach `streakLengthNeeded` instead of getting
 * reset by the many idle-but-on-line frames between each new sample.
 */
export function updatePerfectStreak(
  state: PerfectStreakState,
  newlyCovered: number,
  lineDistanceFt: number,
): { state: PerfectStreakState; triggered: boolean } {
  const onLine = lineDistanceFt <= PERFECT_PRECISION_FT;

  if (newlyCovered === 0) {
    if (onLine) return { state, triggered: false };
    return state.count === 0 ? { state, triggered: false } : { state: { count: 0 }, triggered: false };
  }

  if (!onLine) {
    return state.count === 0 ? { state, triggered: false } : { state: { count: 0 }, triggered: false };
  }

  const count = state.count + 1;
  if (count >= STREAK_LENGTH_NEEDED) {
    return { state: { count: 0 }, triggered: true };
  }
  return { state: { count }, triggered: false };
}
