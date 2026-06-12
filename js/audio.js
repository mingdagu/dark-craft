// 音频模块（自 M0 移植）：三总线核心 + 战斗音效 + 环境音 + 昼夜双版本 BGM
// 全部 Web Audio 实时合成。音频属于表现层，允许使用非确定性随机。

export const AudioCore = (function () {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  const settings = {
    mute: localStorage.getItem('dc_mute') === '1',
    sfx: isNaN(parseFloat(localStorage.getItem('dc_vol_sfx'))) ? 0.8 : parseFloat(localStorage.getItem('dc_vol_sfx')),
    music: isNaN(parseFloat(localStorage.getItem('dc_vol_music'))) ? 0.7 : parseFloat(localStorage.getItem('dc_vol_music')),
  };
  function apply() {
    if (!ctx) return;
    master.gain.value = settings.mute ? 0 : 0.6;
    sfxBus.gain.value = settings.sfx;
    musicBus.gain.value = settings.music;
  }
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
      master = ctx.createGain(); master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.connect(master);
      apply();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  addEventListener('keydown', ensure); addEventListener('mousedown', ensure);
  return {
    ensure, settings,
    get ctx() { return ctx; },
    get sfx() { return sfxBus; },
    get music() { return musicBus; },
    set(key, val) {
      settings[key] = val;
      localStorage.setItem('dc_mute', settings.mute ? '1' : '0');
      localStorage.setItem('dc_vol_sfx', String(settings.sfx));
      localStorage.setItem('dc_vol_music', String(settings.music));
      apply();
    },
  };
})();

function tone(freq, endFreq, dur, type, vol, delay) {
  const c = AudioCore.ensure(); if (!c) return;
  const t0 = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq || freq), t0 + dur);
  g.gain.setValueAtTime(vol || 0.15, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(AudioCore.sfx);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function snoise(when, dur, vol, fStart, fEnd, dest) {
  const c = AudioCore.ensure(); if (!c) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(fStart || 1000, when);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd || fStart || 1000), when + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol || 0.2, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(f); f.connect(g); g.connect(dest || AudioCore.sfx);
  src.start(when);
}
function noise(dur, vol, fStart, fEnd) {
  const c = AudioCore.ensure(); if (!c) return;
  snoise(c.currentTime, dur, vol, fStart, fEnd, AudioCore.sfx);
}
function mnote(freq, dur, type, vol, when, dest) {
  const c = AudioCore.ctx; if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(g); g.connect(dest);
  o.start(when); o.stop(when + dur + 0.05);
}
function mkick(when, vol, dest, f0, f1) {
  const c = AudioCore.ctx; if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0 || 130, when);
  o.frequency.exponentialRampToValueAtTime(f1 || 40, when + 0.12);
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
  o.connect(g); g.connect(dest);
  o.start(when); o.stop(when + 0.2);
}

export const AudioFX = {
  melee()     { noise(0.12, 0.18, 2400, 300); },
  fireCast()  { tone(220, 880, 0.18, 'sawtooth', 0.10); noise(0.15, 0.06, 1800, 600); },
  fireBoom()  { noise(0.45, 0.30, 700, 60); tone(120, 35, 0.4, 'triangle', 0.22); },
  monHit()    { tone(140 + Math.random() * 50, 70, 0.09, 'square', 0.14); },
  monDie()    { tone(300, 45, 0.35, 'sawtooth', 0.13); },
  playerHit() { tone(95, 45, 0.22, 'square', 0.22); noise(0.12, 0.10, 500, 120); },
  pickup(tier) {
    const base = 520 + tier * 130;
    tone(base, base, 0.09, 'sine', 0.12);
    tone(base * 1.5, base * 1.5, 0.12, 'sine', 0.10, 0.07);
    if (tier >= 2) tone(base * 2, base * 2, 0.16, 'sine', 0.09, 0.14);
    if (tier >= 3) tone(base * 2.67, base * 2.67, 0.20, 'sine', 0.08, 0.21);
  },
  potion()    { tone(300, 170, 0.09, 'sine', 0.13); tone(240, 150, 0.09, 'sine', 0.13, 0.10); tone(280, 160, 0.10, 'sine', 0.12, 0.20); },
  levelUp()   { [392, 523, 659, 784].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.13, i * 0.09)); },
};

