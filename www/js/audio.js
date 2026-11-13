'use strict';
// ===== Синтезированный звук (без файлов) =====
const Sfx = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let soundOn = true, musicOn = true;
  let musicTimer = null, musicStep = 0;
  const last = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = soundOn ? 1 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 1 : 0; musicBus.connect(master);
    startMusic();
  }

  function throttle(name, ms) {
    const t = performance.now();
    if (last[name] && t - last[name] < ms) return false;
    last[name] = t; return true;
  }

  function tone(freq, dur, opts = {}) {
    if (!ctx || !soundOn) return;
    const { type = 'sine', vol = 0.2, slide = 0, delay = 0, attack = 0.005, bus = sfxBus } = opts;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts = {}) {
    if (!ctx || !soundOn) return;
    const { vol = 0.2, freq = 1200, q = 1, delay = 0, type = 'lowpass' } = opts;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0);
  }

  // ---- колыбельная: музыкальная шкатулка в пентатонике ----
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
  const BASS = [130.81, 174.61, 196.0, 130.81];
  let melodyIdx = 3;
  function musicBoxNote(freq, vol, delay = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    [1, 2, 3.01].forEach((m, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * m;
      const v = vol / (1 + i * 2.5);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6 - i * 0.4);
      o.connect(g); g.connect(musicBus);
      o.start(t0); o.stop(t0 + 1.7);
    });
  }
  function startMusic() {
    if (musicTimer) return;
    musicTimer = setInterval(() => {
      if (!ctx || !musicOn || ctx.state !== 'running') return;
      musicStep++;
      if (musicStep % 8 === 1) musicBoxNote(BASS[Math.floor(musicStep / 8) % BASS.length], 0.05);
      if (Math.random() < 0.82) {
        melodyIdx += [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
        melodyIdx = Math.max(0, Math.min(SCALE.length - 1, melodyIdx));
        musicBoxNote(SCALE[melodyIdx], 0.035);
      }
    }, 420);
  }

  return {
    init,
    setSound(on) { soundOn = on; if (sfxBus) sfxBus.gain.value = on ? 1 : 0; },
    setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.value = on ? 1 : 0; },
    click() { tone(880, 0.06, { type: 'triangle', vol: 0.12 }); },
    summon() {
      tone(520, 0.12, { type: 'triangle', vol: 0.18, slide: 1.6 });
      tone(780, 0.1, { type: 'sine', vol: 0.1, delay: 0.06 });
    },
    lucky() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.14, delay: i * 0.05 })); },
    merge(lvl) {
      const base = 440 * Math.pow(1.1225, lvl * 2);
      tone(base, 0.22, { type: 'triangle', vol: 0.22 });
      tone(base * 1.5, 0.25, { type: 'sine', vol: 0.14, delay: 0.05 });
      tone(base * 2, 0.3, { type: 'sine', vol: 0.1, delay: 0.1 });
      noise(0.15, { vol: 0.08, freq: 4000, type: 'highpass' });
    },
    place() { tone(300, 0.07, { type: 'triangle', vol: 0.12 }); },
    deny() { tone(200, 0.15, { type: 'square', vol: 0.06, slide: 0.7 }); },
    shoot(kind) {
      if (!throttle('shoot' + kind, 70)) return;
      if (kind === 'laser') tone(1400, 0.05, { type: 'square', vol: 0.025, slide: 0.5 });
      else if (kind === 'aura') tone(600, 0.25, { type: 'sine', vol: 0.06, slide: 1.5 });
      else if (kind === 'chain') noise(0.12, { vol: 0.06, freq: 3000, type: 'bandpass', q: 3 });
      else if (kind === 'rocket') noise(0.3, { vol: 0.08, freq: 900 });
      else tone(700, 0.05, { type: 'triangle', vol: 0.03, slide: 0.7 });
    },
    hit() { if (throttle('hit', 45)) tone(240 + Math.random() * 80, 0.04, { type: 'square', vol: 0.025 }); },
    kill(combo) {
      if (!throttle('kill', 35)) return;
      const f = 500 + Math.min(combo, 60) * 12;
      tone(f, 0.09, { type: 'triangle', vol: 0.09, slide: 1.8 });
    },
    boom() { noise(0.35, { vol: 0.22, freq: 500 }); tone(90, 0.3, { type: 'sine', vol: 0.25, slide: 0.5 }); },
    coin() { if (throttle('coin', 40)) tone(1500 + Math.random() * 300, 0.05, { type: 'sine', vol: 0.05 }); },
    lifeLost() { tone(220, 0.4, { type: 'sawtooth', vol: 0.12, slide: 0.5 }); noise(0.3, { vol: 0.15, freq: 300 }); },
    wave() { [523, 659, 784].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.12, delay: i * 0.08 })); },
    boss() {
      tone(70, 1.0, { type: 'sawtooth', vol: 0.18, slide: 0.7, attack: 0.1 });
      tone(105, 1.0, { type: 'sawtooth', vol: 0.12, slide: 0.65, attack: 0.1 });
      noise(0.8, { vol: 0.12, freq: 200 });
    },
    bossDie() {
      noise(0.8, { vol: 0.25, freq: 800 });
      [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.14, delay: 0.15 + i * 0.09 }));
    },
    star() { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.12, delay: i * 0.06 })); },
    upgrade() { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.15, { type: 'square', vol: 0.06, delay: i * 0.05 })); },
    combo(n) { tone(600 + n * 4, 0.3, { type: 'triangle', vol: 0.15, slide: 2 }); },
    gameOver() { [523, 440, 349, 262].forEach((f, i) => tone(f, 0.45, { type: 'triangle', vol: 0.15, delay: i * 0.2 })); },
    record() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.15, delay: i * 0.09 })); },
    card(rarity) {
      if (rarity === 'epic') [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.14, delay: i * 0.06 }));
      else if (rarity === 'rare') [659, 880, 1175].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.13, delay: i * 0.06 }));
      else tone(880, 0.15, { type: 'triangle', vol: 0.13, slide: 1.3 });
    },
    chestShake() { noise(0.1, { vol: 0.1, freq: 600 }); },
  };
})();

// ===== Вибрация =====
const Haptic = {
  on: true,
  vibrate(ms) {
    if (!this.on) return;
    try {
      const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H) { H.impact({ style: ms > 25 ? 'HEAVY' : ms > 12 ? 'MEDIUM' : 'LIGHT' }); return; }
    } catch (e) { /* ignore */ }
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  },
};
