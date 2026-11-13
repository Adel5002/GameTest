'use strict';
// ===== Интерфейс: HUD, меню, коллекция, сундуки, модалки =====
const $ = (id) => document.getElementById(id);

const UI = {
  cache: {},
  replaceMode: null,

  init() {
    Profile.load();
    this.applySettings();
    Game.init($('cv'));
    this.bind();
    this.showMenu();
    if (Profile.dailyAvailable()) setTimeout(() => this.showDaily(), 450);
    setInterval(() => { if (!$('menu').classList.contains('hidden')) this.renderFreeChest(); }, 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && Game.state === 'play' && !Game.paused) this.showPause();
    });
    this.bindBackButton();
  },

  applySettings() {
    const s = Profile.data.settings;
    Sfx.setSound(s.sound); Sfx.setMusic(s.music); Haptic.on = s.vibro;
  },

  bind() {
    const unlock = () => Sfx.init();
    document.addEventListener('pointerdown', unlock, { capture: true });
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { Sfx.click(); fn(e); });
    tap('m-play', () => this.play());
    tap('m-coll', () => this.showScreen('coll'));
    tap('m-shop', () => this.showScreen('shop'));
    tap('m-set', () => this.showSettings());
    tap('m-free', () => { if (Profile.freeChestReady()) this.openChest('free'); else this.toast('Сундук ещё копит сны 💤'); });
    tap('btn-pause', () => this.showPause());
    $('btn-summon').addEventListener('click', () => { Sfx.init(); Game.summon(); this.updateHud(); });
    tap('btn-speed', () => {
      Game.speed = Game.speed === 1 ? 2 : 1;
      $('btn-speed').textContent = '×' + Game.speed;
      $('btn-speed').classList.toggle('on', Game.speed === 2);
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { Sfx.click(); this.showMenu(); }));
  },

  bindBackButton() {
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App) return;
      App.addListener('backButton', () => {
        if (!$('modal').classList.contains('hidden')) {
          if (Game.state === 'play' && Game.paused) this.resume();
          else if (Game.state !== 'over') this.closeModal();
          return;
        }
        if (Game.state === 'play') { this.showPause(); return; }
        if (!$('coll').classList.contains('hidden') || !$('shop').classList.contains('hidden')) { this.showMenu(); return; }
        App.exitApp();
      });
    } catch (e) { /* не нативная сборка */ }
  },

  // ---------- геометрия для канваса ----------
  hudBottom() { return $('hud').getBoundingClientRect().bottom; },
  panelTop() { return $('panel').getBoundingClientRect().top; },
  dustTarget() {
    const r = $('dust-icon').getBoundingClientRect();
    return { x: (r.left + r.width / 2 - Game.offX) / Game.scale, y: (r.top + r.height / 2) / Game.scale };
  },
  bumpDust() {
    const d = $('dust');
    d.classList.remove('bump'); void d.offsetWidth; d.classList.add('bump');
  },

  // ---------- экраны ----------
  hideAll() {
    ['menu', 'coll', 'shop'].forEach(id => $(id).classList.add('hidden'));
    this.closeModal();
  },
  showScreen(id) {
    this.hideAll();
    $(id).classList.remove('hidden');
    if (id === 'coll') { this.replaceMode = null; this.renderColl(); }
    if (id === 'shop') this.renderShop();
  },
  showMenu() {
    this.hideAll();
    document.body.classList.remove('playing');
    Game.state = 'menu';
    Game.enemies = []; Game.particles = []; Game.floats = [];
    $('menu').classList.remove('hidden');
    Profile.refreshMissions();
    this.renderMenu();
  },

  renderMenu() {
    const P = Profile.data;
    $('m-level').textContent = P.level;
    $('m-level2').textContent = P.level;
    $('m-xp').style.width = Math.min(100, P.xp / xpForLevel(P.level) * 100) + '%';
    $('m-stars').textContent = P.stars;
    $('m-best').textContent = P.best ? `Рекорд: волна ${P.best}` : 'Первая ночь';
    $('m-coll-dot').classList.toggle('hidden', !Profile.upgradesAvailable());
    this.renderFreeChest();
    this.renderMissions();
  },

  renderFreeChest() {
    const ready = Profile.freeChestReady();
    $('m-free').classList.toggle('ready', ready);
    $('m-free-dot').classList.toggle('hidden', !ready);
    if (ready) $('m-free-t').textContent = 'Готов! Открывай 👆';
    else {
      const ms = Profile.data.freeChestAt - Date.now();
      const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
      $('m-free-t').textContent = `Через ${h}ч ${String(m).padStart(2, '0')}м ${String(s).padStart(2, '0')}с`;
    }
  },

  renderMissions() {
    const list = Profile.data.missions.list;
    const box = $('m-missions');
    box.innerHTML = `<h3><span>📜 Задания на сегодня</span><span>${list.filter(m => m.claimed).length}/${list.length}</span></h3>`;
    list.forEach((ms, i) => {
      const done = ms.progress >= ms.target;
      const el = document.createElement('div');
      el.className = 'mission';
      el.innerHTML = `
        <div class="m-body">
          <div class="m-t">${Profile.missionText(ms)}</div>
          <div class="bar"><i style="width:${ms.progress / ms.target * 100}%"></i></div>
          <div class="m-p">${ms.progress} / ${ms.target}</div>
        </div>
        <button class="claim-btn ${ms.claimed ? 'done' : done ? 'ready' : ''}">${ms.claimed ? '✓' : '⭐ ' + ms.reward}</button>`;
      el.querySelector('button').addEventListener('click', () => {
        if (ms.claimed || !done) { Sfx.deny(); return; }
        ms.claimed = true;
        Profile.addStars(ms.reward);
        Sfx.star(); Haptic.vibrate(20);
        this.confetti(14);
        this.toast(`+${ms.reward} ⭐`);
        this.renderMenu();
      });
      box.appendChild(el);
    });
  },

  // ---------- забег ----------
  play() {
    this.hideAll();
    document.body.classList.add('playing');
    Game.startRun();
  },

  onRunStart() {
    this.cache = {};
    $('btn-speed').textContent = '×1'; $('btn-speed').classList.remove('on');
    const box = $('powers');
    box.innerHTML = '';
    Game.deck.forEach(id => {
      const b = document.createElement('button');
      b.className = 'pw'; b.dataset.id = id;
      b.innerHTML = `<span class="pw-e">${TOYS[id].emoji}</span><span class="pw-l"></span><span class="pw-c"></span>`;
      b.addEventListener('click', () => { if (Game.powerUp(id)) this.updateHud(true); });
      box.appendChild(b);
    });
    this.tutHint(null);
    this.updateHud(true);
  },

  setIf(key, val, fn) { if (this.cache[key] !== val) { this.cache[key] = val; fn(val); } },

  updateHud(force) {
    if (force) this.cache = {};
    const g = Game;
    this.setIf('lives', g.lives, (v) => {
      const prev = this.cache.livesPrev ?? v;
      let h = '';
      for (let i = 0; i < 3; i++) h += i < v ? '<span>❤️</span>' : `<span class="off ${i === v && prev > v ? 'lost' : ''}">🤍</span>`;
      $('lives').innerHTML = h;
      this.cache.livesPrev = v;
    });
    this.setIf('wave', g.wave, v => { $('wave').textContent = v ? `Волна ${v}` : 'Готовься!'; });
    this.setIf('dust', Math.floor(g.dust), v => { $('dust-val').textContent = v; });
    const cost = g.summonCost();
    const free = g.freeSlots().length;
    this.setIf('scost', cost, v => { $('summon-cost').textContent = v; });
    this.setIf('soff', (g.dust < cost || !free) + '|' + free, () => {
      $('btn-summon').classList.toggle('off', g.dust < cost || !free);
    });
    document.querySelectorAll('.pw').forEach(b => {
      const id = b.dataset.id;
      const pc = g.powerCost(id);
      const key = id + g.power[id] + '|' + (pc !== null && g.dust >= pc);
      this.setIf('pw' + id, key, () => {
        b.querySelector('.pw-l').textContent = `сила ${g.power[id]}`;
        b.querySelector('.pw-c').textContent = pc === null ? 'МАКС' : `✨${pc}`;
        b.classList.toggle('max', pc === null);
        b.classList.toggle('can', pc !== null && g.dust >= pc);
        b.classList.toggle('off', pc !== null && g.dust < pc);
      });
    });
  },

  tutHint(text, pulse) {
    const el = $('tut');
    if (!text) { el.classList.add('hidden'); $('btn-summon').classList.remove('pulse'); this.cache.tut = null; return; }
    if (this.cache.tut !== text) { el.textContent = text; el.classList.remove('hidden'); this.cache.tut = text; }
    $('btn-summon').classList.toggle('pulse', !!pulse);
  },

  showPause() {
    if (Game.state !== 'play') return;
    Game.paused = true;
    const s = Profile.data.settings;
    this.modal(`
      <div class="big-emoji">⏸️</div>
      <h2>Пауза</h2>
      <p>Волна ${Game.wave} · прогнано кошмаров: ${Game.kills}</p>
      <div class="toggle-row"><span>🔊 Звуки</span><button class="switch ${s.sound ? 'on' : ''}" data-set="sound"></button></div>
      <div class="toggle-row"><span>🎵 Колыбельная</span><button class="switch ${s.music ? 'on' : ''}" data-set="music"></button></div>
      <button class="btn green" id="p-resume">Продолжить</button>
      <button class="btn" id="p-quit">Сдаться</button>
    `);
    this.bindSwitches();
    $('p-resume').onclick = () => { Sfx.click(); this.resume(); };
    $('p-quit').onclick = () => {
      Sfx.click(); this.closeModal(); Game.paused = false;
      Game.lives = 0; Game.revived = true; Game.gameOver();
    };
  },
  resume() { this.closeModal(); Game.paused = false; Game.last = performance.now(); },

  // ---------- конец забега ----------
  runRewards() {
    const g = Game;
    const stars = Math.round(g.wave * 2.5 + g.bossKills * 8 + g.maxCombo / 10 + g.starsCaught * 2);
    const xp = g.wave * 10 + Math.floor(g.kills / 5);
    return { stars, xp };
  },

  showGameOver() {
    const g = Game, P = Profile.data;
    const r = this.runRewards();
    const isRecord = g.wave > P.best;
    const diff = P.best - g.wave;
    const reviveCost = 50;
    let near = '';
    if (!isRecord && diff >= 0 && diff <= 3) near = diff === 0 ? 'Ровно как рекорд! Ещё чуть-чуть!' : `До рекорда всего ${diff} ${diff === 1 ? 'волна' : 'волны'}!`;
    const missionNear = P.missions.list.find(m => !m.claimed && m.progress < m.target && m.progress / m.target > 0.6);
    if (!near && missionNear) near = `Задание почти готово: ${Profile.missionText(missionNear)} (${missionNear.progress}/${missionNear.target})`;
    this.modal(`
      <div class="big-emoji">😭</div>
      <h2>Малыш проснулся!</h2>
      <div class="go-label">Ты продержался до</div>
      <div class="go-wave">волны ${g.wave}</div>
      ${isRecord ? '<div class="record">🏆 НОВЫЙ РЕКОРД!</div>' : `<div class="go-label">Рекорд: волна ${P.best}</div>`}
      ${near ? `<div class="near">${near}</div>` : ''}
      <div class="go-stats">
        <div><b>${g.kills}</b>кошмаров</div>
        <div><b>${g.merges}</b>слияний</div>
        <div><b>×${g.maxCombo}</b>комбо</div>
      </div>
      <div class="rewards">
        <div class="reward"><span class="rv">⭐ +${r.stars}</span><small>звёзды</small></div>
        <div class="reward"><span class="rv">🔮 +${r.xp}</span><small>опыт</small></div>
      </div>
      ${!g.revived ? `<button class="btn purple ${P.stars < reviveCost ? 'off' : ''}" id="go-revive">🎶 Спеть колыбельную (⭐ ${reviveCost})<br><small>+2 ❤ и все кошмары исчезнут</small></button>` : ''}
      <button class="btn green" id="go-again">Ещё раз! 🔁</button>
      <button class="btn" id="go-home">Домой</button>
    `);
    if (isRecord && g.wave > 1) { Sfx.record(); this.confetti(40); }
    const rv = $('go-revive');
    if (rv) rv.onclick = () => {
      if (P.stars < reviveCost) { Sfx.deny(); this.toast('Не хватает звёзд ⭐'); return; }
      Profile.addStars(-reviveCost);
      this.closeModal();
      Game.revive();
      this.updateHud(true);
    };
    $('go-again').onclick = () => { Sfx.click(); const lv = this.finishRun(); this.play(); if (lv) this.toast(`🎉 Уровень Стража ${Profile.data.level}!`); };
    $('go-home').onclick = () => { Sfx.click(); const lv = this.finishRun(); this.showMenu(); if (lv) this.showLevelUp(lv); };
  },

  finishRun() {
    const g = Game, P = Profile.data;
    const r = this.runRewards();
    P.best = Math.max(P.best, g.wave);
    P.games++;
    P.totals.kills += g.kills; P.totals.merges += g.merges; P.totals.bosses += g.bossKills;
    Profile.addStars(r.stars);
    const ups = Profile.addXP(r.xp);
    if (ups) Profile.addStars(ups * 50);
    Profile.save();
    return ups;
  },

  showLevelUp(n) {
    this.modal(`
      <div class="big-emoji">🎉</div>
      <h2>Уровень ${Profile.data.level}!</h2>
      <p>Страж становится сильнее. Держи награду:</p>
      <div class="rewards"><div class="reward"><span class="rv">⭐ +${n * 50}</span><small>звёзды</small></div><div class="reward"><span class="rv">🧰 ×1</span><small>сундук</small></div></div>
      <button class="btn gold" id="lu-ok">Открыть сундук!</button>
    `);
    Sfx.record(); this.confetti(30);
    $('lu-ok').onclick = () => this.openChest('small', true);
  },

  // ---------- ежедневная награда ----------
  showDaily() {
    if (!Profile.dailyAvailable() || Game.state === 'play') return;
    const idx = Profile.dailyNextIndex();
    let cells = '';
    DAILY_REWARDS.forEach((r, i) => {
      const e = r.chest ? CHESTS[r.chest].emoji : '⭐';
      const t = r.chest ? CHESTS[r.chest].name.split(' ')[0] : r.stars;
      cells += `<div class="day ${i < idx ? 'done' : ''} ${i === idx ? 'today' : ''} ${i === 6 ? 'last' : ''}"><span class="de">${e}</span>День ${i + 1}<br>${t}</div>`;
    });
    this.modal(`
      <h2>Награда за вход 🌙</h2>
      <p>Заходи каждый день — награды растут! Пропустишь день — серия сгорит.</p>
      <div class="daily-grid">${cells}</div>
      <button class="btn gold" id="d-claim">Забрать!</button>
    `);
    $('d-claim').onclick = () => {
      const r = Profile.claimDaily();
      Sfx.star(); Haptic.vibrate(20);
      if (r.chest) this.openChest(r.chest, true);
      else { Profile.addStars(r.stars); this.closeModal(); this.toast(`+${r.stars} ⭐`); this.confetti(20); this.renderMenu(); }
    };
  },

  // ---------- сундуки ----------
  renderShop() {
    document.querySelectorAll('.js-stars').forEach(e => { e.textContent = Profile.data.stars; });
    const list = $('shop-list'); list.innerHTML = '';
    ['free', 'small', 'big'].forEach(id => {
      const ch = CHESTS[id];
      const el = document.createElement('div');
      el.className = 'chest-offer';
      let btn;
      if (id === 'free') btn = Profile.freeChestReady() ? '<button class="buy-btn">Бесплатно</button>' : '<button class="buy-btn off">Ждёт</button>';
      else btn = `<button class="buy-btn ${Profile.data.stars < ch.price ? 'off' : ''}">⭐ ${ch.price}</button>`;
      el.innerHTML = `<div class="co-e">${ch.emoji}</div><div class="co-t"><b>${ch.name}</b><span>${ch.cards} карт${ch.guaranteeRare ? ' · гарантированно редкая+' : ''}${id === 'free' ? ' · раз в 3 часа' : ''}</span></div>${btn}`;
      el.querySelector('button').addEventListener('click', () => {
        if (id === 'free') { if (Profile.freeChestReady()) this.openChest('free'); else Sfx.deny(); return; }
        if (Profile.data.stars < ch.price) { Sfx.deny(); this.toast('Не хватает звёзд ⭐ — сыграй ещё ночь!'); return; }
        Profile.addStars(-ch.price);
        this.openChest(id);
      });
      list.appendChild(el);
    });
  },

  openChest(id, isGift) {
    if (id === 'free') { Profile.data.freeChestAt = Date.now() + FREE_CHEST_COOLDOWN; Profile.save(); }
    const ch = CHESTS[id];
    const cards = Profile.rollCards(id);
    let taps = 0, idx = -1;
    this.modal(`
      <h2>${ch.name}</h2>
      <div class="chest-stage" id="cs"><div class="chest-big" id="cbig">${ch.emoji}</div></div>
      <div class="tap-hint" id="chint">Тапай, чтобы открыть!</div>
    `);
    const stage = $('cs');
    const next = () => {
      if (idx < 0) {
        taps++;
        const cb = $('cbig');
        cb.classList.remove('shake'); void cb.offsetWidth; cb.classList.add('shake');
        Sfx.chestShake(); Haptic.vibrate(15);
        if (taps < 3) return;
        Sfx.boom(); Haptic.vibrate(40);
        this.confetti(16);
      }
      idx++;
      if (idx >= cards.length) { showSummary(); return; }
      const c = cards[idx], def = TOYS[c.id], rar = RARITY[def.rarity];
      stage.innerHTML = `
        <div class="card-reveal ${def.rarity === 'epic' ? 'glow-epic' : def.rarity === 'rare' ? 'glow-rare' : ''}" style="border-color:${rar.color}">
          ${c.isNew ? '<div class="new-badge">НОВАЯ!</div>' : ''}
          <div class="cr-e">${def.emoji}</div>
          <div class="cr-n">${def.name}</div>
          <div class="cr-r" style="color:${rar.color}">${rar.name}</div>
          <div class="cr-c">×${c.n}</div>
        </div>`;
      $('chint').textContent = `${idx + 1} / ${cards.length} · тапни дальше`;
      Sfx.card(def.rarity); Haptic.vibrate(def.rarity === 'common' ? 8 : 25);
      if (c.isNew) { Sfx.record(); this.confetti(30); }
    };
    const showSummary = () => {
      $('modal-box').onclick = null;
      const items = cards.map(c => `<span class="sm">${TOYS[c.id].emoji} ×${c.n}</span>`).join('');
      const news = cards.filter(c => c.isNew).map(c => TOYS[c.id].name);
      $('modal-box').innerHTML = `
        <h2>Добыча!</h2>
        <div class="summary">${items}</div>
        ${news.length ? `<p style="color:var(--accent)">Новая игрушка: ${news.join(', ')}! Она уже в коллекции.</p>` : ''}
        ${Profile.upgradesAvailable() ? '<p style="color:var(--good)">Можно прокачать игрушки ⬆</p>' : ''}
        <button class="btn green" id="c-ok">Класс!</button>`;
      $('c-ok').onclick = () => {
        Sfx.click(); this.closeModal();
        if (!$('shop').classList.contains('hidden')) this.renderShop();
        else if (!$('coll').classList.contains('hidden')) this.renderColl();
        else this.renderMenu();
      };
    };
    $('modal-box').onclick = next;
  },

  // ---------- коллекция ----------
  renderColl() {
    const P = Profile.data;
    document.querySelectorAll('.js-stars').forEach(e => { e.textContent = P.stars; });
    const deck = $('deck'); deck.innerHTML = '';
    deck.classList.toggle('replace', !!this.replaceMode);
    $('coll-hint').textContent = this.replaceMode ? `Выбери, кого заменить на ${TOYS[this.replaceMode].name} 👆` : 'Коллекция — тапни игрушку';
    P.deck.forEach((id, i) => {
      const el = this.toyTile(id, true);
      el.addEventListener('click', () => {
        Sfx.click();
        if (this.replaceMode) { P.deck[i] = this.replaceMode; this.replaceMode = null; Profile.save(); this.renderColl(); }
        else this.showToy(id);
      });
      deck.appendChild(el);
    });
    const coll = $('collection'); coll.innerHTML = '';
    TOY_IDS.forEach(id => {
      const el = this.toyTile(id, false);
      el.addEventListener('click', () => { Sfx.click(); this.replaceMode = null; this.showToy(id); });
      coll.appendChild(el);
    });
  },

  toyTile(id, small) {
    const t = Profile.data.toys[id], def = TOYS[id];
    const el = document.createElement('button');
    el.className = `toy-tile r-${def.rarity} ${t.unlocked ? '' : 'locked'} ${!small && Profile.data.deck.includes(id) ? 'in-deck' : ''}`;
    if (small) { el.innerHTML = `<span class="tt-e">${def.emoji}</span><span class="tt-l">ур.${t.lvl}</span>`; return el; }
    const need = t.lvl < MAX_META ? CARD_REQ[t.lvl - 1] : null;
    el.innerHTML = `
      ${Profile.canUpgrade(id) ? '<span class="up-arrow">⬆</span>' : ''}
      <span class="tt-e">${def.emoji}</span>
      <span class="tt-n">${t.unlocked ? def.name : '???'}</span>
      <span class="tt-l">${t.unlocked ? 'ур. ' + t.lvl : RARITY[def.rarity].name}</span>
      ${t.unlocked ? `<div class="bar ${need && t.cards >= need ? 'full' : ''}"><i style="width:${need ? Math.min(100, t.cards / need * 100) : 100}%"></i></div>
      <span class="tt-c">${need ? `${t.cards}/${need} карт` : 'МАКС'}</span>` : '<span class="tt-c">из сундуков</span>'}`;
    return el;
  },

  showToy(id) {
    const P = Profile.data, t = P.toys[id], def = TOYS[id], rar = RARITY[def.rarity];
    if (!t.unlocked) {
      this.modal(`<div class="big-emoji" style="filter:brightness(0) opacity(.6)">${def.emoji}</div><h2>???</h2>
        <p style="color:${rar.color}">${rar.name} игрушка</p><p>Выпадает из сундуков. Чем дороже сундук — тем выше шанс!</p>
        <button class="btn" id="t-close">Понятно</button>`);
      $('t-close').onclick = () => this.closeModal();
      return;
    }
    const m = t.lvl, mul = 1 + 0.1 * (m - 1), mulN = 1 + 0.1 * m;
    const need = m < MAX_META ? CARD_REQ[m - 1] : null;
    const cost = metaStarCost(m);
    let rows = '';
    if (def.kind !== 'joker') {
      rows += `<div><span>Урон</span><b>${Math.round(def.dmg * mul)}${need ? ` <span class="up">→ ${Math.round(def.dmg * mulN)}</span>` : ''}</b></div>`;
      rows += `<div><span>Атак в секунду</span><b>${def.rate}</b></div>`;
    }
    if (def.slow) rows += `<div><span>Замедление</span><b>${Math.round(def.slow * 100)}%</b></div>`;
    if (def.radius) rows += `<div><span>Радиус</span><b>${def.radius}</b></div>`;
    if (def.splash) rows += `<div><span>Взрыв</span><b>${def.splash}</b></div>`;
    if (def.chains) rows += `<div><span>Целей</span><b>${def.chains}+</b></div>`;
    if (def.income) rows += `<div><span>Пыльца / ${def.incomeEvery}с</span><b>${Math.round(def.income * mul)}${need ? ` <span class="up">→ ${Math.round(def.income * mulN)}</span>` : ''}</b></div>`;
    const inDeck = P.deck.includes(id);
    const can = Profile.canUpgrade(id);
    this.modal(`
      <div class="big-emoji">${def.emoji}</div>
      <h2>${def.name} <small style="color:var(--muted)">ур. ${m}</small></h2>
      <div style="color:${rar.color};font-weight:900;font-size:.85em">${rar.name}</div>
      <p>${def.desc}</p>
      <div class="stat-list">${rows}
        <div><span>Карты</span><b>${need ? `${t.cards} / ${need}` : 'МАКС'}</b></div></div>
      ${need ? `<button class="btn gold ${can ? '' : 'off'}" id="t-up">Улучшить · ⭐ ${cost}</button>` : ''}
      ${inDeck ? '<p>✓ В колоде</p>' : '<button class="btn purple" id="t-deck">Взять в колоду</button>'}
      <button class="btn" id="t-close">Закрыть</button>
    `);
    const up = $('t-up');
    if (up) up.onclick = () => {
      if (!Profile.upgradeToy(id)) {
        Sfx.deny();
        this.toast(t.cards < need ? 'Нужно больше карт 🃏' : 'Не хватает звёзд ⭐');
        return;
      }
      Sfx.upgrade(); Sfx.record(); Haptic.vibrate(30); this.confetti(20);
      this.renderColl(); this.showToy(id);
    };
    const dk = $('t-deck');
    if (dk) dk.onclick = () => { Sfx.click(); this.replaceMode = id; this.closeModal(); this.renderColl(); };
    $('t-close').onclick = () => { Sfx.click(); this.closeModal(); };
  },

  // ---------- настройки ----------
  showSettings() {
    const s = Profile.data.settings, P = Profile.data;
    this.modal(`
      <h2>Настройки</h2>
      <div class="toggle-row"><span>🔊 Звуки</span><button class="switch ${s.sound ? 'on' : ''}" data-set="sound"></button></div>
      <div class="toggle-row"><span>🎵 Колыбельная</span><button class="switch ${s.music ? 'on' : ''}" data-set="music"></button></div>
      <div class="toggle-row"><span>📳 Вибрация</span><button class="switch ${s.vibro ? 'on' : ''}" data-set="vibro"></button></div>
      <div class="stat-list">
        <div><span>Ночей сыграно</span><b>${P.games}</b></div>
        <div><span>Кошмаров прогнано</span><b>${P.totals.kills}</b></div>
        <div><span>Слияний</span><b>${P.totals.merges}</b></div>
        <div><span>Боссов побеждено</span><b>${P.totals.bosses}</b></div>
      </div>
      <button class="btn green" id="s-ok">Готово</button>
      <button class="btn" id="s-tut">Пройти обучение заново</button>
      <button class="btn" id="s-reset" style="color:var(--bad)">Сбросить прогресс</button>
    `);
    this.bindSwitches();
    $('s-ok').onclick = () => { Sfx.click(); this.closeModal(); };
    $('s-tut').onclick = () => { Profile.data.tutorial = false; Profile.save(); this.closeModal(); this.toast('Обучение будет в следующей ночи'); };
    let confirm = false;
    $('s-reset').onclick = () => {
      if (!confirm) { confirm = true; $('s-reset').textContent = 'Точно? Нажми ещё раз'; return; }
      Profile.reset(); this.closeModal(); this.showMenu(); this.toast('Прогресс сброшен');
    };
  },
  bindSwitches() {
    document.querySelectorAll('[data-set]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.set;
        Profile.data.settings[k] = !Profile.data.settings[k];
        b.classList.toggle('on', Profile.data.settings[k]);
        Profile.save(); this.applySettings(); Sfx.click();
        if (k === 'vibro' && Profile.data.settings.vibro) Haptic.vibrate(20);
      };
    });
  },

  // ---------- общее ----------
  modal(html) {
    $('modal-box').onclick = null;
    $('modal-box').innerHTML = html;
    $('modal').classList.remove('hidden');
    const box = $('modal-box');
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  },
  closeModal() { $('modal').classList.add('hidden'); $('modal-box').onclick = null; },

  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), 1600);
  },

  confetti(n) {
    const em = ['⭐', '✨', '🌙', '💫', '🎉', '🌟'];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.textContent = em[Math.floor(Math.random() * em.length)];
      el.style.left = Math.random() * 100 + '%';
      el.style.animationDuration = (1.4 + Math.random() * 1.6) + 's';
      el.style.animationDelay = (Math.random() * 0.4) + 's';
      $('ui').appendChild(el);
      setTimeout(() => el.remove(), 3600);
    }
  },
};

window.addEventListener('DOMContentLoaded', () => UI.init());
