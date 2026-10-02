import * as THREE from 'three';

/**
 * Local-space convention for every mesh built here: +Z is "forward".
 * A parent's `rotation.y = heading` then matches the core physics
 * convention in stripingRig.ts (x = sin(heading), z = cos(heading)).
 */

const BUGGY_COLOR = 0x1c3f94;
const STRIPER_COLOR = 0x1c3f94;
const WHEEL_COLOR = 0x111111;
const METAL_COLOR = 0xb9c2cc;

function wheel(radius: number, width: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 16);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.9 });
  return new THREE.Mesh(geo, mat);
}

export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buggy';

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.6, 4.2),
    new THREE.MeshStandardMaterial({ color: BUGGY_COLOR, roughness: 0.6 }),
  );
  chassis.position.set(0, 0.7, 0);
  group.add(chassis);

  const seatBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.8 }),
  );
  seatBase.position.set(0, 1.1, -1.2);
  group.add(seatBase);

  const seatBack = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.0, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.8 }),
  );
  seatBack.position.set(0, 1.6, -1.75);
  group.add(seatBack);

  const engineBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.9, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5 }),
  );
  engineBox.position.set(0, 1.25, 1.3);
  group.add(engineBox);

  const handlebarPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8),
    new THREE.MeshStandardMaterial({ color: METAL_COLOR }),
  );
  handlebarPost.position.set(0, 1.6, -0.1);
  group.add(handlebarPost);

  const handlebar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: METAL_COLOR }),
  );
  handlebar.rotation.z = Math.PI / 2;
  handlebar.position.set(0, 2.05, -0.1);
  group.add(handlebar);

  const rearWheelL = wheel(0.55, 0.35);
  rearWheelL.position.set(-1.25, 0.55, -1.0);
  group.add(rearWheelL);

  const rearWheelR = wheel(0.55, 0.35);
  rearWheelR.position.set(1.25, 0.55, -1.0);
  group.add(rearWheelR);

  const frontWheel = wheel(0.3, 0.2);
  frontWheel.position.set(0, 0.3, 1.8);
  group.add(frontWheel);

  const headlight = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff4c2, emissive: 0xfff4c2, emissiveIntensity: 0.6 }),
  );
  headlight.position.set(0, 0.9, 2.05);
  group.add(headlight);

  return group;
}

export function buildStriperMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'striper';

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.5, 3.2),
    new THREE.MeshStandardMaterial({ color: STRIPER_COLOR, roughness: 0.6 }),
  );
  chassis.position.set(0, 0.6, 0.3);
  group.add(chassis);

  const paintTank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
  );
  paintTank.position.set(0, 1.25, 1.2);
  group.add(paintTank);

  const engineBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.9, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5 }),
  );
  engineBox.position.set(0, 1.1, -0.9);
  group.add(engineBox);

  const wheelL = wheel(0.45, 0.3);
  wheelL.position.set(-1.0, 0.45, 0.2);
  group.add(wheelL);

  const wheelR = wheel(0.45, 0.3);
  wheelR.position.set(1.0, 0.45, 0.2);
  group.add(wheelR);

  // Nozzle assembly: a horizontal metal boom arm sticking out to the
  // front-right near ground level, with the spray gun hanging off its tip —
  // matches the reference photo (`graco-linelazerwebp.webp`), not a centered
  // rear nozzle. Local -X is world "right" at heading 0 (see rightVector()
  // in stripingRig.ts). The tip lines up with the physics offsets in
  // RIG_SPEC (nozzleForwardOffsetFt / nozzleRightOffsetFt) so the visible
  // gun matches where paint actually originates.
  group.add(buildNozzleArmAssembly());

  // No rigid tow bar here: the buggy connects via an articulated hitch, not
  // a fixed frame (see stripingRig.ts) — JobSiteScene draws a hitch bar that
  // swings between the two units' actual pivot points each frame instead.

  return group;
}

/**
 * Mount point (near the chassis edge) and tip (where paint actually
 * originates, matching RIG_SPEC.nozzleForwardOffsetFt/nozzleRightOffsetFt)
 * are both given in the striper's local space. The arm bar is built level
 * (constant height) running between them; the gun housing and paint origin
 * hang below the tip, near ground level.
 */
function buildNozzleArmAssembly(): THREE.Group {
  const mount = { x: -0.85, z: 1.3 };
  const tip = { x: -2.0, z: 2.0 }; // matches RIG_SPEC.nozzleRightOffsetFt/nozzleForwardOffsetFt
  const barHeight = 0.32;
  const gunHeight = 0.18;
  const markerHeight = 0.08;

  const dx = tip.x - mount.x;
  const dz = tip.z - mount.z;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);

  const assembly = new THREE.Group();
  assembly.position.set(mount.x, barHeight, mount.z);
  assembly.rotation.y = angle;

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, length),
    new THREE.MeshStandardMaterial({ color: METAL_COLOR }),
  );
  bar.position.set(0, 0, length / 2);
  assembly.add(bar);

  const mountBracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.2, 0.18),
    new THREE.MeshStandardMaterial({ color: METAL_COLOR }),
  );
  assembly.add(mountBracket);

  const gunHousing = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.22, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x222222 }),
  );
  gunHousing.position.set(0, gunHeight - barHeight, length);
  assembly.add(gunHousing);

  // Counter-rotate so the little guide wheel still rolls aligned with the
  // rig's main direction of travel, regardless of the arm's own angle.
  const guideWheel = wheel(0.12, 0.08);
  guideWheel.rotation.y = -angle;
  guideWheel.position.set(0, markerHeight - barHeight, length + 0.2);
  assembly.add(guideWheel);

  // Marker object: its world position is read to place paint. Kept tiny/invisible.
  const nozzleMarker = new THREE.Object3D();
  nozzleMarker.name = 'nozzle';
  nozzleMarker.position.set(0, markerHeight - barHeight, length);
  assembly.add(nozzleMarker);

  return assembly;
}
