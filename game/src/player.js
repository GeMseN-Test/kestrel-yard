// The player: movement with acceleration, friction, sprint, crouch and jump, plus
// health and armour. Movement resolves through the shared mover in physics.js; the
// health rules live here because only the player takes damage this way (bots keep
// their own health in bots.js).
import * as THREE from 'three';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 6.6;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(mover) {
  const body = {
    position: new THREE.Vector3(0, 0, -12),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const wish = new THREE.Vector3();
  let health = 100;
  let armor = 0; // 0..100, absorbs half the damage while it lasts

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching !== body.crouching) {
      if (crouching) {
        body.crouching = true;
        body.height = CROUCH_HEIGHT;
      } else {
        body.crouching = false;
        body.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const sprinting = keys.has('ShiftLeft') && forward > 0 && !body.crouching;
    const speed = body.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    mover.step(body, dt, GRAVITY, JUMP_SPEED);
  }

  return {
    state: body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    health() {
      return health;
    },
    armor() {
      return armor;
    },
    setArmor(value) {
      armor = value;
    },
    reset(x, z, yaw) {
      body.position.set(x, 0, z);
      body.velocity.set(0, 0, 0);
      body.yaw = yaw;
      body.pitch = 0;
      body.eye = STAND_EYE;
      body.crouching = false;
      body.height = STAND_HEIGHT;
      health = 100;
      armor = 0;
    },
    // Damage first eats armour (half of each hit), then health. Returns true on death.
    damage(amount) {
      let left = amount;
      if (armor > 0) {
        const absorbed = Math.min(armor, Math.ceil(left / 2));
        armor -= absorbed;
        left -= absorbed;
      }
      health = Math.max(0, health - left);
      return health <= 0;
    },
    heal(amount) {
      health = Math.min(100, health + amount);
    },
  };
}
