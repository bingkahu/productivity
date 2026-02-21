/* ============================================================
   VORTEX II — Cosmic Productivity System — script.js
============================================================ */
'use strict';

/* ──────────────────────────────────────────────────────────
   UTILITIES
────────────────────────────────────────────────────────── */
const U = {
  $:  (s, c = document) => c.querySelector(s),
  $$: (s, c = document) => [...c.querySelectorAll(s)],
  uid:  () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  pad:  n  => String(Math.floor(Math.abs(n))).padStart(2, '0'),
  fmt:  s  => `${U.pad(s / 60)}:${U.pad(s % 60)}`,
  today:   () => new Date().toISOString().slice(0, 10),
  daysAgo: n  => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); },
  clamp:   (v, mn, mx) => Math.min(mx, Math.max(mn, v)),
  fmtMins: m  => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`,
  rand:    (mn, mx) => mn + Math.random() * (mx - mn),
  choice:  arr => arr[Math.floor(Math.random() * arr.length)],
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  delegate(parent, sel, ev, fn) {
    if (!parent) return;
    parent.addEventListener(ev, e => { const t = e.target.closest(sel); if (t) fn(e, t); });
  },
};

/* ──────────────────────────────────────────────────────────
   STORE
────────────────────────────────────────────────────────── */
const Store = {
  NS: 'vx2_',
  set(k, v)   { try { localStorage.setItem(this.NS + k, JSON.stringify(v)); } catch (_) {} },
  get(k, d = null) {
    try { const v = localStorage.getItem(this.NS + k); return v !== null ? JSON.parse(v) : d; } catch (_) { return d; }
  },
  clearAll() { Object.keys(localStorage).filter(k => k.startsWith(this.NS)).forEach(k => localStorage.removeItem(k)); },
  exportAll() {
    const out = {};
    ['tasks','habits','notes','mood','stats','rewards','settings'].forEach(k => { const v = this.get(k); if (v) out[k] = v; });
    return out;
  },
  importAll(data) {
    ['tasks','habits','notes','mood','stats','rewards','settings'].forEach(k => { if (data[k] !== undefined) this.set(k, data[k]); });
  },
};

/* ──────────────────────────────────────────────────────────
   EVENT BUS
────────────────────────────────────────────────────────── */
const Bus = {
  _m: new Map(),
  on(ev, fn) { if (!this._m.has(ev)) this._m.set(ev, new Set()); this._m.get(ev).add(fn); },
  emit(ev, ...a) { this._m.get(ev)?.forEach(fn => { try { fn(...a); } catch (_) {} }); },
};

/* ──────────────────────────────────────────────────────────
   STATE
────────────────────────────────────────────────────────── */
const S = {
  tasks:   Store.get('tasks',  []),
  habits:  Store.get('habits', []),
  notes:   Store.get('notes',  []),
  mood:    Store.get('mood',   []),
  activeNoteId: null,
  stats: Store.get('stats', {
    totalSessions: 0, totalFocusMins: 0,
    lastDate: null,   streak: 0,
    tasksCompleted: 0, habitsChecked: 0,
    notesCreated: 0,  moodLogs: 0,
    dailyFocus: {},
  }),
  rewards: Store.get('rewards', { xp: 0, level: 1, achievements: [], owned: [] }),
  settings: Store.get('settings', { theme: 'nebula', sound: true, ambientVol: 35 }),
  timer: {
    running: false, mode: 'focus',
    totalSecs: 1500, remaining: 1500,
    session: 1, laps: [], lapStart: 0,
    startTs: 0, rafId: null, task: '',
  },
  ui: {
    activePanel: 'focus',
    taskFilter: 'all', taskSort: 'date_desc',
    noteFilter: 'all', noteSaveTimer: null,
    activeMoodEmoji: null, selectedMoodTags: [],
    activeMoodChart: '30d',
    activeRewardTab: 'badges',
    cmdItems: [], cmdIdx: 0,
  },
};

/* ──────────────────────────────────────────────────────────
   AUDIO ENGINE
────────────────────────────────────────────────────────── */
const Audio = {
  ctx: null, sfxGain: null, ambGain: null, ambNodes: [],
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const mg = this.ctx.createGain(); mg.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.28; this.sfxGain.connect(mg);
      this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = S.settings.ambientVol / 100; this.ambGain.connect(mg);
    } catch (_) {}
  },
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); },
  setAmbVol(v) { if (this.ambGain && this.ctx) this.ambGain.gain.linearRampToValueAtTime(v / 100, this.ctx.currentTime + 0.1); },
  sfx(type) {
    if (!S.settings.sound || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const map = {
      click:   { f: [660],           vol: 0.08, dur: 0.06, wave: 'sine'     },
      nav:     { f: [440],           vol: 0.04, dur: 0.07, wave: 'sine'     },
      start:   { f: [440, 660, 880], vol: 0.14, dur: 0.45, wave: 'sine'     },
      pause:   { f: [660, 440],      vol: 0.09, dur: 0.30, wave: 'sine'     },
      done:    { f: [440,554,659,880],vol: 0.18, dur: 1.20, wave: 'sine'    },
      lap:     { f: [440, 550],      vol: 0.11, dur: 0.30, wave: 'triangle' },
      achieve: { f: [523,659,784,1047],vol:0.20, dur: 1.40, wave: 'sine'   },
      complete:{ f: [660, 880],      vol: 0.13, dur: 0.40, wave: 'sine'     },
      error:   { f: [200],           vol: 0.07, dur: 0.25, wave: 'sawtooth' },
    };
    const d = map[type] || map.click;
    const step = d.dur / d.f.length;
    d.f.forEach((freq, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = d.wave; o.frequency.value = freq;
      o.connect(g); g.connect(this.sfxGain);
      g.gain.setValueAtTime(0, now + i * step);
      g.gain.linearRampToValueAtTime(d.vol, now + i * step + 0.02);
      g.gain.linearRampToValueAtTime(0, now + (i + 1) * step);
      o.start(now + i * step); o.stop(now + (i + 1) * step + 0.05);
    });
  },
  stopAmbient() { this.ambNodes.forEach(n => { try { n.stop ? n.stop() : n.disconnect(); } catch (_) {} }); this.ambNodes = []; },
  playAmbient(type) {
    this.stopAmbient();
    if (type === 'none' || !this.ctx) return;
    this.resume();
    const ct = this.ctx, g = this.ambGain;
    if (type === 'rain') {
      const buf = ct.createBuffer(1, ct.sampleRate * 2, ct.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
      const src = ct.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ct.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800;
      src.connect(f); f.connect(g); src.start(); this.ambNodes = [src];
    } else if (type === 'forest') {
      this.ambNodes = [200, 300, 400, 500].map(freq => {
        const o = ct.createOscillator(), gg = ct.createGain();
        o.type = 'sine'; o.frequency.value = freq * (1 + Math.random() * 0.1);
        gg.gain.value = 0.02; o.connect(gg); gg.connect(g); o.start(); return o;
      });
    } else if (type === 'ocean') {
      const buf = ct.createBuffer(1, ct.sampleRate * 4, ct.sampleRate);
      const d = buf.getChannelData(0); let ph = 0;
      for (let i = 0; i < d.length; i++) { ph += 0.0008; d[i] = Math.sin(ph * 0.5) * Math.sin(ph * 0.3) * 0.3; }
      const src = ct.createBufferSource(); src.buffer = buf; src.loop = true;
      src.connect(g); src.start(); this.ambNodes = [src];
    } else if (type === 'fire') {
      const buf = ct.createBuffer(1, ct.sampleRate * 2, ct.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.22;
      const src = ct.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ct.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      src.connect(lp); lp.connect(g); src.start(); this.ambNodes = [src];
    } else if (type === 'space') {
      this.ambNodes = [55, 82, 110].map(freq => {
        const o = ct.createOscillator(), gg = ct.createGain();
        o.type = 'sine'; o.frequency.value = freq; gg.gain.value = 0.045;
        o.connect(gg); gg.connect(g); o.start(); return o;
      });
    } else if (type === 'cafe') {
      const buf = ct.createBuffer(1, ct.sampleRate * 3, ct.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.14;
      const src = ct.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ct.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200;
      src.connect(bp); bp.connect(g); src.start(); this.ambNodes = [src];
    } else if (type === 'thunder') {
      const go = () => {
        const buf = ct.createBuffer(1, ct.sampleRate * 0.8, ct.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ct.sampleRate * 0.15)) * 0.9;
        const src = ct.createBufferSource(); src.buffer = buf;
        const gg = ct.createGain(); gg.gain.value = 0.55;
        src.connect(gg); gg.connect(g); src.start();
      };
      go();
      const iv = setInterval(go, 3000 + Math.random() * 5000);
      this.ambNodes = [{ stop: () => clearInterval(iv) }];
    }
  },
};

/* ──────────────────────────────────────────────────────────
   NOTIFICATIONS
────────────────────────────────────────────────────────── */
const Notify = {
  _stack: null,
  init() { this._stack = U.$('#notif-stack'); },
  show(msg, type = 'info', ms = 3400, icon = '') {
    if (!this._stack) return;
    const icons = { info: '✦', success: '✓', warning: '⚠', error: '✕' };
    const el = document.createElement('div');
    el.className = `notif-item ${type}`;
    el.innerHTML = `<span class="notif-icon">${icon || icons[type]}</span><span class="notif-msg">${msg}</span>`;
    this._stack.appendChild(el);
    setTimeout(() => { el.classList.add('exit'); setTimeout(() => el.remove(), 350); }, ms);
  },
  success: (m, i) => Notify.show(m, 'success', 3200, i),
  warn:    (m, i) => Notify.show(m, 'warning', 4000, i),
  error:   (m, i) => Notify.show(m, 'error',   4000, i),
  info:    (m, i) => Notify.show(m, 'info',     3000, i),
};

/* ──────────────────────────────────────────────────────────
   CONFETTI
────────────────────────────────────────────────────────── */
const Confetti = {
  canvas: null, ctx: null, pieces: [], running: false,
  init() { this.canvas = U.$('#c-confetti'); if (this.canvas) this.ctx = this.canvas.getContext('2d'); },
  burst(n = 70) {
    if (!this.ctx) return;
    this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight;
    const cols = ['#00e5ff','#7c83fd','#4dff91','#ffe76e','#ff4da6','#ff6b35','#a855f7'];
    for (let i = 0; i < n; i++) this.pieces.push({
      x: window.innerWidth / 2 + U.rand(-200, 200), y: window.innerHeight * 0.4 + U.rand(-80, 80),
      vx: U.rand(-8, 8), vy: U.rand(-14, -3), r: U.rand(4, 9),
      rot: Math.random() * Math.PI * 2, drot: U.rand(-0.15, 0.15),
      color: U.choice(cols), life: 1, rect: Math.random() > 0.5,
    });
    if (!this.running) { this.running = true; this._frame(); }
  },
  _frame() {
    const { ctx, canvas } = this; if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.pieces = this.pieces.filter(p => {
      p.vy += 0.26; p.x += p.vx; p.y += p.vy; p.rot += p.drot; p.life -= 0.013;
      if (p.life <= 0) return false;
      ctx.save(); ctx.globalAlpha = p.life; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.rect) ctx.fillRect(-p.r / 2, -p.r * 0.6, p.r, p.r * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); return true;
    });
    if (this.pieces.length > 0) requestAnimationFrame(() => this._frame());
    else { this.running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  },
};

/* ──────────────────────────────────────────────────────────
   XP / LEVELLING
────────────────────────────────────────────────────────── */
const XP = {
  THRESHOLDS: [0,100,250,500,900,1400,2100,3000,4200,5800,8000,11000,15000,20000,27000,36000],
  TITLES: ['Stardust','Comet','Asteroid','Meteor','Satellite','Astronaut','Explorer','Pioneer',
           'Navigator','Commander','Voyager','Trailblazer','Sentinel','Guardian','Champion','Cosmic Legend'],
  earn(amount, reason = '') {
    S.rewards.xp = (S.rewards.xp || 0) + amount;
    const old = S.rewards.level || 1;
    S.rewards.level = this._calcLevel(S.rewards.xp);
    Store.set('rewards', S.rewards);
    if (S.rewards.level > old) this._onLevelUp(S.rewards.level);
    Bus.emit('xp-change');
    if (reason && amount >= 10) Notify.info(`+${amount} XP — ${reason}`, '✦');
  },
  _calcLevel(xp) { for (let i = this.THRESHOLDS.length - 1; i >= 0; i--) if (xp >= this.THRESHOLDS[i]) return i + 1; return 1; },
  xpForNext() { const lv = S.rewards.level || 1; return this.THRESHOLDS[lv] || this.THRESHOLDS[this.THRESHOLDS.length - 1]; },
  xpForCur()  { const lv = (S.rewards.level || 1) - 1; return this.THRESHOLDS[lv] || 0; },
  pct() { const c = this.xpForCur(), n = this.xpForNext(); return n === c ? 100 : U.clamp(((S.rewards.xp - c) / (n - c)) * 100, 0, 100); },
  getTitle(lv) { return this.TITLES[Math.min(lv - 1, this.TITLES.length - 1)] || 'Cosmic Being'; },
  _onLevelUp(lv) {
    Confetti.burst(100); Audio.sfx('achieve');
    Notify.success(`Level up! Level ${lv}: ${this.getTitle(lv)}`, '🌟');
    Achievements.showPopup({ icon: '🌟', name: `Level ${lv} Reached!`, desc: this.getTitle(lv) });
  },
  updateSidebarUI() {
    const bar = U.$('#sb-xp-bar'); if (bar) bar.style.width = this.pct() + '%';
    const lbl = U.$('#sb-xp-label'); if (lbl) lbl.textContent = `XP: ${S.rewards.xp || 0}`;
  },
};

/* ──────────────────────────────────────────────────────────
   ACHIEVEMENTS
────────────────────────────────────────────────────────── */
const Achievements = {
  popup: null,
  DEFS: [
    { id: 'first_focus',  icon: '🎯', name: 'First Contact',    desc: 'Complete your first focus session',  xp: 50  },
    { id: 'focus_5',      icon: '🔥', name: 'Ignition',          desc: '5 focus sessions',                  xp: 75  },
    { id: 'focus_25',     icon: '💫', name: 'Hyperdrive',         desc: '25 focus sessions',                 xp: 150 },
    { id: 'focus_100',    icon: '🌌', name: 'Galactic Mind',      desc: '100 focus sessions',                xp: 400 },
    { id: 'streak_3',     icon: '🔥', name: 'On Fire',            desc: '3-day streak',                      xp: 60  },
    { id: 'streak_7',     icon: '⭐', name: 'Week Warrior',       desc: '7-day streak',                      xp: 150 },
    { id: 'streak_30',    icon: '🌟', name: 'Month Master',       desc: '30-day streak',                     xp: 500 },
    { id: 'first_task',   icon: '✅', name: 'Mission Ready',      desc: 'Complete your first task',          xp: 30  },
    { id: 'tasks_10',     icon: '🚀', name: 'Launcher',           desc: 'Complete 10 tasks',                 xp: 80  },
    { id: 'tasks_50',     icon: '⚡', name: 'Powerhouse',         desc: 'Complete 50 tasks',                 xp: 200 },
    { id: 'tasks_200',    icon: '🌠', name: 'Task Titan',          desc: 'Complete 200 tasks',                xp: 600 },
    { id: 'first_habit',  icon: '💧', name: 'New Ritual',         desc: 'Add your first habit',              xp: 30  },
    { id: 'habit_7',      icon: '🎖', name: 'Habit Formed',       desc: 'Any habit: 7-day streak',           xp: 120 },
    { id: 'habit_30',     icon: '🏅', name: 'Deep Groove',        desc: 'Any habit: 30-day streak',          xp: 350 },
    { id: 'first_note',   icon: '📝', name: 'Thought Catcher',    desc: 'Create your first note',            xp: 25  },
    { id: 'notes_10',     icon: '📚', name: 'Archivist',          desc: 'Create 10 notes',                   xp: 80  },
    { id: 'notes_50',     icon: '🗂',  name: 'Librarian',          desc: 'Create 50 notes',                   xp: 200 },
    { id: 'mood_7',       icon: '🌈', name: 'Self Aware',         desc: '7 mood entries',                    xp: 70  },
    { id: 'mood_30',      icon: '🧠', name: 'Mindful',            desc: '30 mood entries',                   xp: 180 },
    { id: 'level_5',      icon: '🌙', name: 'Rising Star',        desc: 'Reach Level 5',                     xp: 0   },
    { id: 'level_10',     icon: '🌟', name: 'Stellar',            desc: 'Reach Level 10',                    xp: 0   },
    { id: 'all_habits',   icon: '🌈', name: 'Perfect Day',        desc: 'Complete all habits in one day',    xp: 200 },
    { id: 'focus_2h',     icon: '⏱',  name: 'Deep Work',          desc: '2 hrs focus in one day',            xp: 100 },
    { id: 'konami',       icon: '👾', name: 'Cheat Code',         desc: 'You found the secret!',             xp: 500 },
    { id: 'night_owl',    icon: '🦉', name: 'Night Owl',          desc: 'Used app after midnight',           xp: 40  },
    { id: 'early_bird',   icon: '🌅', name: 'Early Bird',         desc: 'Used app before 6am',               xp: 40  },
    { id: 'high_energy',  icon: '⚡', name: 'Supercharged',       desc: 'Logged energy 9+',                  xp: 30  },
  ],
  init() { this.popup = U.$('#achievement-popup'); },
  check() {
    const ul = S.rewards.achievements || [];
    const give = id => {
      if (ul.includes(id)) return;
      const def = this.DEFS.find(d => d.id === id); if (!def) return;
      ul.push(id); S.rewards.achievements = ul; Store.set('rewards', S.rewards);
      XP.earn(def.xp); this.showPopup(def); Audio.sfx('achieve'); Confetti.burst(40);
      Bus.emit('achievements-change');
    };
    const st = S.stats;
    if ((st.totalSessions||0) >= 1)   give('first_focus');
    if ((st.totalSessions||0) >= 5)   give('focus_5');
    if ((st.totalSessions||0) >= 25)  give('focus_25');
    if ((st.totalSessions||0) >= 100) give('focus_100');
    if ((st.streak||0) >= 3)  give('streak_3');
    if ((st.streak||0) >= 7)  give('streak_7');
    if ((st.streak||0) >= 30) give('streak_30');
    if (S.tasks.some(t => t.done))                 give('first_task');
    if (S.tasks.filter(t => t.done).length >= 10)  give('tasks_10');
    if (S.tasks.filter(t => t.done).length >= 50)  give('tasks_50');
    if (S.tasks.filter(t => t.done).length >= 200) give('tasks_200');
    if (S.habits.length >= 1)                      give('first_habit');
    if (S.habits.some(h => h.streak >= 7))         give('habit_7');
    if (S.habits.some(h => h.streak >= 30))        give('habit_30');
    if (S.notes.length >= 1)  give('first_note');
    if (S.notes.length >= 10) give('notes_10');
    if (S.notes.length >= 50) give('notes_50');
    if (S.mood.length >= 7)   give('mood_7');
    if (S.mood.length >= 30)  give('mood_30');
    if ((S.rewards.level||1) >= 5)  give('level_5');
    if ((S.rewards.level||1) >= 10) give('level_10');
    if (S.habits.length > 0 && S.habits.every(h => h.completions?.[U.today()])) give('all_habits');
    if ((st.dailyFocus?.[U.today()]||0) >= 120) give('focus_2h');
    if (S.mood.some(m => (m.energy||0) >= 9)) give('high_energy');
    const hr = new Date().getHours();
    if (hr >= 0 && hr < 2) give('night_owl');
    if (hr >= 4 && hr < 6) give('early_bird');
  },
  showPopup(def) {
    if (!this.popup) return;
    this.popup.innerHTML = `
      <div class="ap-icon">${def.icon}</div>
      <div class="ap-body">
        <div class="ap-badge">Achievement Unlocked</div>
        <div class="ap-name">${def.name}</div>
        <div class="ap-desc">${def.desc}</div>
      </div>`;
    this.popup.classList.remove('hidden');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.popup?.classList.add('hidden'), 5000);
  },
  render() {
    const grid = U.$('#achievements-grid'); if (!grid) return;
    const ul = S.rewards.achievements || [];
    grid.innerHTML = this.DEFS.map(d => `
      <div class="ach-card ${ul.includes(d.id) ? 'unlocked' : ''}">
        <div class="ach-icon">${d.icon}</div>
        <div class="ach-name">${d.name}</div>
        <div class="ach-desc">${d.desc}</div>
      </div>`).join('');
  },
};

/* ──────────────────────────────────────────────────────────
   BACKGROUND (stars, nebula, particles)
────────────────────────────────────────────────────────── */
const BG = {
  stars: { ctx: null, pts: [], t: 0 },
  particles: { ctx: null, pts: [] },
  nebula: { ctx: null },

  init() {
    this._initNebula(); this._initStars(); this._initParticles();
    window.addEventListener('resize', () => this.resize());
  },

  _initNebula() {
    const c = U.$('#c-nebula'); if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    this.nebula.ctx = c.getContext('2d'); this._drawNebula();
  },
  _drawNebula() {
    const { ctx } = this.nebula; if (!ctx) return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const palettes = {
      nebula: ['#00e5ff22','#0040ff11','#8000ff11'],
      aurora: ['#00ff8022','#00e5ff11','#40ff0011'],
      pulsar: ['#ff00aa22','#aa00ff11','#ff005511'],
      sol:    ['#ff6b3522','#ffcc0011','#ff330011'],
      void:   ['#8855ff22','#5500ff11','#cc00ff11'],
      titan:  ['#ffcc0022','#ff950011','#ff660011'],
    };
    const theme = document.documentElement.dataset.theme || 'nebula';
    const cols = palettes[theme] || palettes.nebula;
    [[W * 0.3, H * 0.35, 0.44], [W * 0.72, H * 0.6, 0.37], [W * 0.5, H * 0.22, 0.31]].forEach(([x, y, r], i) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * Math.min(W, H));
      g.addColorStop(0, cols[i]); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
  },

  _initStars() {
    const c = U.$('#c-stars'); if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    this.stars.ctx = c.getContext('2d');
    this.stars.pts = Array.from({ length: 260 }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      r: Math.random() * 1.5, o: 0.15 + Math.random() * 0.8,
      sp: 0.3 + Math.random() * 1.4, ph: Math.random() * Math.PI * 2,
      vx: (Math.random() - 0.5) * 0.03, vy: (Math.random() - 0.5) * 0.02,
    }));
    this._animStars();
  },
  _animStars() {
    const { ctx, pts } = this.stars;
    if (!ctx) { requestAnimationFrame(() => this._animStars()); return; }
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this.stars.t += 0.005;
    pts.forEach(s => {
      const op = s.o * (0.4 + 0.6 * Math.sin(this.stars.t * s.sp + s.ph));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,215,255,${op})`; ctx.fill();
      s.x = (s.x + s.vx + W) % W; s.y = (s.y + s.vy + H) % H;
    });
    requestAnimationFrame(() => this._animStars());
  },

  _initParticles() {
    const c = U.$('#c-particles'); if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    this.particles.ctx = c.getContext('2d');
    this.particles.pts = Array.from({ length: 28 }, () => this._newParticle());
    this._animParticles();
  },
  _newParticle() {
    return { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
      r: 1 + Math.random() * 2, vx: (Math.random() - 0.5) * 0.3, vy: -0.1 - Math.random() * 0.4,
      o: 0.1 + Math.random() * 0.3, life: 0, maxLife: 200 + Math.random() * 300 };
  },
  _animParticles() {
    const { ctx, pts } = this.particles;
    if (!ctx) { requestAnimationFrame(() => this._animParticles()); return; }
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const rgbs = { nebula:'0,229,255', aurora:'77,255,145', pulsar:'255,77,166', sol:'255,107,53', void:'168,85,247', titan:'255,204,0' };
    const rgb = rgbs[document.documentElement.dataset.theme || 'nebula'] || rgbs.nebula;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]; p.life++; p.x += p.vx; p.y += p.vy;
      if (p.life > p.maxLife || p.y < -10) { pts[i] = this._newParticle(); continue; }
      const fade = Math.sin(Math.PI * p.life / p.maxLife);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${p.o * fade})`; ctx.fill();
    }
    requestAnimationFrame(() => this._animParticles());
  },

  resize() {
    ['#c-nebula','#c-stars','#c-particles','#c-confetti'].forEach(id => {
      const c = U.$(id); if (c) { c.width = window.innerWidth; c.height = window.innerHeight; }
    });
    this._drawNebula();
  },
};

/* ──────────────────────────────────────────────────────────
   CURSOR
────────────────────────────────────────────────────────── */
const Cursor = {
  dot: null, ring: null, mx: 0, my: 0, cx: 0, cy: 0, rx: 0, ry: 0, last: 0,
  init() {
    this.dot  = U.$('#cursor-dot');
    this.ring = U.$('#cursor-ring');
    document.addEventListener('mousemove', e => { this.mx = e.clientX; this.my = e.clientY; this._trail(); });
    document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
    document.addEventListener('mouseup',   () => document.body.classList.remove('cursor-click'));
    document.addEventListener('mouseover', e => {
      document.body.classList.toggle('cursor-hover', e.target.matches('button,a,input,select,textarea,[contenteditable]'));
    });
    this._tick();
  },
  _trail() {
    const now = Date.now(); if (now - this.last < 45) return; this.last = now;
    const wrap = U.$('#cursor-trail-container'); if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'cursor-trail';
    el.style.cssText = `left:${this.mx}px;top:${this.my}px;width:4px;height:4px;opacity:.5;`;
    wrap.appendChild(el); setTimeout(() => el.remove(), 600);
  },
  _tick() {
    this.cx += (this.mx - this.cx) * 0.14; this.cy += (this.my - this.cy) * 0.14;
    this.rx += (this.mx - this.rx) * 0.09; this.ry += (this.my - this.ry) * 0.09;
    if (this.dot)  { this.dot.style.left  = this.cx + 'px'; this.dot.style.top  = this.cy + 'px'; }
    if (this.ring) { this.ring.style.left = this.rx + 'px'; this.ring.style.top = this.ry + 'px'; }
    requestAnimationFrame(() => this._tick());
  },
};

/* ──────────────────────────────────────────────────────────
   SPLASH — guaranteed to exit, never gets stuck
────────────────────────────────────────────────────────── */
const Splash = {
  _done: false,
  _raf:  null,
  _angle: 0,

  init() {
    const cvs = U.$('#splash-canvas');
    if (cvs) { cvs.width = 300; cvs.height = 300; this._drawOrb(cvs); }
    // Hard guarantee: exit after 2.8 s no matter what
    setTimeout(() => this.exit(), 2800);
  },

  _drawOrb(cvs) {
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height, cx = W / 2, cy = H / 2;
    const draw = () => {
      if (this._done) return;
      this._angle += 0.022;
      ctx.clearRect(0, 0, W, H);
      // Outer glow rings
      for (let i = 0; i < 3; i++) {
        const rr = 82 + i * 20;
        const gg = ctx.createRadialGradient(cx, cy, rr * 0.5, cx, cy, rr);
        gg.addColorStop(0, `rgba(0,229,255,${(0.12 - i * 0.04) * (0.7 + 0.3 * Math.sin(this._angle * 2))})`);
        gg.addColorStop(1, 'transparent');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
      }
      // Core gradient orb
      const grad = ctx.createRadialGradient(cx - 18, cy - 18, 5, cx, cy, 68);
      grad.addColorStop(0, '#00e5ff'); grad.addColorStop(0.5, '#5a4fcf'); grad.addColorStop(1, '#0a0a20');
      ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
      // Orbiting particles
      for (let i = 0; i < 8; i++) {
        const a = this._angle + (i / 8) * Math.PI * 2;
        const dist = 88 + Math.sin(this._angle * 3 + i) * 7;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, 2.5 + Math.sin(this._angle * 2 + i), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,229,255,${0.55 + 0.45 * Math.sin(this._angle + i)})`; ctx.fill();
      }
      this._raf = requestAnimationFrame(draw);
    };
    draw();
  },

  exit() {
    if (this._done) return;
    this._done = true;
    cancelAnimationFrame(this._raf);
    const splash = U.$('#splash'); if (!splash) return;
    splash.classList.add('exit');
    setTimeout(() => {
      splash.style.display = 'none';
      const app = U.$('#app');
      if (app) app.classList.remove('hidden');
      setTimeout(() => {
        const hr = new Date().getHours();
        const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
        Notify.info(`${greet}! Welcome to VORTEX II. Press Ctrl+K for commands.`, '◈');
      }, 500);
    }, 650);
  },
};

