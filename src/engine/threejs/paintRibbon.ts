import * as THREE from 'three';

/**
 * Renders a paint trail as actual 3D ribbon geometry (a strip of quads
 * following a sprayed/dragged path) instead of a canvas texture.
 * Resolution-independent and anti-aliased by the renderer regardless of
 * zoom — this is what both the main nozzle stripe and the tire-track marks
 * use; canvas-texture painting (`PaintCanvas`) was dropped entirely once
 * tire tracks moved over too, since canvas pixel resolution traded directly
 * against frame rate (see CLAUDE.md, "Paint canvas pixel resolution...").
 *
 * Streamed in fixed-size chunks (`QUADS_PER_CHUNK` quads each) so no single
 * GPU buffer grows unbounded over a long play session, and each chunk only
 * uploads the specific vertex range that changed via
 * `BufferAttribute.addUpdateRange` — not the whole buffer — which is the
 * exact problem that made the canvas-texture approach fall over at higher
 * resolution (every change re-uploaded the entire texture).
 *
 * Per-vertex alpha (for the tire tracks' fade-out) rides on Three.js's
 * built-in vertex-color pipeline: a `color` attribute with itemSize 4
 * (RGBA) on `material.vertexColors = true` + `transparent = true`
 * automatically blends per-vertex alpha with no custom shader needed —
 * confirmed against the engine source (`USE_COLOR_ALPHA` /
 * `vertexAlphas` in WebGLPrograms.js) before relying on it.
 */

const QUADS_PER_CHUNK = 1000;
const VERTS_PER_QUAD = 6; // 2 triangles, non-indexed
const POS_FLOATS_PER_VERT = 3;
const COLOR_FLOATS_PER_VERT = 4;
const MIN_SEGMENT_LENGTH_FT = 0.02; // skip degenerate zero-length segments

interface EdgePoint {
  leftX: number;
  leftZ: number;
  rightX: number;
  rightZ: number;
}

class RibbonChunk {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array | null;
  private quadCount = 0;

  constructor(material: THREE.Material, heightY: number, withAlpha: boolean) {
    this.positions = new Float32Array(QUADS_PER_CHUNK * VERTS_PER_QUAD * POS_FLOATS_PER_VERT);
    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, POS_FLOATS_PER_VERT);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);

    if (withAlpha) {
      this.colors = new Float32Array(QUADS_PER_CHUNK * VERTS_PER_QUAD * COLOR_FLOATS_PER_VERT);
      const colorAttr = new THREE.BufferAttribute(this.colors, COLOR_FLOATS_PER_VERT);
      colorAttr.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('color', colorAttr);
    } else {
      this.colors = null;
    }

    this.geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.position.y = heightY;
    // Bounding volumes are computed once lazily and never automatically
    // recomputed as we stream more vertices in afterward, so frustum
    // culling against a stale (near-empty) bounding sphere would make the
    // mesh vanish almost immediately. Simplest fix: don't cull it.
    this.mesh.frustumCulled = false;
  }

  get isFull(): boolean {
    return this.quadCount >= QUADS_PER_CHUNK;
  }

  addQuad(prev: EdgePoint, next: EdgePoint, prevAlpha: number, nextAlpha: number): void {
    const base = this.quadCount * VERTS_PER_QUAD * POS_FLOATS_PER_VERT;
    const p = this.positions;
    let i = base;
    // triangle 1: prevLeft, prevRight, nextRight
    p[i++] = prev.leftX;
    p[i++] = 0;
    p[i++] = prev.leftZ;
    p[i++] = prev.rightX;
    p[i++] = 0;
    p[i++] = prev.rightZ;
    p[i++] = next.rightX;
    p[i++] = 0;
    p[i++] = next.rightZ;
    // triangle 2: prevLeft, nextRight, nextLeft
    p[i++] = prev.leftX;
    p[i++] = 0;
    p[i++] = prev.leftZ;
    p[i++] = next.rightX;
    p[i++] = 0;
    p[i++] = next.rightZ;
    p[i++] = next.leftX;
    p[i++] = 0;
    p[i++] = next.leftZ;

    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.addUpdateRange(base, VERTS_PER_QUAD * POS_FLOATS_PER_VERT);

    if (this.colors) {
      const cBase = this.quadCount * VERTS_PER_QUAD * COLOR_FLOATS_PER_VERT;
      const c = this.colors;
      let j = cBase;
      const alphasInOrder = [prevAlpha, prevAlpha, nextAlpha, prevAlpha, nextAlpha, nextAlpha];
      for (const a of alphasInOrder) {
        c[j++] = 1;
        c[j++] = 1;
        c[j++] = 1;
        c[j++] = a;
      }
      const colorAttr = this.geometry.attributes.color as THREE.BufferAttribute;
      colorAttr.addUpdateRange(cBase, VERTS_PER_QUAD * COLOR_FLOATS_PER_VERT);
    }

    this.quadCount++;
    this.geometry.setDrawRange(0, this.quadCount * VERTS_PER_QUAD);
  }

  commit(): void {
    this.geometry.attributes.position.needsUpdate = true;
    if (this.colors) this.geometry.attributes.color.needsUpdate = true;
  }
}

