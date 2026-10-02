import * as THREE from 'three';
import { forwardVector, rightVector } from '../../core/heading.ts';

export function createTopDownCamera(viewDepthFt: number, aspect: number): THREE.OrthographicCamera {
  const halfD = viewDepthFt / 2;
  const halfW = halfD * aspect;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfD, -halfD, 0.1, 500);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 100, 0);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function frameTopDownCamera(
  camera: THREE.OrthographicCamera,
  centerX: number,
  centerZ: number,
  viewDepthFt: number,
  aspect: number,
): void {
  const halfD = viewDepthFt / 2;
  const halfW = halfD * aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfD;
  camera.bottom = -halfD;
  camera.position.set(centerX, 100, centerZ);
  camera.lookAt(centerX, 0, centerZ);
  camera.updateProjectionMatrix();
}

export interface OverShoulderTarget {
  x: number;
  z: number;
  heading: number;
}

/**
 * Smoothly follows behind and above the buggy, looking past it toward the
 * striper and nozzle out front. Offset to the buggy's RIGHT so the buggy's
 * own body doesn't block the view of the striper/nozzle directly ahead on a
 * rigid, non-articulated frame — a dead-center chase cam would have them
 * collinear on straightaways.
 */
export class OverShoulderCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly backDistanceFt = 11;
  private readonly heightFt = 5;
  private readonly sideOffsetFt = 4.5; // toward the buggy's right
  private readonly lookAheadFt = 8;
  private readonly followLerp = 6; // higher = snappier

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.1, 1000);
  }

  snapTo(target: OverShoulderTarget): void {
    const desired = this.desiredPosition(target);
    this.camera.position.set(desired.x, desired.y, desired.z);
    const look = this.lookTarget(target);
    this.camera.lookAt(look.x, look.y, look.z);
  }

  update(target: OverShoulderTarget, dt: number): void {
    const desired = this.desiredPosition(target);
    const t = 1 - Math.exp(-this.followLerp * dt);
    this.camera.position.lerp(new THREE.Vector3(desired.x, desired.y, desired.z), t);
    const look = this.lookTarget(target);
    const currentLook = new THREE.Vector3();
    this.camera.getWorldDirection(currentLook);
    const desiredDir = new THREE.Vector3(look.x, look.y, look.z).sub(this.camera.position).normalize();
    const blended = currentLook.lerp(desiredDir, t);
    this.camera.lookAt(this.camera.position.clone().add(blended));
  }

  private desiredPosition(target: OverShoulderTarget): { x: number; y: number; z: number } {
    const f = forwardVector(target.heading);
    const r = rightVector(target.heading);
    return {
      x: target.x - f.x * this.backDistanceFt + r.x * this.sideOffsetFt,
      y: this.heightFt,
      z: target.z - f.z * this.backDistanceFt + r.z * this.sideOffsetFt,
    };
  }

  private lookTarget(target: OverShoulderTarget): { x: number; y: number; z: number } {
    const f = forwardVector(target.heading);
    return {
      x: target.x + f.x * this.lookAheadFt,
      y: 1.2,
      z: target.z + f.z * this.lookAheadFt,
    };
  }
}