/* ──────────────────────────────────────────────────────────
   PRECISE TIMER
────────────────────────────────────────────────────────── */
const Timer = {
  CIRC:     2 * Math.PI * 140,  // outer ring circumference ≈ 879.6
  CIRC_LAP: 2 * Math.PI * 120,  // inner lap ring ≈ 753.9

  init() { this._bindUI(); this._render(); this._updateMiniStats(); this._startClock(); },

  _bindUI() {
    U.$('#tbtn-start').onclick = () => { Audio.init(); this.toggle(); };
    U.$('#tbtn-reset').onclick = () => { Audio.init(); this.reset(); };
    U.$('#tbtn-lap').onclick   = () => { Audio.init(); this.lap(); };
    U.$('#tbtn-skip').onclick  = () => { Audio.init(); this.skip(); };

    U.$$('.tmode').forEach(btn => btn.onclick = () => {
      U.$$('.tmode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode, mins = parseInt(btn.dataset.mins);
      if (mode === 'custom') { U.$('#custom-wrap').classList.toggle('hidden'); return; }
      U.$('#custom-wrap').classList.add('hidden');
      this.setMode(mode, mins); Audio.sfx('nav');
    });
    U.$('#custom-set').onclick = () => {
      const v = parseInt(U.$('#custom-mins').value);
      if (v > 0 && v <= 240) { this.setMode('custom', v); U.$('#custom-wrap').classList.add('hidden'); Audio.sfx('click'); }
    };
    U.$('#custom-mins')?.addEventListener('keydown', e => { if (e.key === 'Enter') U.$('#custom-set').click(); });
    U.$('#timer-task-input').oninput = e => {
      S.timer.task = e.target.value;
      const td = U.$('#t-task-display'); if (td) td.textContent = e.target.value;
    };
    U.$$('.amb-btn').forEach(b => b.onclick = () => {
      Audio.init(); U.$$('.amb-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
      Audio.playAmbient(b.dataset.snd);
    });
    const volEl = U.$('#amb-vol');
    if (volEl) {
      volEl.value = S.settings.ambientVol;
      volEl.oninput = e => {
        const v = parseInt(e.target.value); S.settings.ambientVol = v;
        const vp = U.$('#vol-pct'); if (vp) vp.textContent = v + '%';
        Audio.setAmbVol(v); Store.set('settings', S.settings);
      };
    }
    const vp = U.$('#vol-pct'); if (vp) vp.textContent = S.settings.ambientVol + '%';
  },

  setMode(mode, mins) {
    this.reset(true);
    S.timer.mode = mode; S.timer.totalSecs = mins * 60; S.timer.remaining = mins * 60;
    const labels = { focus: 'FOCUS', shortbreak: 'SHORT BREAK', longbreak: 'LONG BREAK', custom: 'CUSTOM' };
    const chip = U.$('#t-mode-chip'); if (chip) chip.textContent = labels[mode] || 'FOCUS';
    this._render();
  },

  toggle() { S.timer.running ? this.pause() : this.start(); },

  start() {
    Audio.resume();
    if (S.timer.remaining <= 0) S.timer.remaining = S.timer.totalSecs;
    S.timer.startTs  = performance.now() - (S.timer.totalSecs - S.timer.remaining) * 1000;
    S.timer.lapStart = performance.now();
    S.timer.running  = true;
    const btn = U.$('#tbtn-start'); if (btn) { btn.innerHTML = '⏸'; btn.classList.add('paused'); }
    U.$('.timer-card')?.classList.add('timer-pulsing');
    Audio.sfx('start'); this._tick();
  },

  pause() {
    S.timer.running = false; cancelAnimationFrame(S.timer.rafId);
    const btn = U.$('#tbtn-start'); if (btn) { btn.innerHTML = '▶'; btn.classList.remove('paused'); }
    U.$('.timer-card')?.classList.remove('timer-pulsing');
    Audio.sfx('pause');
  },

  reset(silent = false) {
    S.timer.running = false; cancelAnimationFrame(S.timer.rafId);
    S.timer.remaining = S.timer.totalSecs; S.timer.laps = [];
    const btn = U.$('#tbtn-start'); if (btn) { btn.innerHTML = '▶'; btn.classList.remove('paused'); }
    U.$('.timer-card')?.classList.remove('timer-pulsing');
    this._render(); this._renderLaps(); if (!silent) Audio.sfx('click');
  },

  skip() { this.pause(); this._complete(); },

  lap() {
    if (!S.timer.running) return;
    const elapsed = (performance.now() - S.timer.lapStart) / 1000;
    S.timer.laps.push(elapsed); S.timer.lapStart = performance.now();
    this._renderLaps(); Audio.sfx('lap');
    Notify.info(`Lap ${S.timer.laps.length}: ${U.fmt(Math.round(elapsed))}`, '◷');
  },

  _renderLaps() {
    const el = U.$('#laps-list'); if (!el) return;
    if (!S.timer.laps.length) { el.innerHTML = '<div class="laps-empty">No laps recorded</div>'; return; }
    el.innerHTML = S.timer.laps.map((l, i) =>
      `<div class="lap-item"><span class="lap-num">LAP ${i + 1}</span><span>${U.fmt(Math.round(l))}</span></div>`
    ).join('');
    el.scrollTop = el.scrollHeight;
  },

  _tick() {
    if (!S.timer.running) return;
    S.timer.remaining = Math.max(0, S.timer.totalSecs - (performance.now() - S.timer.startTs) / 1000);
    this._render();
    if (S.timer.remaining <= 0) { this._complete(); return; }
    S.timer.rafId = requestAnimationFrame(() => this._tick());
  },

  _render() {
    const rem = S.timer.remaining, total = S.timer.totalSecs;
    const d = U.$('#t-digits'); if (d) d.textContent = U.fmt(Math.ceil(rem));
    const ms = U.$('#t-ms');   if (ms) ms.textContent = '.' + U.pad((rem % 1) * 100);
    const ratio = total > 0 ? (total - rem) / total : 0;
    const off = this.CIRC * (1 - ratio);
    const ring = U.$('#ring-main'); if (ring) ring.style.strokeDashoffset = off;
    const glow = U.$('#ring-glow'); if (glow) glow.style.strokeDashoffset = off;
    const lapEl = S.timer.lapStart > 0 ? U.clamp((performance.now() - S.timer.lapStart) / 1000 / (total || 1), 0, 1) : 0;
    const lr = U.$('#ring-lap'); if (lr) lr.style.strokeDashoffset = this.CIRC_LAP * (1 - lapEl);
    this._moveTip(ratio, 140, U.$('#ring-tip'));
    this._moveTip(lapEl, 120, U.$('#ring-lap-tip'));
    document.title = S.timer.running ? `${U.fmt(Math.ceil(rem))} — VORTEX II` : 'VORTEX II';
  },

  _moveTip(ratio, R, el) {
    if (!el) return;
    const rad = (-90 + ratio * 360) * Math.PI / 180;
    el.setAttribute('cx', (160 + R * Math.cos(rad)).toFixed(2));
    el.setAttribute('cy', (160 + R * Math.sin(rad)).toFixed(2));
  },

  _complete() {
    const mins = Math.floor(S.timer.totalSecs / 60);
    S.timer.running = false; cancelAnimationFrame(S.timer.rafId);
    const btn = U.$('#tbtn-start'); if (btn) { btn.innerHTML = '▶'; btn.classList.remove('paused'); }
    U.$('.timer-card')?.classList.remove('timer-pulsing');
    if (S.timer.mode === 'focus') {
      S.stats.totalSessions  = (S.stats.totalSessions  || 0) + 1;
      S.stats.totalFocusMins = (S.stats.totalFocusMins || 0) + mins;
      const td = U.today(); S.stats.dailyFocus = S.stats.dailyFocus || {};
      S.stats.dailyFocus[td] = (S.stats.dailyFocus[td] || 0) + mins;
      this._updateStreak();
      S.timer.session = S.timer.session < 4 ? S.timer.session + 1 : 1;
      const si = U.$('#t-session-info'); if (si) si.textContent = `Session ${S.timer.session} of 4`;
      this._logSession(S.timer.task || 'Focus session', mins);
      Store.set('stats', S.stats);
      XP.earn(mins * 2, `${mins}m focus`);
      Confetti.burst(65); Audio.sfx('done');
      Notify.success(`Focus complete! ${mins} minutes logged 🚀`, '◎');
      Achievements.check(); this._updateMiniStats();
    } else { Audio.sfx('complete'); Notify.info('Break over! Ready to focus?', '☕'); }
    this._render();
  },

  _updateStreak() {
    const last = S.stats.lastDate, now = U.today();
    if (!last) S.stats.streak = 1;
    else if (last !== now) {
      const diff = (new Date(now) - new Date(last)) / 86400000;
      S.stats.streak = diff === 1 ? (S.stats.streak || 0) + 1 : 1;
    }
    S.stats.lastDate = now;
  },

  _logSession(task, mins) {
    const el = U.$('#session-log'); if (!el) return;
    const now = new Date();
    const div = document.createElement('div'); div.className = 'session-log-item';
    div.textContent = `${U.pad(now.getHours())}:${U.pad(now.getMinutes())} — ${task} (${mins}m)`;
    el.prepend(div); while (el.children.length > 12) el.lastChild?.remove();
    const sess = Store.get('timer_sessions', []);
    sess.unshift({ task, mins, ts: Date.now(), date: U.today() });
    if (sess.length > 200) sess.length = 200;
    Store.set('timer_sessions', sess);
  },

  _updateMiniStats() {
    const td = U.today(), sess = Store.get('timer_sessions', []);
    const todayN = sess.filter(s => s.date === td).length;
    const wkMins = Object.entries(S.stats.dailyFocus || {}).filter(([d]) => d >= U.daysAgo(7)).reduce((a, [, v]) => a + v, 0);
    const el = id => U.$(`#${id}`);
    if (el('ms-today'))  el('ms-today').textContent  = todayN;
    if (el('ms-total'))  el('ms-total').textContent  = U.fmtMins(S.stats.totalFocusMins || 0);
    if (el('ms-streak')) el('ms-streak').textContent = (S.stats.streak || 0) + '🔥';
    if (el('ms-week'))   el('ms-week').textContent   = Math.round(wkMins / 60 * 10) / 10 + 'h';
    XP.updateSidebarUI();
  },

  _startClock() {
    const tick = () => {
      const n = new Date();
      const t = U.$('#sb-time'); if (t) t.textContent = `${U.pad(n.getHours())}:${U.pad(n.getMinutes())}:${U.pad(n.getSeconds())}`;
      const d = U.$('#sb-date'); if (d) d.textContent = n.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    };
    tick(); setInterval(tick, 1000);
  },
};

/* ──────────────────────────────────────────────────────────
   TASKS
────────────────────────────────────────────────────────── */
const Tasks = {
  init() {
    U.$('#add-task-btn').onclick = () => this.add();
    U.$('#task-text-input').addEventListener('keydown', e => { if (e.key === 'Enter') this.add(); });
    U.$$('.flt').forEach(b => b.onclick = () => {
      U.$$('.flt').forEach(x => x.classList.remove('active')); b.classList.add('active');
      S.ui.taskFilter = b.dataset.f; this.render(); Audio.sfx('nav');
    });
    U.$('#task-search')?.addEventListener('input', U.debounce(() => this.render(), 220));
    U.$('#task-sort')?.addEventListener('change', e => { S.ui.taskSort = e.target.value; this.render(); });
    U.$('#clear-done-btn').onclick = () => { S.tasks = S.tasks.filter(t => !t.done); Store.set('tasks', S.tasks); this.render(); Notify.info('Completed tasks cleared'); };
    U.delegate(U.$('#tasks-container'), '[data-task-done]', 'click', (_, el) => this.complete(el.dataset.taskDone));
    U.delegate(U.$('#tasks-container'), '[data-task-del]',  'click', (_, el) => this.delete(el.dataset.taskDel));
    this.render(); this._badge();
  },
  add() {
    const inp = U.$('#task-text-input'), text = inp.value.trim();
    if (!text) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); Audio.sfx('error'); return; }
    S.tasks.unshift({ id: U.uid(), text, pri: U.$('#task-pri').value, cat: U.$('#task-cat').value, due: U.$('#task-due-input').value, done: false, created: Date.now() });
    Store.set('tasks', S.tasks); inp.value = ''; const di = U.$('#task-due-input'); if (di) di.value = '';
    this.render(); this._badge(); XP.earn(5); Audio.sfx('click');
    Notify.success(`Mission launched: "${text.slice(0, 40)}"`, '◧'); Achievements.check();
  },
  complete(id) {
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    t.done = !t.done;
    if (t.done) { S.stats.tasksCompleted = (S.stats.tasksCompleted||0)+1; Store.set('stats', S.stats); XP.earn(15,'Task completed'); Confetti.burst(28); Audio.sfx('complete'); Notify.success(`Mission complete! "${t.text.slice(0,35)}"`, '✓'); Achievements.check(); }
    Store.set('tasks', S.tasks); this.render(); this._badge();
  },
  delete(id) { S.tasks = S.tasks.filter(t => t.id !== id); Store.set('tasks', S.tasks); this.render(); this._badge(); Audio.sfx('click'); },
  _badge() {
    const n = S.tasks.filter(t => !t.done).length, nb = U.$('#nb-tasks');
    if (nb) { nb.textContent = n; nb.style.display = n > 0 ? 'flex' : 'none'; }
  },
  _filtered() {
    const f = S.ui.taskFilter, q = (U.$('#task-search')?.value||'').toLowerCase(), td = U.today();
    let list = [...S.tasks];
    if (f === 'active')   list = list.filter(t => !t.done);
    if (f === 'done')     list = list.filter(t =>  t.done);
    if (f === 'critical') list = list.filter(t => t.pri === 'critical');
    if (f === 'today')    list = list.filter(t => t.due === td);
    if (q) list = list.filter(t => t.text.toLowerCase().includes(q));
    const po = { critical:0, high:1, medium:2, low:3 };
    if (S.ui.taskSort === 'date_desc') list.sort((a,b) => b.created - a.created);
    if (S.ui.taskSort === 'date_asc')  list.sort((a,b) => a.created - b.created);
    if (S.ui.taskSort === 'priority')  list.sort((a,b) => po[a.pri] - po[b.pri]);
    if (S.ui.taskSort === 'due')       list.sort((a,b) => { if (!a.due) return 1; if (!b.due) return -1; return a.due.localeCompare(b.due); });
    if (S.ui.taskSort === 'alpha')     list.sort((a,b) => a.text.localeCompare(b.text));
    if (f === 'all') list.sort((a,b) => a.done === b.done ? 0 : a.done ? 1 : -1);
    return list;
  },
  render() {
    const el = U.$('#tasks-container'); if (!el) return;
    const list = this._filtered(), td = U.today();
    const catE = { work:'💼', personal:'🏠', health:'🏃', learn:'📚', creative:'🎨', finance:'💰' };
    if (!list.length) { el.innerHTML = '<div class="task-empty">No missions found. Launch one above! 🚀</div>'; }
    else el.innerHTML = list.map(t => {
      const ov = t.due && t.due < td && !t.done;
      return `<div class="task-item ${t.done?'completed':''}" data-pri="${t.pri}">
        <div class="task-priority-bar"></div>
        <button class="task-cb-wrap" data-task-done="${t.id}"><div class="task-cb ${t.done?'done':''}"></div></button>
        <div class="task-body">
          <div class="task-text">${t.text}</div>
          <div class="task-badges">
            <span class="task-badge">${catE[t.cat]||''} ${t.cat}</span>
            <span class="task-badge">${t.pri}</span>
            ${t.due ? `<span class="task-badge task-badge-due ${ov?'overdue':''}">${ov?'⚠ Overdue: ':'📅 '}${t.due}</span>` : ''}
          </div>
        </div>
        <div class="task-actions"><button class="task-action-btn task-del-btn" data-task-del="${t.id}">✕</button></div>
      </div>`;
    }).join('');
    const total = S.tasks.length, done = S.tasks.filter(t => t.done).length, active = total - done;
    const ce = U.$('#tf-counts'); if (ce) ce.textContent = `${active} mission${active!==1?'s':''} active`;
    const bar = U.$('#tf-progress-bar'); if (bar) bar.style.width = (total > 0 ? done/total*100 : 0) + '%';
    const pct = U.$('#tf-pct'); if (pct) pct.textContent = (total > 0 ? Math.round(done/total*100) : 0) + '%';
  },
};