export const Ambient = (function () {
  let windOn = false;
  const timers = { bird: 3, cricket: 1, owl: 9, bat: 7, wolf: 20 };
  function startWind(c) {
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d0 = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d0[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = c.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(AudioCore.sfx);
    src.start(); lfo.start();
  }
  const chirp = () => { const b = 1900 + Math.random() * 700, n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) tone(b + Math.random() * 200, b + 700, 0.07, 'sine', 0.05, k * 0.1); };
  const cricket = () => { for (let k = 0; k < 3; k++) tone(4200 + Math.random() * 150, 4200, 0.035, 'sine', 0.022, k * 0.07); };
  const owl = () => { tone(420, 330, 0.28, 'sine', 0.06); tone(390, 300, 0.42, 'sine', 0.055, 0.5); };
  const bat = () => { const c = AudioCore.ctx; if (!c) return;
    for (let k = 0; k < 9; k++) snoise(c.currentTime + k * 0.03, 0.02, 0.03, 3200, 1600); };
  const wolfHowl = () => { tone(330, 540, 0.9, 'sine', 0.038); tone(540, 370, 1.1, 'sine', 0.03, 0.9); };
  function update(dt, darkness) {
    const c = AudioCore.ctx; if (!c) return;
    if (!windOn) { startWind(c); windOn = true; }
    const isNight = darkness > 0.6, isDay = darkness < 0.4;
    timers.bird -= dt; if (isDay && timers.bird <= 0) { chirp(); timers.bird = 4 + Math.random() * 6; }
    timers.cricket -= dt; if (isNight && timers.cricket <= 0) { cricket(); timers.cricket = 0.5 + Math.random() * 0.5; }
    timers.owl -= dt; if (isNight && timers.owl <= 0) { owl(); timers.owl = 12 + Math.random() * 14; }
    timers.bat -= dt; if (isNight && timers.bat <= 0) { bat(); timers.bat = 9 + Math.random() * 10; }
    timers.wolf -= dt; if (isNight && timers.wolf <= 0) { wolfHowl(); timers.wolf = 28 + Math.random() * 28; }
  }
  return { update };
})();

export const Music = (function () {
  let inited = false, dayBus = null, nightBus = null;
  const day = { next: 0, step: 0 }, night = { next: 0, step: 0 };
  const DAY_8TH = 60 / 78 / 2, NIGHT_8TH = 60 / 96 / 2;
  const N = { A1: 55, E2: 82.41, F2: 87.31, Eb2: 77.78, A3: 220, B3: 246.94, C4: 261.63,
    D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb5: 932.33 };
  const dayBass = [N.A1, N.E2, N.F2, N.E2];
  const nightBass = [N.A1, N.A1, N.Eb2, N.E2];
  const dayArp = [N.A3, N.C4, N.E4, N.A4, N.E4, N.C4, N.B3, N.C4,
    N.A3, N.C4, N.E4, N.G4, N.E4, N.D4, N.C4, N.B3];
  const nightArp = [N.A3, N.C4, N.E4, N.F4, N.E4, N.C4, N.B3, N.C4,
    N.A3, N.B3, N.C4, N.F4, N.E4, N.D4, N.C4, N.B3];
  function initBuses(c) {
    dayBus = c.createGain(); dayBus.gain.value = 0; dayBus.connect(AudioCore.music);
    nightBus = c.createGain(); nightBus.gain.value = 0; nightBus.connect(AudioCore.music);
  }
  function schedDay(t, i) {
    const bar = Math.floor(i / 8) % 4, beat = i % 8;
    if (beat === 0) { mnote(dayBass[bar], DAY_8TH * 7.5, 'sawtooth', 0.085, t, dayBus); mkick(t, 0.10, dayBus); }
    if (beat === 4) { mkick(t, 0.07, dayBus); snoise(t, 0.06, 0.035, 1200, 500, dayBus); }
    if ((i * 7 + bar * 3) % 11 >= 3) mnote(dayArp[i % 16], DAY_8TH * 0.95, 'triangle', 0.045, t, dayBus);
  }
  function schedNight(t, i) {
    const bar = Math.floor(i / 8) % 4, beat = i % 8;
    if (beat === 0) mnote(nightBass[bar], NIGHT_8TH * 7.5, 'sawtooth', 0.095, t, nightBus);
    if (beat === 0 || beat === 3 || beat === 4) mkick(t, beat === 0 ? 0.12 : 0.08, nightBus);
    if (beat === 2 || beat === 6) snoise(t, 0.05, 0.04, 1500, 600, nightBus);
    if (beat === 7 && bar % 2 === 1) mkick(t, 0.09, nightBus, 95, 50);
    if ((i * 5 + bar) % 13 >= 2) mnote(nightArp[i % 16], NIGHT_8TH * 0.9, 'triangle', 0.05, t, nightBus);
    if (beat === 0 && bar === 2 && Math.floor(i / 32) % 2 === 0) mnote(N.Bb5, 1.4, 'sine', 0.02, t, nightBus);
  }
  function runScheduler(s, weight, spb, sched, c) {
    if (weight < 0.02) { s.next = 0; return; }
    if (s.next < c.currentTime) s.next = c.currentTime + 0.05;
    const horizon = c.currentTime + 1.2;
    while (s.next < horizon) { sched(s.next, s.step++); s.next += spb; }
  }
  function update(darkness) {
    const c = AudioCore.ctx; if (!c) return;
    if (!inited) { initBuses(c); inited = true; }
    dayBus.gain.value = 1 - darkness;
    nightBus.gain.value = darkness;
    runScheduler(day, 1 - darkness, DAY_8TH, schedDay, c);
    runScheduler(night, darkness, NIGHT_8TH, schedNight, c);
  }
  return { update };
})();

// 模拟事件 → 音效的桥（渲染主循环每 tick 调用）
export function playEventSfx(ev) {
  if (ev.t !== 'sfx') return;
  if (ev.n === 'pickup') AudioFX.pickup(ev.tier || 0);
  else if (AudioFX[ev.n]) AudioFX[ev.n]();
}
