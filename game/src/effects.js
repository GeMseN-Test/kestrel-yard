// Effects: tracers, impact sparks, explosions and the bomb's blinking light.
// Everything here is pooled: a fixed set of line and point objects reused every
// shot, so a firefight allocates nothing per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 8;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0 }));
    points.visible = false;
    scene.add(points);
    sparks.push({ points, life: 0, velocity: new Float32Array(30) });
  }
  let sparkIndex = 0;

  // The planted bomb: a small blinking box with a red light, shown while planted.
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242b'), roughness: 0.6, metalness: 0.3 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2e2e') }),
  );
  bombLight.position.set(0.12, 0.14, 0);
  bombGroup.add(bombBody, bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  // The dropped bomb on the ground, for the attackers to pick back up.
  const dropped = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 }),
  );
  dropped.visible = false;
  scene.add(dropped);

  const tmp = new THREE.Vector3();

  return {
    tracer(from, to, team) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
      const pos = slot.line.geometry.attributes.position.array;
      pos[0] = from.x;
      pos[1] = from.y;
      pos[2] = from.z;
      pos[3] = to.x;
      pos[4] = to.y;
      pos[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.material.color.set(team === 'kestrel' ? 0xffd27a : 0xff7a6b);
      slot.line.material.opacity = 0.9;
      slot.line.visible = true;
      slot.life = 0.09;
    },
    impact(point) {
      const slot = sparks[sparkIndex];
      sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
      const pos = slot.points.geometry.attributes.position.array;
      for (let i = 0; i < 10; i += 1) {
        pos[i * 3] = point.x;
        pos[i * 3 + 1] = point.y;
        pos[i * 3 + 2] = point.z;
        slot.velocity[i * 3] = (Math.random() - 0.5) * 4;
        slot.velocity[i * 3 + 1] = Math.random() * 3;
        slot.velocity[i * 3 + 2] = (Math.random() - 0.5) * 4;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.opacity = 1;
      slot.points.visible = true;
      slot.life = 0.25;
    },
    explosion(point) {
      this.impact(point);
      const slot = sparks[sparkIndex];
      sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
      const pos = slot.points.geometry.attributes.position.array;
      for (let i = 0; i < 10; i += 1) {
        pos[i * 3] = point.x;
        pos[i * 3 + 1] = point.y + 0.2;
        pos[i * 3 + 2] = point.z;
        slot.velocity[i * 3] = (Math.random() - 0.5) * 9;
        slot.velocity[i * 3 + 1] = Math.random() * 7;
        slot.velocity[i * 3 + 2] = (Math.random() - 0.5) * 9;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.color.set(0xff8a3d);
      slot.points.material.opacity = 1;
      slot.points.visible = true;
      slot.life = 0.5;
    },
    muzzle(bot) {
      // A one-frame flash at the bot's gun tip, drawn as a short tracer to the sky.
      tmp.copy(bot.body.position);
      tmp.y += 1.3;
      const tip = tmp.clone();
      tip.y += 0.15;
      this.tracer(tmp, tip, bot.team);
    },
    showBomb(x, z, visible) {
      bombGroup.visible = visible;
      if (visible) bombGroup.position.set(x, 0.12, z);
    },
    showDropped(x, z, visible) {
      dropped.visible = visible;
      if (visible) dropped.position.set(x, 0.12, z);
    },
    step(dt, time) {
      for (const slot of tracers) {
        if (slot.life > 0) {
          slot.life -= dt;
          slot.line.material.opacity = Math.max(0, slot.life / 0.09) * 0.9;
          if (slot.life <= 0) slot.line.visible = false;
        }
      }
      for (const slot of sparks) {
        if (slot.life > 0) {
          slot.life -= dt;
          const pos = slot.points.geometry.attributes.position.array;
          for (let i = 0; i < 10; i += 1) {
            pos[i * 3] += slot.velocity[i * 3] * dt;
            pos[i * 3 + 1] += slot.velocity[i * 3 + 1] * dt;
            pos[i * 3 + 2] += slot.velocity[i * 3 + 2] * dt;
            slot.velocity[i * 3 + 1] -= 12 * dt;
          }
          slot.points.geometry.attributes.position.needsUpdate = true;
          slot.points.material.opacity = Math.max(0, slot.life / 0.25);
          if (slot.life <= 0) slot.points.visible = false;
        }
      }
      if (bombGroup.visible) {
        bombLight.material.color.setHex(Math.sin(time * 10) > 0 ? 0xff2e2e : 0x551111);
      }
    },
  };
}