/* ──────────────────────────────────────────────────────────
   HABITS
────────────────────────────────────────────────────────── */
const Habits = {
  COLS: { cyan:'#00e5ff', orange:'#ff6b35', pink:'#ff4da6', lime:'#4dff91', amber:'#ffcc00', violet:'#a855f7' },
  FREQLBL: { daily:'Daily', weekdays:'Weekdays', weekends:'Weekends', mwf:'Mon/Wed/Fri', tth:'Tue/Thu' },
  init() {
    U.$('#add-habit-btn').onclick = () => this.add();
    U.$('#habit-name-in').addEventListener('keydown', e => { if (e.key === 'Enter') this.add(); });
    U.delegate(U.$('#habits-list'), '[data-habit-check]', 'click', (_, el) => this.toggle(el.dataset.habitCheck));
    U.delegate(U.$('#habits-list'), '[data-habit-del]',   'click', (_, el) => this.delete(el.dataset.habitDel));
    this.render(); this._renderWeek(); this._renderConst(); this._badge();
  },
  add() {
    const ni = U.$('#habit-name-in'), name = ni.value.trim();
    if (!name) { ni.classList.add('shake'); setTimeout(() => ni.classList.remove('shake'), 400); Audio.sfx('error'); return; }
    S.habits.push({ id:U.uid(), name, icon:U.$('#habit-icon-in').value, freq:U.$('#habit-freq-in').value, color:U.$('#habit-color-in').value, goal:U.$('#habit-goal-in')?.value||'', streak:0, best:0, completions:{}, created:U.today() });
    Store.set('habits', S.habits); ni.value = ''; const gi = U.$('#habit-goal-in'); if (gi) gi.value = '';
    this.render(); this._renderWeek(); this._renderConst(); this._badge();
    XP.earn(10,'Habit created'); Audio.sfx('click'); Notify.success(`Habit added!`, '◈'); Achievements.check();
  },
  toggle(id) {
    const h = S.habits.find(x => x.id === id); if (!h) return;
    const td = U.today();
    if (h.completions[td]) { delete h.completions[td]; h.streak = Math.max(0, h.streak - 1); }
    else { h.completions[td]=true; h.streak++; if (h.streak > h.best) h.best=h.streak; S.stats.habitsChecked=(S.stats.habitsChecked||0)+1; Store.set('stats',S.stats); XP.earn(8,'Habit checked'); Confetti.burst(18); Audio.sfx('complete'); Notify.success(`${h.icon} ${h.name} done!`,'◈'); Achievements.check(); }
    Store.set('habits', S.habits); this.render(); this._renderWeek(); this._renderConst(); this._badge();
  },
  delete(id) { S.habits=S.habits.filter(h=>h.id!==id); Store.set('habits',S.habits); this.render(); this._renderWeek(); this._renderConst(); this._badge(); Audio.sfx('click'); },
  _badge() {
    const td=U.today(), done=S.habits.filter(h=>h.completions?.[td]).length, nb=U.$('#nb-habits');
    if (nb) { nb.textContent=`${done}/${S.habits.length}`; nb.style.display=S.habits.length>0?'flex':'none'; }
  },
  render() {
    const el=U.$('#habits-list'); if (!el) return;
    const td=U.today();
    if (!S.habits.length) { el.innerHTML='<div style="color:var(--tx-faint);font-family:var(--font-mono);font-size:.78rem;padding:20px;text-align:center">Add a habit above to begin.</div>'; this._renderSummary(); return; }
    el.innerHTML=S.habits.map(h=>{
      const done=!!h.completions?.[td], col=this.COLS[h.color]||'#00e5ff', pct=Math.min((h.streak||0)*3.33,100);
      return `<div class="habit-card" data-color="${h.color}">
        <button class="habit-check ${done?'done':''}" data-habit-check="${h.id}">${!done?`<span style="font-size:1.1rem">${h.icon}</span>`:''}</button>
        <div class="habit-info">
          <div class="habit-name">${h.icon} ${h.name}</div>
          <div class="habit-freq">${this.FREQLBL[h.freq]||h.freq}</div>
          ${h.goal?`<div class="habit-goal">"${h.goal}"</div>`:''}
          <div class="habit-streak-row">
            <div class="habit-streak-bar"><div class="habit-streak-fill" style="width:${pct}%;background:${col}"></div></div>
            <div class="habit-streak-num">${h.streak}🔥 best:${h.best}</div>
          </div>
        </div>
        <button class="habit-del-btn" data-habit-del="${h.id}">✕</button>
      </div>`;
    }).join('');
    this._renderSummary();
  },
  _renderSummary() {
    const el=U.$('#habit-summary'); if (!el) return;
    const td=U.today(), done=S.habits.filter(h=>h.completions?.[td]).length;
    const pct=S.habits.length?Math.round(done/S.habits.length*100):0;
    const best=S.habits.reduce((a,h)=>Math.max(a,h.streak||0),0);
    el.innerHTML=`<b>${done}/${S.habits.length}</b> done today (${pct}%) · Top streak: <b>${best} days 🔥</b>`;
  },
  _renderWeek() {
    const el=U.$('#habit-week-grid'); if (!el) return;
    if (!S.habits.length) { el.innerHTML=''; return; }
    const now=new Date(), dow=now.getDay()===0?6:now.getDay()-1;
    const days=Array.from({length:7},(_,i)=>{ const d=new Date(now); d.setDate(now.getDate()-dow+i); return d.toISOString().slice(0,10); });
    const lbls=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let html=`<div class="hwg-header"><span></span>${lbls.map(l=>`<span class="hwg-day">${l}</span>`).join('')}</div>`;
    S.habits.forEach(h=>{
      html+=`<div class="hwg-row"><span class="hwg-icon">${h.icon}</span>${days.map(d=>{
        const future=d>U.today(), done=!!h.completions?.[d];
        return `<div class="hwg-cell ${done?'done':''} ${future?'future':''}" data-color="${h.color}" title="${d}"></div>`;
      }).join('')}</div>`;
    });
    el.innerHTML=html;
  },
  _renderConst() {
    const cvs=U.$('#constellation-cvs'); if (!cvs) return;
    const ctx=cvs.getContext('2d'), W=cvs.width, H=cvs.height;
    ctx.clearRect(0,0,W,H);
    const pts=[];
    S.habits.forEach(h=>Object.keys(h.completions||{}).forEach(d=>{ if(h.completions[d]) pts.push({x:20+Math.random()*(W-40),y:20+Math.random()*(H-40),r:1.5+Math.random()*3,color:this.COLS[h.color]||'#00e5ff'}); }));
    for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) { const dx=pts[j].x-pts[i].x,dy=pts[j].y-pts[i].y,dist=Math.sqrt(dx*dx+dy*dy); if(dist<70){ ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(100,120,255,${0.18-dist/600})`;ctx.lineWidth=0.7;ctx.stroke(); } }
    pts.forEach(p=>{ const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*2.5); g.addColorStop(0,p.color+'dd'); g.addColorStop(1,p.color+'00'); ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill(); });
    if (!pts.length) { ctx.fillStyle='rgba(90,90,138,.5)';ctx.font='11px JetBrains Mono,monospace';ctx.textAlign='center';ctx.fillText('Complete habits to grow your constellation',W/2,H/2); }
  },
};

/* ──────────────────────────────────────────────────────────
   NOTES
────────────────────────────────────────────────────────── */
const Notes = {
  init() {
    U.$('#new-note-btn')?.addEventListener('click', () => this.create());
    U.$('#note-empty-new')?.addEventListener('click', () => this.create());
    U.$('#del-note-btn')?.addEventListener('click', () => this.delete());
    U.$('#notes-search-in')?.addEventListener('input', U.debounce(() => this.renderList(), 200));
    U.$$('.note-flt').forEach(b => b.onclick = () => { U.$$('.note-flt').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.ui.noteFilter=b.dataset.f; this.renderList(); });
    U.$$('.ntb').forEach(btn => btn.addEventListener('mousedown', e => { e.preventDefault(); document.execCommand(btn.dataset.cmd, false, btn.dataset.val||null); U.$('#note-body')?.focus(); }));
    U.$('#ntb-link')?.addEventListener('mousedown', e => { e.preventDefault(); const url=prompt('URL:'); if(url) document.execCommand('createLink',false,url); });
    U.$('#ntb-hr')?.addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('insertHTML',false,'<hr/>'); });
    U.$('#ntb-clear')?.addEventListener('mousedown', e => { e.preventDefault(); document.execCommand('removeFormat',false,null); });
    U.$('#note-body')?.addEventListener('input', () => { this._scheduleSave(); this._wordCount(); });
    U.$('#note-title-in')?.addEventListener('input', () => this._scheduleSave());
    U.$('#note-tag-in')?.addEventListener('change', () => this._scheduleSave());
    U.$$('.nc-dot').forEach(d => d.onclick = () => { U.$$('.nc-dot').forEach(x=>x.classList.remove('active')); d.classList.add('active'); this._scheduleSave(); });
    this.renderList(); this._badge();
  },
  create() {
    const note={id:U.uid(),title:'',body:'',tag:'none',color:'default',created:Date.now(),updated:Date.now()};
    S.notes.unshift(note); Store.set('notes',S.notes); S.activeNoteId=note.id;
    S.stats.notesCreated=(S.stats.notesCreated||0)+1; Store.set('stats',S.stats);
    this.renderList(); this.openNote(note.id); this._badge();
    XP.earn(5,'Note created'); Achievements.check(); Audio.sfx('click');
  },
  delete() {
    if (!S.activeNoteId) return;
    S.notes=S.notes.filter(n=>n.id!==S.activeNoteId); S.activeNoteId=null; Store.set('notes',S.notes);
    U.$('#note-editor')?.classList.add('hidden'); U.$('#note-empty')?.classList.remove('hidden');
    this.renderList(); this._badge(); Audio.sfx('click'); Notify.info('Note deleted');
  },
  openNote(id) {
    const note=S.notes.find(n=>n.id===id); if (!note) return;
    S.activeNoteId=id;
    U.$('#note-empty')?.classList.add('hidden'); U.$('#note-editor')?.classList.remove('hidden');
    const ti=U.$('#note-title-in'); if(ti) ti.value=note.title;
    const bd=U.$('#note-body');    if(bd) bd.innerHTML=note.body;
    const tg=U.$('#note-tag-in'); if(tg) tg.value=note.tag||'none';
    U.$$('.nc-dot').forEach(d=>d.classList.toggle('active',d.dataset.c===(note.color||'default')));
    this._wordCount(); this.renderList(); Audio.sfx('nav');
  },
  _scheduleSave() {
    clearTimeout(S.ui.noteSaveTimer);
    const st=U.$('#note-status'); if(st){st.textContent='saving…';st.classList.add('show');}
    S.ui.noteSaveTimer=setTimeout(()=>this._save(),600);
  },
  _save() {
    const id=S.activeNoteId; if (!id) return;
    const note=S.notes.find(n=>n.id===id); if (!note) return;
    note.title=U.$('#note-title-in')?.value||'';
    note.body=U.$('#note-body')?.innerHTML||'';
    note.tag=U.$('#note-tag-in')?.value||'none';
    note.color=U.$$('.nc-dot').find(d=>d.classList.contains('active'))?.dataset.c||'default';
    note.updated=Date.now(); Store.set('notes',S.notes);
    const st=U.$('#note-status'); if(st){st.textContent='saved';setTimeout(()=>st.classList.remove('show'),1500);}
    this.renderList();
  },
  _wordCount() {
    const body=U.$('#note-body'); if (!body) return;
    const text=(body.textContent||'').trim(), words=text?text.split(/\s+/).length:0;
    const wc=U.$('#note-wc'); if(wc) wc.textContent=`${words} words`;
    const rt=U.$('#note-rt'); if(rt) rt.textContent=`~${Math.max(1,Math.round(words/200))} min read`;
  },
  _badge() { const nb=U.$('#nb-notes'); if(nb){nb.textContent=S.notes.length;nb.style.display=S.notes.length>0?'flex':'none';} },
  _filtered() {
    const q=(U.$('#notes-search-in')?.value||'').toLowerCase(), f=S.ui.noteFilter;
    let list=[...S.notes].sort((a,b)=>b.updated-a.updated);
    if (f!=='all') list=list.filter(n=>n.tag===f);
    if (q) list=list.filter(n=>(n.title+' '+n.body.replace(/<[^>]+>/g,'')).toLowerCase().includes(q));
    return list;
  },
  renderList() {
    const el=U.$('#notes-list'); if (!el) return;
    const te={idea:'💡',important:'⚡',todo:'✅',research:'🔬',personal:'🌙',none:''}, list=this._filtered();
    if (!list.length) { el.innerHTML='<div style="color:var(--tx-faint);font-size:.78rem;padding:20px;text-align:center;font-family:var(--font-mono)">No notes found.</div>'; return; }
    el.innerHTML=list.map(n=>{
      const preview=n.body.replace(/<[^>]+>/g,'').slice(0,50)||'Empty note';
      const date=new Date(n.updated).toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return `<div class="note-list-item ${S.activeNoteId===n.id?'active':''}" data-note-id="${n.id}">
        <div class="note-color-stripe ${n.color||'default'}"></div>
        <div class="note-li-title">${n.title||'Untitled Note'}</div>
        <div class="note-li-preview">${preview}</div>
        <div class="note-li-meta"><span>${te[n.tag]||''} ${n.tag&&n.tag!=='none'?n.tag:''}</span><span>${date}</span></div>
      </div>`;
    }).join('');
    U.$$('.note-list-item').forEach(item=>item.onclick=()=>this.openNote(item.dataset.noteId));
  },
};

/* ──────────────────────────────────────────────────────────
   MOOD
────────────────────────────────────────────────────────── */
const Mood = {
  EMOJIS: {5:'🚀',4:'😄',3:'😐',2:'😔',1:'🌧'},
  LABELS: {5:'Phenomenal',4:'Great',3:'Okay',2:'Low',1:'Rough'},
  RESPONSES: {
    5:["Absolutely thriving! Channel that cosmic energy 🚀","Phenomenal — the universe is with you!","Maximum velocity! 🌟"],
    4:["Great vibes! Keep that momentum 😄","Solid energy — steady orbital path.","Good day! Make it count."],
    3:["Steady state. Every step matters 😐","Neutral is fine — keep orbiting.","Stable. You're doing okay."],
    2:["Rough patch? Gravity pushes back. You'll rise 😔","Even stars dim before shining brighter.","Rest if needed. Tomorrow is new."],
    1:["Storm season — it passes 🌧","Even black holes end. Hang in there.","Rest. Recharge. The cosmos waits."],
  },
  init() {
    U.$$('.me-btn').forEach(b=>b.onclick=()=>{ U.$$('.me-btn').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); S.ui.activeMoodEmoji=parseInt(b.dataset.v); Audio.sfx('click'); });
    [['sl-mood','sv-mood'],['sl-energy','sv-energy'],['sl-focus-mood','sv-focus'],['sl-stress','sv-stress']].forEach(([si,vi])=>{
      const sl=U.$(`#${si}`), vl=U.$(`#${vi}`); if(sl&&vl) sl.oninput=()=>vl.textContent=sl.value;
    });
    U.$$('.mt-tag').forEach(t=>t.onclick=()=>{ t.classList.toggle('active'); const tag=t.dataset.t; S.ui.selectedMoodTags.includes(tag)?S.ui.selectedMoodTags=S.ui.selectedMoodTags.filter(x=>x!==tag):S.ui.selectedMoodTags.push(tag); });
    U.$('#log-mood-btn').onclick=()=>this.log();
    U.$$('.ct-tab').forEach(t=>t.onclick=()=>{ U.$$('.ct-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); S.ui.activeMoodChart=t.dataset.ct; this.renderChart(); });
    this.renderChart(); this.renderHistory(); this.renderInsights();
  },
  log() {
    if (S.ui.activeMoodEmoji===null) { Notify.warn('Select a mood first!','◕'); Audio.sfx('error'); return; }
    const entry={ id:U.uid(), mood:S.ui.activeMoodEmoji, slMood:parseInt(U.$('#sl-mood')?.value||5), energy:parseInt(U.$('#sl-energy')?.value||5), focus:parseInt(U.$('#sl-focus-mood')?.value||5), stress:parseInt(U.$('#sl-stress')?.value||5), note:U.$('#mood-note')?.value||'', tags:[...S.ui.selectedMoodTags], ts:Date.now(), date:U.today() };
    S.mood.unshift(entry); if(S.mood.length>500) S.mood.length=500; Store.set('mood',S.mood);
    S.stats.moodLogs=(S.stats.moodLogs||0)+1; Store.set('stats',S.stats);
    XP.earn(10,'Mood logged'); Achievements.check(); Audio.sfx('complete');
    const fb=U.$('#mood-response'); if(fb){fb.textContent=U.choice(this.RESPONSES[entry.mood]||this.RESPONSES[3]);fb.classList.remove('hidden');setTimeout(()=>fb.classList.add('hidden'),5000);}
    U.$$('.me-btn').forEach(x=>x.classList.remove('selected')); S.ui.activeMoodEmoji=null;
    U.$$('.mt-tag').forEach(t=>t.classList.remove('active')); S.ui.selectedMoodTags=[];
    const mn=U.$('#mood-note'); if(mn) mn.value='';
    this.renderChart(); this.renderHistory(); this.renderInsights();
    Notify.success(`Mood: ${this.LABELS[entry.mood]} · Energy ${entry.energy}/10`,this.EMOJIS[entry.mood]);
  },
  renderChart() {
    const mode=S.ui.activeMoodChart, c30=U.$('#mood-main-chart'), cRad=U.$('#mood-radar-chart');
    if (!c30||!cRad) return;
    if (mode==='radar') { c30.classList.add('hidden'); cRad.classList.remove('hidden'); this._drawRadar(cRad); }
    else { c30.classList.remove('hidden'); cRad.classList.add('hidden'); this._drawLine(c30,mode==='90d'?90:30); }
  },
  _drawLine(cvs,days) {
    const W=cvs.width=cvs.offsetWidth||600, H=220; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const px=30,py=18,pb=28,w=W-px*2,h=H-py-pb, step=w/(days-1);
    const labels=Array.from({length:days},(_,i)=>U.daysAgo(days-1-i));
    const byDay=new Map(labels.map(d=>[d,S.mood.find(m=>m.date===d)||null]));
    for (let i=1;i<=5;i++) { const y=py+h-((i-1)/4)*h; ctx.beginPath();ctx.moveTo(px,y);ctx.lineTo(W-px,y);ctx.strokeStyle='rgba(100,120,255,.07)';ctx.lineWidth=1;ctx.stroke(); }
    const drawL=(getV,col,lw)=>{ ctx.beginPath();let st=false; labels.forEach((d,i)=>{ const e=byDay.get(d);if(!e){st=false;return;} const x=px+i*step,y=py+h-(getV(e)-1)/4*h; st?ctx.lineTo(x,y):ctx.moveTo(x,y);st=true; }); ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.stroke(); };
    drawL(e=>e.energy/2,'rgba(124,131,253,.28)',1.3);
    drawL(e=>e.mood,'rgba(0,229,255,.9)',2.5);
    labels.forEach((d,i)=>{ const e=byDay.get(d);if(!e)return; const x=px+i*step,y=py+h-(e.mood-1)/4*h; ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle='#00e5ff';ctx.fill();ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill(); });
    ctx.fillStyle='rgba(90,90,138,.6)';ctx.font='9px JetBrains Mono';ctx.textAlign='center';
    const ls=Math.floor(days/5);
    for (let i=0;i<days;i+=ls) { const d=new Date(labels[i]); ctx.fillText(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),px+i*step,H-6); }
  },
  _drawRadar(cvs) {
    const W=cvs.width=cvs.offsetWidth||300,H=300; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    if (!S.mood.length) { ctx.fillStyle='rgba(90,90,138,.5)';ctx.font='11px JetBrains Mono';ctx.textAlign='center';ctx.fillText('Log some moods first!',W/2,H/2);return; }
    const cx=W/2,cy=H/2,R=100, axes=[{lbl:'Mood',key:'slMood'},{lbl:'Energy',key:'energy'},{lbl:'Focus',key:'focus'},{lbl:'Calm',key:'stress',inv:true}], n=axes.length;
    const recent=S.mood.slice(0,7);
    const vals=axes.map(a=>{ let v=recent.reduce((s,e)=>s+(e[a.key]||5),0)/recent.length; if(a.inv)v=11-v; return v/10; });
    [.25,.5,.75,1].forEach(r=>{ ctx.beginPath(); for(let i=0;i<n;i++){const a=-Math.PI/2+i/n*Math.PI*2;i===0?ctx.moveTo(cx+R*r*Math.cos(a),cy+R*r*Math.sin(a)):ctx.lineTo(cx+R*r*Math.cos(a),cy+R*r*Math.sin(a));} ctx.closePath();ctx.strokeStyle='rgba(100,120,255,.12)';ctx.stroke(); });
    ctx.beginPath(); vals.forEach((v,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2; i===0?ctx.moveTo(cx+R*v*Math.cos(a),cy+R*v*Math.sin(a)):ctx.lineTo(cx+R*v*Math.cos(a),cy+R*v*Math.sin(a)); }); ctx.closePath();ctx.fillStyle='rgba(0,229,255,.12)';ctx.fill();ctx.strokeStyle='rgba(0,229,255,.85)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(200,210,255,.75)';ctx.font='12px Outfit,sans-serif';ctx.textAlign='center';
    axes.forEach((ax,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2; ctx.fillText(ax.lbl,cx+(R+18)*Math.cos(a),cy+(R+18)*Math.sin(a)+4); });
  },
  renderInsights() {
    const el=U.$('#mood-insights-row'); if(!el) return;
    if (!S.mood.length) { el.innerHTML=''; return; }
    const avg=key=>(S.mood.reduce((a,e)=>a+(e[key]||5),0)/S.mood.length).toFixed(1);
    const best=S.mood.reduce((a,e)=>Math.max(a,e.mood),0);
    el.innerHTML=[{val:`${this.EMOJIS[Math.round(avg('mood'))]} ${avg('mood')}`,lbl:'Avg Mood'},{val:`⚡ ${avg('energy')}`,lbl:'Avg Energy'},{val:`🎯 ${avg('focus')}`,lbl:'Avg Focus'},{val:S.mood.length,lbl:'Check-ins'},{val:this.EMOJIS[best]||'—',lbl:'Best Logged'}]
      .map(i=>`<div class="mood-insight-card"><div class="mi-val">${i.val}</div><div class="mi-lbl">${i.lbl}</div></div>`).join('');
  },
  renderHistory() {
    const el=U.$('#mood-history'); if(!el) return;
    if (!S.mood.length) { el.innerHTML=''; return; }
    el.innerHTML=S.mood.slice(0,15).map(e=>{
      const d=new Date(e.ts);
      return `<div class="mood-history-item"><span class="mhi-emoji">${this.EMOJIS[e.mood]}</span><div class="mhi-info"><div class="mhi-label">${this.LABELS[e.mood]} · Energy ${e.energy}/10</div><div class="mhi-tags">${e.tags?.join(' · ')||'—'}</div><div class="mhi-axes">M:${e.slMood||e.mood} E:${e.energy} F:${e.focus} S:${e.stress}</div></div><div class="mhi-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}</div></div>`;
    }).join('');
  },
};

/* ──────────────────────────────────────────────────────────
   STATS
────────────────────────────────────────────────────────── */
const Stats = {
  render() { this._hero(); this._weeklyFocus(); this._donut(); this._trend(); this._radar(); this._heatmap(); Achievements.render(); },
  _hero() {
    const el=U.$('#stats-hero-row'); if(!el) return;
    const td=U.today();
    el.innerHTML=[
      {icon:'◎',num:S.stats.totalSessions||0,lbl:'Focus Sessions',sub:'All time'},
      {icon:'◧',num:S.tasks.filter(t=>t.done).length,lbl:'Tasks Crushed',sub:'Completed'},
      {icon:'🔥',num:S.stats.streak||0,lbl:'Day Streak',sub:'Current'},
      {icon:'◈',num:`${S.habits.filter(h=>h.completions?.[td]).length}/${S.habits.length}`,lbl:'Habits Today',sub:'Completed'},
      {icon:'📝',num:S.notes.length,lbl:'Notes',sub:'Created'},
      {icon:'✦',num:S.rewards.xp||0,lbl:'Total XP',sub:`Level ${S.rewards.level||1}`},
    ].map(i=>`<div class="stat-hero"><div class="sh-icon">${i.icon}</div><div class="sh-num">${i.num}</div><div class="sh-label">${i.lbl}</div><div class="sh-sub">${i.sub}</div></div>`).join('');
  },
  _weeklyFocus() {
    const cvs=U.$('#chart-weekly-focus'); if(!cvs) return;
    const W=cvs.width=cvs.offsetWidth||380,H=180; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const names=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], now=new Date(), dow=now.getDay()===0?6:now.getDay()-1;
    const data=names.map((_,i)=>{ const d=new Date(now); d.setDate(now.getDate()-dow+i); return (S.stats.dailyFocus?.[d.toISOString().slice(0,10)]||0)/60; });
    const maxV=Math.max(...data,0.5), px=28,py=16,pb=26,w=W-px*2,h=H-py-pb, bw=(w/7)*0.56, sp=w/7;
    names.forEach((day,i)=>{ const bh=Math.max(0,(data[i]/maxV)*h),x=px+i*sp+(sp-bw)/2,y=py+h-bh; const g=ctx.createLinearGradient(0,y,0,py+h); g.addColorStop(0,'rgba(0,229,255,.9)');g.addColorStop(1,'rgba(0,229,255,.1)'); ctx.fillStyle=g; ctx.beginPath(); if(ctx.roundRect)ctx.roundRect(x,y,bw,bh,[3,3,0,0]);else ctx.rect(x,y,bw,bh); ctx.fill(); ctx.fillStyle='rgba(90,90,138,.7)';ctx.font='9px JetBrains Mono';ctx.textAlign='center'; ctx.fillText(day,x+bw/2,H-6); if(data[i]>0.05){ctx.fillStyle='rgba(200,210,255,.8)';ctx.fillText(data[i].toFixed(1)+'h',x+bw/2,y-4);} });
  },
  _donut() {
    const cvs=U.$('#chart-donut'); if(!cvs) return;
    cvs.width=280;cvs.height=180; const W=280,H=180;
    const ctx=cvs.getContext('2d');ctx.clearRect(0,0,W,H);
    const cats=['work','personal','health','learn','creative','finance'], cols=['#00e5ff','#7c83fd','#4dff91','#ffe76e','#ff4da6','#ff6b35'];
    const counts=cats.map(c=>S.tasks.filter(t=>t.cat===c).length), total=counts.reduce((a,b)=>a+b,0);
    const cx=80,cy=H/2,R=55,inner=24;
    if (!total) { ctx.fillStyle='rgba(90,90,138,.4)';ctx.font='11px JetBrains Mono';ctx.textAlign='center';ctx.fillText('No tasks yet',cx,cy+4);return; }
    let ang=-Math.PI/2;
    counts.forEach((c,i)=>{ if(!c)return; const sl=c/total*Math.PI*2; ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,ang,ang+sl);ctx.closePath();ctx.fillStyle=cols[i];ctx.fill();ang+=sl; });
    ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);ctx.fillStyle='#111124';ctx.fill();
    ctx.fillStyle='rgba(200,210,255,.9)';ctx.font='bold 13px JetBrains Mono';ctx.textAlign='center';ctx.fillText(total,cx,cy+5);
    cats.forEach((cat,i)=>{ if(!counts[i])return; const y=22+i*25; ctx.fillStyle=cols[i];ctx.fillRect(150,y-8,9,9); ctx.fillStyle='rgba(200,210,255,.75)';ctx.textAlign='left';ctx.font='9px Outfit';ctx.fillText(`${cat} (${counts[i]})`,165,y); });
  },
  _trend() {
    const cvs=U.$('#chart-trend'); if(!cvs) return;
    const W=cvs.width=cvs.offsetWidth||380,H=180; cvs.height=H;
    const ctx=cvs.getContext('2d');ctx.clearRect(0,0,W,H);
    const days=30,px=30,py=14,pb=26,w=W-px*2,h=H-py-pb;
    const labels=Array.from({length:days},(_,i)=>U.daysAgo(days-1-i));
    const data=labels.map(d=>(S.stats.dailyFocus?.[d]||0)/60), maxV=Math.max(...data,0.5), step=w/(days-1);
    ctx.beginPath(); data.forEach((v,i)=>{ const x=px+i*step,y=py+h-(v/maxV)*h; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }); ctx.lineTo(px+(days-1)*step,py+h);ctx.lineTo(px,py+h);ctx.closePath();
    const gr=ctx.createLinearGradient(0,py,0,py+h); gr.addColorStop(0,'rgba(0,229,255,.22)');gr.addColorStop(1,'rgba(0,229,255,.02)');ctx.fillStyle=gr;ctx.fill();
    ctx.beginPath(); data.forEach((v,i)=>{ const x=px+i*step,y=py+h-(v/maxV)*h; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }); ctx.strokeStyle='rgba(0,229,255,.85)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(90,90,138,.6)';ctx.font='9px JetBrains Mono';ctx.textAlign='center';
    [0,7,14,21,29].forEach(i=>{ const d=new Date(labels[i]); ctx.fillText(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),px+i*step,H-4); });
  },
  _radar() {
    const cvs=U.$('#chart-radar'); if(!cvs) return;
    cvs.width=280;cvs.height=180; const W=280,H=180;
    const ctx=cvs.getContext('2d');ctx.clearRect(0,0,W,H);
    const cx=W/2,cy=H/2,R=68, total=S.tasks.length||1;
    const vals=[S.tasks.filter(t=>t.done).length/total, S.habits.length>0?S.habits.filter(h=>h.streak>0).length/S.habits.length:0, S.mood.length>0?S.mood.slice(0,7).reduce((a,e)=>a+e.mood,0)/Math.min(S.mood.length,7)/5:0, Math.min((S.stats.totalSessions||0)/100,1), Math.min(S.notes.length/20,1)];
    const lbls=['Tasks','Habits','Mood','Focus','Notes'], n=vals.length;
    [.25,.5,.75,1].forEach(r=>{ ctx.beginPath(); for(let i=0;i<n;i++){const a=-Math.PI/2+i/n*Math.PI*2;i===0?ctx.moveTo(cx+R*r*Math.cos(a),cy+R*r*Math.sin(a)):ctx.lineTo(cx+R*r*Math.cos(a),cy+R*r*Math.sin(a));} ctx.closePath();ctx.strokeStyle='rgba(100,120,255,.1)';ctx.stroke(); });
    ctx.beginPath(); vals.forEach((v,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2;i===0?ctx.moveTo(cx+R*v*Math.cos(a),cy+R*v*Math.sin(a)):ctx.lineTo(cx+R*v*Math.cos(a),cy+R*v*Math.sin(a)); }); ctx.closePath();ctx.fillStyle='rgba(0,229,255,.1)';ctx.fill();ctx.strokeStyle='rgba(0,229,255,.8)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(200,210,255,.75)';ctx.font='10px Outfit,sans-serif';ctx.textAlign='center';
    lbls.forEach((l,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2; ctx.fillText(l,cx+(R+14)*Math.cos(a),cy+(R+14)*Math.sin(a)+4); });
  },
  _heatmap() {
    const el=U.$('#heatmap'); if(!el) return;
    el.innerHTML=Array.from({length:90},(_,i)=>{ const d=U.daysAgo(89-i),score=[((S.stats.dailyFocus?.[d]||0)>0),(S.tasks.some(t=>new Date(t.created).toISOString().slice(0,10)===d)),(S.habits.some(h=>h.completions?.[d])),(S.mood.some(m=>m.date===d))].filter(Boolean).length; return `<div class="hm-cell" ${score?`data-lv="${Math.min(score,4)}"`:''}  title="${d}: ${score} activities"></div>`; }).join('');
  },
};

