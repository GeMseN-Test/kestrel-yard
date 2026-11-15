// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This file owns the match flow (menu, buy, live, round end, match end), the
// player's shooting, and the wiring between every module. It never simulates a bot
// or a bullet itself — bots.js and combat.js do that.
//
// ?shot=spawn|combat|site|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './map.js';
import { createMover } from './physics.js';
import { createStore, PHASE, WIN_ROUNDS, MAX_ROUNDS, ROUND_TIME, BUY_TIME, KILL_REWARD, WIN_REWARD, LOSS_REWARD } from './state.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, BUY_ORDER } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 25, 75);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const store = createStore();
const world = createWorld(scene);
const mover = createMover(world.colliders);
const player = createPlayer(mover);
const weapons = createWeapons(camera);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// Per-entity scoreboard stats, keyed by name.
const stats = new Map();
function statFor(name, team) {
  if (!stats.has(name)) stats.set(name, { name, team, kills: 0, deaths: 0, alive: true });
  return stats.get(name);
}
statFor('YOU', 'kestrel');

let bots = null;
const playerApi = {
  get alive() {
    return player.health() > 0;
  },
  body: player.state,
  state: player.state,
};

function onKill(victimName, victimTeam, killerName, killerTeam, headshot) {
  hud.killfeed(killerName, victimName, headshot, killerTeam);
  const killer = killerName ? statFor(killerName, killerTeam) : null;
  const victim = statFor(victimName, victimTeam);
  if (killer) killer.kills += 1;
  victim.deaths += 1;
  victim.alive = false;
  if (killerName === 'YOU') {
    store.money += KILL_REWARD;
    store.kills.kestrel += 1;
    hud.setMoney(store.money);
  } else if (killerTeam === 'kestrel') {
    store.kills.kestrel += 1;
  } else {
    store.kills.viper += 1;
  }
}

