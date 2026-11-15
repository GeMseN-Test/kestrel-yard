// Kestrel Yard: a container depot at dusk, drawn only from boxes. It is an original
// map, not a copy of any commercial map: two bomb sites (A CRANE in the west, B DEPOT
// in the east), three lanes through a staggered container row at mid, and a west and
// an east flank lane. Defenders (Kestrel, the player's team) start north, near the
// sites; attackers (Viper, carrying the bomb) start south and must cross mid.
//
// Coordinates: x east, z south. The yard is 44 m wide (x -22..22) and 34 m deep
// (z -17..17). Sites are 8 x 8 m zones centred on (-16,-6) and (16,-6).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'CRANE', x: -16, z: -6, half: 4 },
  B: { name: 'DEPOT', x: 16, z: -6, half: 4 },
};

// Waypoint graph for the bots. Nodes are named spots; edges are walkable links.
// Bots pathfind with breadth-first search and walk node to node.
const NODES = {
  VS: [0, 14], // viper spawn
  MS: [0, 8], // mid south
  MC: [0, 0], // mid centre
  MN: [0, -8], // mid north
  SW: [-12, 10], // south-west connector
  SE: [12, 10], // south-east connector
  WM: [-18, 0], // west lane
  EM: [18, 0], // east lane
  AF: [-18, 6], // west flank
  BF: [18, 6], // east flank
  AA: [-12, -2], // A approach
  BA: [12, -2], // B approach
  AS: [-16, -6], // site A
  BS: [16, -6], // site B
  KA: [-13, -11], // kestrel A hold
  KB: [13, -11], // kestrel B hold
  KM: [0, -12], // kestrel mid hold
  PL: [-4, -12], // player spawn (kestrel)
};
const EDGES = [
  ['VS', 'MS'], ['VS', 'SW'], ['VS', 'SE'],
  ['MS', 'MC'], ['MS', 'SW'], ['MS', 'SE'],
  ['MC', 'MN'], ['MC', 'WM'], ['MC', 'EM'], ['MC', 'AA'], ['MC', 'BA'],
  ['WM', 'AF'], ['WM', 'AA'], ['EM', 'BF'], ['EM', 'BA'],
  ['AF', 'AA'], ['BF', 'BA'], ['AF', 'SW'], ['BF', 'SE'],
  ['AA', 'AS'], ['BA', 'BS'], ['AA', 'KA'], ['BA', 'KB'],
  ['MN', 'KM'], ['MN', 'KA'], ['MN', 'KB'], ['KM', 'PL'],
  ['KA', 'AS'], ['KB', 'BS'], ['AS', 'KA'], ['BS', 'KB'],
];

export const SPAWNS = {
  kestrel: [
    { x: -4, z: -12, yaw: Math.PI }, // player, facing south down mid
    { x: -13, z: -11, yaw: 0.4 },
    { x: 13, z: -11, yaw: -0.4 },
    { x: -8, z: -13, yaw: 0.2 },
    { x: 8, z: -13, yaw: -0.2 },
  ],
  viper: [
    { x: 0, z: 14, yaw: 0 },
    { x: -4, z: 14, yaw: 0 },
    { x: 4, z: 14, yaw: 0 },
    { x: -8, z: 13, yaw: 0 },
    { x: 8, z: 13, yaw: 0 },
  ],
};

// [width, height, depth, x, y, z, material] — every box is a collider and a surface
// a bullet stops on. Containers are 6 m long, 2.6 m tall, stacked two high in places.
const BOXES = [
  // Ground and perimeter.
  [44.4, 0.4, 34.4, 0, -0.2, 0, 'ground'],
  [0.4, 5, 34.4, -22.2, 2.5, 0, 'surface'],
  [0.4, 5, 34.4, 22.2, 2.5, 0, 'surface'],
  [44.4, 5, 0.4, 0, 2.5, -17.2, 'surface'],
  [44.4, 5, 0.4, 0, 2.5, 17.2, 'surface'],
  // Mid container row: three lanes (west x -12, mid x 0, east x 12).
  [6, 2.6, 2.6, -8, 1.3, 0, 'rust'],
  [6, 2.6, 2.6, -8, 3.9, 0, 'slate'],
  [6, 2.6, 2.6, 8, 1.3, 0, 'teal'],
  [2.4, 1.1, 2.4, 0, 0.55, 3.5, 'ochre'],
  [3.6, 1.1, 1.2, 0, 0.55, -4, 'teal'],
  [2.4, 1.1, 2.4, -14, 0.55, 4, 'slate'],
  [2.4, 1.1, 2.4, 14, 0.55, 4, 'rust'],
  // Flank containers.
  [2.6, 2.6, 6, -18, 1.3, 2, 'teal'],
  [2.6, 2.6, 6, 18, 1.3, 2, 'rust'],
  // North corners guarding the site approaches.
  [2.6, 2.6, 6, -5, 1.3, -9, 'ochre'],
  [2.6, 2.6, 6, 5, 1.3, -9, 'rust'],
  // Site A: stacked containers under the crane.
  [2.6, 2.6, 6, -19, 1.3, -11, 'teal'],
  [6, 2.6, 2.6, -15, 1.3, -13, 'slate'],
  [2.4, 1.1, 2.4, -13, 0.55, -3, 'rust'],
  // Site B: warehouse wall with a doorway, crates inside.
  [3, 4, 0.4, 12.5, 2, -14, 'surface'],
  [3, 4, 0.4, 19.5, 2, -14, 'surface'],
  [8, 1, 0.4, 16, 4.5, -14, 'surface'],
  [2.4, 1.1, 2.4, 18, 0.55, -9, 'ochre'],
  [2.4, 1.1, 2.4, 13, 0.55, -3, 'slate'],
  // South cover near the viper spawn.
  [3.6, 1.1, 1.2, -6, 0.55, 11, 'hairline'],
  [3.6, 1.1, 1.2, 6, 0.55, 11, 'hairline'],
  [1.2, 1.1, 3.6, 0, 0.55, 13, 'hairline'],
  // Barrels (crates that read as barrels at a glance).
  [0.9, 1.1, 0.9, -10, 0.55, -6, 'rust'],
  [0.9, 1.1, 0.9, 10, 0.55, -6, 'teal'],
  [0.9, 1.1, 0.9, -2, 0.55, 8, 'ochre'],
  [0.9, 1.1, 0.9, 2, 0.55, 8, 'ochre'],
];