/* ──────────────────────────────────────────────────────────
   REWARDS
────────────────────────────────────────────────────────── */
const Rewards = {
  SHOP:[
    {id:'th_aurora',icon:'🌿',name:'Aurora Theme', desc:'Lush green cosmos',   cost:200,type:'theme', val:'aurora'},
    {id:'th_pulsar',icon:'💜',name:'Pulsar Theme', desc:'Pink cosmic pulse',   cost:250,type:'theme', val:'pulsar'},
    {id:'th_sol',   icon:'☀️',name:'Sol Theme',    desc:'Fiery orange star',   cost:200,type:'theme', val:'sol'   },
    {id:'th_void',  icon:'🔮',name:'Void Theme',   desc:'Deep purple cosmos',  cost:250,type:'theme', val:'void'  },
    {id:'th_titan', icon:'⚡',name:'Titan Theme',  desc:'Electric gold world', cost:300,type:'theme', val:'titan' },
    {id:'av_star',  icon:'⭐',name:'Star Avatar',  desc:'Sparkly avatar',      cost:150,type:'avatar',val:'⭐'   },
    {id:'av_comet', icon:'☄️',name:'Comet Avatar', desc:'Streaking avatar',    cost:200,type:'avatar',val:'☄️'   },
    {id:'av_planet',icon:'🪐',name:'Planet Avatar',desc:'Ringed world',        cost:250,type:'avatar',val:'🪐'   },
  ],
  MILESTONES:[
    {icon:'🎯',name:'First Orbit',   desc:'10 sessions',       target:10,  key:'totalSessions'},
    {icon:'🌙',name:'Night Shift',   desc:'50 sessions',       target:50,  key:'totalSessions'},
    {icon:'🌟',name:'Century',       desc:'100 sessions',      target:100, key:'totalSessions'},
    {icon:'💫',name:'Titan Run',     desc:'1000 focus mins',   target:1000,key:'totalFocusMins'},
    {icon:'🏆',name:'Task Master',   desc:'100 tasks done',    target:100, key:'tasksCompleted'},
    {icon:'📚',name:'Scholar',       desc:'25 notes',          target:25,  key:'notesCreated'},
    {icon:'🧘',name:'Mindful',       desc:'50 mood entries',   target:50,  key:'moodLogs'},
    {icon:'🔥',name:'10-Day Streak', desc:'10-day streak',     target:10,  key:'streak'},
  ],
  init() {
    U.$$('.rt-tab').forEach(t=>t.onclick=()=>{ U.$$('.rt-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active'); U.$$('.rt-panel').forEach(p=>{p.classList.remove('active');p.classList.add('hidden');}); const p=U.$(`#rt-${t.dataset.rt}`);if(p){p.classList.add('active');p.classList.remove('hidden');} S.ui.activeRewardTab=t.dataset.rt; Audio.sfx('nav'); });
    Bus.on('xp-change', () => this._profile());
    this.render();
  },
  render() { this._profile(); this._badges(); this._milestones(); this._shop(); },
  _profile() {
    const lv=S.rewards.level||1, el=id=>U.$(`#${id}`);
    if(el('rp-level'))   el('rp-level').textContent=`Level ${lv}`;
    if(el('rp-name'))    el('rp-name').textContent=XP.getTitle(lv);
    if(el('rp-xp-text'))el('rp-xp-text').textContent=`${S.rewards.xp} / ${XP.xpForNext()} XP`;
    if(el('rp-xp-fill'))el('rp-xp-fill').style.width=XP.pct()+'%';
    if(el('rpm-total-xp'))el('rpm-total-xp').textContent=S.rewards.xp||0;
    if(el('rpm-badges')) el('rpm-badges').textContent=(S.rewards.achievements||[]).length;
    if(el('rpm-streak')) el('rpm-streak').textContent=S.stats.streak||0;
    const av=S.rewards.owned?.find(o=>o.type==='avatar')?.val||'◈';
    if(el('rp-avatar'))  el('rp-avatar').textContent=av;
    XP.updateSidebarUI();
  },
  _badges() {
    const grid=U.$('#badges-grid'); if(!grid) return;
    const ul=S.rewards.achievements||[];
    grid.innerHTML=Achievements.DEFS.map(d=>`<div class="badge-card ${ul.includes(d.id)?'unlocked':'locked'}"><span class="badge-icon">${d.icon}</span><div class="badge-name">${d.name}</div><div class="badge-desc">${d.desc}</div><div class="badge-xp">+${d.xp} XP</div></div>`).join('');
  },
  _milestones() {
    const el=U.$('#milestones-list'); if(!el) return;
    el.innerHTML=this.MILESTONES.map(m=>{ const cur=Math.min(S.stats[m.key]||0,m.target),pct=Math.round(cur/m.target*100); return `<div class="milestone-item ${cur>=m.target?'done':''}"><div class="mi-m-icon">${m.icon}</div><div class="mi-m-info"><div class="mi-m-name">${m.name}</div><div class="mi-m-desc">${m.desc}</div><div class="mi-m-progress"><div class="mi-m-fill" style="width:${pct}%"></div></div><div class="mi-m-pct">${cur} / ${m.target} (${pct}%)</div></div></div>`; }).join('');
  },
  _shop() {
    const grid=U.$('#shop-grid'); if(!grid) return;
    const owned=S.rewards.owned||[];
    grid.innerHTML=this.SHOP.map(item=>{ const isOwned=owned.find(o=>o.id===item.id); return `<div class="shop-item ${isOwned?'owned':''}"><span class="shop-icon">${item.icon}</span><div class="shop-name">${item.name}</div><div class="shop-cost">${item.cost} XP</div>${isOwned?`<span class="shop-btn owned-lbl">Owned ✓</span>`:`<button class="shop-btn" data-shop-id="${item.id}">Buy</button>`}</div>`; }).join('');
    U.$$('[data-shop-id]').forEach(btn=>btn.onclick=()=>this._buy(btn.dataset.shopId));
  },
  _buy(id) {
    const item=this.SHOP.find(x=>x.id===id); if(!item) return;
    if ((S.rewards.xp||0)<item.cost) { Notify.warn(`Need ${item.cost} XP!`,'⚠'); Audio.sfx('error'); return; }
    S.rewards.xp-=item.cost; S.rewards.owned=S.rewards.owned||[]; S.rewards.owned.push({id:item.id,type:item.type,val:item.val}); Store.set('rewards',S.rewards);
    if (item.type==='theme') applyTheme(item.val);
    Confetti.burst(45); Audio.sfx('achieve'); Notify.success(`Unlocked: ${item.name}!`,item.icon); this.render();
  },
};