const hooks = {
  mover,
  clearSight: (ax, ay, az, bx, by, bz) => combat.clearSight(ax, ay, az, bx, by, bz),
  raycast: (origin, dirVec, maxDist) => combat.raycast(origin, dirVec, maxDist, playerApi),
  damagePlayer(amount, fromBot) {
    if (player.health() <= 0 || store.phase !== PHASE.LIVE) return;
    const died = player.damage(amount);
    audio.hurt();
    hud.damageFlash();
    if (died) {
      onKill('YOU', 'kestrel', fromBot ? fromBot.name : null, fromBot ? fromBot.team : null, false);
      hud.showMessage('YOU ARE DOWN — your team fights on', 4000);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  damageBot(bot, amount, part, from) {
    const result = combat.damageBot(bot, amount, part, from);
    if (result === 'kill') {
      onKill(bot.name, bot.team, from === 'player' ? 'YOU' : from ? from.name : null, from === 'player' ? 'kestrel' : from ? from.team : null, part === 'head');
      if (from === 'player') {
        audio.hit(true);
        hud.hitMarker(true, 400);
      }
    } else if (result === 'hit' && from === 'player') {
      audio.hit(false);
      hud.hitMarker(false);
    }
    return result;
  },
  noise: (x, z, radius) => bots.hear(x, z, radius),
  tracer: (a, b, team) => effects.tracer(a, b, team),
  impact: (point) => effects.impact(point),
  muzzle: (bot) => effects.muzzle(bot),
  onPlant(site) {
    hud.showMessage(`BOMB PLANTED AT SITE ${site}`, 4000);
    hud.showBanner('BOMB PLANTED', `Defuse it at site ${site} before it blows`, 3000);
    audio.plantBeep();
    effects.showBomb(store.bomb.x, store.bomb.z, true);
  },
  onDefuse() {
    effects.showBomb(0, 0, false);
    endRound('kestrel', 'defuse');
  },
  onPickup(bot) {
    hud.showMessage(`${bot.name} picked up the bomb`, 2500);
  },
};

bots = createBots(scene, world, store, hooks);
const combat = createCombat(scene, world, store, bots, effects, audio);

let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let roundEndTimer = 0;
let buyOpen = false;
let deployArmed = false;

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function startMatch() {
  store.round = 1;
  store.score = { kestrel: 0, viper: 0 };
  store.kills = { kestrel: 0, viper: 0 };
  store.money = 800;
  store.matchWinner = null;
  store.roundWinner = null;
  stats.clear();
  statFor('YOU', 'kestrel');
  weapons.resetMatch();
  bots.spawnAll(random);
  startRound();
}

function startRound() {
  store.phase = PHASE.BUY;
  store.clock = BUY_TIME;
  store.bomb = { state: 'carried', site: null, x: 0, y: 0, z: 0, timer: 40, carrier: null, planter: null, defuser: null, progress: 0 };
  const spawn = { x: -4, z: -12, yaw: Math.PI };
  player.reset(spawn.x, spawn.z, spawn.yaw);
  weapons.resetRound(false);
  bots.resetRound(random);
  const carrier = bots.bots.find((b) => b.isCarrier);
  if (carrier) store.bomb.carrier = carrier.id;
  for (const bot of bots.bots) statFor(bot.name, bot.team).alive = true;
  statFor('YOU', 'kestrel').alive = true;
  effects.showBomb(0, 0, false);
  effects.showDropped(0, 0, false);
  combat.clearGrenades();
  buyOpen = true;
  hud.showBuy(true, store.money, weapons.inventory());
  hud.setMoney(store.money);
  hud.setScore(store.score.kestrel, store.score.viper, store.round);
  hud.setHealth(player.health(), player.armor());
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
  hud.showMessage(`ROUND ${store.round} — buy up, then deploy`, 4000);
  syncCamera();
}

function deploy() {
  if (store.phase !== PHASE.BUY) return;
  store.phase = PHASE.LIVE;
  store.clock = ROUND_TIME;
  buyOpen = false;
  player.setArmor(weapons.hasArmor() ? 100 : 0);
  hud.setHealth(player.health(), player.armor());
  hud.showBuy(false, store.money, weapons.inventory());
  hud.showBanner(`ROUND ${store.round}`, store.round === 1 ? 'Defend sites A and B — stop the bomb' : 'Defend the sites', 2500);
  if (!shot) input.requestLock();
}

function endRound(winner, reason) {
  if (store.phase !== PHASE.LIVE) return;
  store.phase = PHASE.ROUND_END;
  store.roundWinner = winner;
  store.score[winner] += 1;
  const playerWon = winner === 'kestrel';
  store.money += playerWon ? WIN_REWARD : LOSS_REWARD;
  hud.setMoney(store.money);
  hud.setScore(store.score.kestrel, store.score.viper, store.round);
  effects.showBomb(0, 0, false);
  effects.showDropped(0, 0, false);
  const reasons = {
    elimination: playerWon ? 'Viper team eliminated' : 'Kestrel team eliminated',
    detonation: 'The bomb detonated at site ' + (store.bomb.site || ''),
    defuse: 'Bomb defused — site held',
    time: 'Time ran out — no plant',
  };
  hud.showBanner(playerWon ? 'ROUND WON' : 'ROUND LOST', reasons[reason] || reason, 4000);
  if (playerWon) audio.roundWin();
  else audio.roundLose();
  roundEndTimer = 4.5;
  if (document.pointerLockElement) document.exitPointerLock();
}

function endMatch(winner) {
  store.phase = PHASE.MATCH_END;
  store.matchWinner = winner;
  const won = winner === 'kestrel';
  hud.showOverlay('match', won
    ? `Kestrels take the match ${store.score.kestrel}–${store.score.viper}. The yard is yours.`
    : `Vipers take the match ${store.score.viper}–${store.score.kestrel}. The yard falls.`);
}

function shoot(spread) {
  const def = weapons.def();
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  const hit = combat.raycast(camera.position, direction, def.range, playerApi);
  if (hit) {
    effects.tracer(muzzle, hit.point, 'kestrel');
    if (hit.object.userData && hit.object.userData.bot) {
      hooks.damageBot(hit.object.userData.bot, hit.part === 'head' ? def.head : def.body, hit.part, 'player');
    } else if (hit.object.userData && hit.object.userData.isPlayer) {
      // The player's own ray never hits the player; this branch is unreachable.
    } else {
      effects.impact(hit.point);
    }
  } else {
    tmpVec.copy(camera.position).addScaledVector(direction, def.range);
    effects.tracer(muzzle, tmpVec, 'kestrel');
  }
  weapons.pullTrigger();
  player.recoil(0.009 + def.kick * 0.6 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weapons.currentId());
  hooks.noise(player.state.position.x, player.state.position.z, 30);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, def.name, weapons.grenades());
  return true;
}

function step(dt) {
  store.time += dt;
  if (store.phase === PHASE.BUY) {
    store.clock -= dt;
    if (store.clock <= 0) deploy();
  } else if (store.phase === PHASE.LIVE) {
    store.clock -= dt;
    // The bomb's own clock runs once planted.
    if (store.bomb.state === 'planted') {
      store.bomb.timer -= dt;
      if (store.bomb.timer <= 0) {
        const p = new THREE.Vector3(store.bomb.x, 0.5, store.bomb.z);
        effects.explosion(p);
        audio.explosion();
        endRound('viper', 'detonation');
        return;
      }
    }
    if (player.health() > 0) player.step(dt, input.state.keys);
    weapons.step(dt, player.groundSpeed() > 0.5);
    bots.step(dt, playerApi, store.time, random);
    combat.stepGrenades(
      dt,
      playerApi,
      (amount) => hooks.damagePlayer(amount, null),
      (bot, amount, part) => hooks.damageBot(bot, amount, part, null),
    );
    // Player defuse: hold E near a planted bomb (only while alive).
    const defuse = player.health() > 0 ? combat.defuseProgress(dt, playerApi, input.state.keys) : -1;
    if (defuse === 1) {
      endRound('kestrel', 'defuse');
      return;
    }
    hud.setChannel(defuse > 0 ? 'DEFUSING…' : null, Math.max(0, defuse));
    // Round end checks.
    const kestrelAlive = bots.aliveCount('kestrel') + (player.health() > 0 ? 1 : 0);
    const viperAlive = bots.aliveCount('viper');
    if (store.bomb.state === 'dropped') {
      effects.showDropped(store.bomb.x, store.bomb.z, true);
    } else {
      effects.showDropped(0, 0, false);
    }
    if (viperAlive === 0 && store.bomb.state !== 'planted') {
      endRound('kestrel', 'elimination');
      return;
    }
    if (kestrelAlive === 0) {
      endRound('viper', 'elimination');
      return;
    }
    if (store.clock <= 0 && store.bomb.state !== 'planted') {
      endRound('kestrel', 'time');
      return;
    }
  } else if (store.phase === PHASE.ROUND_END) {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      if (store.score.kestrel >= WIN_ROUNDS || store.score.viper >= WIN_ROUNDS || store.round >= MAX_ROUNDS) {
        endMatch(store.score.kestrel > store.score.viper ? 'kestrel' : 'viper');
      } else {
        store.round += 1;
        startRound();
      }
    }
  }
  effects.step(dt, store.time);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const zoomed = input.state.aiming && weapons.currentId() === 'sniper' && store.phase === PHASE.LIVE;
    const zoomFactor = zoomed ? weapons.def().zoom : 1;
    if (camera.fov !== 74 / zoomFactor) {
      camera.fov = 74 / zoomFactor;
      camera.updateProjectionMatrix();
    }
    if (input.state.locked || player.health() <= 0) player.look(look.x / zoomFactor, look.y / zoomFactor);
    const pressed = input.takePressed();
    if (store.phase === PHASE.BUY) {
      if (pressed.has('KeyB')) {
        buyOpen = !buyOpen;
        hud.showBuy(buyOpen, store.money, weapons.inventory());
      }
      if (pressed.has('Enter')) deploy();
      for (let i = 0; i < BUY_ORDER.length; i += 1) {
        if (pressed.has(`Digit${i + 1}`)) {
          const id = BUY_ORDER[i];
          const before = store.money;
          store.money = weapons.buy(id, store.money);
          hud.buyFlash(id, store.money < before);
          if (store.money < before) audio.buy();
          hud.setMoney(store.money);
          hud.showBuy(true, store.money, weapons.inventory());
          hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
        }
      }
    } else if (store.phase === PHASE.LIVE && player.health() > 0) {
      if (pressed.has('KeyB')) hud.showMessage('Buy phase is over — fight with what you have', 2000);
      if (pressed.has('KeyR')) weapons.reload();
      if (pressed.has('KeyG') && weapons.throwGrenade()) {
        camera.getWorldDirection(direction);
        muzzle.copy(camera.position).addScaledVector(direction, 0.5);
        combat.throwGrenade(muzzle, direction, 13);
        hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
      }
      const slots = ['pistol', 'smg', 'rifle', 'sniper'];
      for (let i = 0; i < slots.length; i += 1) {
        if (pressed.has(`Digit${i + 1}`)) {
          if (weapons.select(slots[i])) {
            hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
          }
        }
      }
      if (input.state.firing && weapons.ready()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
      if (weapons.ammo().mag === 0 && weapons.ammo().reserve > 0) weapons.reload();
    }
    if (pressed.has('Tab') && store.phase === PHASE.LIVE) {
      hud.showScoreboard([...stats.values()].sort((a, b) => b.kills - a.kills));
    }
    if (!input.state.keys.has('Tab')) hud.hideScoreboard();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // HUD, every frame (setters are cached, so this is cheap).
    hud.setHealth(player.health(), player.armor());
    hud.setTimer(store.phase === PHASE.LIVE ? store.clock : store.phase === PHASE.BUY ? store.clock : 0, store.bomb.state === 'planted');
    hud.setBomb(store.bomb.state, store.bomb.site, store.bomb.timer);
    hud.setCrosshairGap(6 + weapons.spread(player.groundSpeed()) * 500 + player.groundSpeed() * 0.8);
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (store.phase === PHASE.LIVE && player.health() > 0) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (store.phase === PHASE.MENU) {
    // The buy menu needs the mouse free, so the match starts unlocked; the
    // pointer locks when the round deploys.
    hud.hideOverlay();
    startMatch();
  } else if (store.phase === PHASE.MATCH_END) {
    hud.hideOverlay();
    startMatch();
  } else {
    input.requestLock();
  }
});

