// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, killfeed,
// buy menu, channel bars and the overlay panels. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Every setter is
// cached, so the DOM is only written when a value actually changes.
import { WEAPONS, GRENADE, ARMOR, BUY_ORDER } from './weapons.js';

const COPY = {
  start: {
    title: 'KESTREL YARD',
    copy: 'A container depot at dusk. Five Kestrels hold two bomb sites against five Vipers. First to 4 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'KESTREL YARD',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthValue = $('health-value');
  const healthBar = $('health-fill');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreK = $('score-kestrel');
  const scoreV = $('score-viper');
  const roundValue = $('round-value');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const damage = $('damage');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const channel = $('channel');
  const channelLabel = $('channel-label');
  const channelFill = $('channel-fill');
  const message = $('message');
  const scoreboard = $('scoreboard');

  let last = {};
  let hitTimer = 0;
  let messageTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  // The buy menu rows are built once from the weapon table.
  const buyRows = {};
  for (const id of BUY_ORDER) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.dataset.id = id;
    const def = id === 'grenade' ? GRENADE : id === 'armor' ? ARMOR : WEAPONS[id];
    row.innerHTML = `<span class="buy-key">${BUY_ORDER.indexOf(id) + 1}</span><span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
    buyMenu.querySelector('.buy-list').appendChild(row);
    buyRows[id] = row;
  }

  return {
    setHealth(hp, armor) {
      setText(healthValue, 'hp', String(hp));
      setText(armorValue, 'armor', armor > 0 ? `+${armor}` : '');
      if (last.hpBar !== hp) {
        last.hpBar = hp;
        healthBar.style.width = `${hp}%`;
        healthBar.classList.toggle('low', hp <= 30);
      }
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      setText(grenadeCount, 'gren', grenades > 0 ? `HE x${grenades}` : '');
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
      setText(buyMoney, 'buymoney', `$${value}`);
    },
    setScore(kestrel, viper, round) {
      setText(scoreK, 'sk', String(kestrel));
      setText(scoreV, 'sv', String(viper));
      setText(roundValue, 'round', `ROUND ${round}`);
    },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('urgent', seconds <= 10);
      timerValue.classList.toggle('planted', planted);
    },
    setBomb(state, site, seconds) {
      let text = '';
      if (state === 'planted') text = `BOMB AT ${site} — ${Math.ceil(seconds)}s`;
      else if (state === 'dropped') text = 'BOMB DROPPED';
      else if (state === 'carried') text = 'VIPERS HAVE THE BOMB';
      setText(bombStatus, 'bomb', text);
      bombStatus.classList.toggle('danger', state === 'planted');
    },
    setCrosshairGap(px) {
      const value = `${px.toFixed(1)}px`;
      if (last.gap !== value) {
        last.gap = value;
        crosshair.style.setProperty('--gap', value);
      }
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const line = document.createElement('div');
      line.className = `feed-line ${killerTeam}`;
      line.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showMessage(text, ms = 3000) {
      message.textContent = text;
      message.classList.add('on');
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => message.classList.remove('on'), ms);
    },
    showBanner(titleText, subText, ms = 3500) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    hideBanner() {
      banner.classList.remove('on');
    },
    showBuy(open, money, owned) {
      buyMenu.hidden = !open;
      if (!open) return;
      setText(buyMoney, 'buymoney', `$${money}`);
      for (const id of BUY_ORDER) {
        const row = buyRows[id];
        const def = id === 'grenade' ? GRENADE : id === 'armor' ? ARMOR : WEAPONS[id];
        const has = id === 'grenade' ? false : id === 'armor' ? false : Boolean(owned[id]);
        row.classList.toggle('owned', has);
        row.classList.toggle('poor', money < def.price);
      }
    },
    buyFlash(id, ok) {
      const row = buyRows[id];
      if (!row) return;
      row.classList.add(ok ? 'bought' : 'denied');
      setTimeout(() => row.classList.remove('bought', 'denied'), 250);
    },
    setChannel(label, progress) {
      if (label === null) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showScoreboard(rows) {
      scoreboard.hidden = false;
      scoreboard.querySelector('tbody').innerHTML = rows.map((r) =>
        `<tr class="${r.team}"><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.alive ? 'ALIVE' : 'DEAD'}</td></tr>`).join('');
    },
    hideScoreboard() {
      scoreboard.hidden = true;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'round') copy.textContent = detail || '';
      else if (mode === 'match') copy.textContent = detail || '';
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
