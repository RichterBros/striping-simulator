import * as THREE from 'three';
import type { JobDef } from '../../core/jobs.ts';
import { generateStallLines, lotFootprint } from '../../core/layout.ts';
import { CoverageTracker } from '../../core/paintTracking.ts';
import { WetPaintField } from '../../core/paintDrying.ts';
import {
  createInitialRigState,
  hitchPivotPosition,
  nozzleWorldPosition,
  nudgeRotate,
  RIG_SPEC,
  stepRig,
  wheelContacts,
  type RigInput,
  type RigState,
} from '../../core/vehicles/stripingRig.ts';
import {
  createTireContaminationState,
  updateTireContamination,
  TIRE_SPEC,
  type TireContaminationState,
} from '../../core/vehicles/tireContamination.ts';
import { buildBuggyMesh, buildStriperMesh } from './vehicleMesh.ts';
import { OverShoulderCamera } from './cameras.ts';
import { RibbonTrail } from './paintRibbon.ts';
import { RigAudio } from '../audio/rigAudio.ts';

const PAINT_COLOR = '#f5f3ee';
const ASPHALT_COLOR = '#3a3b3d';
// Depth order (low to high): ground(0) < tire tracks < main stripe < reference lines.
// Tracks sit "on" the asphalt; the stripe reads as fresher/on top where they
// overlap; reference lines stay visible as a guide over painted stripe.
const TIRE_TRACK_HEIGHT_Y = 0.01;
const STRIPE_HEIGHT_Y = 0.015;
const REFERENCE_LINE_HEIGHT_Y = 0.02;

const GROUND_MARGIN_FT = 20;

export interface JobSiteInputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  spray: boolean;
}

export class JobSiteScene {
  readonly scene = new THREE.Scene();
  private readonly overShoulder: OverShoulderCamera;
  get camera(): THREE.PerspectiveCamera {
    return this.overShoulder.camera;
  }

  private rig: RigState;
  private readonly buggyMesh: THREE.Group;
  private readonly striperMesh: THREE.Group;
  private readonly hitchBar: THREE.Mesh;
  private readonly nozzleMarker: THREE.Object3D;
  private readonly stripeRibbon: RibbonTrail;
  private readonly wheelTrails: RibbonTrail[];
  private readonly coverage: CoverageTracker;
  private readonly wetPaint: WetPaintField;
  private tireContamination: TireContaminationState = createTireContaminationState();
  private elapsedSec = 0;
  private readonly groundWidthFt: number;
  private readonly groundDepthFt: number;
  private readonly audio: RigAudio;
  private wasLocked: boolean;

