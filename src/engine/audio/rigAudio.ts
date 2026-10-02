/**
 * Rig sound effects via the Web Audio API. The engine loop and spray loop
 * are real recorded samples (`public/sounds/`, served as static files —
 * see CLAUDE.md on why that belongs in `public/` and not an `src/` import);
 * the lock/unlock clicks are still procedurally synthesized (short noise
 * bursts), since a one-off mechanical click is easy to synthesize
 * convincingly and didn't need a recorded asset.
 *
 * Must be constructed from inside a real user-gesture call stack (e.g. a
 * click handler) or browsers will create the AudioContext in a suspended
 * state and silently block playback. `JobSiteScene` is already constructed
 * synchronously from the "Start Job" button's click handler in main.ts, so
 * this piggybacks on that gesture rather than needing one of its own. Each
 * sample's fetch+decode is necessarily async and happens after that, but
 * that's fine — the constraint is on the AudioContext's creation/unlock,
 * not on when any particular sound starts playing.
 */

const ENGINE_LOOP_URL = '/sounds/striping_simulator_engine_idle_loop.wav';
const SPRAY_LOOP_URL = '/sounds/striping_simulator_paint_spray_loop.wav';

export class RigAudio {
  private readonly ctx: AudioContext;
  private readonly engineGain: GainNode;
  private readonly sprayGain: GainNode;
  private sprayBuffer: AudioBuffer | null = null;
  private spraySource: AudioBufferSourceNode | null = null;
  private started = false;

  // "Making a connection" tone: a continuously-running pair of oscillators
  // (root + a fifth above, for a fuller chime rather than a bare sine)
  // whose shared gain fades in only while actively gaining new coverage,
  // and whose pitch rises with overall job completion — see
  // setProgressTone(). Runs the whole job site phase at gain 0 when idle,
  // same "start once, just modulate gain/frequency" pattern as the old
  // synthesized engine sound, since oscillators can't be restarted once
  // stopped.
  private readonly progressOsc: OscillatorNode;
  private readonly progressOsc2: OscillatorNode;
  private readonly progressGain: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    void this.ctx.resume();

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0; // ramped up by setEngineLevel once driving starts
    this.engineGain.connect(this.ctx.destination);

    this.sprayGain = this.ctx.createGain();
    this.sprayGain.gain.value = 0.7;
    this.sprayGain.connect(this.ctx.destination);

    this.progressGain = this.ctx.createGain();
    this.progressGain.gain.value = 0;
    this.progressGain.connect(this.ctx.destination);

    this.progressOsc = this.ctx.createOscillator();
    this.progressOsc.type = 'sine';
    this.progressOsc.frequency.value = 320;
    this.progressOsc.connect(this.progressGain);

