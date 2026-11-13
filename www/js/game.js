'use strict';
// ===== Ядро игры: поле, игрушки, кошмары, волны, отрисовка =====

const W = 360;
const LANE = 36, SLOT = 50, GAP = 4, COLS = 5, ROWS = 3;
const NSLOTS = COLS * ROWS;
const REF_PATH = 1150; // эталонная длина пути — скорость врагов нормируется под экран

const rand = (a, b) => a + Math.random() * (b - a);
const pickW = (arr) => { // [{w, v}]
  let s = 0; for (const o of arr) s += o.w;
  let r = Math.random() * s;
  for (const o of arr) { if ((r -= o.w) <= 0) return o.v; }
  return arr[arr.length - 1].v;
};

const spriteCache = new Map();
function emojiSprite(e, px) {
  const key = e + '|' + px;
  let c = spriteCache.get(key);
  if (c) return c;
  const s = Math.max(8, Math.ceil(px * Game.scale * Game.dpr * 1.3));
  c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  x.font = `${Math.floor(s * 0.74)}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(e, s / 2, s / 2 + s * 0.05);
  spriteCache.set(key, c);
  return c;
}
function drawEmoji(ctx, e, x, y, px, alpha = 1) {
  const c = emojiSprite(e, px);
  const s = px * 1.3;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
  if (alpha !== 1) ctx.globalAlpha = 1;
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const Game = {
  state: 'menu', // menu | play | over
  t: 0, speed: 1, paused: false,
  particles: [], floats: [], enemies: [], projs: [], beams: [], flyers: [], rings: [],
  grid: new Array(NSLOTS).fill(null),
  shake: 0, redFlash: 0, whiteFlash: 0, slowmo: 0,

  init(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.last = performance.now();
    const loop = (ts) => { this.frame(ts); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },

  // ---------- размеры и разметка ----------
  resize() {
    const cw = window.innerWidth, ch = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.scale = Math.min(cw / W, ch / 600);
    this.offX = (cw - W * this.scale) / 2;
    this.H = ch / this.scale;
    this.cv.width = Math.round(cw * this.dpr);
    this.cv.height = Math.round(ch * this.dpr);
    this.cv.style.width = cw + 'px';
    this.cv.style.height = ch + 'px';
    document.documentElement.style.setProperty('--gw', (W * this.scale) + 'px');
    document.documentElement.style.setProperty('--gs', this.scale);
    spriteCache.clear();
    this.layout();
  },

  layout() {
    const s = this.scale;
    const top = UI.hudBottom() / s + 4;
    const bot = UI.panelTop() / s - 4;
    const avail = Math.max(260, bot - top);
    const boardH = Math.min(avail, 450);
    const boardTop = top + (avail - boardH) / 2;
    const boardBot = boardTop + boardH;
    const L = this.L = {};
    L.boardTop = boardTop; L.boardBot = boardBot;
    L.leftX = 4 + LANE / 2; L.rightX = W - 4 - LANE / 2;
    L.topY = boardTop + LANE / 2; L.botY = boardBot - LANE / 2;
    L.gridW = COLS * SLOT + (COLS - 1) * GAP;
    L.gridH = ROWS * SLOT + (ROWS - 1) * GAP;
    L.gridX = (W - L.gridW) / 2;
    L.gridY = L.botY - LANE / 2 - 14 - L.gridH;
    L.bed = { x: 58, y: L.botY - 25, w: 100, h: 50 };
    L.closet = { x: 2, y: boardBot - 58, w: 44, h: 62 };
    this.path = [
      { x: L.leftX, y: boardBot + 6 },
      { x: L.leftX, y: L.topY },
      { x: L.rightX, y: L.topY },
      { x: L.rightX, y: L.botY },
      { x: L.bed.x + L.bed.w + 4, y: L.botY },
    ];
    this.segs = []; let acc = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segs.push({ a, b, len, start: acc, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
      acc += len;
    }
    this.pathLen = acc;
    this.slots = [];
    for (let i = 0; i < NSLOTS; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      this.slots.push({ x: L.gridX + c * (SLOT + GAP) + SLOT / 2, y: L.gridY + r * (SLOT + GAP) + SLOT / 2 });
    }
    // окно с луной — если над ковриком есть место
    const space = L.gridY - (L.topY + LANE / 2);
    L.window = space > 80 ? { x: W / 2 - 52, y: L.topY + LANE / 2 + (space - Math.min(space - 24, 92)) / 2, w: 104, h: Math.min(space - 24, 92) } : null;
    this.bg = null;
  },

  posAt(d) {
    if (d <= 0) { const s = this.segs[0]; return { x: s.a.x, y: s.a.y, dx: s.dx, dy: s.dy }; }
    for (const s of this.segs) {
      if (d <= s.start + s.len) {
        const k = d - s.start;
        return { x: s.a.x + s.dx * k, y: s.a.y + s.dy * k, dx: s.dx, dy: s.dy };
      }
    }
    const s = this.segs[this.segs.length - 1];
    return { x: s.b.x, y: s.b.y, dx: s.dx, dy: s.dy };
  },

  // ---------- забег ----------
  startRun() {
    const P = Profile.data;
    this.state = 'play';
    this.paused = false;
    this.speed = 1;
    this.deck = P.deck.slice();
    this.meta = {}; TOY_IDS.forEach(id => { this.meta[id] = P.toys[id].lvl; });
    this.power = {}; this.deck.forEach(id => { this.power[id] = 1; });
    this.grid = new Array(NSLOTS).fill(null);
    this.enemies = []; this.projs = []; this.beams = []; this.particles = []; this.floats = []; this.flyers = []; this.rings = [];
    this.dust = 100;
    this.summons = 0;
    this.lives = 3;
    this.wave = 0;
    this.spawnQueue = [];
    this.preStart = P.tutorial ? 3.5 : 7;
    this.betweenT = 0; this.queueEmptyT = 0;
    this.combo = 0; this.comboT = 0; this.maxCombo = 0;
    this.kills = 0; this.bossKills = 0; this.merges = 0; this.maxToyLvl = 1;
    this.rageT = 0;
    this.starT = rand(22, 32); this.star = null; this.starsCaught = 0;
    this.revived = false;
    this.drag = null;
    this.kidMood = 0;
    this.closetBump = 0;
    this.banner = null;
    this.tut = P.tutorial ? null : { step: 0, t: 0 };
    this.runTime = 0;
    this.shake = 0; this.redFlash = 0; this.whiteFlash = 0; this.slowmo = 0;
    Profile.track('game', 1);
    UI.onRunStart();
  },

  summonCost() { return 10 + this.summons * 10; },
  freeSlots() { const r = []; this.grid.forEach((t, i) => { if (!t) r.push(i); }); return r; },

  summon(free = false, lvl = 1) {
    if (this.state !== 'play') return false;
    const fs = this.freeSlots();
    if (!fs.length) { Sfx.deny(); UI.toast('Нет места! Сливай игрушки 👆'); return false; }
    if (!free) {
      const cost = this.summonCost();
      if (this.dust < cost) { Sfx.deny(); return false; }
      this.dust -= cost; this.summons++;
    }
    const slot = fs[Math.floor(Math.random() * fs.length)];
    let lucky = false;
    if (!free && Math.random() < 0.05) { lvl = 2; lucky = true; }
    const type = this.deck[Math.floor(Math.random() * this.deck.length)];
    this.placeToy(slot, type, lvl);
    const p = this.slots[slot];
    if (lucky) {
      Sfx.lucky(); this.float(p.x, p.y - 30, 'Удача! ⭐', '#ffe066', 16);
      this.burst(p.x, p.y, '#ffe066', 18, 120);
    } else Sfx.summon();
    this.burst(p.x, p.y, TOYS[type].color, 8, 70);
    Haptic.vibrate(8);
    Profile.track('summon', 1);
    return true;
  },

  placeToy(slot, type, lvl) {
    this.grid[slot] = { type, lvl, cd: rand(0, 0.4), scared: 0, pop: 0, born: this.t, incT: 0, seed: Math.random() * 10 };
    if (lvl > this.maxToyLvl) { this.maxToyLvl = lvl; Profile.track('toylvl', lvl); }
  },

  canMerge(a, b) {
    if (!a || !b || a === b) return false;
    if (a.lvl !== b.lvl || a.lvl >= MAX_LVL) return false;
    return a.type === b.type || a.type === 'wand' || b.type === 'wand';
  },

  merge(fromSlot, toSlot) {
    const a = this.grid[fromSlot], b = this.grid[toSlot];
    let type;
    if (a.type === 'wand' && b.type !== 'wand') type = b.type;
    else if (b.type === 'wand' && a.type !== 'wand') type = a.type;
    else type = this.deck[Math.floor(Math.random() * this.deck.length)];
    const lvl = a.lvl + 1;
    this.grid[fromSlot] = null;
    this.placeToy(toSlot, type, lvl);
    this.grid[toSlot].pop = 1.6;
    const p = this.slots[toSlot];
    const col = TOYS[type].color;
    this.burst(p.x, p.y, col, 14 + lvl * 4, 90 + lvl * 20);
    this.burst(p.x, p.y, '#ffffff', 6 + lvl * 2, 60);
    this.rings.push({ x: p.x, y: p.y, r: 10, max: 40 + lvl * 8, life: 0.45, t: 0, color: col, w: 4 });
    if (lvl >= 4) this.float(p.x, p.y - 34, lvl === MAX_LVL ? 'МАКСИМУМ!' : `Уровень ${lvl}!`, lvl >= 6 ? '#ffb84d' : '#fff', 13 + lvl);
    if (lvl >= 5) { this.shake = Math.max(this.shake, 3 + lvl); this.whiteFlash = 0.15 + (lvl - 5) * 0.08; }
    Sfx.merge(lvl);
    Haptic.vibrate(10 + lvl * 3);
    this.merges++;
    Profile.track('merge', 1);
    if (this.tut && this.tut.step <= 1) { this.tut.step = 2; this.tut.t = 0; }
  },

  powerCost(type) { const p = this.power[type]; return p >= MAX_POWER ? null : POWER_COST[p - 1]; },
  powerUp(type) {
    const cost = this.powerCost(type);
    if (cost === null || this.dust < cost || this.state !== 'play') { Sfx.deny(); return false; }
    this.dust -= cost; this.power[type]++;
    Sfx.upgrade(); Haptic.vibrate(15);
    this.grid.forEach((t, i) => {
      if (t && t.type === type) { t.pop = 1.2; const p = this.slots[i]; this.burst(p.x, p.y, TOYS[type].color, 10, 80); }
    });
    return true;
  },

  // ---------- статы игрушек ----------
  dmgOf(t) {
    const d = TOYS[t.type];
    return d.dmg * (1 + (t.lvl - 1) * 1.2) * (1 + 0.3 * (this.power[t.type] - 1)) *
      (1 + 0.1 * (this.meta[t.type] - 1)) * (this.rageT > 0 ? 2 : 1);
  },
  rateOf(t) { return TOYS[t.type].rate * (1 + (t.lvl - 1) * 0.18); },
  radiusOf(t) { return TOYS[t.type].radius + 7 * (t.lvl - 1) + 6 * (this.power[t.type] - 1); },

  // ---------- волны ----------
  buildWave(n) {
    const q = [];
    const boss = n % 5 === 0;
    const interval = Math.max(0.38, 1.0 - n * 0.025);
    const weights = [
      { w: 10, v: 'shade' },
      { w: n >= 2 ? 3 + n * 0.3 : 0, v: 'fast' },
      { w: n >= 4 ? 2 + n * 0.22 : 0, v: 'tank' },
      { w: n >= 7 ? 2 + n * 0.2 : 0, v: 'splitter' },
    ];
    if (boss) {
      q.push({ boss: BOSSES[(n / 5 - 1) % BOSSES.length], delay: 1.2 });
      const c = 4 + Math.floor(n / 3);
      for (let i = 0; i < c; i++) q.push({ type: pickW(weights), delay: interval * 1.6 });
    } else {
      const c = 7 + Math.floor(n * 1.35);
      for (let i = 0; i < c; i++) q.push({ type: pickW(weights), delay: interval });
      // на поздних волнах — «пачки» быстрых
      if (n >= 9 && Math.random() < 0.5) for (let i = 0; i < 5; i++) q.push({ type: 'fast', delay: 0.18 });
    }
    return q;
  },

  startWave(n) {
    this.wave = n;
    this.spawnQueue = this.buildWave(n);
    this.spawnT = 0.4;
    this.betweenT = 0; this.queueEmptyT = 0;
    const b = this.spawnQueue[0].boss;
    if (b) {
      this.banner = { text: `БОСС: ${b.name}`, sub: b.hint, t: 0, life: 2.6, color: '#ff5a7a' };
      Sfx.boss(); this.shake = 8; Haptic.vibrate(40);
    } else {
      this.banner = { text: `Волна ${n}`, sub: n === 1 ? 'Кошмары лезут из шкафа!' : '', t: 0, life: 1.6, color: '#cfc4ff' };
      Sfx.wave();
    }
    Profile.track('wave', n);
  },

  spawnEnemy(item) {
    const hp0 = baseHP(this.wave);
    const sp = this.pathLen / REF_PATH;
    let e;
    if (item.boss) {
      const b = item.boss;
      e = { kind: b.id, boss: b, hp: hp0 * b.hp, speed: b.speed * sp, r: b.r, body: b.body, eye: b.eye,
        reward: 0, abilT: 3, shieldT: 0 };
    } else {
      const def = ENEMIES[item.type];
      e = { kind: item.type, hp: hp0 * def.hp, speed: def.speed * sp * rand(0.95, 1.05), r: def.r,
        body: def.body, eye: def.eye, reward: def.reward, split: def.split || 0 };
    }
    e.maxHp = e.hp; e.d = item.d || 0; e.slowT = 0; e.slowAmt = 0; e.flash = 0;
    e.seed = Math.random() * 100; e.dead = false; e.blink = rand(1, 4);
    const p = this.posAt(e.d); e.x = p.x; e.y = p.y; e.dx = p.dx; e.dy = p.dy;
    this.enemies.push(e);
    if (!item.d) this.closetBump = 1;
    return e;
  },

  updateWaves(dt) {
    if (this.preStart > 0) {
      // в обучении ждём, пока игрок достанет хотя бы пару игрушек
      if (this.tut && this.grid.filter(Boolean).length < 2 && this.preStart < 1) return;
      this.preStart -= dt;
      if (this.preStart <= 0) this.startWave(1);
      return;
    }
    if (this.spawnQueue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const it = this.spawnQueue.shift();
        this.spawnEnemy(it);
        this.spawnT = this.spawnQueue.length ? this.spawnQueue[0].delay : 0;
      }
      return;
    }
    this.queueEmptyT += dt;
    const bossAlive = this.enemies.some(e => e.boss);
    if (!this.enemies.length) {
      this.betweenT += dt;
      if (this.betweenT > 1.0) {
        const bonus = 20 + this.wave * 6;
        this.dust += bonus;
        this.float(W / 2, this.L.topY + 50, `Волна пройдена! +${bonus} ✨`, '#a8ffcf', 14);
        this.startWave(this.wave + 1);
      }
    } else if (!bossAlive && this.queueEmptyT > 7) {
      this.startWave(this.wave + 1);
    }
  },

  // ---------- урон ----------
  targetFor(t, mode) {
    const es = this.enemies;
    if (!es.length) return null;
    if (mode === 'random') return es[Math.floor(Math.random() * es.length)];
    let best = null;
    if (mode === 'strongest') { for (const e of es) if (!best || e.hp > best.hp) best = e; return best; }
    if (mode === 'unslowed') {
      for (const e of es) if (e.slowT <= 0.3 && (!best || e.d > best.d)) best = e;
      if (best) return best;
    }
    for (const e of es) if (!best || e.d > best.d) best = e;
    return best;
  },

  attack(t, slot) {
    const def = TOYS[t.type];
    const p = this.slots[slot];
    let dmg = this.dmgOf(t);
    const crit = Math.random() < 0.06;
    if (crit) dmg *= 2.5;
    switch (def.kind) {
      case 'aura': {
        const R = this.radiusOf(t);
        const hit = this.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < R + e.r);
        if (!hit.length) return false;
        hit.forEach(e => this.damage(e, dmg, crit));
        this.rings.push({ x: p.x, y: p.y, r: 12, max: R, life: 0.4, t: 0, color: def.color, w: 3, fill: true });
        Sfx.shoot('aura');
        break;
      }
      case 'laser': {
        const e = this.targetFor(t, def.target);
        if (!e) return false;
        this.beams.push({ pts: [{ x: p.x, y: p.y - 6 }, { x: e.x, y: e.y }], life: 0.09, t: 0, color: def.color, w: 1.5 + t.lvl * 0.4 });
        this.damage(e, dmg, crit);
        this.spark(e.x, e.y, def.color, 2);
        Sfx.shoot('laser');
        break;
      }
      case 'chain': {
        let e = this.targetFor(t, 'first');
        if (!e) return false;
        const n = def.chains + t.lvl - 1;
        const pts = [{ x: p.x, y: p.y - 6 }];
        const hitSet = new Set();
        let d = dmg;
        for (let i = 0; i < n && e; i++) {
          hitSet.add(e); pts.push({ x: e.x, y: e.y });
          this.damage(e, d, crit && i === 0);
          d *= 0.85;
          let nx = null, nd = 110;
          for (const o of this.enemies) {
            if (hitSet.has(o) || o.dead) continue;
            const dd = Math.hypot(o.x - e.x, o.y - e.y);
            if (dd < nd) { nd = dd; nx = o; }
          }
          e = nx;
        }
        this.beams.push({ pts, life: 0.16, t: 0, color: def.color, w: 2.5, zig: true });
        Sfx.shoot('chain');
        break;
      }
      case 'single': {
        const e = this.targetFor(t, def.target);
        if (!e) return false;
        this.projs.push({
          x: p.x, y: p.y - 8, target: e, tx: e.x, ty: e.y, kind: def.proj, color: def.color,
          speed: def.proj === 'rocket' ? 300 : 520, dmg, crit, lvl: t.lvl,
          splash: def.splash ? def.splash + (t.lvl - 1) * 4 : 0,
          slow: def.slow ? Math.min(0.62, def.slow + 0.04 * (t.lvl - 1) + 0.03 * (this.power[t.type] - 1)) : 0,
          slowDur: def.slowDur || 0, life: 3, vx: 0, vy: -120,
        });
        Sfx.shoot(def.proj === 'rocket' ? 'rocket' : 'proj');
        break;
      }
      default: return false;
    }
    t.pop = Math.max(t.pop, 0.6);
    return true;
  },

  damage(e, dmg, crit) {
    if (e.dead) return;
    if (e.shieldT > 0) {
      if (Math.random() < 0.08) this.float(e.x, e.y - e.r - 6, 'щит!', '#8af7ff', 10);
      return;
    }
    e.hp -= dmg; e.flash = 0.07;
    if (crit) this.float(e.x + rand(-6, 6), e.y - e.r - 4, this.fmt(dmg), '#ffdd55', 13, true);
    Sfx.hit();
    if (e.hp <= 0) this.kill(e);
  },

  fmt(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return '' + n;
  },

  kill(e) {
    e.dead = true;
    this.kills++;
    Profile.track('kill', 1);
    // комбо
    if (this.comboT > 0) this.combo++; else this.combo = 1;
    this.comboT = 1.6;
    if (this.combo > this.maxCombo) { this.maxCombo = this.combo; Profile.track('combo', this.combo); }
    let reward;
    if (e.boss) {
      reward = 120 + this.wave * 12;
      this.bossKills++;
      Profile.track('boss', 1);
      Sfx.bossDie(); Haptic.vibrate(60);
      this.shake = 14; this.whiteFlash = 0.5; this.slowmo = 0.9;
      this.burst(e.x, e.y, '#ffffff', 40, 220);
      this.burst(e.x, e.y, e.eye, 40, 180);
      this.rings.push({ x: e.x, y: e.y, r: 10, max: 120, life: 0.6, t: 0, color: '#ffffff', w: 6 });
      this.float(e.x, e.y - 40, `${e.boss.name} повержен!`, '#ffe066', 18);
      for (let i = 0; i < 14; i++) this.flyers.push(this.mkFlyer(e.x + rand(-20, 20), e.y + rand(-20, 20)));
    } else {
      reward = Math.round((6 + this.wave * 0.9) * e.reward);
      Sfx.kill(this.combo);
      this.burst(e.x, e.y, e.body, 8, 90);
      this.burst(e.x, e.y, e.eye, 4, 60);
      this.flyers.push(this.mkFlyer(e.x, e.y));
      if (e.split) {
        for (let i = 0; i < e.split; i++) this.spawnEnemy({ type: 'mini', d: Math.max(1, e.d + (i ? -12 : 4)) });
      }
    }
    if (this.combo > 0 && this.combo % 10 === 0) {
      const bonus = this.combo;
      reward += bonus;
      Sfx.combo(this.combo);
      this.float(W / 2, this.L.topY + 70, `КОМБО ×${this.combo}! +${bonus}`, '#ff9de2', 15 + Math.min(10, this.combo / 10));
    }
    this.dust += reward;
  },

  mkFlyer(x, y) {
    const t = UI.dustTarget();
    return { x, y, sx: x, sy: y, tx: t.x, ty: t.y, t: 0, dur: rand(0.45, 0.7), cx: x + rand(-60, 60), cy: y - rand(40, 110) };
  },

  leak(e) {
    e.dead = true;
    const dmg = e.boss ? 2 : 1;
    this.lives = Math.max(0, this.lives - dmg);
    this.shake = 12; this.redFlash = 0.7; this.kidMood = 1.4;
    Sfx.lifeLost(); Haptic.vibrate(45);
    this.burst(e.x, e.y, '#ff4d6d', 20, 140);
    this.float(e.x - 30, e.y - 30, e.boss ? '−2 ❤' : '−1 ❤', '#ff6b81', 18);
    this.combo = 0;
    if (this.lives <= 0) this.gameOver();
  },

  gameOver() {
    this.state = 'over';
    this.drag = null;
    Sfx.gameOver();
    Haptic.vibrate(80);
    setTimeout(() => UI.showGameOver(), 900);
  },

  revive() {
    this.revived = true;
    this.lives = 2;
    this.state = 'play';
    this.whiteFlash = 0.8;
    for (const e of this.enemies) {
      if (e.boss) { e.d = Math.max(0, e.d - this.pathLen * 0.45); continue; }
      e.dead = true; this.burst(e.x, e.y, '#fff2a8', 6, 80);
    }
    this.enemies = this.enemies.filter(e => !e.dead);
    this.float(W / 2, this.L.topY + 60, 'Колыбельная! 🎶', '#fff2a8', 18);
    Sfx.record();
  },

  // ---------- эффекты ----------
  burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 500) break;
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * spd;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.8), t: 0, color, size: rand(1.5, 3.5), g: 60 });
    }
  },
  spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 500) break;
      const a = Math.random() * Math.PI * 2, s = rand(30, 80);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, t: 0, color, size: 1.5, g: 0 });
    }
  },
  float(x, y, text, color, size = 12, small = false) {
    this.floats.push({ x, y, text, color, size, t: 0, life: small ? 0.7 : 1.3, small });
  },

  // ---------- падающая звезда ----------
  updateStar(dt) {
    if (this.star) {
      const s = this.star;
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (Math.random() < 0.6) this.particles.push({ x: s.x, y: s.y, vx: rand(-10, 10), vy: rand(-10, 10), life: 0.6, t: 0, color: '#fff6b0', size: rand(1, 2.5), g: 0 });
      if (s.t > s.life) this.star = null;
      return;
    }
    this.starT -= dt;
    if (this.starT <= 0 && this.wave >= 1) {
      this.starT = rand(30, 50);
      const fromLeft = Math.random() < 0.5;
      const y = rand(this.L.topY + 30, this.L.gridY + 20);
      this.star = { x: fromLeft ? -10 : W + 10, y, vx: (fromLeft ? 1 : -1) * rand(70, 90), vy: rand(-8, 12), t: 0, life: 5.2 };
    }
  },
  catchStar() {
    const s = this.star; this.star = null;
    this.starsCaught++;
    Profile.track('star', 1);
    Sfx.star(); Haptic.vibrate(20);
    this.burst(s.x, s.y, '#fff6b0', 30, 160);
    const r = Math.random();
    if (r < 0.45) {
      const n = 40 + this.wave * 14;
      this.dust += n;
      this.float(s.x, s.y - 20, `+${n} ✨`, '#fff6b0', 18);
      for (let i = 0; i < 8; i++) this.flyers.push(this.mkFlyer(s.x + rand(-10, 10), s.y + rand(-10, 10)));
    } else if (r < 0.75 && this.freeSlots().length) {
      const lvl = Math.random() < 0.35 ? 3 : 2;
      this.summon(true, lvl);
      this.float(s.x, s.y - 20, `Подарок: игрушка ур.${lvl}!`, '#fff6b0', 15);
    } else {
      this.rageT = 10;
      this.float(s.x, s.y - 20, 'Ярость! Урон ×2', '#ff8a8a', 17);
    }
  },

  // ---------- главный цикл ----------
  frame(ts) {
    let dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    this.t += dt;
    if (this.state === 'play' && !this.paused) {
      let k = this.speed;
      if (this.slowmo > 0) { this.slowmo -= dt; k *= 0.3; }
      const steps = Math.ceil(k);
      for (let i = 0; i < steps; i++) this.update(dt * k / steps);
      UI.updateHud();
    } else if (this.state === 'over') {
      this.updateFx(dt);
    }
    this.render(dt);
  },

  update(dt) {
    this.runTime += dt;
    this.updateWaves(dt);
    this.updateStar(dt);
    if (this.rageT > 0) this.rageT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.kidMood > 0) this.kidMood -= dt;
    if (this.closetBump > 0) this.closetBump -= dt * 4;

    // враги
    for (const e of this.enemies) {
      if (e.dead) continue;
      let sp = e.speed;
      if (e.slowT > 0) { e.slowT -= dt; sp *= 1 - e.slowAmt; }
      e.d += sp * dt;
      if (e.flash > 0) e.flash -= dt;
      e.blink -= dt; if (e.blink < -0.12) e.blink = rand(1.5, 4);
      const p = this.posAt(e.d); e.x = p.x; e.y = p.y; e.dx = p.dx; e.dy = p.dy;
      if (e.boss) this.bossAbility(e, dt);
      if (e.d >= this.pathLen) this.leak(e);
      if (this.state !== 'play') return;
    }
    this.enemies = this.enemies.filter(e => !e.dead);

    // игрушки
    for (let i = 0; i < NSLOTS; i++) {
      const t = this.grid[i];
      if (!t) continue;
      if (t.pop > 0) t.pop = Math.max(0, t.pop - dt * 4);
      if (this.drag && this.drag.slot === i) continue;
      if (t.scared > 0) { t.scared -= dt; continue; }
      const def = TOYS[t.type];
      if (def.kind === 'joker') continue;
      if (def.income) {
        t.incT += dt;
        if (t.incT >= def.incomeEvery) {
          t.incT = 0;
          const n = Math.round(def.income * t.lvl * (1 + 0.25 * (this.power[t.type] - 1)) * (1 + 0.1 * (this.meta[t.type] - 1)));
          this.dust += n;
          const p = this.slots[i];
          this.float(p.x, p.y - 26, `+${n}`, '#ff9de2', 11, true);
          this.flyers.push(this.mkFlyer(p.x, p.y));
        }
      }
      t.cd -= dt;
      if (t.cd <= 0 && this.enemies.length) {
        if (this.attack(t, i)) t.cd = 1 / this.rateOf(t);
        else t.cd = 0.1;
      }
    }

    // снаряды
    for (const pr of this.projs) {
      pr.life -= dt;
      if (pr.target && !pr.target.dead) { pr.tx = pr.target.x; pr.ty = pr.target.y; }
      const dx = pr.tx - pr.x, dy = pr.ty - pr.y, dist = Math.hypot(dx, dy);
      if (pr.kind === 'rocket') {
        // ракета летит по дуге
        const ax = dx / (dist || 1) * 900, ay = dy / (dist || 1) * 900;
        pr.vx += ax * dt; pr.vy += ay * dt;
        const v = Math.hypot(pr.vx, pr.vy), mx = 340;
        if (v > mx) { pr.vx *= mx / v; pr.vy *= mx / v; }
        pr.x += pr.vx * dt; pr.y += pr.vy * dt;
        if (Math.random() < 0.7) this.particles.push({ x: pr.x, y: pr.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.5, t: 0, color: '#999', size: rand(2, 4), g: -20 });
      } else {
        const step = pr.speed * dt;
        if (dist > 0.01) { pr.x += dx / dist * Math.min(step, dist); pr.y += dy / dist * Math.min(step, dist); }
      }
      const reach = (pr.target && !pr.target.dead ? pr.target.r : 6);
      if (Math.hypot(pr.tx - pr.x, pr.ty - pr.y) <= reach || pr.life <= 0) {
        pr.done = true;
        this.projHit(pr);
      }
    }
    this.projs = this.projs.filter(p => !p.done);
    this.updateFx(dt);

    // обучение
    if (this.tut) this.updateTutorial(dt);
  },

  projHit(pr) {
    const tgt = pr.target && !pr.target.dead ? pr.target : null;
    if (pr.splash) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (e === tgt) this.damage(e, pr.dmg, pr.crit);
        else if (d < pr.splash + e.r) this.damage(e, pr.dmg * 0.6, false);
      }
      this.rings.push({ x: pr.x, y: pr.y, r: 4, max: pr.splash, life: 0.3, t: 0, color: pr.color, w: 3, fill: true });
      this.burst(pr.x, pr.y, pr.color, pr.kind === 'rocket' ? 20 : 8, pr.kind === 'rocket' ? 150 : 80);
      if (pr.kind === 'rocket') { this.shake = Math.max(this.shake, 4); Sfx.boom(); }
    } else if (tgt) {
      this.damage(tgt, pr.dmg, pr.crit);
      if (pr.slow && !tgt.dead && !tgt.boss) { tgt.slowT = pr.slowDur; tgt.slowAmt = pr.slow; }
      else if (pr.slow && !tgt.dead && tgt.boss) { tgt.slowT = pr.slowDur * 0.5; tgt.slowAmt = pr.slow * 0.5; }
      this.spark(pr.x, pr.y, pr.color, 3);
    }
  },

  bossAbility(e, dt) {
    if (e.shieldT > 0) e.shieldT -= dt;
    e.abilT -= dt;
    if (e.abilT > 0) return;
    const ab = e.boss.ability;
    if (ab === 'summon') {
      e.abilT = 4.5;
      for (let i = 0; i < 2; i++) this.spawnEnemy({ type: 'shade', d: Math.max(1, e.d - 10 - i * 14) });
      this.burst(e.x, e.y, '#8a5cff', 16, 100);
      this.float(e.x, e.y - e.r - 10, 'Ко мне, тени!', '#c9a8ff', 11);
    } else if (ab === 'scare') {
      e.abilT = 5;
      const toys = this.grid.map((t, i) => t ? i : -1).filter(i => i >= 0 && !(this.drag && this.drag.slot === i));
      toys.sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(this.wave / 15)).forEach(i => {
        this.grid[i].scared = 2.6;
        const p = this.slots[i];
        this.beams.push({ pts: [{ x: e.x, y: e.y }, { x: p.x, y: p.y }], life: 0.35, t: 0, color: '#ff9a3c', w: 3, zig: true });
      });
      this.float(e.x, e.y - e.r - 10, 'БУ!', '#ffae00', 16);
      this.shake = Math.max(this.shake, 4);
    } else if (ab === 'shield') {
      e.abilT = 6;
      e.shieldT = 1.8;
      this.float(e.x, e.y - e.r - 10, 'Щит!', '#8af7ff', 13);
    }
  },

  updateFx(dt) {
    for (const p of this.particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.96; p.vy *= 0.96;
    }
    this.particles = this.particles.filter(p => p.t < p.life);
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter(f => f.t < f.life);
    for (const b of this.beams) b.t += dt;
    this.beams = this.beams.filter(b => b.t < b.life);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.life);
    for (const f of this.flyers) {
      f.t += dt;
      if (f.t >= f.dur && !f.done) { f.done = true; UI.bumpDust(); Sfx.coin(); }
    }
    this.flyers = this.flyers.filter(f => !f.done);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
    if (this.redFlash > 0) this.redFlash -= dt;
    if (this.whiteFlash > 0) this.whiteFlash -= dt * 1.5;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.life) this.banner = null; }
  },

  // ---------- обучение ----------
  mergeablePair() {
    for (let i = 0; i < NSLOTS; i++) for (let j = i + 1; j < NSLOTS; j++) {
      if (this.canMerge(this.grid[i], this.grid[j])) return [i, j];
    }
    return null;
  },
  updateTutorial(dt) {
    const tut = this.tut; tut.t += dt;
    const n = this.grid.filter(Boolean).length;
    if (tut.step === 0) {
      UI.tutHint('Нажми «Достать игрушку» внизу 👇', true);
      if (this.mergeablePair()) { tut.step = 1; tut.t = 0; }
    } else if (tut.step === 1) {
      UI.tutHint('Перетащи одинаковые игрушки друг на друга!', false);
      if (!this.mergeablePair()) { tut.step = n < NSLOTS ? 0 : 1; }
    } else if (tut.step === 2) {
      UI.tutHint('Супер! Слияние даёт игрушку уровнем выше — но случайного типа 🎲', false);
      if (tut.t > 4) { tut.step = 3; tut.t = 0; }
    } else if (tut.step === 3) {
      UI.tutHint('Кнопки над «Достать» усиливают ВСЕ игрушки этого типа ✨', false);
      if (tut.t > 5) { tut.step = 4; tut.t = 0; }
    } else if (tut.step === 4) {
      UI.tutHint('Лови падающие звёзды — там подарки! Удачи, Страж 🌙', false);
      if (tut.t > 4) {
        this.tut = null; UI.tutHint(null);
        Profile.data.tutorial = true; Profile.save();
      }
    }
  },

  // ---------- ввод ----------
  toLogical(ev) {
    const r = this.cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left - this.offX) / this.scale, y: (ev.clientY - r.top) / this.scale };
  },
  slotAt(x, y, tol = 0.62) {
    let best = -1, bd = SLOT * tol;
    this.slots.forEach((s, i) => {
      const d = Math.max(Math.abs(s.x - x), Math.abs(s.y - y));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  },
  bindInput() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (ev) => {
      Sfx.init();
      if (this.state !== 'play' || this.paused) return;
      const p = this.toLogical(ev);
      if (this.star && Math.hypot(this.star.x - p.x, this.star.y - p.y) < 34) { this.catchStar(); return; }
      const i = this.slotAt(p.x, p.y, 0.55);
      if (i >= 0 && this.grid[i]) {
        this.drag = { slot: i, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, id: ev.pointerId };
        try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        Haptic.vibrate(5);
      }
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!this.drag || ev.pointerId !== this.drag.id) return;
      const p = this.toLogical(ev);
      this.drag.x = p.x; this.drag.y = p.y;
      if (Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > 6) this.drag.moved = true;
    });
    const end = (ev) => {
      if (!this.drag || ev.pointerId !== this.drag.id) return;
      const d = this.drag; this.drag = null;
      if (this.state !== 'play') return;
      const from = d.slot;
      const a = this.grid[from];
      if (!a) return;
      if (!d.moved) { this.showToyInfo(from); return; }
      const to = this.slotAt(d.x, d.y, 0.7);
      if (to < 0 || to === from) return;
      const b = this.grid[to];
      if (b && this.canMerge(a, b)) this.merge(from, to);
      else if (!b) { this.grid[to] = a; this.grid[from] = null; a.pop = 0.6; Sfx.place(); }
      else { this.grid[to] = a; this.grid[from] = b; a.pop = 0.6; b.pop = 0.6; Sfx.place(); }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  },
  showToyInfo(i) {
    const t = this.grid[i], def = TOYS[t.type], p = this.slots[i];
    let s = `${def.name} ур.${t.lvl}`;
    if (def.kind !== 'joker') s += ` · урон ${this.fmt(this.dmgOf(t))}`;
    if (def.income) s += ` · +${Math.round(def.income * t.lvl * (1 + 0.25 * (this.power[t.type] - 1)))}✨`;
    this.float(p.x, p.y - 32, s, '#ffffff', 11);
    if (def.kind === 'aura') this.rings.push({ x: p.x, y: p.y, r: this.radiusOf(t) - 1, max: this.radiusOf(t), life: 0.8, t: 0, color: def.color, w: 2 });
    t.pop = 0.6;
  },

  // ---------- отрисовка ----------
  render(dt) {
    const ctx = this.ctx, s = this.scale, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0920';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = rand(-1, 1) * this.shake * 0.6; sy = rand(-1, 1) * this.shake * 0.6; }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.offX + sx * s), dpr * sy * s);

    this.drawRoom(ctx);
    if (this.state === 'menu') { this.drawCloset(ctx); return; }

    this.drawGrid(ctx);
    this.drawEnemies(ctx);
    this.drawCloset(ctx);
    this.drawProjectiles(ctx);
    this.drawFx(ctx);
    if (this.drag && this.grid[this.drag.slot]) {
      const t = this.grid[this.drag.slot];
      this.drawToy(ctx, t, this.drag.x, this.drag.y - 10, 1.18, true);
    }
    this.drawStar(ctx);
    this.drawFloats(ctx);
    this.drawTutorialHand(ctx);
    this.drawBanner(ctx);

    // вспышки на весь экран
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.redFlash > 0) {
      ctx.fillStyle = `rgba(255,40,80,${Math.min(0.35, this.redFlash * 0.4)})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    }
    if (this.whiteFlash > 0) {
      ctx.fillStyle = `rgba(255,250,230,${Math.min(0.6, this.whiteFlash)})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    }
    if (this.state === 'play' && this.lives === 1) {
      // тревожная виньетка
      const a = 0.18 + Math.sin(this.t * 4) * 0.08;
      const g = ctx.createRadialGradient(this.cv.width / 2, this.cv.height / 2, this.cv.height * 0.3, this.cv.width / 2, this.cv.height / 2, this.cv.height * 0.75);
      g.addColorStop(0, 'rgba(255,0,60,0)'); g.addColorStop(1, `rgba(255,0,60,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    }
  },

  buildBg() {
    const L = this.L;
    const c = document.createElement('canvas');
    const hpx = Math.ceil(this.H + 20);
    c.width = Math.ceil(W * this.scale * this.dpr); c.height = Math.ceil(hpx * this.scale * this.dpr);
    const x = c.getContext('2d');
    x.scale(this.scale * this.dpr, this.scale * this.dpr);
    // пол — тёмные доски
    const g = x.createLinearGradient(0, 0, 0, hpx);
    g.addColorStop(0, '#1b1538'); g.addColorStop(1, '#130f2a');
    x.fillStyle = g; x.fillRect(0, 0, W, hpx);
    x.strokeStyle = 'rgba(255,255,255,0.035)'; x.lineWidth = 1;
    for (let y = 0; y < hpx; y += 22) {
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
      const off = (y * 37) % 90;
      for (let px = off; px < W; px += 90 + (y % 3) * 20) { x.beginPath(); x.moveTo(px, y); x.lineTo(px, y + 22); x.stroke(); }
    }
    // дорожка кошмаров
    x.lineCap = 'round'; x.lineJoin = 'round';
    const path = () => { x.beginPath(); this.path.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); };
    path(); x.strokeStyle = 'rgba(140,100,255,0.16)'; x.lineWidth = LANE + 6; x.stroke();
    path(); x.strokeStyle = '#0a0718'; x.lineWidth = LANE; x.stroke();
    path(); x.strokeStyle = 'rgba(90,60,170,0.18)'; x.lineWidth = LANE - 10; x.stroke();
    // коврик под игрушками
    const pad = 10;
    rr(x, L.gridX - pad, L.gridY - pad, L.gridW + pad * 2, L.gridH + pad * 2, 16);
    const rg = x.createLinearGradient(0, L.gridY, 0, L.gridY + L.gridH);
    rg.addColorStop(0, '#2c2358'); rg.addColorStop(1, '#241c4a');
    x.fillStyle = rg; x.fill();
    x.setLineDash([4, 5]); x.strokeStyle = 'rgba(200,180,255,0.28)'; x.lineWidth = 1.5;
    rr(x, L.gridX - pad + 5, L.gridY - pad + 5, L.gridW + pad * 2 - 10, L.gridH + pad * 2 - 10, 12); x.stroke();
    x.setLineDash([]);
    // клетки
    this.slots.forEach(sl => {
      rr(x, sl.x - SLOT / 2, sl.y - SLOT / 2, SLOT, SLOT, 10);
      x.fillStyle = 'rgba(10,6,30,0.35)'; x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.06)'; x.lineWidth = 1; x.stroke();
    });
    // окно с луной
    if (L.window) {
      const w = L.window;
      rr(x, w.x - 4, w.y - 4, w.w + 8, w.h + 8, 8); x.fillStyle = '#3a2d22'; x.fill();
      const sg = x.createLinearGradient(0, w.y, 0, w.y + w.h);
      sg.addColorStop(0, '#0d1b45'); sg.addColorStop(1, '#25306b');
      rr(x, w.x, w.y, w.w, w.h, 5); x.fillStyle = sg; x.fill();
      for (let i = 0; i < 14; i++) {
        x.fillStyle = `rgba(255,255,255,${rand(0.3, 0.9)})`;
        x.fillRect(w.x + rand(4, w.w - 4), w.y + rand(4, w.h - 4), 1.2, 1.2);
      }
      const mx = w.x + w.w * 0.68, my = w.y + w.h * 0.36, mr = Math.min(16, w.h * 0.2);
      const mg = x.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3);
      mg.addColorStop(0, 'rgba(255,245,200,0.35)'); mg.addColorStop(1, 'rgba(255,245,200,0)');
      x.fillStyle = mg; x.fillRect(w.x, w.y, w.w, w.h);
      x.fillStyle = '#fff4c8'; x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#1a2558'; x.beginPath(); x.arc(mx - mr * 0.45, my - mr * 0.2, mr * 0.85, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#3a2d22'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(w.x + w.w / 2, w.y); x.lineTo(w.x + w.w / 2, w.y + w.h); x.moveTo(w.x, w.y + w.h / 2); x.lineTo(w.x + w.w, w.y + w.h / 2); x.stroke();
      // шторы
      x.fillStyle = '#7a3b6e';
      x.beginPath(); x.moveTo(w.x - 10, w.y - 8); x.quadraticCurveTo(w.x + 14, w.y + w.h * 0.5, w.x - 6, w.y + w.h + 8); x.lineTo(w.x - 14, w.y + w.h + 8); x.lineTo(w.x - 14, w.y - 8); x.fill();
      x.beginPath(); x.moveTo(w.x + w.w + 10, w.y - 8); x.quadraticCurveTo(w.x + w.w - 14, w.y + w.h * 0.5, w.x + w.w + 6, w.y + w.h + 8); x.lineTo(w.x + w.w + 14, w.y + w.h + 8); x.lineTo(w.x + w.w + 14, w.y - 8); x.fill();
      // лунный свет на полу
      const lg = x.createLinearGradient(0, w.y, 0, L.gridY + L.gridH);
      lg.addColorStop(0, 'rgba(180,200,255,0.10)'); lg.addColorStop(1, 'rgba(180,200,255,0)');
      x.fillStyle = lg;
      x.beginPath(); x.moveTo(w.x, w.y + w.h); x.lineTo(w.x + w.w, w.y + w.h); x.lineTo(w.x + w.w + 50, L.gridY + L.gridH); x.lineTo(w.x - 10, L.gridY + L.gridH); x.fill();
    }
    // кровать
    const b = L.bed;
    rr(x, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 9); x.fillStyle = '#5a3424'; x.fill();
    rr(x, b.x, b.y, b.w, b.h, 7); x.fillStyle = '#efe6ff'; x.fill();
    // одеяло
    rr(x, b.x + 30, b.y + 2, b.w - 32, b.h - 4, 7);
    const bg = x.createLinearGradient(b.x + 30, 0, b.x + b.w, 0);
    bg.addColorStop(0, '#5b7cff'); bg.addColorStop(1, '#3c55c9');
    x.fillStyle = bg; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(b.x + 40 + (i % 3) * 20, b.y + 14 + Math.floor(i / 3) * 20, 2.5, 0, Math.PI * 2); x.fill(); }
    // подушка
    rr(x, b.x + 4, b.y + 7, 24, b.h - 14, 8); x.fillStyle = '#ffffff'; x.fill();
    // виньетка
    const vg = x.createRadialGradient(W / 2, hpx / 2, hpx * 0.25, W / 2, hpx / 2, hpx * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,0.5)');
    x.fillStyle = vg; x.fillRect(0, 0, W, hpx);
    this.bg = c;
  },

  drawRoom(ctx) {
    if (!this.bg) this.buildBg();
    ctx.drawImage(this.bg, 0, 0, W, Math.ceil(this.H + 20));
    const L = this.L;
    // бегущие точки — направление движения
    ctx.save();
    ctx.setLineDash([2, 14]);
    ctx.lineDashOffset = -this.t * 22;
    ctx.strokeStyle = 'rgba(170,140,255,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); this.path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    ctx.restore();
    // малыш
    const b = L.bed;
    const kx = b.x + 16, ky = b.y + b.h / 2;
    let face = '😴';
    if (this.state === 'over') face = '😭';
    else if (this.state === 'play') {
      if (this.kidMood > 0) face = '😱';
      else if (this.lives === 1) face = '😰';
      else if (this.lives === 2) face = '😟';
    }
    const bob = this.kidMood > 0 ? rand(-1.5, 1.5) : Math.sin(this.t * 1.5) * 0.6;
    drawEmoji(ctx, face, kx + bob, ky, 24);
    // Zzz
    if (face === '😴') {
      ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (let i = 0; i < 3; i++) {
        const ph = (this.t * 0.5 + i / 3) % 1;
        ctx.fillStyle = `rgba(210,200,255,${(1 - ph) * 0.8})`;
        ctx.font = `bold ${8 + ph * 8}px system-ui, sans-serif`;
        ctx.fillText('z', kx + 10 + ph * 18 + Math.sin(ph * 6) * 3, ky - 10 - ph * 34);
      }
    }
  },

  drawCloset(ctx) {
    const c = this.L.closet;
    const bump = Math.max(0, this.closetBump || 0);
    ctx.save();
    rr(ctx, c.x, c.y, c.w, c.h, 4); ctx.fillStyle = '#4a3020'; ctx.fill();
    ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 2; ctx.stroke();
    // тёмная щель
    const gap = 5 + bump * 6 + Math.sin(this.t * 0.7) * 1.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(c.x + c.w / 2 - gap / 2, c.y + 4, gap, c.h - 8);
    // глаза в щели
    const blink = Math.sin(this.t * 1.3) > 0.96;
    if (!blink) {
      ctx.fillStyle = '#ffe066';
      const ey = c.y + c.h * 0.4 + Math.sin(this.t * 0.9) * 4;
      ctx.beginPath(); ctx.arc(c.x + c.w / 2 - 1.2, ey, 1.4, 0, Math.PI * 2); ctx.arc(c.x + c.w / 2 + 1.6, ey, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    // ручки
    ctx.fillStyle = '#c9a66b';
    ctx.beginPath(); ctx.arc(c.x + c.w / 2 - gap / 2 - 5, c.y + c.h * 0.55, 2, 0, Math.PI * 2); ctx.arc(c.x + c.w / 2 + gap / 2 + 5, c.y + c.h * 0.55, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  drawGrid(ctx) {
    const dragT = this.drag ? this.grid[this.drag.slot] : null;
    const tutPair = this.tut && this.tut.step === 1 ? this.mergeablePair() : null;
    for (let i = 0; i < NSLOTS; i++) {
      const sl = this.slots[i];
      const t = this.grid[i];
      if (dragT && this.drag.moved) {
        if (i !== this.drag.slot && t && this.canMerge(dragT, t)) {
          const a = 0.5 + Math.sin(this.t * 10) * 0.3;
          rr(ctx, sl.x - SLOT / 2 - 2, sl.y - SLOT / 2 - 2, SLOT + 4, SLOT + 4, 12);
          ctx.strokeStyle = `rgba(255,230,120,${a})`; ctx.lineWidth = 3; ctx.stroke();
        }
      }
      if (tutPair && (i === tutPair[0] || i === tutPair[1])) {
        rr(ctx, sl.x - SLOT / 2 - 2, sl.y - SLOT / 2 - 2, SLOT + 4, SLOT + 4, 12);
        ctx.strokeStyle = `rgba(255,230,120,${0.5 + Math.sin(this.t * 6) * 0.4})`; ctx.lineWidth = 3; ctx.stroke();
      }
      if (!t || (this.drag && this.drag.slot === i && this.drag.moved)) continue;
      let dim = dragT && this.drag.moved && i !== this.drag.slot && !this.canMerge(dragT, t);
      this.drawToy(ctx, t, sl.x, sl.y, 1, false, dim);
    }
  },

  drawToy(ctx, t, x, y, sc = 1, lifted = false, dim = false) {
    const def = TOYS[t.type];
    const age = this.t - t.born;
    let k = sc;
    if (age < 0.35) { const a = age / 0.35 - 1; k *= Math.max(0.15, 1 + 2.70158 * a * a * a + 1.70158 * a * a); }
    k *= 1 + t.pop * 0.12;
    const half = SLOT / 2 * k;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.45;
    // подсветка по уровню
    if (t.lvl >= 3 || this.rageT > 0) {
      const gr = ctx.createRadialGradient(x, y, half * 0.4, x, y, half * 1.5);
      const col = this.rageT > 0 ? '#ff4d4d' : def.color;
      gr.addColorStop(0, hexA(col, 0.12 + t.lvl * 0.04)); gr.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = gr; ctx.fillRect(x - half * 1.6, y - half * 1.6, half * 3.2, half * 3.2);
    }
    rr(ctx, x - half + 2, y - half + 2, half * 2 - 4, half * 2 - 4, 10 * k);
    const g = ctx.createLinearGradient(x, y - half, x, y + half);
    g.addColorStop(0, hexA(def.color, lifted ? 0.55 : 0.38));
    g.addColorStop(1, hexA(def.color, lifted ? 0.25 : 0.14));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = t.lvl >= 5 ? 2.5 : 1.5;
    ctx.strokeStyle = t.lvl >= MAX_LVL ? '#ffd84a' : hexA(def.color, 0.5 + t.lvl * 0.07);
    ctx.stroke();
    // игрушка
    const bob = Math.sin(this.t * 2.2 + t.seed) * 1.2;
    drawEmoji(ctx, def.emoji, x, y - 4 * k + bob, 27 * k);
    // уровень — точки
    const n = t.lvl, dx = 5.2 * k, py = y + half - 8 * k;
    const startX = x - (n - 1) * dx / 2;
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(startX + i * dx, py, 2 * k, 0, Math.PI * 2);
      ctx.fillStyle = t.lvl >= MAX_LVL ? '#ffd84a' : '#fff'; ctx.fill();
    }
    // напуганная игрушка
    if (t.scared > 0) {
      ctx.globalAlpha = 0.6; rr(ctx, x - half + 2, y - half + 2, half * 2 - 4, half * 2 - 4, 10); ctx.fillStyle = '#20102a'; ctx.fill();
      ctx.globalAlpha = 1; drawEmoji(ctx, '😱', x + Math.sin(this.t * 40) * 1.5, y - 2, 20);
    }
    // шкатулка — индикатор пыльцы
    if (def.income && !lifted) {
      const p = t.incT / def.incomeEvery;
      ctx.beginPath(); ctx.arc(x + half - 8, y - half + 8, 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.strokeStyle = '#ff9de2'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  },

  drawEnemies(ctx) {
    for (const e of this.enemies) {
      const r = e.r;
      const pts = 12;
      ctx.save();
      // тень на полу
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      // аура
      const ag = ctx.createRadialGradient(e.x, e.y, r * 0.5, e.x, e.y, r * 1.7);
      ag.addColorStop(0, hexA(e.body, 0.5)); ag.addColorStop(1, hexA(e.body, 0));
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.7, 0, Math.PI * 2); ctx.fill();
      // тело-клякса
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const rad = r * (1 + 0.1 * Math.sin(this.t * 5 + i * 1.9 + e.seed) + (Math.sin(a) > 0.3 ? 0.12 * Math.sin(this.t * 8 + i) : 0));
        const px = e.x + Math.cos(a) * rad, py = e.y + Math.sin(a) * rad;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      const bg = ctx.createRadialGradient(e.x - r * 0.3, e.y - r * 0.4, r * 0.1, e.x, e.y, r * 1.1);
      bg.addColorStop(0, hexA(e.body, 1)); bg.addColorStop(1, '#07040f');
      ctx.fillStyle = bg;
      ctx.fill();
      if (e.flash > 0) { ctx.fillStyle = e.boss ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)'; ctx.fill(); }
      if (e.slowT > 0) { ctx.fillStyle = 'rgba(120,200,255,0.35)'; ctx.fill(); }
      // рожки у боссов
      if (e.boss) {
        ctx.fillStyle = '#07040f';
        ctx.beginPath();
        ctx.moveTo(e.x - r * 0.6, e.y - r * 0.6); ctx.lineTo(e.x - r * 0.85, e.y - r * 1.45); ctx.lineTo(e.x - r * 0.2, e.y - r * 0.85);
        ctx.moveTo(e.x + r * 0.6, e.y - r * 0.6); ctx.lineTo(e.x + r * 0.85, e.y - r * 1.45); ctx.lineTo(e.x + r * 0.2, e.y - r * 0.85);
        ctx.fill();
      }
      // глаза
      const lx = e.dx * r * 0.25, ly = e.dy * r * 0.25;
      if (e.blink > 0) {
        const er = Math.max(1.6, r * 0.18);
        ctx.fillStyle = e.eye;
        ctx.beginPath();
        ctx.ellipse(e.x - r * 0.33 + lx, e.y - r * 0.15 + ly, er, er * 1.25, 0, 0, Math.PI * 2);
        ctx.ellipse(e.x + r * 0.33 + lx, e.y - r * 0.15 + ly, er, er * 1.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(e.x - r * 0.33 + lx * 1.4, e.y - r * 0.12 + ly * 1.4, er * 0.45, 0, Math.PI * 2);
        ctx.arc(e.x + r * 0.33 + lx * 1.4, e.y - r * 0.12 + ly * 1.4, er * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      if (e.boss) {
        // зубастая пасть
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        const mw = r * 0.9, my = e.y + r * 0.3;
        ctx.moveTo(e.x - mw / 2, my);
        for (let i = 0; i <= 6; i++) ctx.lineTo(e.x - mw / 2 + (mw / 6) * i, my + (i % 2 ? r * 0.22 : 0));
        ctx.closePath(); ctx.fill();
      }
      // щит
      if (e.shieldT > 0) {
        ctx.strokeStyle = `rgba(138,247,255,${0.6 + Math.sin(this.t * 20) * 0.3})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.35, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(138,247,255,0.15)'; ctx.fill();
      }
      // полоска здоровья
      if (e.hp < e.maxHp || e.boss) {
        const bw = e.boss ? r * 2.2 : r * 1.8, bh = e.boss ? 5 : 3, by = e.y - r - (e.boss ? 18 : 8);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - bw / 2 - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = e.boss ? '#ff4d6d' : '#b8ff5a';
        ctx.fillRect(e.x - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), bh);
      }
      ctx.restore();
    }
  },

  drawProjectiles(ctx) {
    for (const p of this.projs) {
      switch (p.kind) {
        case 'fluff':
          ctx.fillStyle = '#fff6ea';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.lvl * 0.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(240,168,104,0.6)'; ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1, 2.5, 0, Math.PI * 2); ctx.fill();
          break;
        case 'bubble':
          ctx.strokeStyle = 'rgba(160,230,255,0.9)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 5 + p.lvl * 0.5, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(p.x - 2, p.y - 2, 1.4, 0, Math.PI * 2); ctx.fill();
          break;
        case 'note':
          ctx.fillStyle = '#ff9de2'; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('♪', p.x, p.y);
          break;
        case 'fire': {
          const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 8);
          g.addColorStop(0, '#fff6a0'); g.addColorStop(0.5, '#ff9a3c'); g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
          if (Math.random() < 0.5) this.particles.push({ x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.25, t: 0, color: '#ff9a3c', size: 2, g: 0 });
          break;
        }
        case 'rocket': {
          const a = Math.atan2(p.vy, p.vx);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a + Math.PI / 4);
          drawEmoji(ctx, '🚀', 0, 0, 16);
          ctx.restore();
          break;
        }
      }
    }
    for (const b of this.beams) {
      const a = 1 - b.t / b.life;
      ctx.strokeStyle = hexA(b.color, a); ctx.lineWidth = b.w; ctx.lineCap = 'round';
      ctx.beginPath();
      b.pts.forEach((p, i) => {
        if (!i) { ctx.moveTo(p.x, p.y); return; }
        if (b.zig) {
          const q = b.pts[i - 1];
          for (let k = 1; k <= 3; k++) {
            const f = k / 4;
            ctx.lineTo(q.x + (p.x - q.x) * f + rand(-6, 6), q.y + (p.y - q.y) * f + rand(-6, 6));
          }
        }
        ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`; ctx.lineWidth = b.w * 0.4; ctx.stroke();
    }
  },

  drawFx(ctx) {
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = r.r + (r.max - r.r) * (1 - Math.pow(1 - k, 2));
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      if (r.fill) { ctx.fillStyle = hexA(r.color, 0.18 * (1 - k)); ctx.fill(); }
      ctx.strokeStyle = hexA(r.color, 1 - k); ctx.lineWidth = r.w * (1 - k * 0.5); ctx.stroke();
    }
    for (const p of this.particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    // искры пыльцы летят в счётчик
    for (const f of this.flyers) {
      const k = Math.min(1, f.t / f.dur), e = k * k;
      const x = (1 - e) * (1 - e) * f.sx + 2 * (1 - e) * e * f.cx + e * e * f.tx;
      const y = (1 - e) * (1 - e) * f.sy + 2 * (1 - e) * e * f.cy + e * e * f.ty;
      ctx.fillStyle = '#fff3a6';
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,120,0.35)';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  },

  drawStar(ctx) {
    const s = this.star; if (!s) return;
    const pulse = 1 + Math.sin(this.t * 10) * 0.12;
    const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 30);
    g.addColorStop(0, 'rgba(255,246,176,0.8)'); g.addColorStop(1, 'rgba(255,246,176,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 30, 0, Math.PI * 2); ctx.fill();
    drawEmoji(ctx, '🌟', s.x, s.y, 26 * pulse);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ТАП!', s.x, s.y + 24);
  },

  drawFloats(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const k = f.t / f.life;
      const pop = f.t < 0.12 ? 0.6 + f.t / 0.12 * 0.5 : 1.1 - Math.min(0.1, (f.t - 0.12));
      const y = f.y - k * (f.small ? 16 : 26);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `900 ${f.size * pop}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,5,30,0.85)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    // комбо
    if (this.combo >= 5 && this.state === 'play') {
      const s = 14 + Math.min(12, this.combo / 5);
      ctx.font = `900 ${s}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,5,30,0.85)';
      const txt = `×${this.combo} комбо`;
      const y = this.L.topY + 30;
      ctx.globalAlpha = Math.min(1, this.comboT * 2);
      ctx.strokeText(txt, W / 2, y); ctx.fillStyle = '#ff9de2'; ctx.fillText(txt, W / 2, y);
      ctx.globalAlpha = 1;
    }
    if (this.rageT > 0 && this.state === 'play') {
      ctx.font = '900 11px system-ui, sans-serif'; ctx.fillStyle = '#ff8a8a';
      ctx.fillText(`🔥 Ярость ${Math.ceil(this.rageT)}с`, W / 2, this.L.gridY - 20);
    }
    if (this.preStart > 0 && this.state === 'play' && !(this.tut && this.grid.filter(Boolean).length < 2)) {
      ctx.font = '900 13px system-ui, sans-serif'; ctx.fillStyle = 'rgba(220,210,255,0.85)';
      ctx.fillText(`Кошмары проснутся через ${Math.ceil(this.preStart)}…`, W / 2, this.L.topY + 46);
    }
  },

  drawBanner(ctx) {
    const b = this.banner; if (!b) return;
    const k = b.t / b.life;
    const inK = Math.min(1, b.t / 0.25), outK = k > 0.8 ? (1 - k) / 0.2 : 1;
    const y = this.L.gridY - 30 > this.L.topY + 40 ? (this.L.topY + this.L.gridY) / 2 : this.L.gridY + this.L.gridH / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(inK, outK);
    ctx.fillStyle = 'rgba(8,5,25,0.7)';
    ctx.fillRect(0, y - 26, W, b.sub ? 54 : 40);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${22 + (1 - inK) * 10}px system-ui, sans-serif`;
    ctx.fillStyle = b.color; ctx.fillText(b.text, W / 2 + (1 - inK) * -40, y - 6);
    if (b.sub) { ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText(b.sub, W / 2, y + 16); }
    ctx.restore();
  },

  drawTutorialHand(ctx) {
    if (!this.tut || this.tut.step !== 1 || this.drag) return;
    const pair = this.mergeablePair(); if (!pair) return;
    const a = this.slots[pair[0]], b = this.slots[pair[1]];
    const k = (this.t % 1.6) / 1.6;
    const e = k < 0.15 ? 0 : k > 0.8 ? 1 : (k - 0.15) / 0.65;
    const ee = e * e * (3 - 2 * e);
    const x = a.x + (b.x - a.x) * ee, y = a.y + (b.y - a.y) * ee;
    drawEmoji(ctx, '👆', x + 8, y + 18, 30, k > 0.9 ? (1 - k) * 10 : 1);
  },
};