/* ──────────────────────────────────────────────────────────
   COMMAND PALETTE
────────────────────────────────────────────────────────── */
const Cmd = {
  ACTIONS:[
    {icon:'◎',label:'Focus Timer',  section:'Navigate',action:()=>Nav.go('focus')},
    {icon:'◧',label:'Tasks',        section:'Navigate',action:()=>Nav.go('tasks')},
    {icon:'◈',label:'Habits',       section:'Navigate',action:()=>Nav.go('habits')},
    {icon:'◉',label:'Notes',        section:'Navigate',action:()=>Nav.go('notes')},
    {icon:'◕',label:'Mood',         section:'Navigate',action:()=>Nav.go('mood')},
    {icon:'◆',label:'Stats',        section:'Navigate',action:()=>Nav.go('stats')},
    {icon:'✦',label:'Rewards',      section:'Navigate',action:()=>Nav.go('rewards')},
    {icon:'▶',label:'Start Timer',  section:'Actions', action:()=>{Nav.go('focus');setTimeout(()=>U.$('#tbtn-start')?.click(),100);}},
    {icon:'+',label:'New Note',      section:'Actions', action:()=>{Nav.go('notes');setTimeout(()=>Notes.create(),100);}},
    {icon:'◑',label:'Theme Engine', section:'Settings',action:()=>openModal('theme-modal')},
    {icon:'⬢',label:'Data Vault',   section:'Settings',action:()=>openModal('data-modal')},
    {icon:'≋',label:'Daily Summary',section:'Settings',action:()=>Summary.show()},
    {icon:'♪',label:'Toggle Sound', section:'Settings',action:()=>{S.settings.sound=!S.settings.sound;Store.set('settings',S.settings);Notify.info(`Sound ${S.settings.sound?'on':'off'}`);}},
  ],
  open() { const o=U.$('#cmd-overlay'); o?.classList.remove('hidden'); U.$('#cmd-input')?.focus(); this._search(''); Audio.sfx('nav'); },
  close(){ U.$('#cmd-overlay')?.classList.add('hidden'); },
  init() {
    U.$('#cmd-input')?.addEventListener('input',e=>this._search(e.target.value));
    U.$('#cmd-input')?.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();S.ui.cmdIdx=Math.min(S.ui.cmdIdx+1,S.ui.cmdItems.length-1);this._render();}
      if(e.key==='ArrowUp'){e.preventDefault();S.ui.cmdIdx=Math.max(S.ui.cmdIdx-1,0);this._render();}
      if(e.key==='Enter'){e.preventDefault();this._run();}
      if(e.key==='Escape')this.close();
    });
    U.$('#cmd-overlay')?.addEventListener('click',e=>{if(e.target===U.$('#cmd-overlay'))this.close();});
  },
  _search(q){
    const lo=q.toLowerCase();
    const base=lo?this.ACTIONS.filter(a=>a.label.toLowerCase().includes(lo)):this.ACTIONS;
    const tasks=lo&&lo.length>1?S.tasks.filter(t=>t.text.toLowerCase().includes(lo)).slice(0,4).map(t=>({icon:t.done?'✓':'◧',label:t.text,section:'Tasks',action:()=>Nav.go('tasks')})):[];
    const notes=lo&&lo.length>1?S.notes.filter(n=>(n.title+' '+n.body.replace(/<[^>]+>/g,'')).toLowerCase().includes(lo)).slice(0,3).map(n=>({icon:'◉',label:n.title||'Untitled',section:'Notes',action:()=>{Nav.go('notes');setTimeout(()=>Notes.openNote(n.id),100);}})):[];
    S.ui.cmdItems=[...base,...tasks,...notes]; S.ui.cmdIdx=0; this._render();
  },
  _run() { const item=S.ui.cmdItems[S.ui.cmdIdx]; if(item){item.action();this.close();} },
  _render(){
    const el=U.$('#cmd-results'); if(!el) return;
    if(!S.ui.cmdItems.length){el.innerHTML='<div style="padding:14px;text-align:center;color:var(--tx-faint);font-family:var(--font-mono);font-size:.78rem">No results</div>';return;}
    let html='',lastSec='';
    S.ui.cmdItems.forEach((item,i)=>{
      if(item.section!==lastSec){html+=`<div class="cmd-section-label">${item.section}</div>`;lastSec=item.section;}
      html+=`<div class="cmd-result-item ${i===S.ui.cmdIdx?'focused':''}" data-ci="${i}"><span class="cmd-result-icon">${item.icon}</span><span class="cmd-result-label">${item.label}</span><span class="cmd-result-section">${item.section}</span></div>`;
    });
    el.innerHTML=html;
    U.$$('.cmd-result-item').forEach(item=>{item.onclick=()=>{S.ui.cmdIdx=parseInt(item.dataset.ci);this._run();};item.onmouseover=()=>{S.ui.cmdIdx=parseInt(item.dataset.ci);this._render();};});
  },
};

