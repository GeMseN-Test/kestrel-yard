// The single state store. Every number the match cares about lives here and nowhere
// else: the round clock, the score, the money, the bomb, and the two teams. Modules
// read it and write it; they never keep their own copy of a match fact.
//
// Teams: 'kestrel' defends (the player + 4 bots), 'viper' attacks (5 bots, one
// carries the bomb). First to 4 round wins takes the match, at most 7 rounds.
// A round ends by elimination, by the bomb exploding, by a defuse, or by the clock
// running out with no plant (defenders win).
export const PHASE = {
  MENU: 'menu', // start overlay, nothing simulated
  BUY: 'buy', // freeze time: buy menu open, 12 s
  LIVE: 'live', // round running
  ROUND_END: 'round_end', // banner shown, 4 s
  MATCH_END: 'match_end', // final overlay, restart offered
};

export const WIN_ROUNDS = 4;
export const MAX_ROUNDS = 7;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const BOMB_TIME = 40;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const PLANT_REWARD = 300;

export function createStore() {
  return {
    phase: PHASE.MENU,
    round: 1,
    score: { kestrel: 0, viper: 0 },
    clock: BUY_TIME, // counts down in BUY and LIVE
    kills: { kestrel: 0, viper: 0 }, // round kills, for the scoreboard
    money: START_MONEY, // the player's money; bots buy from their own purse in bots.js
    bomb: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      site: null, // 'A' | 'B' once planted
      x: 0,
      y: 0,
      z: 0,
      timer: BOMB_TIME, // counts down once planted
      carrier: null, // bot id carrying it, or null
      planter: null, // bot id planting, while channeling
      defuser: null, // bot id defusing, while channeling
      progress: 0, // 0..1 channel progress of planter/defuser
    },
    // The last thing that happened, for the killfeed and the round banner.
    lastEvent: null, // { kind: 'kill'|'plant'|'defuse'|'explode'|'timeout'|'round'|'match', ... }
    roundWinner: null,
    matchWinner: null,
    // Deterministic clock for screenshots: shot mode drives the sim by hand.
    time: 0,
  };
}
