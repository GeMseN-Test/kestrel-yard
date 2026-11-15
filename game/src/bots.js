// The bots: nine of them, four Kestrels defending with the player and five Vipers
// attacking with the bomb. Each bot is a small state machine — move along a route,
// hold a position, engage what it sees, plant or defuse the bomb — driven by a
// waypoint graph, line of sight and hearing. They shoot with real raycasts and the
// same weapon numbers as the player, so a bot kill and a player kill follow the same
// rules.
//
// Reaction and accuracy are deliberately human-ish: a bot needs 0.35–0.7 s to start
// firing after spotting you, fires in bursts, and misses more the further you are
// and the faster you move. Standing still and aiming beats spraying on the move —
// for the bots as well as for the player.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { SPAWNS, SITES } from './map.js';
import { PLANT_TIME, DEFUSE_TIME, WIN_REWARD, LOSS_REWARD } from './state.js';

const BOT_SPEED = 4.2;
const BOT_HEIGHT = 1.72;
const VISION_RANGE = 46;
const VISION_HALF_ANGLE = 1.05; // ~60 degrees
const HEAR_RANGE = 30;
const NAMES = {
  kestrel: ['HERON', 'FALCON', 'OSPREY', 'MERLIN'],
  viper: ['ADDER', 'COBRA', 'MAMBA', 'TAIPAN', 'KRAIT'],
};
const ROUTES = {
  A: ['MC', 'AA', 'AS'],
  B: ['MC', 'BA', 'BS'],
  AW: ['WM', 'AA', 'AS'],
  BW: ['EM', 'BA', 'BS'],
};
const HOLD_SPOTS = {
  kestrel: [
    { x: -13, z: -11, yaw: 0.5, site: 'A' },
    { x: 13, z: -11, yaw: -0.5, site: 'B' },
    { x: -8, z: -13, yaw: 0.2, site: 'A' },
    { x: 8, z: -13, yaw: -0.2, site: 'B' },
  ],
};

function buildMesh(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'kestrel' ? '#3a4552' : '#4a3230'), roughness: 0.85 });
  const visor = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'kestrel' ? '#f0a830' : '#e0483e'),
    roughness: 0.3, metalness: 0.4, emissive: new THREE.Color(team === 'kestrel' ? '#7a5510' : '#7a1410'),
  });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2026'), roughness: 0.9 });
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(0.22, 0.75, 0.22, -0.14, 0.38, 0, dark); // legs
  add(0.22, 0.75, 0.22, 0.14, 0.38, 0, dark);
  const body = add(0.56, 0.85, 0.34, 0, 1.15, 0, suit);
  const head = add(0.34, 0.34, 0.34, 0, 1.78, 0, suit);
  add(0.3, 0.1, 0.05, 0, 1.8, -0.18, visor);
  const gun = add(0.07, 0.1, 0.62, 0.2, 1.28, -0.3, dark);
  group.userData = { body, head, gun };
  return group;
}

