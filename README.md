# kestrel-yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/GeMseN-Test/kestrel-yard/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/GeMseN-Test/kestrel-yard/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Kestrel Yard: a round-based tactical first-person shooter in the style Counter-Strike made famous, built on three.js 0.187.0 from static files with no build step and no network request. Single-player against bots. An original map, original art and original names.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5c2wyg2x&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## The game

**Kestrel Yard** is a container depot at dusk. Five Kestrels (you + four bots) hold
two bomb sites — **A CRANE** in the west, **B DEPOT** in the east — against five
Viper bots. The Vipers carry a bomb: if they plant it, you have 40 seconds to defuse
it. First to 4 round wins takes the match (at most 7 rounds).

- **Gunplay:** four weapons (P9 Sidearm, K9 SMG, VK-47 rifle, Longbow sniper with
  scope), headshot damage, recoil and spread that punish firing on the move,
  acceleration, sprint, crouch and jump, map collision.
- **Tactics:** bomb plant/defuse, money earned per round and spent in a buy menu
  (weapons, HE grenades, Kevlar), bots that follow routes through the map, hold
  positions, rotate to a planted bomb and react to what they see and hear.
- **Map:** three lanes through a staggered container row, two flank lanes, a gantry
  crane over site A and a warehouse doorway at site B, dusk lighting with long
  amber shadows.
- **HUD:** health and armour, ammo, money, round timer, team score, bomb status,
  killfeed, hitmarkers, buy menu and scoreboard.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| Right-click | Scope (Longbow) |
| R | Reload |
| Shift | Sprint |
| Ctrl / C | Crouch |
| Space | Jump |
| B | Buy menu (buy phase) |
| 1–4 | Weapons, 1–6 in the buy menu |
| G | Throw HE grenade |
| E | Defuse the bomb (hold, near a planted bomb) |
| Tab | Scoreboard |

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots live in `screenshots/` (the first by name is the cover). They are real
renders of this game, taken in a headless browser with `?shot=spawn|combat|site|end`.

## Layout

- `game/index.html` — the page and the whole HUD
- `game/src/main.js` — boot, the fixed-step loop and the match flow
- `game/src/map.js` — Kestrel Yard: geometry, colliders, the waypoint graph
- `game/src/bots.js` — the nine bots: routes, perception, bursts, plant/defuse
- `game/src/combat.js` — shots, grenades, the defuse
- `game/src/weapons.js` — the four guns, the grenade, the buy table
- `game/src/player.js` — movement, health, armour
- `game/src/physics.js` — the shared AABB mover
- `game/src/state.js` — the single match store
- `game/src/effects.js` — tracers, sparks, explosions, the bomb light
- `game/src/audio.js` — synthesised sound, no audio files
- `game/src/hud.js` — the DOM HUD
- `game/src/input.js` — keyboard, mouse, pointer lock
- `game/vendor/three/` — three.js 0.187.0, vendored byte for byte

MIT licensed. Built for the make.fun "Make the best three.js tactical FPS"
bounty (threejs-fps-02).
