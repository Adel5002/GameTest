'use strict';
// ===== Профиль игрока, сохранение, задания, сундуки =====
const SAVE_KEY = 'dreamguard_save_v1';

const Profile = {
  data: null,

  defaults() {
    const toys = {};
    TOY_IDS.forEach(id => { toys[id] = { lvl: 1, cards: 0, unlocked: START_TOYS.includes(id) }; });
    return {
      v: 1, stars: 60, xp: 0, level: 1, best: 0, games: 0,
      toys, deck: START_TOYS.slice(),
      freeChestAt: 0,
      daily: { last: '', streak: 0 },
      missions: { day: '', list: [] },
      settings: { sound: true, music: true, vibro: true },
      tutorial: false,
      totals: { kills: 0, merges: 0, bosses: 0 },
    };
  },

  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { d = null; }
    const def = this.defaults();
    if (!d || typeof d !== 'object') d = def;
    // мягкое слияние с дефолтами (на случай новых полей)
    for (const k in def) if (d[k] === undefined) d[k] = def[k];
    TOY_IDS.forEach(id => { if (!d.toys[id]) d.toys[id] = def.toys[id]; });
    d.deck = d.deck.filter(id => TOYS[id] && d.toys[id].unlocked);
    for (const id of TOY_IDS) { if (d.deck.length >= DECK_SIZE) break; if (d.toys[id].unlocked && !d.deck.includes(id)) d.deck.push(id); }
    this.data = d;
    this.refreshMissions();
    this.save();
    return d;
  },

  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* нет хранилища */ } },

  reset() { this.data = this.defaults(); this.refreshMissions(); this.save(); },

  addStars(n) { this.data.stars += n; this.save(); },

  // возвращает число полученных уровней
  addXP(n) {
    const d = this.data; d.xp += n; let ups = 0;
    while (d.xp >= xpForLevel(d.level)) { d.xp -= xpForLevel(d.level); d.level++; ups++; }
    this.save(); return ups;
  },

  // ----- ежедневная награда -----
  dayKey(date = new Date()) { return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate(); },
  dailyAvailable() { return this.data.daily.last !== this.dayKey(); },
  dailyNextIndex() {
    const d = this.data.daily;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const continues = d.last === this.dayKey(y);
    const streak = continues ? d.streak : 0;
    return streak % DAILY_REWARDS.length;
  },
  claimDaily() {
    const idx = this.dailyNextIndex();
    const d = this.data.daily;
    const y = new Date(); y.setDate(y.getDate() - 1);
    d.streak = (d.last === this.dayKey(y) ? d.streak : 0) + 1;
    d.last = this.dayKey();
    this.save();
    return DAILY_REWARDS[idx];
  },

  // ----- задания -----
  refreshMissions() {
    const m = this.data.missions;
    const today = this.dayKey();
    if (m.day === today && m.list.length) return;
    const pool = MISSION_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const tier = Math.min(2, Math.floor((this.data.level - 1) / 4));
    m.day = today;
    m.list = pool.map(p => ({
      type: p.type, target: p.targets[tier], progress: 0, reward: p.reward + tier * 10, claimed: false,
    }));
    this.save();
  },
  missionText(ms) { return MISSION_POOL.find(p => p.type === ms.type).text(ms.target); },
  track(type, value = 1) {
    const list = this.data.missions.list;
    for (const ms of list) {
      if (ms.type !== type || ms.claimed) continue;
      const def = MISSION_POOL.find(p => p.type === type);
      ms.progress = def.mode === 'max' ? Math.max(ms.progress, value) : ms.progress + value;
      ms.progress = Math.min(ms.progress, ms.target);
    }
  },
  missionsReady() { return this.data.missions.list.filter(m => !m.claimed && m.progress >= m.target).length; },

  // ----- сундуки и карты -----
  freeChestReady() { return Date.now() >= this.data.freeChestAt; },
  rollCards(chestId) {
    const ch = CHESTS[chestId];
    const res = {};
    const pick = (forceRare) => {
      let r = Math.random() * 100, rar = 'common';
      if (forceRare) rar = Math.random() < 0.25 ? 'epic' : 'rare';
      else if (r < RARITY.epic.weight) rar = 'epic';
      else if (r < RARITY.epic.weight + RARITY.rare.weight) rar = 'rare';
      const ids = TOY_IDS.filter(id => TOYS[id].rarity === rar);
      return ids[Math.floor(Math.random() * ids.length)];
    };
    let total = ch.cards;
    if (ch.guaranteeRare) { const id = pick(true); res[id] = (res[id] || 0) + 3; total -= 3; }
    // карты выпадают «пачками», а не по одной — так интереснее
    while (total > 0) {
      const id = pick(false);
      const n = Math.min(total, 1 + Math.floor(Math.random() * Math.max(1, ch.cards / 4)));
      res[id] = (res[id] || 0) + n; total -= n;
    }
    // применяем
    const out = [];
    for (const id of Object.keys(res)) {
      const t = this.data.toys[id];
      const isNew = !t.unlocked;
      if (isNew) { t.unlocked = true; if (this.data.deck.length < DECK_SIZE) this.data.deck.push(id); }
      t.cards += res[id];
      out.push({ id, n: res[id], isNew });
    }
    out.sort((a, b) => ['common', 'rare', 'epic'].indexOf(TOYS[a.id].rarity) - ['common', 'rare', 'epic'].indexOf(TOYS[b.id].rarity));
    this.save();
    return out;
  },

  canUpgrade(id) {
    const t = this.data.toys[id];
    if (!t.unlocked || t.lvl >= MAX_META) return false;
    return t.cards >= CARD_REQ[t.lvl - 1] && this.data.stars >= metaStarCost(t.lvl);
  },
  upgradeToy(id) {
    if (!this.canUpgrade(id)) return false;
    const t = this.data.toys[id];
    t.cards -= CARD_REQ[t.lvl - 1];
    this.data.stars -= metaStarCost(t.lvl);
    t.lvl++;
    this.save();
    return true;
  },
  upgradesAvailable() { return TOY_IDS.filter(id => this.canUpgrade(id)).length; },
};