    this.progressOsc2 = this.ctx.createOscillator();
    this.progressOsc2.type = 'triangle';
    this.progressOsc2.frequency.value = 320 * 1.5; // perfect fifth above, for shimmer
    const progressOsc2Gain = this.ctx.createGain();
    progressOsc2Gain.gain.value = 0.35; // quieter than the root tone
    this.progressOsc2.connect(progressOsc2Gain).connect(this.progressGain);
  }

  /** Call once, after the AudioContext is allowed to play (see class doc).
   * Kicks off loading both samples; the engine loop starts playing as soon
   * as it's ready, the spray loop just gets preloaded and sits ready for
   * `startSpray()`/`stopSpray()` — preloading here rather than on first
   * spray avoids a delay on the player's very first press of Space. Also
   * starts the (silent until needed) progress-tone oscillators. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.progressOsc.start();
    this.progressOsc2.start();
    void this.loadAndLoopEngine();
    void this.loadSprayBuffer();
  }

  private async loadAndLoopEngine(): Promise<void> {
    try {
      const response = await fetch(ENGINE_LOOP_URL);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.loop = true;
      source.connect(this.engineGain);
      source.start();
    } catch (err) {
      // Non-fatal: the game is fully playable without engine audio.
      console.error('RigAudio: failed to load engine loop', err);
    }
  }

  private async loadSprayBuffer(): Promise<void> {
    try {
      const response = await fetch(SPRAY_LOOP_URL);
      const arrayBuffer = await response.arrayBuffer();
      this.sprayBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      // Non-fatal: the game is fully playable without spray audio.
      console.error('RigAudio: failed to load spray loop', err);
    }
  }

  /** Call every frame with 0 (stopped) .. 1 (max speed) to modulate the
   * engine's volume with how fast the rig is moving. Doesn't pitch-shift
   * the sample — it's a single idle-loop recording, not a multi-RPM set,
   * so speeding up playback would sound more like a chipmunk effect than a
   * revving engine. */
  setEngineLevel(speedFraction: number): void {
    const now = this.ctx.currentTime;
    const idleGain = 0.5;
    const targetGain = idleGain + speedFraction * 0.4;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.15);
  }

  /** Starts the spray loop immediately (hard start, not a fade-in) — a
   * fresh `AudioBufferSourceNode` each time, since nodes are single-use and
   * can't be restarted after `stop()`. No-ops if already playing (so a
   * caller doing simple edge-detection on a boolean doesn't double-start)
   * or if the buffer hasn't finished loading yet. */
  startSpray(): void {
    if (this.spraySource || !this.sprayBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.sprayBuffer;
    source.loop = true;
    source.connect(this.sprayGain);
    source.start();
    this.spraySource = source;
  }

  /** Cuts the spray loop immediately (hard stop, not a fade-out) —
   * matches the nozzle itself switching off instantly, not trailing off. */
  stopSpray(): void {
    if (!this.spraySource) return;
    this.spraySource.stop();
    this.spraySource.disconnect();
    this.spraySource = null;
  }

  /** Call every frame while spraying with whether this frame's spray point
   * just covered new ground (not just "is spraying" — this should only
   * sound while genuinely making progress, not while idling on
   * already-painted asphalt) and the overall completion fraction (0..1).
   * Fades in fast / out slower, and the pitch climbs as the job nears
   * completion — "building anticipation" toward finishing. Call with
   * `active: false` when the nozzle is off entirely. */
  setProgressTone(active: boolean, completionFraction: number): void {
    const now = this.ctx.currentTime;
    const minFreq = 320;
    const maxFreq = 1000;
    const targetFreq = minFreq + completionFraction * (maxFreq - minFreq);
    this.progressOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
    this.progressOsc2.frequency.setTargetAtTime(targetFreq * 1.5, now, 0.08);
    const targetGain = active ? 0.12 : 0;
    this.progressGain.gain.setTargetAtTime(targetGain, now, active ? 0.05 : 0.2);
  }

  /** Short ascending three-note chime for the "PERFECT!" precision
   * celebration — distinct from the continuous progress tone above (this
   * is a one-shot reward sting, not a continuous feedback signal). */
  playPerfectChime(): void {
    const now = this.ctx.currentTime;
    const notesHz = [660, 880, 1320]; // a bright major-ish triad, ascending
    notesHz.forEach((freq, i) => {
      const startAt = now + i * 0.07;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.25, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.32);
    });
  }

  /** Short mechanical click, played once per transition. Lock and unlock
   * use different pitches so they're distinguishable by ear alone. */
  private playClick(pitch: number): void {
    const now = this.ctx.currentTime;
    const durationSec = 0.035;
    const sampleCount = Math.floor(this.ctx.sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      const envelope = Math.exp(-i / (sampleCount * 0.15));
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400 * pitch;
    filter.Q.value = 2.5;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;

    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
  }

  /** Higher-pitched "solid" click for the hitch locking into place. */
  playLockClick(): void {
    this.playClick(1.3);
  }

  /** Lower-pitched "release" click for the hitch unlocking. */
  playUnlockClick(): void {
    this.playClick(0.8);
  }
}
