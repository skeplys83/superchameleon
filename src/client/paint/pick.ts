import * as THREE from "three";

// Fast body pick. SkinnedMesh.raycast re-skins the model per ray (6.15 ms
// each on player.glb) — a tolerant search of 25 rays would freeze. Skinning
// is done once per frame, cached; every ray after is a flat triangle sweep.
// combat/shoot.ts still uses three's raycast (a shot is at most 2 Hz).

const MAX_AGE_MS = 8;

type Posed = {
  positions: Float32Array;
  box: THREE.Box3;
  at: number;
};

const posed = new WeakMap<THREE.SkinnedMesh, Posed>();

const vertex = new THREE.Vector3();
const edge1 = new THREE.Vector3();
const edge2 = new THREE.Vector3();
const pvec = new THREE.Vector3();
const tvec = new THREE.Vector3();
const qvec = new THREE.Vector3();

function poseOf(mesh: THREE.SkinnedMesh): Posed {
  const cached = posed.get(mesh);
  const now = performance.now();
  if (cached && now - cached.at < MAX_AGE_MS) return cached;

  const attribute = mesh.geometry.attributes.position;
  const positions = cached?.positions ?? new Float32Array(attribute.count * 3);
  const box = cached?.box ?? new THREE.Box3();
  box.makeEmpty();

  for (let i = 0; i < attribute.count; i++) {
    vertex.fromBufferAttribute(attribute, i);
    mesh.applyBoneTransform(i, vertex);
    vertex.applyMatrix4(mesh.matrixWorld);
    positions[i * 3] = vertex.x;
    positions[i * 3 + 1] = vertex.y;
    positions[i * 3 + 2] = vertex.z;
    box.expandByPoint(vertex);
  }

  const next = cached ?? ({ positions, box } as Posed);
  next.positions = positions;
  next.box = box;
  next.at = now;
  posed.set(mesh, next);
  return next;
}

export type BodyHit = {
  u: number;
  v: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

// One shared result, valid until the next call — a gesture fires up to 25.
const result: BodyHit = {
  u: 0,
  v: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
};

const EPSILON = 1e-10;

// Front faces only (matches three's default FrontSide) — else the inside of
// the chest behind an arm is sometimes picked.
export function pickBody(mesh: THREE.SkinnedMesh, ray: THREE.Ray): BodyHit | null {
  const { positions, box } = poseOf(mesh);
  if (!ray.intersectsBox(box)) return null;

  const index = mesh.geometry.index;
  const uv = mesh.geometry.attributes.uv;
  if (!index || !uv) return null;

  const tri = index.array;
  const count = tri.length / 3;
  let bestT = Infinity;
  let bestTri = -1;
  let bestU = 0;
  let bestV = 0;

  const { origin, direction } = ray;

  for (let t = 0; t < count; t++) {
    const a = tri[t * 3] * 3;
    const b = tri[t * 3 + 1] * 3;
    const c = tri[t * 3 + 2] * 3;

    // Möller-Trumbore with culling branch.
    edge1.set(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    edge2.set(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]);
    pvec.crossVectors(direction, edge2);
    const det = edge1.dot(pvec);
    if (det < EPSILON) continue;

    tvec.set(origin.x - positions[a], origin.y - positions[a + 1], origin.z - positions[a + 2]);
    const u = tvec.dot(pvec);
    if (u < 0 || u > det) continue;

    qvec.crossVectors(tvec, edge1);
    const v = direction.dot(qvec);
    if (v < 0 || u + v > det) continue;

    const distance = edge2.dot(qvec) / det;
    if (distance <= 0 || distance >= bestT) continue;

    bestT = distance;
    bestTri = t;
    bestU = u / det;
    bestV = v / det;
  }

  if (bestTri < 0) return null;

  const a = tri[bestTri * 3];
  const b = tri[bestTri * 3 + 1];
  const c = tri[bestTri * 3 + 2];
  const w0 = 1 - bestU - bestV;

  result.u = w0 * uv.getX(a) + bestU * uv.getX(b) + bestV * uv.getX(c);
  result.v = w0 * uv.getY(a) + bestU * uv.getY(b) + bestV * uv.getY(c);
  result.distance = bestT;
  result.point.copy(ray.direction).multiplyScalar(bestT).add(ray.origin);

  // Positions are already world-posed — no transform needed.
  edge1.set(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1], positions[b * 3 + 2] - positions[a * 3 + 2]);
  edge2.set(positions[c * 3] - positions[a * 3], positions[c * 3 + 1] - positions[a * 3 + 1], positions[c * 3 + 2] - positions[a * 3 + 2]);
  result.normal.crossVectors(edge1, edge2).normalize();

  return result;
}