/* ──────────────────────────────────────────────────────────
   NAVIGATION
────────────────────────────────────────────────────────── */
const Nav = {
  go(panel) {
    U.$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.panel===panel));
    U.$$('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${panel}`));
    S.ui.activePanel=panel; Audio.sfx('nav');
    if (panel==='stats')   Stats.render();
    if (panel==='habits')  Habits._renderConst();
    if (panel==='mood')    { Mood.renderChart(); Mood.renderInsights(); Mood.renderHistory(); }
    if (panel==='rewards') Rewards.render();
  },
  init() { U.$$('.nav-btn').forEach(btn=>btn.onclick=()=>this.go(btn.dataset.panel)); },
};

/* ──────────────────────────────────────────────────────────
   THEME ENGINE
────────────────────────────────────────────────────────── */
const THEMES=[
  {id:'nebula',name:'Nebula', desc:'Default cyan cosmos',  grad:'linear-gradient(135deg,#00e5ff,#0090ff)'},
  {id:'aurora',name:'Aurora', desc:'Green northern lights',grad:'linear-gradient(135deg,#4dff91,#00c896)'},
  {id:'pulsar',name:'Pulsar', desc:'Pink cosmic pulse',    grad:'linear-gradient(135deg,#ff4da6,#cc00ff)'},
  {id:'sol',   name:'Sol',    desc:'Fiery orange star',    grad:'linear-gradient(135deg,#ff6b35,#ffcc00)'},
  {id:'void',  name:'Void',   desc:'Deep violet cosmos',   grad:'linear-gradient(135deg,#a855f7,#6366f1)'},
  {id:'titan', name:'Titan',  desc:'Electric gold world',  grad:'linear-gradient(135deg,#ffcc00,#ff9500)'},
];