function letterTexture(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,24,32,0.85)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = colour;
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }
  for (const [w, h, d, x, y, z, m] of BOXES) box(w, h, d, x, y, z, m);

  // Gantry crane over site A: four legs, two top beams, one cross beam.
  const crane = materials.hairline;
  for (const [x, z] of [[-19, -3], [-13, -3], [-19, -9], [-13, -9]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), crane);
    leg.position.set(x, 3.5, z);
    leg.castShadow = true;
    group.add(leg);
    colliders.push(new THREE.Box3().setFromObject(leg));
    shootables.push(leg);
  }
  for (const z of [-3, -9]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.6, 0.6), crane);
    beam.position.set(-16, 7, z);
    beam.castShadow = true;
    group.add(beam);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 6.5), crane);
  cross.position.set(-16, 7, -6);
  group.add(cross);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), materials.accent);
  hook.position.set(-16, 6, -6);
  group.add(hook);

  // Site markers: a glowing floor outline and a floating letter sign.
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
    const half = site.half;
    for (const [w, d, x, z] of [
      [half * 2, 0.12, site.x, site.z - half],
      [half * 2, 0.12, site.x, site.z + half],
      [0.12, half * 2, site.x - half, site.z],
      [0.12, half * 2, site.x + half, site.z],
    ]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), strip);
      edge.position.set(x, 0.03, z);
      group.add(edge);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, PALETTE.accent), transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(site.x, 4.6, site.z);
    group.add(sign);
  }

  // Distant skyline silhouettes outside the walls, for depth at dusk.
  const skyline = new THREE.MeshStandardMaterial({ color: new THREE.Color('#12161f'), roughness: 1 });
  for (const [x, z, w, h] of [[-32, -26, 8, 14], [-12, -30, 10, 20], [8, -28, 7, 11], [28, -22, 9, 16], [-34, 10, 9, 12], [34, 8, 8, 18], [30, 26, 10, 13], [-28, 26, 7, 10]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyline);
    tower.position.set(x, h / 2, z);
    group.add(tower);
  }

  // Light: a low amber sun from the west, a cool fill, and lamps over both sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#2a3648'), new THREE.Color('#14171c'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-30, 16, 8);
  sun.target.position.set(4, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d8aa8'), 0.5);
  fill.position.set(18, 12, 16);
  scene.add(fill);
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 16, 1.6);
    lamp.position.set(site.x, 5.5, site.z);
    scene.add(lamp);
  }

  // Waypoint graph with breadth-first search.
  const adjacency = {};
  for (const name of Object.keys(NODES)) adjacency[name] = [];
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearestNode(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const [name, [nx, nz]] of Object.entries(NODES)) {
      const d = (nx - x) ** 2 + (nz - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = name;
      }
    }
    return best;
  }
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [[toX, toZ]];
    const prev = { [start]: null };
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === goal) break;
      for (const next of adjacency[node]) {
        if (!(next in prev)) {
          prev[next] = node;
          queue.push(next);
        }
      }
    }
    if (!(goal in prev)) return [[toX, toZ]];
    const nodes = [];
    let node = goal;
    while (node !== null) {
      nodes.unshift(node);
      node = prev[node];
    }
    const points = nodes.slice(1).map((name) => NODES[name]);
    points.push([toX, toZ]);
    return points;
  }

  return {
    colliders,
    shootables,
    group,
    findPath,
    siteAt(x, z) {
      for (const key of ['A', 'B']) {
        const site = SITES[key];
        if (Math.abs(x - site.x) <= site.half && Math.abs(z - site.z) <= site.half) return key;
      }
      return null;
    },
  };
}
