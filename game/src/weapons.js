// Weapons: the numbers, the view models and the firing cycle. main.js owns the ray
// and the damage; this module owns everything else about shooting: which weapon is
// in hand, its magazine, its reload, its spread, and how it looks and kicks.
//
// Four guns and one grenade. Headshots pay: the rifle's head damage kills outright,
// the pistol and SMG need two, the sniper kills through armour on a body shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', price: 0, mag: 12, reserve: 36, auto: false,
    fireGap: 0.22, reloadTime: 1.4, body: 34, head: 68,
    spreadStill: 0.003, spreadMove: 0.02, kick: 0.012, zoom: 1, range: 60,
  },
  smg: {
    id: 'smg', name: 'K9 SMG', price: 1500, mag: 32, reserve: 96, auto: true,
    fireGap: 0.075, reloadTime: 2.0, body: 26, head: 52,
    spreadStill: 0.004, spreadMove: 0.03, kick: 0.008, zoom: 1, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', price: 2700, mag: 30, reserve: 90, auto: true,
    fireGap: 0.096, reloadTime: 1.9, body: 33, head: 132,
    spreadStill: 0.0022, spreadMove: 0.028, kick: 0.014, zoom: 1, range: 80,
  },
  sniper: {
    id: 'sniper', name: 'LONGBOW', price: 4750, mag: 5, reserve: 15, auto: false,
    fireGap: 1.15, reloadTime: 3.2, body: 115, head: 230,
    spreadStill: 0.0005, spreadMove: 0.05, kick: 0.05, zoom: 2.2, range: 120,
  },
};

export const GRENADE = { id: 'grenade', name: 'HE GRENADE', price: 300, radius: 6, damage: 120 };
export const ARMOR = { id: 'armor', name: 'KEVLAR VEST', price: 650 };
export const BUY_ORDER = ['pistol', 'smg', 'rifle', 'sniper', 'grenade', 'armor'];

const MOVE_REFERENCE = 5.2;
const MUZZLE_TIME = 0.06;

function buildModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f959e'), roughness: 0.55, metalness: 0.35 });
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (def.id === 'pistol') {
    add(0.05, 0.09, 0.24, 0, 0, -0.1, steel);
    add(0.045, 0.1, 0.06, 0, -0.08, 0.02, dark);
  } else if (def.id === 'smg') {
    add(0.07, 0.09, 0.34, 0, 0, -0.12, steel);
    add(0.05, 0.14, 0.05, 0, -0.1, -0.05, dark);
    add(0.04, 0.04, 0.22, 0, 0.02, -0.32, dark);
    add(0.06, 0.07, 0.14, 0, -0.02, 0.18, dark);
  } else if (def.id === 'rifle') {
    add(0.08, 0.1, 0.46, 0, 0, -0.14, steel);
    add(0.05, 0.05, 0.42, 0, 0.03, -0.4, dark);
    add(0.07, 0.08, 0.2, 0, -0.02, 0.22, dark);
    add(0.04, 0.12, 0.04, 0, -0.09, -0.08, dark);
  } else {
    add(0.07, 0.09, 0.62, 0, 0, -0.2, steel);
    add(0.05, 0.05, 0.4, 0, 0.03, -0.48, dark);
    add(0.09, 0.09, 0.2, 0, 0.06, -0.14, dark);
    add(0.06, 0.07, 0.16, 0, -0.02, 0.24, dark);
  }
  group.position.set(0.26, -0.25, -0.52);
  group.rotation.y = -0.12;
  return group;
}

export function createWeapons(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.07),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.22, -0.7);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 3);
  flashLight.position.set(0.22, -0.18, -0.7);
  camera.add(flashLight);

  // The player's inventory: every owned gun keeps its own magazine and reserve.
  const owned = {
    pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
  };
  let current = 'pistol';
  let grenades = 0;
  let armor = false;
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bob: 0 };
  models.pistol.visible = true;

  function def() {
    return WEAPONS[current];
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bob += dt * (moving ? 11 : 0);
    const model = models[current];
    model.position.z = -0.52 + state.kick;
    model.position.y = -0.25 + (moving ? Math.sin(state.bob) * 0.006 : 0);
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 2 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const inv = owned[current];
        const need = def().mag - inv.mag;
        const take = Math.min(need, inv.reserve);
        inv.mag += take;
        inv.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    currentId() {
      return current;
    },
    def,
    ammo() {
      return owned[current];
    },
    inventory() {
      return owned;
    },
    grenades() {
      return grenades;
    },
    hasArmor() {
      return armor;
    },
    buy(id, money) {
      if (id === 'grenade') {
        if (money < GRENADE.price || grenades >= 2) return money;
        grenades += 1;
        return money - GRENADE.price;
      }
      if (id === 'armor') {
        if (money < ARMOR.price || armor) return money;
        armor = true;
        return money - ARMOR.price;
      }
      const weapon = WEAPONS[id];
      if (!weapon || money < weapon.price || owned[id]) return money;
      owned[id] = { mag: weapon.mag, reserve: weapon.reserve };
      return money - weapon.price;
    },
    // Buying ammo for a gun already owned tops its reserve back up.
    buyAmmo(id, money) {
      const weapon = WEAPONS[id];
      const inv = owned[id];
      if (!weapon || !inv || money < 200) return money;
      inv.reserve = weapon.reserve;
      return money - 200;
    },
    select(id) {
      if (!owned[id] || id === current || state.reloadLeft > 0) return false;
      models[current].visible = false;
      current = id;
      models[current].visible = true;
      state.cooldown = 0.25;
      return true;
    },
    throwGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    ready() {
      return owned[current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (owned[current].mag <= 0) return false;
      owned[current].mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = def().kick;
    },
    reload() {
      const inv = owned[current];
      if (state.reloadLeft > 0 || inv.mag === def().mag || inv.reserve === 0) return;
      state.reloadLeft = def().reloadTime;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * d.spreadMove;
    },
    resetRound(keepArmor) {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserve;
      }
      grenades = 0;
      if (!keepArmor) armor = false;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    resetMatch() {
      for (const id of Object.keys(owned)) delete owned[id];
      owned.pistol = { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve };
      models[current].visible = false;
      current = 'pistol';
      models.pistol.visible = true;
      grenades = 0;
      armor = false;
    },
  };
}
