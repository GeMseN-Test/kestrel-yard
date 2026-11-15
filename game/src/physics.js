// Shared movement physics: one axis at a time against the world's axis-aligned boxes,
// so a wall never swallows a body and standing on the floor is never read as walking
// into a wall. The player and every bot move through this one function; nothing else
// in the game touches colliders directly.
import * as THREE from 'three';

const RADIUS = 0.34;

// probe is reused every call: no allocation in the hot loop.
const probe = new THREE.Box3();

function overlaps(x, y, z, height, lift, colliders) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

export function createMover(colliders) {
  // body: { position: Vector3, velocity: Vector3, height, onGround }
  // gravity and jumpSpeed are per-body so bots and the player can differ.
  return {
    step(body, dt, gravity, jumpSpeed) {
      const nextX = body.position.x + body.velocity.x * dt;
      if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04, colliders)) {
        body.position.x = nextX;
      } else {
        body.velocity.x = 0;
      }
      const nextZ = body.position.z + body.velocity.z * dt;
      if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04, colliders)) {
        body.position.z = nextZ;
      } else {
        body.velocity.z = 0;
      }
      body.velocity.y -= gravity * dt;
      body.position.y += body.velocity.y * dt;
      body.onGround = false;
      const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0, colliders);
      if (hit && body.velocity.y <= 0) {
        body.position.y = hit.max.y;
        body.velocity.y = 0;
        body.onGround = true;
      } else if (hit) {
        body.position.y = hit.min.y - body.height;
        body.velocity.y = 0;
      }
      if (body.position.y < 0) {
        body.position.y = 0;
        body.velocity.y = 0;
        body.onGround = true;
      }
      body.velocity.y = Math.max(-30, body.velocity.y);
    },
  };
}
