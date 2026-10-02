export type Phase = 'yard' | 'jobsite';

const CONTROLS_TEXT =
  'EQUIPMENT YARD\n' +
  'Click equipment  —  load/unload the truck\n' +
  '\n' +
  'JOB SITE\n' +
  'W / S  —  drive forward / back\n' +
  'A / D  —  steer left / right\n' +
  '  While locked, a quick tap nudges\n' +
  '  sideways without turning — hold to steer normally\n' +
  'Q / E  —  nudge-rotate left / right (while locked)\n' +
  'SPACE  —  spray paint';

export class Hud {
  readonly root: HTMLDivElement;
  private readonly instructions: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly controlsPanel: HTMLDivElement;
  private readonly scorePanel: HTMLDivElement;
  private readonly scorePercent: HTMLDivElement;
  private readonly scoreBar: HTMLDivElement;
  private readonly perfectPopup: HTMLDivElement;
  private readonly lockBadge: HTMLDivElement;
  private onStartJob: (() => void) | null = null;
  private lastShownPct = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'STRIPING SIMULATOR';
    this.root.appendChild(title);

    this.instructions = document.createElement('div');
    this.instructions.className = 'hud-instructions';
    this.root.appendChild(this.instructions);

    this.startButton = document.createElement('button');
    this.startButton.className = 'hud-start-button';
    this.startButton.textContent = 'Start Job';
    this.startButton.disabled = true;
    this.startButton.addEventListener('click', () => this.onStartJob?.());
    this.root.appendChild(this.startButton);

    // Big arcade-style score readout, top-right — independently positioned
    // (not part of the left-aligned flex stack above) same way the
    // controls panel already escapes it.
    this.scorePanel = document.createElement('div');
    this.scorePanel.className = 'hud-score-panel';
    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'hud-score-label';
    scoreLabel.textContent = 'STRIPING COMPLETE';
    this.scorePercent = document.createElement('div');
    this.scorePercent.className = 'hud-score-percent';
    this.scorePercent.textContent = '0%';
    this.scoreBar = document.createElement('div');
    this.scoreBar.className = 'hud-score-bar';
    const scoreBarFill = document.createElement('div');
    scoreBarFill.className = 'hud-score-bar-fill';
    this.scoreBar.appendChild(scoreBarFill);
    this.scorePanel.appendChild(scoreLabel);
    this.scorePanel.appendChild(this.scorePercent);
    this.scorePanel.appendChild(this.scoreBar);
    this.root.appendChild(this.scorePanel);

    this.controlsPanel = document.createElement('div');
    this.controlsPanel.className = 'hud-controls-panel';
    const controlsTitle = document.createElement('div');
    controlsTitle.className = 'hud-controls-title';
    controlsTitle.textContent = 'Controls';
    const controlsBody = document.createElement('div');
    controlsBody.className = 'hud-controls-body';
    controlsBody.textContent = CONTROLS_TEXT;
    this.controlsPanel.appendChild(controlsTitle);
    this.controlsPanel.appendChild(controlsBody);
    this.root.appendChild(this.controlsPanel);

    // Center-screen "PERFECT!" celebration — independent of the rest of the
    // HUD, triggered transiently via flashPerfect() rather than shown/hidden
    // through setPhase like everything else here.
    this.perfectPopup = document.createElement('div');
    this.perfectPopup.className = 'hud-perfect-popup';
    this.perfectPopup.textContent = 'PERFECT!';
    this.root.appendChild(this.perfectPopup);

    // Top-center badge that tracks the hitch lock state directly (unlike
    // flashPerfect's one-shot animation, this just mirrors current state —
    // visible exactly while locked, gone the instant it unlocks).
    this.lockBadge = document.createElement('div');
    this.lockBadge.className = 'hud-lock-badge';
    const lockBadgeWheelLabel = document.createElement('div');
    lockBadgeWheelLabel.className = 'hud-lock-badge-wheel-label';
    lockBadgeWheelLabel.textContent = 'WHEEL';
    this.lockBadge.appendChild(lockBadgeWheelLabel);
    const lockBadgeText = document.createElement('div');
    lockBadgeText.textContent = '\u{1F512} LOCKED';
    this.lockBadge.appendChild(lockBadgeText);
    this.root.appendChild(this.lockBadge);

    this.setPhase('yard');
  }

  setPhase(phase: Phase): void {
    if (phase === 'yard') {
      this.instructions.textContent = 'Click equipment to load the truck, then press Start Job.';
      this.startButton.style.display = 'inline-block';
      this.scorePanel.style.display = 'none';
      this.controlsPanel.style.display = 'block';
      this.lockBadge.classList.remove('visible');
    } else {
      this.instructions.textContent =
        'W/S: drive  A/D: steer (tap to nudge, hold to turn)  Q/E: nudge-rotate  SPACE: spray paint  — stripe the lot along the reference lines.';
      this.startButton.style.display = 'none';
      this.scorePanel.style.display = 'flex';
      this.controlsPanel.style.display = 'none';
    }
  }

  setStartEnabled(enabled: boolean): void {
    this.startButton.disabled = !enabled;
  }

  setOnStartJob(cb: () => void): void {
    this.onStartJob = cb;
  }

  setCompletion(fraction: number): void {
    const pct = Math.round(fraction * 100);
    this.scorePercent.textContent = `${pct}%`;
    const fillEl = this.scoreBar.firstElementChild as HTMLDivElement | null;
    if (fillEl) fillEl.style.width = `${pct}%`;

    if (pct > this.lastShownPct) {
      this.scorePercent.classList.remove('bump');
      void this.scorePercent.offsetWidth; // force reflow so the animation restarts
      this.scorePercent.classList.add('bump');
    }
    this.lastShownPct = pct;
  }

  /** Transient "PERFECT!" celebration — call once per precision streak. */
  flashPerfect(): void {
    this.perfectPopup.classList.remove('show');
    void this.perfectPopup.offsetWidth; // force reflow so the animation restarts
    this.perfectPopup.classList.add('show');
  }

  /** Mirrors the hitch lock state every frame — visible iff `locked`. */
  setLocked(locked: boolean): void {
    this.lockBadge.classList.toggle('visible', locked);
  }
}
