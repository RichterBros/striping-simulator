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
const NOZZLE_HOUSING_COLOR = 0xe8622a;

const WHEEL_RIM_COLOR = 0xf2f2f2;
const WHEEL_HUB_COLOR = 0x1c1c1c;
const WHEEL_LUG_COLOR = 0xc9cdd1;
const wheelRimMat = new THREE.MeshStandardMaterial({ color: WHEEL_RIM_COLOR, roughness: 0.5 });
const wheelHubMat = new THREE.MeshStandardMaterial({ color: WHEEL_HUB_COLOR, roughness: 0.6 });
const wheelLugMat = new THREE.MeshStandardMaterial({ color: WHEEL_LUG_COLOR, metalness: 0.6, roughness: 0.3 });

/** Matches `reference images/wheel-ref.png`: black tire, white rim, dark
 * center hub cap, 5 lug nuts. */
function wheel(radius: number, width: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 16);
  // Bakes the cylinder's axis onto local X, so spinning the mesh around its
  // own rotation.x (done per-frame in JobSiteScene, driven by distance
  // traveled) reads as the wheel actually rolling, not just a static disc.
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wheel';
  mesh.userData.wheelRadiusFt = radius;

  // Rim/hub/lugs are built on both faces (not just the outward-facing one),
  // since which local-X direction ends up facing the camera depends on
  // which side of the vehicle the wheel is on — a single-faced build risks
  // putting all the detail on whichever face is hidden against the
  // chassis. They're children of the wheel mesh, so they spin for free
  // along with mesh.rotation.x; this is also what makes the (otherwise
  // radially-symmetric) tire's rotation visually readable at all.
  for (const side of [1, -1]) {
    const faceX = (side * width) / 2 + side * 0.01; // sits just proud of the tire face

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.12, 16),
      wheelRimMat,
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.set(faceX, 0, 0);
    mesh.add(rim);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width * 0.18, 12),
      wheelHubMat,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.set(faceX + side * 0.02, 0, 0);
    mesh.add(hub);

    const lugCount = 5;
    const lugOrbitRadius = radius * 0.32;
    for (let i = 0; i < lugCount; i++) {
      const angle = (i / lugCount) * Math.PI * 2;
      const lug = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.07, 6, 6), wheelLugMat);
      lug.position.set(
        faceX + side * 0.025,
        Math.cos(angle) * lugOrbitRadius,
        Math.sin(angle) * lugOrbitRadius,
      );
      mesh.add(lug);
    }
  }

  return mesh;
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
    // Painted-plastic orange housing (matches real Graco-style spray guns),
    // not polished chrome — low metalness, moderate roughness for a
    // semi-gloss painted finish rather than a mirror.
    new THREE.MeshStandardMaterial({ color: NOZZLE_HOUSING_COLOR, metalness: 0.1, roughness: 0.45 }),
  );
  gunHousing.position.set(0, gunHeight - barHeight, length);
  assembly.add(gunHousing);

  // Marker object: its world position is read to place paint. Kept tiny/invisible.
  const nozzleMarker = new THREE.Object3D();
  nozzleMarker.name = 'nozzle';
  nozzleMarker.position.set(0, markerHeight - barHeight, length);
  assembly.add(nozzleMarker);

  return assembly;
}
