import * as THREE from 'three';
import type { EquipmentDef, EquipmentId } from '../../core/equipment.ts';
import { createTopDownCamera, frameTopDownCamera } from './cameras.ts';

interface PropEntry {
  id: EquipmentId;
  mesh: THREE.Mesh;
  yardPosition: THREE.Vector3;
  truckPosition: THREE.Vector3;
  loaded: boolean;
}

const YARD_DEPTH_FT = 40;
const GROUND_SIZE_FT = 160; // generously larger than any realistic viewport extent

export class YardScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly props: PropEntry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly equipmentDefs: Map<EquipmentId, EquipmentDef>;
  private onLoadedChange: (() => void) | null = null;

  constructor(equipmentDefs: EquipmentDef[], aspect: number) {
    this.equipmentDefs = new Map(equipmentDefs.map((def) => [def.id, def]));
    this.camera = createTopDownCamera(YARD_DEPTH_FT, aspect);
    frameTopDownCamera(this.camera, 0, 0, YARD_DEPTH_FT, aspect);

    this.scene.background = new THREE.Color(0x1a1d22);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(10, 30, 10);
    this.scene.add(sun);

    this.buildGround();
    this.buildTruck();
    this.buildEquipmentProps(equipmentDefs);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE_FT, GROUND_SIZE_FT),
      new THREE.MeshStandardMaterial({ color: 0x4a4d52 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  private buildTruck(): void {
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.2, 14),
      new THREE.MeshStandardMaterial({ color: 0x7a1f1f }),
    );
    bed.position.set(-12, 0.6, 0);
    this.scene.add(bed);

    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x7a1f1f }),
    );
    cab.position.set(-12, 1.1, -8.5);
    this.scene.add(cab);
  }

  private buildEquipmentProps(defs: EquipmentDef[]): void {
    const spacing = 6;
    const startX = -spacing * ((defs.length - 1) / 2);

    defs.forEach((def, i) => {
      const mesh = this.buildPropMesh(def);
      const yardPosition = new THREE.Vector3(startX + i * spacing + 14, 0.5, 10);
      const truckPosition = new THREE.Vector3(-12, 1.3 + i * 0.6, -4 + i * 1.8);
      mesh.position.copy(yardPosition);
      mesh.userData.equipmentId = def.id;
      this.scene.add(mesh);
      this.props.push({ id: def.id, mesh, yardPosition, truckPosition, loaded: false });
    });
  }

  private buildPropMesh(def: EquipmentDef): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    let color = 0xcccccc;
    switch (def.category) {
      case 'vehicle':
        geometry = new THREE.BoxGeometry(2.2, 1.2, 4.5);
        color = 0x1c3f94;
        break;
      case 'consumable':
        geometry = new THREE.CylinderGeometry(0.8, 0.8, 1.4, 16);
        color = def.id === 'paint-yellow' ? 0xe8c400 : 0xf2f2f2;
        break;
      default:
        geometry = new THREE.ConeGeometry(0.7, 1.4, 12);
        color = 0xe8622a;
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    return mesh;
  }

  onLoadedChanged(cb: () => void): void {
    this.onLoadedChange = cb;
  }

  /** Call with normalized device coords (-1..1) from a click on the canvas. */
  handleClick(ndcX: number, ndcY: number): void {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const meshes = this.props.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return;

    const hitMesh = hits[0].object;
    const entry = this.props.find((p) => p.mesh === hitMesh);
    if (!entry) return;

    entry.loaded = !entry.loaded;
    const target = entry.loaded ? entry.truckPosition : entry.yardPosition;
    entry.mesh.position.copy(target);
    this.onLoadedChange?.();
  }

  getLoadedEquipment(): EquipmentId[] {
    return this.props.filter((p) => p.loaded).map((p) => p.id);
  }

  getEquipmentDef(id: EquipmentId): EquipmentDef | undefined {
    return this.equipmentDefs.get(id);
  }

  update(_dt: number): void {
    // Idle yard phase: no per-frame simulation needed yet.
  }

  setAspect(aspect: number): void {
    frameTopDownCamera(this.camera, this.camera.position.x, this.camera.position.z, YARD_DEPTH_FT, aspect);
  }
}