  constructor(job: JobDef, aspect: number) {
    const footprint = lotFootprint(job.lot);
    this.groundWidthFt = footprint.widthFt + GROUND_MARGIN_FT * 2;
    this.groundDepthFt = footprint.depthFt + GROUND_MARGIN_FT * 2;

    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 60, 220);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(40, 60, 20);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.groundWidthFt, this.groundDepthFt),
      new THREE.MeshStandardMaterial({ color: ASPHALT_COLOR, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(footprint.widthFt / 2, 0, footprint.depthFt / 2);
    this.scene.add(ground);

    this.stripeRibbon = new RibbonTrail(PAINT_COLOR, RIG_SPEC.stripeLineWidthFt, STRIPE_HEIGHT_Y);
    this.scene.add(this.stripeRibbon.group);

    this.wheelTrails = Array.from(
      { length: 4 },
      () => new RibbonTrail(PAINT_COLOR, TIRE_SPEC.trackWidthFt, TIRE_TRACK_HEIGHT_Y, true),
    );
    for (const trail of this.wheelTrails) this.scene.add(trail.group);

    const requiredLines = generateStallLines(job.lot);
    this.scene.add(this.buildReferenceLines(requiredLines));
    this.coverage = new CoverageTracker(requiredLines, 1, RIG_SPEC.stripeLineWidthFt * 1.5);
    // Sample spacing must stay <= 2x pickupRadiusFt or gaps open up between
    // stored wet-paint samples along an otherwise continuously-sprayed line.
    this.wetPaint = new WetPaintField(TIRE_SPEC.pickupRadiusFt, 0.25);

    this.buggyMesh = buildBuggyMesh();
    this.striperMesh = buildStriperMesh();
    this.scene.add(this.buggyMesh);
    this.scene.add(this.striperMesh);
    const marker = this.striperMesh.getObjectByName('nozzle');
    if (!marker) throw new Error('striper mesh missing nozzle marker');
    this.nozzleMarker = marker;

    // Articulated hitch bar: swings between the striper's pivot and the
    // buggy's actual position each frame (see syncMeshesToRig), since the
    // two are no longer rigidly framed together.
    const hitchBarGeometry = new THREE.CylinderGeometry(0.05, 0.05, RIG_SPEC.frameLengthFt, 6);
    hitchBarGeometry.rotateX(Math.PI / 2); // axis -> local Z, matching the heading convention
    this.hitchBar = new THREE.Mesh(hitchBarGeometry, new THREE.MeshStandardMaterial({ color: 0xb9c2cc }));
    this.scene.add(this.hitchBar);

    const startX = footprint.widthFt / 2;
    const startZ = -GROUND_MARGIN_FT / 2;
    this.rig = createInitialRigState(startX, startZ, 0);
    this.wasLocked = this.rig.locked;
    this.syncMeshesToRig();

    // Constructed here (not lazily) because this constructor itself runs
    // synchronously inside the "Start Job" button's click handler in
    // main.ts — that's the real user gesture browsers require before an
    // AudioContext is allowed to actually produce sound.
    this.audio = new RigAudio();
    this.audio.start();

    this.overShoulder = new OverShoulderCamera(aspect);
    this.overShoulder.snapTo({ x: this.rig.buggyX, z: this.rig.buggyZ, heading: this.rig.buggyHeading });
  }

  private buildReferenceLines(lines: ReturnType<typeof generateStallLines>): THREE.LineSegments {
    const positions: number[] = [];
    for (const line of lines) {
      positions.push(line.x1, REFERENCE_LINE_HEIGHT_Y, line.z1, line.x2, REFERENCE_LINE_HEIGHT_Y, line.z2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    return new THREE.LineSegments(geometry, material);
  }

  private syncMeshesToRig(): void {
    this.buggyMesh.position.set(this.rig.buggyX, 0, this.rig.buggyZ);
    this.buggyMesh.rotation.y = this.rig.buggyHeading;
    this.striperMesh.position.set(this.rig.striperX, 0, this.rig.striperZ);
    this.striperMesh.rotation.y = this.rig.striperHeading;

    const pivot = hitchPivotPosition(this.rig);
    const dx = this.rig.buggyX - pivot.x;
    const dz = this.rig.buggyZ - pivot.z;
    this.hitchBar.position.set((pivot.x + this.rig.buggyX) / 2, 0.55, (pivot.z + this.rig.buggyZ) / 2);
    this.hitchBar.rotation.y = Math.atan2(dx, dz);
  }

  update(dt: number, input: JobSiteInputState): void {
    this.elapsedSec += dt;
    const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const rigInput: RigInput = { throttle, steer, spray: input.spray };

    this.rig = stepRig(this.rig, rigInput, dt);
    this.syncMeshesToRig();

    if (this.rig.locked !== this.wasLocked) {
      if (this.rig.locked) this.audio.playLockClick();
      else this.audio.playUnlockClick();
      this.wasLocked = this.rig.locked;
    }
    this.audio.setEngineLevel(Math.abs(this.rig.speedFtPerSec) / RIG_SPEC.maxForwardSpeedFtPerSec);

    if (this.rig.nozzleOn) {
      const nozzlePos = nozzleWorldPosition(this.rig);
      this.stripeRibbon.extendTo(nozzlePos.x, nozzlePos.z);
      this.coverage.recordSpray(nozzlePos.x, nozzlePos.z);
      this.wetPaint.recordPaint(nozzlePos.x, nozzlePos.z, this.elapsedSec);
    } else {
      this.stripeRibbon.breakStroke();
    }

    this.wetPaint.prune(this.elapsedSec);
    const wheels = wheelContacts(this.rig);
    const distanceFt = Math.abs(this.rig.speedFtPerSec) * dt;
    this.tireContamination = updateTireContamination(
      this.tireContamination,
      wheels,
      (x, z) => this.wetPaint.isWetAt(x, z),
      distanceFt,
    );

    if (this.tireContamination.level > 0) {
      const alpha = this.tireContamination.level * TIRE_SPEC.maxTrackAlpha;
      wheels.forEach((w, i) => {
        this.wheelTrails[i].extendTo(w.x, w.z, alpha);
      });
    } else {
      for (const trail of this.wheelTrails) trail.breakStroke();
    }

    this.overShoulder.update(
      { x: this.rig.buggyX, z: this.rig.buggyZ, heading: this.rig.buggyHeading },
      dt,
    );

    this.stripeRibbon.commitFrame();
    for (const trail of this.wheelTrails) trail.commitFrame();
  }

  getNozzleWorldPosition(): { x: number; z: number } {
    return nozzleWorldPosition(this.rig);
  }

  /** Discrete Q/E rotate-nudge — called directly from a keydown handler
   * (not the per-frame update() input), since it's a one-shot action, not
   * a continuous held input. No-ops while unlocked. */
  nudgeRotate(dir: number): void {
    this.rig = nudgeRotate(this.rig, dir);
    this.syncMeshesToRig();
  }

  get nozzleMarkerObject(): THREE.Object3D {
    return this.nozzleMarker;
  }

  completionFraction(): number {
    return this.coverage.completionFraction();
  }

  setAspect(aspect: number): void {
    this.overShoulder.camera.aspect = aspect;
    this.overShoulder.camera.updateProjectionMatrix();
  }
}
