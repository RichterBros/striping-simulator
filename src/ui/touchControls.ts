import type { JobSiteInputState } from '../engine/threejs/jobSiteScene.ts';

type HeldField = keyof Pick<JobSiteInputState, 'forward' | 'back' | 'left' | 'right' | 'spray'>;

/**
 * On-screen touch equivalent of the keyboard controls, for touch-primary
 * devices (see isTouchPrimaryDevice() in main.ts). Mutates the same shared
 * `JobSiteInputState` object the keyboard handlers already poll each frame
 * in main.ts's tick loop — so the rig physics/tap-vs-hold lock logic in
 * stripingRig.ts doesn't need to know or care whether a hold came from a
 * key or a touch button; both just flip the same booleans. The steer
 * buttons get the tap-vs-nudge/hold-to-turn behavior for free this way,
 * same as the keyboard's A/D.
 */
export class TouchControls {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, input: JobSiteInputState, onNudgeRotate: (dir: number) => void) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    parent.appendChild(this.root);

    const dpad = document.createElement('div');
    dpad.className = 'touch-dpad';
    this.root.appendChild(dpad);

    const forwardBtn = this.heldButton(input, 'forward', '▲');
    forwardBtn.classList.add('touch-dpad-forward');
    dpad.appendChild(forwardBtn);

    const leftBtn = this.heldButton(input, 'left', '◀');
    leftBtn.classList.add('touch-dpad-left');
    dpad.appendChild(leftBtn);

    const backBtn = this.heldButton(input, 'back', '▼');
    backBtn.classList.add('touch-dpad-back');
    dpad.appendChild(backBtn);

    const rightBtn = this.heldButton(input, 'right', '▶');
    rightBtn.classList.add('touch-dpad-right');
    dpad.appendChild(rightBtn);

    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    this.root.appendChild(actions);

    const nudgeRow = document.createElement('div');
    nudgeRow.className = 'touch-nudge-row';
    actions.appendChild(nudgeRow);

    const qBtn = this.tapButton('Q');
    qBtn.classList.add('touch-nudge-btn');
    qBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onNudgeRotate(-1);
    });
    nudgeRow.appendChild(qBtn);

    const eBtn = this.tapButton('E');
    eBtn.classList.add('touch-nudge-btn');
    eBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onNudgeRotate(1);
    });
    nudgeRow.appendChild(eBtn);

    const sprayBtn = this.heldButton(input, 'spray', 'SPRAY');
    sprayBtn.classList.add('touch-spray-btn');
    actions.appendChild(sprayBtn);
  }

  /** A button that sets `input[field]` true while held, false on release —
   * `pointercancel`/`lostpointercapture` are also wired so a finger
   * dragging off the button (common on a small touch target) still
   * reliably releases the input instead of leaving it stuck down. */
  private heldButton(input: JobSiteInputState, field: HeldField, label: string): HTMLButtonElement {
    const btn = this.tapButton(label);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      input[field] = true;
    });
    const release = (): void => {
      input[field] = false;
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    return btn;
  }

  private tapButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'touch-btn';
    btn.textContent = label;
    return btn;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
