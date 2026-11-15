// Combat resolution: the player's shots, grenades and the defuse. Bot shots are
// resolved in bots.js; both sides call the same damage entry points here so a kill
// is a kill whoever fired it.
//
// A shot is one raycast against the world and every living bot's two hit meshes
// (body, head). Grenades are small ballistic bodies that bounce once or twice and
// explode after a 1.6 s fuse, damaging everything in 6 m through no wall check —
// a grenade around a corner still hurts, which is the point of it.
import * as THREE from 'three';
import { GRENADE } from './weapons.js';
import { DEFUSE_TIME } from './state.js';

const GRAVITY = 18;

export function createCombat(scene, world, store, bots, effects, audio) {
  const raycaster = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const to = new THREE.Vector3();
  const grenades = [];
  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e343c'), roughness: 0.6, metalness: 0.4 }),
  );

  // The raycast every shooter uses: world meshes, bot hit meshes, and the player
  // capsule (the player has no mesh of their own, so the capsule is tested by hand).
  // Returns { point, object, part } or null.
  function raycast(origin, direction, maxDist, player) {
    from.copy(origin);
    dir.copy(direction);
    raycaster.set(from, dir);
    raycaster.far = maxDist;
    const targets = world.shootables.concat(bots.hitMeshes());
    const hits = raycaster.intersectObjects(targets, false);
    let best = hits.length > 0 ? hits[0] : null;
    let bestDist = best ? best.distance : maxDist;
    if (player && player.alive) {
      const p = player.body.position;
      // Closest approach of the ray to the player's vertical axis.
      const ox = p.x - origin.x;
      const oy = (p.y + 0.9) - origin.y;
      const oz = p.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t > 0 && t < bestDist) {
        const cx = origin.x + dir.x * t;
        const cy = origin.y + dir.y * t;
        const cz = origin.z + dir.z * t;
        const radial = Math.hypot(cx - p.x, cz - p.z);
        if (radial < 0.45 && cy > p.y && cy < p.y + 1.72) {
          const part = cy > p.y + 1.45 ? 'head' : 'body';
          return { point: new THREE.Vector3(cx, cy, cz), object: { userData: { isPlayer: true } }, part, distance: t };
        }
      }
    }
    if (!best) return null;
    return { point: best.point, object: best.object, part: best.object.userData ? best.object.userData.part : null, distance: bestDist };
  }

  function clearSight(ax, ay, az, bx, by, bz) {
    from.set(ax, ay, az);
    to.set(bx - ax, by - ay, bz - az);
    const len = to.length();
    if (len < 0.001) return true;
    to.multiplyScalar(1 / len);
    raycaster.set(from, to);
    raycaster.far = len;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  // Damage one bot. Returns 'kill' | 'hit' | null. The caller owns the score.
  function damageBot(bot, amount, part, fromShooter) {
    if (!bot.alive) return null;
    let left = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, Math.ceil(left / 2));
      bot.armor -= absorbed;
      left -= absorbed;
    }
    bot.health -= left;
    if (bot.health <= 0) {
      bots.kill(bot);
      return 'kill';
    }
    // Being shot interrupts a plant or a defuse and makes the bot flinch to cover.
    bot.channel = 0;
    return 'hit';
  }

  function throwGrenade(origin, direction, speed) {
    const mesh = grenadeMesh.clone();
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades.push({
      mesh,
      velocity: direction.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 3.5, 0)),
      fuse: 1.6,
      bounced: 0,
    });
    audio.throwSound();
  }

  function explode(g) {
    const p = g.mesh.position;
    effects.explosion(p);
    audio.explosion(p);
    scene.remove(g.mesh);
    return p;
  }

  function stepGrenades(dt, player, onPlayerDamage, onBotDamage) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= GRAVITY * dt;
      const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
      let hitWall = false;
      for (const box of world.colliders) {
        if (box.containsPoint(next)) {
          hitWall = true;
          break;
        }
      }
      if (next.y < 0.09) {
        next.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * 0.45;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
        g.bounced += 1;
      } else if (hitWall && g.bounced < 3) {
        g.velocity.multiplyScalar(-0.4);
        g.bounced += 1;
      }
      g.mesh.position.copy(next);
      if (g.fuse <= 0) {
        const p = explode(g);
        grenades.splice(i, 1);
        // Damage falls off with distance; no wall check, by design.
        const hurt = (pos, radius) => {
          const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
          if (d > radius) return 0;
          return Math.round(GRENADE.damage * (1 - d / radius) + 20);
        };
        if (player.alive) {
          const dmg = hurt(new THREE.Vector3(player.body.position.x, player.body.position.y + 1, player.body.position.z), GRENADE.radius);
          if (dmg > 0) onPlayerDamage(dmg, null);
        }
        for (const bot of bots.bots) {
          if (!bot.alive) continue;
          const dmg = hurt(new THREE.Vector3(bot.body.position.x, bot.body.position.y + 1, bot.body.position.z), GRENADE.radius);
          if (dmg > 0) onBotDamage(bot, dmg, 'body', null);
        }
      }
    }
  }

  return {
    raycast,
    clearSight,
    damageBot,
    throwGrenade,
    stepGrenades,
    grenadeCount() {
      return grenades.length;
    },
    clearGrenades() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
    },
    // The player defusing: hold E within 1.8 m of a planted bomb, no enemy in sight.
    // Returns the channel progress 0..1, or -1 when defusing is impossible right now.
    defuseProgress(dt, player, keys) {
      const bomb = store.bomb;
      if (bomb.state !== 'planted') return -1;
      const d = Math.hypot(player.body.position.x - bomb.x, player.body.position.z - bomb.z);
      if (d > 1.8 || !keys.has('KeyE')) {
        bomb.progress = 0;
        return -1;
      }
      bomb.progress += dt / DEFUSE_TIME;
      if (bomb.progress >= 1) {
        bomb.state = 'defused';
        bomb.progress = 0;
        return 1;
      }
      return bomb.progress;
    },
  };
}
