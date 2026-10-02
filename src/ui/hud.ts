export type Phase = 'yard' | 'jobsite';

const CONTROLS_TEXT =
  'EQUIPMENT YARD\n' +
  'Click equipment  —  load/unload the truck\n' +
  '\n' +
  'JOB SITE\n' +
  'W / S  —  drive forward / back\n' +
  'A / D  —  steer left / right\n' +
  'SPACE  —  spray paint';

export class Hud {
  readonly root: HTMLDivElement;
  private readonly instructions: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly completionWrap: HTMLDivElement;
  private readonly completionBar: HTMLDivElement;
  private readonly completionLabel: HTMLDivElement;
  private readonly controlsPanel: HTMLDivElement;
  private onStartJob: (() => void) | null = null;

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

    this.completionWrap = document.createElement('div');
    this.completionWrap.className = 'hud-completion';
    this.completionLabel = document.createElement('div');
    this.completionLabel.className = 'hud-completion-label';
    this.completionBar = document.createElement('div');
    this.completionBar.className = 'hud-completion-bar';
    const fill = document.createElement('div');
    fill.className = 'hud-completion-fill';
    this.completionBar.appendChild(fill);
    this.completionWrap.appendChild(this.completionLabel);
    this.completionWrap.appendChild(this.completionBar);
    this.root.appendChild(this.completionWrap);

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

    this.setPhase('yard');
  }

  setPhase(phase: Phase): void {
    if (phase === 'yard') {
      this.instructions.textContent = 'Click equipment to load the truck, then press Start Job.';
      this.startButton.style.display = 'inline-block';
      this.completionWrap.style.display = 'none';
      this.controlsPanel.style.display = 'block';
    } else {
      this.instructions.textContent =
        'W/S: drive  A/D: steer  SPACE: spray paint  — stripe the lot along the reference lines.';
      this.startButton.style.display = 'none';
      this.completionWrap.style.display = 'block';
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
    this.completionLabel.textContent = `Striping complete: ${pct}%`;
    const fillEl = this.completionBar.firstElementChild as HTMLDivElement | null;
    if (fillEl) fillEl.style.width = `${pct}%`;
  }
}