// Clicking the canvas mid-round re-locks the pointer (e.g. after the browser
// refused a lock straight after the last one was released).
renderer.domElement.addEventListener('click', () => {
  if (!shot && store.phase === PHASE.LIVE && !input.state.locked && player.health() > 0) {
    input.requestLock();
  }
});

// Clicking a buy row buys it, same as its number key.
document.getElementById('buy-menu').addEventListener('click', (event) => {
  if (store.phase !== PHASE.BUY) return;
  const row = event.target.closest('.buy-row');
  if (!row || event.target.closest('#deploy')) return;
  const id = row.dataset.id;
  const before = store.money;
  store.money = weapons.buy(id, store.money);
  hud.buyFlash(id, store.money < before);
  if (store.money < before) audio.buy();
  hud.setMoney(store.money);
  hud.showBuy(true, store.money, weapons.inventory());
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
});

document.getElementById('deploy').addEventListener('click', () => {
  audio.unlock();
  deploy();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  startMatch();
  if (name === 'spawn') {
    // Buy phase, menu open, looking down mid lane from the Kestrel spawn.
    player.state.position.set(-4, 0, -12);
    player.state.yaw = Math.PI;
    player.state.pitch = 0;
    settle(10);
  } else if (name === 'combat') {
    deploy();
    player.state.position.set(-3, 0, 9);
    player.state.yaw = 0;
    player.state.pitch = 0.02;
    const vipers = bots.bots.filter((b) => b.team === 'viper');
    vipers[0].body.position.set(1, 0, -1.5);
    vipers[0].body.yaw = Math.PI;
    vipers[1].body.position.set(5, 0, -3);
    vipers[1].body.yaw = Math.PI;
    settle(25);
    player.heal(100);
    const targetBot = vipers[0];
    targetBot.target = null;
    targetBot.thinkAt = 999; // hold still for the staged shot
    aimAt(new THREE.Vector3(targetBot.body.position.x, targetBot.body.position.y + 1.2, targetBot.body.position.z));
    shoot(0);
    settle(2);
    // The hit marker lives on a real-time timer; hold it for the frozen frame.
    hud.hitMarker(false, 4000);
  } else if (name === 'site') {
    deploy();
    store.bomb.state = 'planted';
    store.bomb.site = 'A';
    store.bomb.timer = 32;
    store.bomb.x = -16;
    store.bomb.z = -6;
    effects.showBomb(-16, -6, true);
    player.state.position.set(-14, 0, -3);
    player.state.yaw = 0.59;
    player.state.pitch = -0.02;
    const viper = bots.bots.find((b) => b.team === 'viper');
    viper.body.position.set(-18, 0, -8);
    viper.body.yaw = 2.2;
    hud.showMessage('BOMB PLANTED AT SITE A — defuse it (hold E)', 5000);
    settle(10);
    hud.setChannel('DEFUSING…', 0.45);
    hud.showMessage('BOMB PLANTED AT SITE A — defuse it (hold E)', 5000);
  } else {
    // Round won, banner up. The banner and message run on real-time timers, so
    // they are shown again after the settle, right before the frozen frame.
    deploy();
    endRound('kestrel', 'elimination');
    hud.hideScoreboard();
    settle(10);
    hud.showBanner('ROUND WON', 'Viper team eliminated', 4000);
    hud.showMessage('Viper team eliminated — Kestrels take round 1', 4000);
  }
  hud.setScore(store.score.kestrel, store.score.viper, store.round);
  hud.setMoney(store.money);
  hud.setHealth(player.health(), player.armor());
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.grenades());
  hud.setTimer(store.phase === PHASE.LIVE ? store.clock : 0, store.bomb.state === 'planted');
  hud.setBomb(store.bomb.state, store.bomb.site, store.bomb.timer);
  // Transient UI runs on real-time timers; re-assert it right before the freeze
  // so the slow software renderer cannot age it out of the frame.
  if (name === 'combat') hud.hitMarker(false, 4000);
  paintTwiceThenReady();
}

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
