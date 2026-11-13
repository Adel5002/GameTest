'use strict';
// ===== Игровые данные =====

const MAX_LVL = 7;
const DECK_SIZE = 5;

const RARITY = {
  common: { name: 'Обычная', color: '#9fd3ff', weight: 70 },
  rare:   { name: 'Редкая',  color: '#ffb84d', weight: 23 },
  epic:   { name: 'Эпическая', color: '#d48bff', weight: 7 },
};

// dmg — урон за атаку на 1 уровне, rate — атак в секунду
const TOYS = {
  bear: {
    name: 'Мишка', emoji: '🧸', color: '#f0a868', rarity: 'common', kind: 'single',
    dmg: 22, rate: 1.25, target: 'first', proj: 'fluff',
    desc: 'Кидается пухом в кошмар, который ближе всех к кровати.',
  },
  robot: {
    name: 'Робот', emoji: '🤖', color: '#5ad1ff', rarity: 'common', kind: 'laser',
    dmg: 8, rate: 3.4, target: 'random',
    desc: 'Строчит лазером по случайным кошмарам. Очень быстро.',
  },
  duck: {
    name: 'Уточка', emoji: '🦆', color: '#ffd84a', rarity: 'common', kind: 'single',
    dmg: 11, rate: 1.0, target: 'unslowed', proj: 'bubble', slow: 0.32, slowDur: 2.4,
    desc: 'Пускает мыльные пузыри — кошмары вязнут и замедляются.',
  },
  light: {
    name: 'Ночник', emoji: '💡', color: '#fff2a8', rarity: 'common', kind: 'aura',
    dmg: 17, rate: 0.85, radius: 96,
    desc: 'Вспышка света ранит ВСЕ кошмары в радиусе. Ставь у дорожки!',
  },
  music: {
    name: 'Шкатулка', emoji: '🎵', color: '#ff8fd8', rarity: 'common', kind: 'single',
    dmg: 8, rate: 1.0, target: 'first', proj: 'note', income: 5, incomeEvery: 4,
    desc: 'Играет колыбельную: каждые 4 сек приносит пыльцу снов.',
  },
  dino: {
    name: 'Динозаврик', emoji: '🦖', color: '#7ee081', rarity: 'rare', kind: 'single',
    dmg: 26, rate: 0.75, target: 'first', proj: 'fire', splash: 50,
    desc: 'Плюётся огнём — урон по площади.',
  },
  flash: {
    name: 'Фонарик', emoji: '🔦', color: '#9fb4ff', rarity: 'rare', kind: 'chain',
    dmg: 15, rate: 1.1, chains: 3,
    desc: 'Луч перескакивает между кошмарами (+1 цель за уровень).',
  },
  rocket: {
    name: 'Ракета', emoji: '🚀', color: '#ff6b6b', rarity: 'epic', kind: 'single',
    dmg: 140, rate: 0.3, target: 'strongest', proj: 'rocket', splash: 30,
    desc: 'Медленно, но мощно бьёт самого толстого. Гроза боссов.',
  },
  wand: {
    name: 'Палочка', emoji: '🪄', color: '#c58bff', rarity: 'epic', kind: 'joker',
    dmg: 0, rate: 0,
    desc: 'Не атакует. Сливается с ЛЮБОЙ игрушкой своего уровня и превращается в неё.',
  },
};
const TOY_IDS = Object.keys(TOYS);
const START_TOYS = ['bear', 'robot', 'duck', 'light', 'music'];

const ENEMIES = {
  shade:    { name: 'Тень',     hp: 1.0,  speed: 44, r: 13, body: '#3a2a6e', eye: '#ffe066', reward: 1 },
  fast:     { name: 'Шустрик',  hp: 0.5,  speed: 82, r: 10, body: '#1f4a70', eye: '#7ef9ff', reward: 1 },
  tank:     { name: 'Громила',  hp: 3.4,  speed: 27, r: 18, body: '#5c1d40', eye: '#ff5a5a', reward: 2 },
  splitter: { name: 'Клякса',   hp: 1.5,  speed: 38, r: 15, body: '#1d4d3a', eye: '#b8ff5a', reward: 1, split: 2 },
  mini:     { name: 'Капелька', hp: 0.35, speed: 64, r: 8,  body: '#1d4d3a', eye: '#b8ff5a', reward: 0.5 },
};

const BOSSES = [
  { id: 'babai', name: 'Бабайка', hp: 26, speed: 19, r: 30, body: '#2b1640', eye: '#ff3b3b', ability: 'summon',
    hint: 'Призывает теней!' },
  { id: 'buka',  name: 'Бука',    hp: 24, speed: 21, r: 28, body: '#40142a', eye: '#ffae00', ability: 'scare',
    hint: 'Пугает игрушки — они замирают!' },
  { id: 'mgla',  name: 'Мгла',    hp: 22, speed: 23, r: 27, body: '#14303f', eye: '#8af7ff', ability: 'shield',
    hint: 'Прячется за щитом!' },
];

// стоимость усиления типа в бою (уровень силы 1→2, 2→3, ...)
const POWER_COST = [100, 200, 400, 700];
const MAX_POWER = POWER_COST.length + 1;

// прокачка игрушки в коллекции: карт нужно для перехода с ур. L на L+1
const CARD_REQ = [2, 4, 8, 14, 24, 40, 60, 90, 130];
const MAX_META = CARD_REQ.length + 1;
const metaStarCost = (lvl) => 30 * lvl + 10 * lvl * lvl;

const CHESTS = {
  free:  { name: 'Подушка-сюрприз',  emoji: '🎁', cards: 3,  price: 0 },
  small: { name: 'Сундук снов',      emoji: '🧰', cards: 7,  price: 120 },
  big:   { name: 'Волшебный сундук', emoji: '💎', cards: 22, price: 380, guaranteeRare: true },
};
const FREE_CHEST_COOLDOWN = 3 * 60 * 60 * 1000;

const DAILY_REWARDS = [
  { stars: 20 }, { stars: 30 }, { stars: 40 }, { chest: 'small' },
  { stars: 60 }, { stars: 80 }, { chest: 'big' },
];

const MISSION_POOL = [
  { type: 'merge',  mode: 'add', targets: [15, 25, 40],  text: n => `Слей игрушки ${n} раз`, reward: 30 },
  { type: 'kill',   mode: 'add', targets: [150, 300, 500], text: n => `Прогони ${n} кошмаров`, reward: 30 },
  { type: 'summon', mode: 'add', targets: [30, 60, 100], text: n => `Достань ${n} игрушек`, reward: 25 },
  { type: 'wave',   mode: 'max', targets: [8, 12, 16],   text: n => `Дойди до волны ${n}`, reward: 40 },
  { type: 'boss',   mode: 'add', targets: [1, 3, 5],     text: n => `Победи боссов: ${n}`, reward: 40 },
  { type: 'combo',  mode: 'max', targets: [25, 50, 80],  text: n => `Сделай комбо ×${n}`, reward: 35 },
  { type: 'toylvl', mode: 'max', targets: [4, 5, 6],     text: n => `Собери игрушку ${n} уровня`, reward: 40 },
  { type: 'star',   mode: 'add', targets: [2, 4, 6],     text: n => `Поймай падающих звёзд: ${n}`, reward: 30 },
  { type: 'game',   mode: 'add', targets: [2, 3, 5],     text: n => `Сыграй ночей: ${n}`, reward: 25 },
];

const xpForLevel = (lvl) => 60 + lvl * 40;

// здоровье обычного кошмара на волне w
const baseHP = (w) => Math.round(46 * Math.pow(1.22, w - 1) + 10 * (w - 1));