function applyTheme(id) {
  document.documentElement.dataset.theme=id; S.settings.theme=id; Store.set('settings',S.settings);
  BG._drawNebula?.();
  U.$$('.theme-option').forEach(o=>o.classList.toggle('active',o.dataset.themeId===id));
}

function initTheme() {
  const grid=U.$('#theme-grid'); if(!grid) return;
  grid.innerHTML=THEMES.map(t=>`<div class="theme-option ${S.settings.theme===t.id?'active':''}" data-theme-id="${t.id}"><div class="theme-preview" style="background:${t.grad}"></div><div class="theme-name">${t.name}</div><div class="theme-desc">${t.desc}</div></div>`).join('');
  U.$$('.theme-option').forEach(opt=>opt.onclick=()=>{applyTheme(opt.dataset.themeId);Audio.sfx('click');Notify.success(`Theme: ${opt.querySelector('.theme-name').textContent}`,'◑');});
  applyTheme(S.settings.theme||'nebula');
}

/* ──────────────────────────────────────────────────────────
   MODALS + SUMMARY
────────────────────────────────────────────────────────── */
function openModal(id)  { U.$(`#${id}`)?.classList.remove('hidden'); }
function closeModal(id) { U.$(`#${id}`)?.classList.add('hidden'); }

function initModals() {
  U.$('#btn-theme')?.addEventListener('click',()=>openModal('theme-modal'));
  U.$('#btn-data')?.addEventListener('click', ()=>openModal('data-modal'));
  U.$('#btn-cmd')?.addEventListener('click',  ()=>Cmd.open());
  U.$('#btn-summary')?.addEventListener('click',()=>Summary.show());
  U.$('#btn-sound')?.addEventListener('click', ()=>{ Audio.init(); S.settings.sound=!S.settings.sound; Store.set('settings',S.settings); Notify.info(`Sound ${S.settings.sound?'enabled':'disabled'}`,'♪'); });
  ['theme-modal','data-modal','summary-modal'].forEach(id=>{ U.$(`#${id}`)?.addEventListener('click',e=>{if(e.target===U.$(`#${id}`))closeModal(id);}); });
  U.$('#theme-modal-close')?.addEventListener('click',()=>closeModal('theme-modal'));
  U.$('#data-modal-close')?.addEventListener('click', ()=>closeModal('data-modal'));
  U.$('#summary-close')?.addEventListener('click',    ()=>closeModal('summary-modal'));
  U.$('#btn-export')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(Store.exportAll(),null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`vortex-backup-${U.today()}.json`; a.click();
    Notify.success('Data exported!','⬇');
  });
  U.$('#import-file-input')?.addEventListener('change',e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader(); reader.onload=ev=>{
      try { Store.importAll(JSON.parse(ev.target.result)); Notify.success('Import successful! Reloading…','⬆'); setTimeout(()=>location.reload(),1800); }
      catch(_){ const st=U.$('#import-status');if(st){st.textContent='✕ Invalid file.';st.className='import-status err';} Notify.error('Import failed.','✕'); }
    }; reader.readAsText(file);
  });
  U.$('#btn-reset-all')?.addEventListener('click',()=>{ if(confirm('Delete ALL data? This cannot be undone!')){ Store.clearAll(); location.reload(); } });
}

