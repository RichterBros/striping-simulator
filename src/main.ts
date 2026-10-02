import * as THREE from 'three';
import './style.css';
import equipmentData from './data/equipment.json';
import jobsData from './data/jobs.json';
import type { EquipmentDef } from './core/equipment.ts';
import type { JobDef } from './core/jobs.ts';
import { YardScene } from './engine/threejs/yardScene.ts';
import { JobSiteScene, type JobSiteInputState } from './engine/threejs/jobSiteScene.ts';
import { Hud, type Phase } from './ui/hud.ts';

const equipmentDefs = equipmentData as EquipmentDef[];
const jobs = jobsData as JobDef[];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const hud = new Hud(app);

let phase: Phase = 'yard';
let yardScene: YardScene | null = new YardScene(equipmentDefs, currentAspect());
let jobSiteScene: JobSiteScene | null = null;

const input: JobSiteInputState = { forward: false, back: false, left: false, right: false, spray: false };

function requiredEquipmentLoaded(job: JobDef, loaded: Set<string>): boolean {
  return job.requiredEquipment.every((id) => loaded.has(id));
}

function refreshStartButton(): void {
  if (!yardScene) return;
  const loaded = new Set(yardScene.getLoadedEquipment());
  hud.setStartEnabled(requiredEquipmentLoaded(jobs[0], loaded));
}

yardScene.onLoadedChanged(refreshStartButton);
refreshStartButton();

hud.setOnStartJob(() => {
  if (phase !== 'yard') return;
  phase = 'jobsite';
  yardScene = null;
  jobSiteScene = new JobSiteScene(jobs[0], currentAspect());
  hud.setPhase('jobsite');
});

renderer.domElement.addEventListener('click', (event) => {
  if (phase !== 'yard' || !yardScene) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  yardScene.handleClick(ndcX, ndcY);
});

const keyMap: Record<string, keyof JobSiteInputState> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'spray',
};

window.addEventListener('keydown', (e) => {
  const field = keyMap[e.code];
  if (!field) return;
  input[field] = true;
  if (e.code === 'Space') e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  const field = keyMap[e.code];
  if (!field) return;
  input[field] = false;
});

function currentAspect(): number {
  return window.innerWidth / window.innerHeight;
}

function handleResize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (jobSiteScene) jobSiteScene.setAspect(currentAspect());
  if (yardScene) yardScene.setAspect(currentAspect());
}
window.addEventListener('resize', handleResize);
handleResize();

let lastTime = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (phase === 'yard' && yardScene) {
    yardScene.update(dt);
    renderer.render(yardScene.scene, yardScene.camera);
  } else if (phase === 'jobsite' && jobSiteScene) {
    jobSiteScene.update(dt, input);
    hud.setCompletion(jobSiteScene.completionFraction());
    renderer.render(jobSiteScene.scene, jobSiteScene.camera);
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
