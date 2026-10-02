/**
 * Procedurally synthesized rig sound effects via the Web Audio API — no
 * imported audio assets yet, consistent with the project's current
 * procedural-everything approach (primitive geometry, no imported models).
 *
 * Must be constructed from inside a real user-gesture call stack (e.g. a
 * click handler) or browsers will create the AudioContext in a suspended
 * state and silently block playback. `JobSiteScene` is already constructed
 * synchronously from the "Start Job" button's click handler in main.ts, so
 * this piggybacks on that gesture rather than needing one of its own.
 */

export class RigAudio {
  private readonly ctx: AudioContext;
  private readonly engineOsc: OscillatorNode;
  private readonly engineGain: GainNode;
  private started = false;

  constructor() {
    this.ctx = new AudioContext();
    void this.ctx.resume();

    // Low engine rumble: a sawtooth through a low-pass filter reads as a
    // rough idling engine rather than a pure, synthetic tone.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 42;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0; // ramped up by setEngineLevel once driving starts

    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.ctx.destination);
  }

  /** Call once, after the AudioContext is allowed to play (see class doc). */
  start(): void {
    if (this.started) return;
    this.engineOsc.start();
    this.started = true;
  }

  /** Call every frame with 0 (stopped) .. 1 (max speed) to modulate the
   * engine's volume and pitch with how fast the rig is moving. */
  setEngineLevel(speedFraction: number): void {
    const now = this.ctx.currentTime;
    const idleGain = 0.025;
    const targetGain = idleGain + speedFraction * 0.045;
    const targetFreq = 42 + speedFraction * 28;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.15);
    this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.15);
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