const Summary = {
  show() {
    openModal('summary-modal');
    const el=U.$('#summary-content'); if(!el) return;
    const td=U.today(), sess=Store.get('timer_sessions',[]).filter(s=>s.date===td);
    const focusMins=S.stats.dailyFocus?.[td]||0;
    const tasksDone=S.tasks.filter(t=>t.done&&new Date(t.created).toISOString().slice(0,10)===td).length;
    const habitsDone=S.habits.filter(h=>h.completions?.[td]).length;
    const todayMood=S.mood.find(m=>m.date===td);
    el.innerHTML=`
      <div class="summary-section"><div class="summary-sec-title">Today</div>
        <div class="summary-stat-row">
          <div class="summary-stat"><div class="ss-val">${sess.length}</div><div class="ss-lbl">Focus Sessions</div></div>
          <div class="summary-stat"><div class="ss-val">${U.fmtMins(focusMins)}</div><div class="ss-lbl">Focus Time</div></div>
          <div class="summary-stat"><div class="ss-val">${tasksDone}</div><div class="ss-lbl">Tasks Done</div></div>
          <div class="summary-stat"><div class="ss-val">${habitsDone}/${S.habits.length}</div><div class="ss-lbl">Habits</div></div>
        </div>
      </div>
      <div class="summary-section"><div class="summary-sec-title">Mood</div>
        ${todayMood?`<div class="summary-stat-row"><div class="summary-stat"><div class="ss-val">${Mood.EMOJIS[todayMood.mood]} ${Mood.LABELS[todayMood.mood]}</div><div class="ss-lbl">State</div></div><div class="summary-stat"><div class="ss-val">⚡${todayMood.energy}</div><div class="ss-lbl">Energy</div></div><div class="summary-stat"><div class="ss-val">🎯${todayMood.focus}</div><div class="ss-lbl">Focus</div></div></div>`:'<p style="color:var(--tx-faint);font-family:var(--font-mono);font-size:.78rem">No mood logged today.</p>'}
      </div>
      <div class="summary-section"><div class="summary-sec-title">All-Time</div>
        <div class="summary-stat-row">
          <div class="summary-stat"><div class="ss-val">${S.stats.totalSessions||0}</div><div class="ss-lbl">Sessions</div></div>
          <div class="summary-stat"><div class="ss-val">${U.fmtMins(S.stats.totalFocusMins||0)}</div><div class="ss-lbl">Total Focus</div></div>
          <div class="summary-stat"><div class="ss-val">${S.stats.streak||0}🔥</div><div class="ss-lbl">Streak</div></div>
          <div class="summary-stat"><div class="ss-val">Lv${S.rewards.level||1}</div><div class="ss-lbl">Level</div></div>
        </div>
      </div>`;
    Audio.sfx('nav');
  },
};

/* ──────────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS + EASTER EGGS
────────────────────────────────────────────────────────── */
function initKeyboard() {
  const seq=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let kp=0;
  document.addEventListener('keydown', e=>{
    // Konami
    if(e.key===seq[kp]){kp++;if(kp===seq.length){kp=0;onKonami();}}else kp=0;

    const inField=['INPUT','TEXTAREA'].includes(document.activeElement.tagName)||document.activeElement.contentEditable==='true';
    if(e.key==='Escape'){Cmd.close();closeModal('theme-modal');closeModal('data-modal');closeModal('summary-modal');}
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();Cmd.open();}
    if((e.ctrlKey||e.metaKey)&&!inField){
      const pm={'1':'focus','2':'tasks','3':'habits','4':'notes','5':'mood','6':'stats','7':'rewards'};
      if(pm[e.key]){e.preventDefault();Nav.go(pm[e.key]);}
    }
    if(e.code==='Space'&&S.ui.activePanel==='focus'&&!inField){e.preventDefault();U.$('#tbtn-start')?.click();}
    if(e.key==='r'&&S.ui.activePanel==='focus'&&!inField) U.$('#tbtn-reset')?.click();
    if(e.key==='l'&&S.ui.activePanel==='focus'&&!inField) U.$('#tbtn-lap')?.click();
  });

  function onKonami(){
    Confetti.burst(180); Audio.sfx('achieve');
    const ul=S.rewards.achievements||[];
    if(!ul.includes('konami')){ul.push('konami');S.rewards.achievements=ul;Store.set('rewards',S.rewards);XP.earn(500,'Konami Code!');Achievements.showPopup({icon:'👾',name:'Cheat Code',desc:'You found the secret!'});}
    Notify.success('👾 KONAMI CODE! Ultra mode for 8 seconds!','👾');
    document.documentElement.style.setProperty('--theme-accent','#ff4da6');
    document.documentElement.style.setProperty('--tg-stop-a','#ff4da6');
    document.documentElement.style.setProperty('--tg-stop-b','#cc00ff');
    setTimeout(()=>applyTheme(S.settings.theme||'nebula'),8000);
  }
}

/* ──────────────────────────────────────────────────────────
   AUTOSAVE + IDLE
────────────────────────────────────────────────────────── */
function initAutosave() {
  setInterval(()=>{
    Store.set('tasks',S.tasks); Store.set('habits',S.habits); Store.set('notes',S.notes);
    Store.set('mood',S.mood);   Store.set('stats',S.stats);   Store.set('rewards',S.rewards);
  }, 30000);
}

function initIdle() {
  const msgs=['✦ The cosmos awaits your next move…','◎ Your tasks miss you.','🚀 The universe doesn\'t pause.','⭐ Great things take focus.','🌌 Cosmic potential unclaimed.'];
  let idx=0, t;
  const reset=()=>{ clearTimeout(t); t=setTimeout(()=>Notify.info(msgs[idx++%msgs.length]),120000); };
  document.addEventListener('mousemove',reset); document.addEventListener('keydown',reset); reset();
}

/* ──────────────────────────────────────────────────────────
   MAIN — DOMContentLoaded
────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Apply theme immediately (before anything renders)
  document.documentElement.dataset.theme = S.settings.theme || 'nebula';

  // Start background animations (non-blocking)
  BG.init();

  // Init cursor
  Cursor.init();

  // Init notifications
  Notify.init();

  // Init confetti
  Confetti.init();

  // Init achievements system
  Achievements.init();

  // ── SPLASH: start, will auto-exit in ≤2.8s ──
  Splash.init();

  // ── All UI modules ──
  Nav.init();
  Timer.init();
  Tasks.init();
  Habits.init();
  Notes.init();
  Mood.init();
  Rewards.init();
  Cmd.init();
  initTheme();
  initModals();
  initKeyboard();
  initIdle();
  initAutosave();

  // Window resize
  window.addEventListener('resize', () => {
    BG.resize();
    if(S.ui.activePanel==='stats') Stats.render();
    if(S.ui.activePanel==='mood')  Mood.renderChart();
  });

  // Cross-module bus listeners
  Bus.on('xp-change', () => { XP.updateSidebarUI(); if(S.ui.activePanel==='rewards') Rewards._profile(); });
  Bus.on('achievements-change', () => { if(S.ui.activePanel==='stats') Achievements.render(); if(S.ui.activePanel==='rewards') Rewards._badges(); });

  // Run initial achievement check in case user already has progress
  setTimeout(() => Achievements.check(), 800);
});