export class RibbonTrail {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly widthFt: number;
  private readonly heightY: number;
  private readonly withAlpha: boolean;
  private activeChunk: RibbonChunk | null = null;
  private readonly dirtyChunks = new Set<RibbonChunk>();
  private lastPoint: { x: number; z: number } | null = null;
  private lastEdge: EdgePoint | null = null;
  private lastAlpha = 1;

  /** `withAlpha` enables per-vertex alpha (for a fading trail like tire
   * tracks) at the cost of a second GPU buffer; leave it off for a simple
   * solid-color trail like the main stripe. */
  constructor(color: string, widthFt: number, heightY: number, withAlpha = false) {
    this.widthFt = widthFt;
    this.heightY = heightY;
    this.withAlpha = withAlpha;
    this.material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      vertexColors: withAlpha,
      transparent: withAlpha,
    });
  }

  private edgeAt(x: number, z: number, dirX: number, dirZ: number): EdgePoint {
    const perpX = -dirZ;
    const perpZ = dirX;
    const half = this.widthFt / 2;
    return {
      leftX: x + perpX * half,
      leftZ: z + perpZ * half,
      rightX: x - perpX * half,
      rightZ: z - perpZ * half,
    };
  }

  private ensureActiveChunk(): RibbonChunk {
    if (this.activeChunk && !this.activeChunk.isFull) return this.activeChunk;
    const chunk = new RibbonChunk(this.material, this.heightY, this.withAlpha);
    this.group.add(chunk.mesh);
    this.activeChunk = chunk;
    return chunk;
  }

  /** Call every frame the trail is actively being laid down, with its
   * current world position. `alpha` only matters when `withAlpha` was
   * passed to the constructor. No-ops until a second point arrives (the
   * first call just records the stroke's starting point/alpha). */
  extendTo(x: number, z: number, alpha = 1): void {
    if (this.lastPoint) {
      const dx = x - this.lastPoint.x;
      const dz = z - this.lastPoint.z;
      const len = Math.hypot(dx, dz);
      if (len >= MIN_SEGMENT_LENGTH_FT) {
        const dirX = dx / len;
        const dirZ = dz / len;
        const nextEdge = this.edgeAt(x, z, dirX, dirZ);
        // Flat-cut start: first segment of a stroke has no prior edge to
        // join, so use this segment's own direction for it too.
        const prevEdge = this.lastEdge ?? this.edgeAt(this.lastPoint.x, this.lastPoint.z, dirX, dirZ);

        const chunk = this.ensureActiveChunk();
        chunk.addQuad(prevEdge, nextEdge, this.lastAlpha, alpha);
        this.dirtyChunks.add(chunk);
        this.lastEdge = nextEdge;
        this.lastPoint = { x, z };
        this.lastAlpha = alpha;
      }
    } else {
      this.lastPoint = { x, z };
      this.lastAlpha = alpha;
    }
  }

  /** Call when the trail lifts (nozzle off, tires dry). The next `extendTo`
   * starts a new, disconnected stroke rather than drawing a line back to
   * this point. */
  breakStroke(): void {
    this.lastPoint = null;
    this.lastEdge = null;
  }

  /** Call once per rendered frame: pushes any changed chunks to the GPU. */
  commitFrame(): void {
    for (const chunk of this.dirtyChunks) chunk.commit();
    this.dirtyChunks.clear();
  }
}
