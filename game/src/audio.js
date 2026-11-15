// Sound, synthesised: no audio files, no network. Every sound is a few WebAudio
// nodes built on the fly — a noise burst through a low-pass for a gunshot, a short
// square blip for a hit, a low sine drop for an explosion. The context is created
// on the first user gesture, so the game stays silent on the menu until you play.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    unlock() {
      ensure();
    },
    shot(weaponId) {
      if (weaponId === 'sniper') burst(0.28, 900, 0.9);
      else if (weaponId === 'pistol') burst(0.12, 1800, 0.5);
      else burst(0.16, 1200, 0.7);
    },
    dryFire() {
      tone(1800, 0.04, 0.15, 'square');
    },
    reload() {
      tone(900, 0.05, 0.12, 'square');
      setTimeout(() => tone(700, 0.05, 0.12, 'square'), 180);
    },
    hit(killed) {
      tone(killed ? 1400 : 1100, killed ? 0.12 : 0.06, 0.25, 'square');
    },
    hurt() {
      tone(220, 0.18, 0.3, 'sawtooth', 110);
    },
    throwSound() {
      burst(0.08, 2500, 0.2, 'bandpass');
    },
    explosion() {
      burst(0.9, 300, 1.0);
      tone(90, 0.8, 0.5, 'sine', 35);
    },
    plantBeep() {
      tone(1200, 0.08, 0.2, 'square');
    },
    defuseBeep() {
      tone(900, 0.08, 0.2, 'square');
    },
    roundWin() {
      tone(523, 0.14, 0.25, 'triangle');
      setTimeout(() => tone(659, 0.14, 0.25, 'triangle'), 140);
      setTimeout(() => tone(784, 0.28, 0.25, 'triangle'), 280);
    },
    roundLose() {
      tone(392, 0.18, 0.25, 'triangle');
      setTimeout(() => tone(311, 0.3, 0.25, 'triangle'), 180);
    },
    buy() {
      tone(1000, 0.06, 0.15, 'square');
      setTimeout(() => tone(1300, 0.08, 0.15, 'square'), 70);
    },
  };
}