export function createBots(scene, world, store, hooks) {
  // hooks: { raycast(from, dir, maxDist), damagePlayer(amount, fromBot), damageBot(bot, amount, part, from),
  //          noise(x, z, radius), tracer(from, to, team), onPlant(site), onDefuse(), onPickup(bot) }
  const mover = hooks.mover;
  const raycaster = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const bots = [];
  let idCounter = 0;

  function makeBot(team, index, random) {
    const id = idCounter;
    idCounter += 1;
    const mesh = buildMesh(team);
    scene.add(mesh);
    const bot = {
      id,
      name: NAMES[team][index],
      team,
      mesh,
      body: {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        yaw: 0,
        pitch: 0,
        eye: 1.6,
        onGround: true,
        crouching: false,
        height: BOT_HEIGHT,
      },
      health: 100,
      armor: 0,
      weaponId: 'rifle',
      money: 800,
      state: 'buy',
      path: [],
      pathIndex: 0,
      holdSpot: null,
      route: null,
      isCarrier: false,
      target: null, // { kind: 'player'|'bot', ref, x, y, z }
      lastKnown: null, // { x, z, time }
      reaction: 0,
      burstLeft: 0,
      burstGap: 0,
      fireCooldown: 0,
      scanTime: 0,
      holdUntil: 0,
      channel: 0, // plant/defuse progress 0..1
      strafeDir: 1,
      strafeUntil: 0,
      thinkAt: random() * 0.15,
      alive: true,
    };
    mesh.userData.body.userData = { bot, part: 'body' };
    mesh.userData.head.userData = { bot, part: 'head' };
    bots.push(bot);
    return bot;
  }

  function spawnAll(random) {
    for (const bot of bots) scene.remove(bot.mesh);
    bots.length = 0;
    idCounter = 0;
    for (let i = 0; i < 4; i += 1) makeBot('kestrel', i, random);
    for (let i = 0; i < 5; i += 1) makeBot('viper', i, random);
    // The bomb goes to TAIPAN, the fourth Viper.
    bots.find((b) => b.team === 'viper' && b.name === 'TAIPAN').isCarrier = true;
    store.bomb.carrier = bots.find((b) => b.isCarrier).id;
  }

  function resetRound(random) {
    // The bomb goes back to TAIPAN every round, and every bot is paid the last
    // round's reward, like the player.
    for (const bot of bots) {
      bot.isCarrier = bot.team === 'viper' && bot.name === 'TAIPAN';
      if (store.round > 1) bot.money += store.roundWinner === bot.team ? WIN_REWARD : LOSS_REWARD;
      const teamBots = bots.filter((b) => b.team === bot.team);
      const spawnIndex = bot.team === 'kestrel' ? teamBots.indexOf(bot) + 1 : teamBots.indexOf(bot);
      const spawn = SPAWNS[bot.team][spawnIndex];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = spawn.yaw;
      bot.health = 100;
      bot.alive = true;
      bot.state = 'buy';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.lastKnown = null;
      bot.channel = 0;
      bot.burstLeft = 0;
      bot.fireCooldown = 0;
      bot.mesh.visible = true;
      bot.mesh.rotation.set(0, spawn.yaw, 0);
      bot.mesh.position.copy(bot.body.position);
      // Bots buy like players: rifle when they can afford it, SMG otherwise.
      if (bot.money >= 2700) {
        bot.weaponId = 'rifle';
        bot.money -= 2700;
        bot.armor = 50;
      } else if (bot.money >= 1500) {
        bot.weaponId = 'smg';
        bot.money -= 1500;
      } else {
        bot.weaponId = 'pistol';
      }
      if (bot.team === 'kestrel') {
        bot.holdSpot = HOLD_SPOTS.kestrel[bots.filter((b) => b.team === 'kestrel').indexOf(bot)];
      } else {
        const keys = Object.keys(ROUTES);
        bot.route = keys[Math.floor(random() * keys.length)];
      }
    }
    // Attackers commit to one site: the carrier's route decides for the team.
    const carrier = bots.find((b) => b.isCarrier);
    for (const bot of bots.filter((b) => b.team === 'viper')) bot.route = carrier.route;
  }

  function hitMeshes() {
    const list = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      list.push(bot.mesh.userData.body, bot.mesh.userData.head);
    }
    return list;
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function nearestAlive(x, z, team) {
    let best = null;
    let bestDist = Infinity;
    for (const bot of bots) {
      if (bot.team !== team || !bot.alive) continue;
      const d = (bot.body.position.x - x) ** 2 + (bot.body.position.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = bot;
      }
    }
    return best;
  }

  function eyeOf(bot) {
    return { x: bot.body.position.x, y: bot.body.position.y + 1.6, z: bot.body.position.z };
  }

  function canSee(bot, tx, ty, tz) {
    const eye = eyeOf(bot);
    const dx = tx - eye.x;
    const dy = ty - eye.y;
    const dz = tz - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > VISION_RANGE) return false;
    if (dist > 6) {
      const facing = Math.atan2(-Math.sin(bot.body.yaw), -Math.cos(bot.body.yaw));
      const toTarget = Math.atan2(dx, dz);
      let diff = Math.abs(toTarget - facing);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > VISION_HALF_ANGLE) return false;
    }
    return hooks.clearSight(eye.x, eye.y, eye.z, tx, ty, tz);
  }

  // The one perception pass, staggered per bot so nine raycasts never land in a frame.
  function perceive(bot, player, dt, time) {
    bot.thinkAt -= dt;
    if (bot.thinkAt > 0) return;
    bot.thinkAt = 0.15;
    // Look for the player first when the player is on the other team.
    if (player.alive && bot.team !== 'kestrel') {
      const p = player.body.position;
      if (canSee(bot, p.x, p.y + 1.2, p.z)) {
        if (!bot.target || bot.target.kind !== 'player') bot.reaction = 0.35 + Math.random() * 0.35;
        bot.target = { kind: 'player', ref: player, x: p.x, y: p.y + 1.2, z: p.z };
        bot.lastKnown = { x: p.x, z: p.z, time };
        return;
      }
    }
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      const p = other.body.position;
      if (canSee(bot, p.x, p.y + 1.2, p.z)) {
        if (!bot.target || bot.target.ref !== other) bot.reaction = 0.35 + Math.random() * 0.35;
        bot.target = { kind: 'bot', ref: other, x: p.x, y: p.y + 1.2, z: p.z };
        bot.lastKnown = { x: p.x, z: p.z, time };
        return;
      }
    }
    // Lost sight: keep the last known spot for a second, then let go.
    if (bot.target && bot.lastKnown && time - bot.lastKnown.time > 1.2) bot.target = null;
  }

  function hear(x, z, radius) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const d = Math.hypot(bot.body.position.x - x, bot.body.position.z - z);
      if (d < radius) bot.lastKnown = { x, z, time: store.time };
    }
  }

  function followPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const [tx, tz] = bot.path[bot.pathIndex];
    const dx = tx - bot.body.position.x;
    const dz = tz - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const speed = BOT_SPEED;
    bot.body.velocity.x = (dx / dist) * speed;
    bot.body.velocity.z = (dz / dist) * speed;
    bot.body.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  function fireAt(bot, dt) {
    const def = WEAPONS[bot.weaponId];
    bot.fireCooldown -= dt;
    if (bot.fireCooldown > 0) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.fireCooldown = 0.45 + Math.random() * 0.4;
      return;
    }
    bot.burstLeft -= 1;
    bot.fireCooldown = def.fireGap;
    const t = bot.target;
    if (!t) return;
    const eye = eyeOf(bot);
    // Aim error: distance, the target's speed and the bot's own movement all widen it.
    const targetSpeed = t.kind === 'player' ? Math.hypot(t.ref.state.velocity.x, t.ref.state.velocity.z) : Math.hypot(t.ref.body.velocity.x, t.ref.body.velocity.z);
    const dist = Math.hypot(t.x - eye.x, t.z - eye.z);
    const error = 0.012 + dist * 0.0011 + targetSpeed * 0.004 + Math.hypot(bot.body.velocity.x, bot.body.velocity.z) * 0.003;
    const head = Math.random() < 0.22;
    const ax = t.x + (Math.random() * 2 - 1) * error * dist;
    const ay = (head ? t.y + 0.45 : t.y) + (Math.random() * 2 - 1) * error * dist * 0.5;
    const az = t.z + (Math.random() * 2 - 1) * error * dist;
    from.set(eye.x, eye.y, eye.z);
    dir.set(ax - eye.x, ay - eye.y, az - eye.z).normalize();
    const hit = hooks.raycast(from, dir, def.range);
    if (hit) {
      hooks.tracer(from, hit.point, bot.team);
      if (hit.object.userData && hit.object.userData.bot) {
        const victim = hit.object.userData.bot;
        const part = hit.object.userData.part;
        hooks.damageBot(victim, part === 'head' ? def.head : def.body, part, bot);
      } else if (hit.object.userData && hit.object.userData.isPlayer) {
        hooks.damagePlayer(hit.part === 'head' ? def.head : def.body, bot);
      } else {
        hooks.impact(hit.point);
      }
    } else {
      to.copy(from).addScaledVector(dir, def.range);
      hooks.tracer(from, to, bot.team);
    }
    hooks.noise(eye.x, eye.z, HEAR_RANGE);
    hooks.muzzle(bot);
  }

  function stepBot(bot, dt, player, time, random) {
    if (!bot.alive) return;
    perceive(bot, player, dt, time);
    const def = WEAPONS[bot.weaponId];

    // Engaging overrides every objective.
    if (bot.target) {
      const t = bot.target;
      const eye = eyeOf(bot);
      const dx = t.x - eye.x;
      const dz = t.z - eye.z;
      bot.body.yaw = Math.atan2(-dx, -dz);
      bot.body.velocity.x = 0;
      bot.body.velocity.z = 0;
      if (bot.reaction > 0) bot.reaction -= dt;
      else fireAt(bot, dt);
      // Strafe sideways while fighting, so fights are not static duels.
      if (time > bot.strafeUntil) {
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        bot.strafeUntil = time + 0.7 + Math.random() * 0.8;
      }
      const strafe = bot.strafeDir * 1.6;
      bot.body.velocity.x += Math.cos(bot.body.yaw) * strafe;
      bot.body.velocity.z += -Math.sin(bot.body.yaw) * strafe;
      bot.state = 'engage';
      mover.step(bot.body, dt, 20, 6.2);
      return;
    }

    // No target: follow the objective.
    if (bot.team === 'viper') {
      const bomb = store.bomb;
      if (bomb.state === 'dropped') {
        if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) {
          bot.path = world.findPath(bot.body.position.x, bot.body.position.z, bomb.x, bomb.z);
          bot.pathIndex = 0;
        }
        if (followPath(bot, dt)) {
          if (Math.hypot(bot.body.position.x - bomb.x, bot.body.position.z - bomb.z) < 1.2) {
            bomb.state = 'carried';
            bomb.carrier = bot.id;
            bot.isCarrier = true;
            hooks.onPickup(bot);
          }
        }
        bot.state = 'move';
      } else if (bot.isCarrier && bomb.state === 'carried') {
        const siteKey = bot.route.includes('A') ? 'A' : 'B';
        const site = SITES[siteKey];
        const inSite = world.siteAt(bot.body.position.x, bot.body.position.z) === siteKey;
        const nearestFoe = nearestAlive(bot.body.position.x, bot.body.position.z, 'kestrel');
        const foeNear = nearestFoe && Math.hypot(nearestFoe.body.position.x - bot.body.position.x,
          nearestFoe.body.position.z - bot.body.position.z) < 8;
        const playerNear = player.alive && Math.hypot(player.body.position.x - bot.body.position.x,
          player.body.position.z - bot.body.position.z) < 8;
        if (inSite && !foeNear && !playerNear) {
          bot.state = 'plant';
          bot.channel += dt / PLANT_TIME;
          bot.body.velocity.set(0, 0, 0);
          if (bot.channel >= 1) {
            bomb.state = 'planted';
            bomb.site = siteKey;
            bomb.timer = 40;
            bomb.x = bot.body.position.x;
            bomb.z = bot.body.position.z;
            bot.isCarrier = false;
            bot.channel = 0;
            hooks.onPlant(siteKey);
          }
        } else {
          if (bot.path.length === 0) {
            const route = ROUTES[bot.route];
            const points = route.map((name) => {
              const node = { MC: [0, 0], AA: [-12, -2], BA: [12, -2], AS: [-16, -6], BS: [16, -6], WM: [-18, 0], EM: [18, 0] }[name];
              return node;
            });
            bot.path = points;
            bot.pathIndex = 0;
          }
          followPath(bot, dt);
          bot.state = 'move';
        }
      } else {
        // Not the carrier: push to the carrier's site and hold an angle there.
        if (bot.path.length === 0) {
          const carrier = bots.find((b) => b.isCarrier) || bots.find((b) => b.team === 'viper');
          const siteKey = carrier && carrier.route ? (carrier.route.includes('A') ? 'A' : 'B') : 'A';
          const site = SITES[siteKey];
          bot.path = world.findPath(bot.body.position.x, bot.body.position.z, site.x + (random() * 6 - 3), site.z + (random() * 6 - 3));
          bot.pathIndex = 0;
        }
        if (followPath(bot, dt)) {
          bot.state = 'hold';
          bot.scanTime += dt;
          bot.body.yaw += Math.sin(bot.scanTime * 0.7) * dt * 0.9;
        } else {
          bot.state = 'move';
        }
      }
    } else {
      // Kestrel: hold the assigned spot; rotate to a planted bomb; defuse when clear.
      const bomb = store.bomb;
      if (bomb.state === 'planted') {
        const dist = Math.hypot(bot.body.position.x - bomb.x, bot.body.position.z - bomb.z);
        const enemiesNear = nearestAlive(bot.body.position.x, bot.body.position.z, 'viper') &&
          Math.hypot(nearestAlive(bot.body.position.x, bot.body.position.z, 'viper').body.position.x - bomb.x,
            nearestAlive(bot.body.position.x, bot.body.position.z, 'viper').body.position.z - bomb.z) < 10;
        if (dist < 1.6 && !enemiesNear) {
          bot.state = 'defuse';
          bot.channel += dt / DEFUSE_TIME;
          bot.body.velocity.set(0, 0, 0);
          if (bot.channel >= 1) {
            bomb.state = 'defused';
            bot.channel = 0;
            hooks.onDefuse();
          }
        } else {
          if (bot.path.length === 0 || bot.state !== 'move') {
            bot.path = world.findPath(bot.body.position.x, bot.body.position.z, bomb.x, bomb.z);
            bot.pathIndex = 0;
          }
          followPath(bot, dt);
          bot.state = 'move';
        }
      } else if (bot.holdSpot) {
        const spot = bot.holdSpot;
        const dist = Math.hypot(bot.body.position.x - spot.x, bot.body.position.z - spot.z);
        if (dist > 0.8) {
          if (bot.path.length === 0) {
            bot.path = world.findPath(bot.body.position.x, bot.body.position.z, spot.x, spot.z);
            bot.pathIndex = 0;
          }
          followPath(bot, dt);
          bot.state = 'move';
        } else {
          bot.state = 'hold';
          bot.body.velocity.set(0, 0, 0);
          bot.scanTime += dt;
          bot.body.yaw = spot.yaw + Math.sin(bot.scanTime * 0.5) * 0.6;
        }
      }
    }
    mover.step(bot.body, dt, 20, 6.2);
    bot.mesh.position.copy(bot.body.position);
    bot.mesh.rotation.y = bot.body.yaw;
  }

  function step(dt, player, time, random) {
    for (const bot of bots) {
      stepBot(bot, dt, player, time, random);
      if (bot.alive) {
        bot.mesh.position.copy(bot.body.position);
        bot.mesh.rotation.y = bot.body.yaw;
      }
    }
  }

  function kill(bot) {
    bot.alive = false;
    bot.target = null;
    bot.body.velocity.set(0, 0, 0);
    bot.mesh.rotation.set(-Math.PI / 2, bot.body.yaw, 0);
    bot.mesh.position.y = 0.25;
    if (bot.isCarrier) {
      bot.isCarrier = false;
      store.bomb.state = 'dropped';
      store.bomb.carrier = null;
      store.bomb.x = bot.body.position.x;
      store.bomb.z = bot.body.position.z;
    }
  }

  return {
    bots,
    spawnAll,
    resetRound,
    step,
    hear,
    kill,
    hitMeshes,
    aliveCount,
    nearestAlive,
    eyeOf,
  };
}
