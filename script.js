/* ============================================================
   VORTEX — Cosmic Productivity Suite
   script.js
   ============================================================ */

'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  timer: {
    running: false,
    mode: 'focus',
    total: 25 * 60,
    remaining: 25 * 60,
    session: 1,
    interval: null,
    focusTask: '',
  },
  habits: [],
  tasks: [],
  notes: {
    list: [],
    activeId: null,
    saveTimeout: null,
  },
  mood: {
    entries: [],
    selected: null,
    energy: 5,
    tags: [],
  },
  stats: {
    totalSessions: 0,
    totalFocusMinutes: 0,
    lastActiveDate: null,
    streak: 0,
  },
  ambient: {
    ctx: null,
    sound: 'none',
    volume: 0.4,
    oscillators: [],
    nodes: [],
  },
};

// ============================================================
// STORAGE
// ============================================================
const Store = {
  save(key, val) { try { localStorage.setItem('vortex_' + key, JSON.stringify(val)); } catch(e){} },
  load(key, def) { try { const v = localStorage.getItem('vortex_' + key); return v ? JSON.parse(v) : def; } catch(e) { return def; } },
  loadAll() {
    State.habits = Store.load('habits', []);
    State.tasks = Store.load('tasks', []);
    State.notes.list = Store.load('notes', []);
    State.mood.entries = Store.load('mood_entries', []);
    State.stats = Store.load('stats', { totalSessions: 0, totalFocusMinutes: 0, lastActiveDate: null, streak: 0 });
    State.timer.session = Store.load('timer_session', 1);
  },
  saveAll() {
    Store.save('habits', State.habits);
    Store.save('tasks', State.tasks);
    Store.save('notes', State.notes.list);
    Store.save('mood_entries', State.mood.entries);
    Store.save('stats', State.stats);
    Store.save('timer_session', State.timer.session);
  },
};

// ============================================================
// UTILITIES
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const fmtTime = secs => `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
const today = () => new Date().toLocaleDateString('en-CA');
const dayName = d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d];

function toast(msg, icon = '✦', duration = 3000) {
  const el = $('#toast');
  el.classList.remove('hidden', 'fade-out');
  $('#toast-icon').textContent = icon;
  $('#toast-msg').textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, duration);
}

function confetti(count = 80) {
  const canvas = $('#confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const pieces = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    r: 4 + Math.random() * 7,
    dx: (Math.random() - 0.5) * 4,
    dy: 2 + Math.random() * 5,
    color: ['#ff6b35','#7c83fd','#51ffc8','#ffe76e','#ff4d8d','#f7c59f'][Math.floor(Math.random() * 6)],
    rot: Math.random() * Math.PI * 2,
    drot: (Math.random() - 0.5) * 0.2,
  }));
  let frame;
  const loop = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
      p.x += p.dx;
      p.y += p.dy;
      p.rot += p.drot;
      p.dy += 0.08;
    });
    if (pieces.some(p => p.y < canvas.height + 40)) {
      frame = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(frame);
    }
  };
  loop();
}

// ============================================================
// STARFIELD
// ============================================================
function initStarfield() {
  const canvas = $('#starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5,
      o: 0.2 + Math.random() * 0.8,
      s: 0.3 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
    }));
  };
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.005;
    stars.forEach(s => {
      const opacity = s.o * (0.5 + 0.5 * Math.sin(t * s.s + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,200,255,${opacity})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  };
  draw();
}

// ============================================================
// CURSOR
// ============================================================
function initCursor() {
  const glow = $('#cursor-glow');
  let mx = 0, my = 0, cx = 0, cy = 0;
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  const tick = () => {
    cx += (mx - cx) * 0.15;
    cy += (my - cy) * 0.15;
    glow.style.left = cx + 'px';
    glow.style.top = cy + 'px';
    requestAnimationFrame(tick);
  };
  tick();
}

// ============================================================
// CLOCK
// ============================================================
function initClock() {
  const dateEl = $('#sidebar-date');
  const timeEl = $('#sidebar-time');
  const update = () => {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };
  update();
  setInterval(update, 1000);
}

// ============================================================
// NAVIGATION
// ============================================================
function initNav() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach(i => i.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      $(`#panel-${item.dataset.panel}`).classList.add('active');
      if (item.dataset.panel === 'stats') renderStats();
      if (item.dataset.panel === 'habits') renderConstellationCanvas();
      if (item.dataset.panel === 'mood') renderMoodChart();
    });
  });
}

// ============================================================
// SPLASH
// ============================================================
function initSplash() {
  setTimeout(() => {
    $('#splash').classList.add('fade-out');
    setTimeout(() => {
      $('#splash').remove();
      $('#app').classList.remove('hidden');
    }, 800);
  }, 2400);
}

// ============================================================
// FOCUS TIMER
// ============================================================
const MODES = { focus: 25, short: 5, long: 15 };

function initTimer() {
  const display = $('#timer-display');
  const modeLabel = $('#timer-mode-label');
  const sessionNum = $('#session-num');
  const progress = $('#orbit-progress');
  const planet = $('#orbit-planet');
  const circumference = 2 * Math.PI * 120;

  progress.style.strokeDasharray = circumference;

  function updateDisplay() {
    display.textContent = fmtTime(State.timer.remaining);
    sessionNum.textContent = State.timer.session;
    const ratio = 1 - State.timer.remaining / State.timer.total;
    const offset = circumference * (1 - ratio);
    progress.style.strokeDashoffset = offset;
    const angle = -90 + ratio * 360;
    const rad = angle * Math.PI / 180;
    const px = 150 + 120 * Math.cos(rad);
    const py = 150 + 120 * Math.sin(rad);
    planet.setAttribute('cx', px);
    planet.setAttribute('cy', py);
    document.title = State.timer.running ? `${fmtTime(State.timer.remaining)} — VORTEX` : 'VORTEX';
  }

  function setMode(mode, duration) {
    if (State.timer.running) stopTimer();
    State.timer.mode = mode;
    State.timer.total = duration * 60;
    State.timer.remaining = duration * 60;
    modeLabel.textContent = mode === 'focus' ? 'FOCUS' : mode === 'short' ? 'SHORT BREAK' : mode === 'long' ? 'LONG BREAK' : 'CUSTOM';
    updateDisplay();
  }

  function startTimer() {
    if (State.timer.remaining <= 0) {
      State.timer.remaining = State.timer.total;
    }
    State.timer.running = true;
    $('#btn-start').textContent = '⏸ PAUSE';
    $('#timer-core').parentElement.parentElement.classList.add('timer-pulsing');
    State.timer.interval = setInterval(() => {
      State.timer.remaining--;
      updateDisplay();
      if (State.timer.remaining <= 0) {
        finishTimer();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(State.timer.interval);
    State.timer.running = false;
    $('#btn-start').textContent = '▶ START';
    $('#timer-core').parentElement.parentElement.classList.remove('timer-pulsing');
  }

  function finishTimer() {
    stopTimer();
    if (State.timer.mode === 'focus') {
      const mins = Math.floor(State.timer.total / 60);
      State.stats.totalSessions++;
      State.stats.totalFocusMinutes += mins;
      updateStreak();
      const todaySessions = Store.load('today_sessions', { date: today(), count: 0 });
      if (todaySessions.date === today()) {
        todaySessions.count++;
      } else {
        todaySessions.date = today();
        todaySessions.count = 1;
      }
      Store.save('today_sessions', todaySessions);
      State.timer.session = State.timer.session < 4 ? State.timer.session + 1 : 1;
      addSessionLog(State.timer.focusTask || 'Focus session', mins);
      Store.saveAll();
      confetti(60);
      toast(`🎉 Focus complete! +${mins}m logged`, '◎', 4000);
      checkAchievements();
      updateFocusMiniStats();
    } else {
      toast('Break over! Ready to focus?', '☕', 3000);
    }
    updateDisplay();
  }

  function addSessionLog(task, mins) {
    const log = $('#session-log');
    const item = document.createElement('div');
    item.className = 'session-log-item';
    const now = new Date();
    item.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())} — ${task} (${mins}m)`;
    log.prepend(item);
    if (log.children.length > 8) log.lastChild.remove();
  }

  $('#btn-start').addEventListener('click', () => {
    if (State.timer.running) stopTimer(); else startTimer();
  });
  $('#btn-reset').addEventListener('click', () => {
    stopTimer();
    State.timer.remaining = State.timer.total;
    updateDisplay();
  });
  $('#btn-skip').addEventListener('click', () => {
    stopTimer();
    finishTimer();
  });

  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dur = parseInt(btn.dataset.duration);
      if (btn.dataset.mode === 'custom') {
        $('#custom-duration-input').classList.toggle('hidden');
      } else {
        $('#custom-duration-input').classList.add('hidden');
        setMode(btn.dataset.mode, dur);
      }
    });
  });

  $('#set-custom-duration').addEventListener('click', () => {
    const val = parseInt($('#custom-minutes').value);
    if (val > 0 && val <= 120) {
      setMode('custom', val);
      $('#custom-duration-input').classList.add('hidden');
      toast(`Custom timer set: ${val} minutes`, '◎');
    }
  });

  $('#focus-task-input').addEventListener('input', e => {
    State.timer.focusTask = e.target.value;
  });

  $$('.ambient-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.ambient-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playAmbient(btn.dataset.sound);
    });
  });

  $('#ambient-volume').addEventListener('input', e => {
    State.ambient.volume = parseInt(e.target.value) / 100;
    $('#vol-display').textContent = e.target.value + '%';
    if (State.ambient.nodes.gainNode) {
      State.ambient.nodes.gainNode.gain.value = State.ambient.volume;
    }
  });

  updateDisplay();
  updateFocusMiniStats();
}

function updateFocusMiniStats() {
  const todaySessions = Store.load('today_sessions', { date: today(), count: 0 });
  $('#today-sessions').textContent = todaySessions.date === today() ? todaySessions.count : 0;
  const hrs = (State.stats.totalFocusMinutes / 60).toFixed(1);
  $('#total-focus-time').textContent = hrs + 'h';
  $('#streak-display').textContent = State.stats.streak + '🔥';
}

function updateStreak() {
  const last = State.stats.lastActiveDate;
  const now = today();
  if (!last) {
    State.stats.streak = 1;
  } else if (last === now) {
    // already updated today
  } else {
    const lastDate = new Date(last);
    const nowDate = new Date(now);
    const diff = (nowDate - lastDate) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      State.stats.streak++;
    } else if (diff > 1) {
      State.stats.streak = 1;
    }
  }
  State.stats.lastActiveDate = now;
}

// ============================================================
// AMBIENT SOUND (Web Audio API)
// ============================================================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function stopAmbient() {
  const { nodes } = State.ambient;
  if (nodes.source) { try { nodes.source.stop(); } catch(e){} }
  if (nodes.oscillators) { nodes.oscillators.forEach(o => { try { o.stop(); } catch(e){} }); }
  State.ambient.nodes = {};
}

function playAmbient(type) {
  stopAmbient();
  State.ambient.sound = type;
  if (type === 'none') return;
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const gain = ctx.createGain();
  gain.gain.value = State.ambient.volume;
  gain.connect(ctx.destination);
  State.ambient.nodes.gainNode = gain;

  if (type === 'rain') {
    const bufferSize = 4096;
    const node = ctx.createScriptProcessor(bufferSize, 1, 1);
    node.onaudioprocess = e => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * 0.35;
      }
    };
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.5;
    node.connect(filter);
    filter.connect(gain);
    State.ambient.nodes.source = { stop: () => { node.disconnect(); filter.disconnect(); } };
    State.ambient.nodes.oscillators = [];

  } else if (type === 'forest') {
    const oscs = [];
    [220, 330, 440, 528, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * (0.9 + Math.random() * 0.2);
      oscGain.gain.value = 0.04 + Math.random() * 0.02;
      osc.connect(oscGain);
      oscGain.connect(gain);
      osc.start();
      oscs.push(osc);
      setInterval(() => {
        osc.frequency.setTargetAtTime(freq * (0.85 + Math.random() * 0.3), ctx.currentTime, 1 + Math.random() * 2);
      }, 2000 + Math.random() * 3000);
    });
    State.ambient.nodes.oscillators = oscs;
    State.ambient.nodes.source = null;

  } else if (type === 'waves') {
    const bufferSize = 4096;
    let phase = 0;
    const node = ctx.createScriptProcessor(bufferSize, 1, 1);
    node.onaudioprocess = e => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        phase += 0.001;
        const wave = Math.sin(phase * 0.5) * Math.sin(phase * 0.3);
        output[i] = wave * 0.3 + (Math.random() - 0.5) * 0.05;
      }
    };
    node.connect(gain);
    State.ambient.nodes.source = { stop: () => node.disconnect() };
    State.ambient.nodes.oscillators = [];

  } else if (type === 'fire') {
    const bufferSize = 4096;
    const node = ctx.createScriptProcessor(bufferSize, 1, 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    node.onaudioprocess = e => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * (0.1 + Math.random() * 0.2);
      }
    };
    node.connect(filter);
    filter.connect(gain);
    State.ambient.nodes.source = { stop: () => { node.disconnect(); filter.disconnect(); } };
    State.ambient.nodes.oscillators = [];

  } else if (type === 'space') {
    const oscs = [];
    [60, 90, 120, 180].forEach(freq => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      oscGain.gain.value = 0.06;
      osc.connect(oscGain);
      oscGain.connect(gain);
      osc.start();
      oscs.push(osc);
    });
    State.ambient.nodes.oscillators = oscs;
    State.ambient.nodes.source = null;
  }
}

// ============================================================
// HABITS
// ============================================================
function initHabits() {
  $('#add-habit-btn').addEventListener('click', addHabit);
  $('#habit-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addHabit(); });
  renderHabits();
  renderWeeklyGrid();
}

function addHabit() {
  const name = $('#habit-name-input').value.trim();
  if (!name) { $('#habit-name-input').classList.add('shake'); setTimeout(() => $('#habit-name-input').classList.remove('shake'), 400); return; }
  const habit = {
    id: uid(),
    name,
    icon: $('#habit-icon-select').value,
    freq: $('#habit-freq').value,
    streak: 0,
    completions: {},
    createdAt: today(),
  };
  State.habits.push(habit);
  Store.save('habits', State.habits);
  $('#habit-name-input').value = '';
  renderHabits();
  renderWeeklyGrid();
  renderConstellationCanvas();
  toast(`Habit "${name}" added!`, habit.icon);
}

function renderHabits() {
  const list = $('#habits-list');
  list.innerHTML = '';
  if (State.habits.length === 0) {
    list.innerHTML = '<div style="color:var(--text-faint);font-family:var(--font-mono);font-size:0.78rem;padding:20px;text-align:center;">No habits yet. Add one above.</div>';
    return;
  }
  State.habits.forEach(habit => {
    const done = !!habit.completions[today()];
    const div = document.createElement('div');
    div.className = 'habit-item';
    div.innerHTML = `
      <button class="habit-check-btn ${done ? 'checked' : ''}" data-id="${habit.id}">
        ${done ? '✓' : ''}
      </button>
      <span class="habit-icon">${habit.icon}</span>
      <div class="habit-info">
        <div class="habit-name">${habit.name}</div>
        <div class="habit-streak-mini">${habit.streak} day streak</div>
        <div class="habit-streak-bar"><div class="habit-streak-fill" style="width:${Math.min(habit.streak * 5, 100)}%"></div></div>
      </div>
      <button class="habit-delete-btn" data-id="${habit.id}" title="Delete habit">✕</button>
    `;
    div.querySelector('.habit-check-btn').addEventListener('click', () => toggleHabit(habit.id));
    div.querySelector('.habit-delete-btn').addEventListener('click', () => deleteHabit(habit.id));
    list.appendChild(div);
  });
}

function toggleHabit(id) {
  const habit = State.habits.find(h => h.id === id);
  if (!habit) return;
  const t = today();
  if (habit.completions[t]) {
    delete habit.completions[t];
    habit.streak = Math.max(0, habit.streak - 1);
  } else {
    habit.completions[t] = true;
    habit.streak++;
    confetti(30);
    toast(`${habit.icon} ${habit.name} completed!`, '◈');
  }
  Store.save('habits', State.habits);
  renderHabits();
  renderWeeklyGrid();
  renderConstellationCanvas();
  checkAchievements();
}

function deleteHabit(id) {
  State.habits = State.habits.filter(h => h.id !== id);
  Store.save('habits', State.habits);
  renderHabits();
  renderWeeklyGrid();
  renderConstellationCanvas();
}

function renderWeeklyGrid() {
  const body = $('#weekly-grid-body');
  body.innerHTML = '';
  const now = new Date();
  const dow = now.getDay();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - dow + 1 + i);
    return d.toLocaleDateString('en-CA');
  });

  State.habits.forEach(habit => {
    const row = document.createElement('div');
    row.className = 'weekly-row';
    const iconEl = document.createElement('div');
    iconEl.className = 'weekly-row-icon';
    iconEl.textContent = habit.icon;
    row.appendChild(iconEl);
    weekDays.forEach(dateStr => {
      const cell = document.createElement('div');
      const isFuture = dateStr > today();
      cell.className = `weekly-cell ${habit.completions[dateStr] ? 'done' : ''} ${isFuture ? 'future' : ''}`;
      cell.title = dateStr;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function renderConstellationCanvas() {
  const canvas = $('#constellation-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const completions = [];
  State.habits.forEach(habit => {
    Object.keys(habit.completions).forEach(dateStr => {
      if (habit.completions[dateStr]) completions.push(dateStr);
    });
  });

  const stars = completions.map((_, i) => ({
    x: 30 + Math.random() * 340,
    y: 30 + Math.random() * 340,
    r: 2 + Math.random() * 3,
    brightness: 0.5 + Math.random() * 0.5,
  }));

  // Draw connections
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const dx = stars[j].x - stars[i].x;
      const dy = stars[j].y - stars[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80) {
        ctx.beginPath();
        ctx.moveTo(stars[i].x, stars[i].y);
        ctx.lineTo(stars[j].x, stars[j].y);
        ctx.strokeStyle = `rgba(124,131,253,${0.15 - dist / 800})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  // Draw stars
  stars.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2);
    grad.addColorStop(0, `rgba(200,200,255,${s.brightness})`);
    grad.addColorStop(1, 'rgba(100,100,200,0)');
    ctx.fillStyle = grad;
    ctx.fill();
  });

  // Labels
  ctx.fillStyle = 'rgba(120,120,168,0.6)';
  ctx.font = '10px Space Mono, monospace';
  ctx.textAlign = 'center';
  if (stars.length === 0) {
    ctx.fillText('Complete habits to grow your constellation', 200, 200);
  }
}

// ============================================================
// TASKS
// ============================================================
function initTasks() {
  $('#add-task-btn').addEventListener('click', addTask);
  $('#task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTasks();
    });
  });
  $('#task-search').addEventListener('input', renderTasks);
  $('#clear-completed').addEventListener('click', () => {
    State.tasks = State.tasks.filter(t => !t.completed);
    Store.save('tasks', State.tasks);
    renderTasks();
    toast('Completed tasks cleared!', '◧');
  });
  renderTasks();
}

function addTask() {
  const text = $('#task-input').value.trim();
  if (!text) { $('#task-input').classList.add('shake'); setTimeout(() => $('#task-input').classList.remove('shake'), 400); return; }
  const task = {
    id: uid(),
    text,
    priority: $('#task-priority').value,
    category: $('#task-category').value,
    due: $('#task-due').value,
    completed: false,
    createdAt: Date.now(),
  };
  State.tasks.unshift(task);
  Store.save('tasks', State.tasks);
  $('#task-input').value = '';
  $('#task-due').value = '';
  renderTasks();
  toast(`Mission launched: "${text.slice(0, 30)}"`, '◧');
}

function renderTasks() {
  const filter = ($('.filter-btn.active') || {}).dataset?.filter || 'all';
  const search = ($('#task-search').value || '').toLowerCase();
  const list = $('#tasks-list');
  list.innerHTML = '';

  let tasks = [...State.tasks];
  if (filter === 'active') tasks = tasks.filter(t => !t.completed);
  if (filter === 'completed') tasks = tasks.filter(t => t.completed);
  if (filter === 'critical') tasks = tasks.filter(t => t.priority === 'critical');
  if (search) tasks = tasks.filter(t => t.text.toLowerCase().includes(search));

  // Sort: incomplete first, then by priority
  const pOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return pOrder[a.priority] - pOrder[b.priority];
  });

  if (tasks.length === 0) {
    list.innerHTML = `<div style="color:var(--text-faint);font-family:var(--font-mono);font-size:0.82rem;padding:40px;text-align:center;">${filter === 'completed' ? 'No completed missions yet.' : 'No missions found.'}</div>`;
  }

  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = `task-item ${task.completed ? 'completed' : ''}`;
    div.dataset.priority = task.priority;
    const isOverdue = task.due && task.due < today() && !task.completed;
    const catEmoji = { work: '💼', personal: '🏠', health: '🏃', learning: '📚', creative: '🎨' }[task.category] || '';
    const dueStr = task.due ? `📅 ${task.due}` : '';
    div.innerHTML = `
      <div class="task-priority-stripe"></div>
      <button class="task-complete-btn ${task.completed ? 'done' : ''}" data-id="${task.id}"></button>
      <div class="task-info">
        <div class="task-text">${task.text}</div>
        <div class="task-meta">
          <span class="task-badge">${catEmoji} ${task.category}</span>
          <span class="task-badge">${task.priority}</span>
          ${task.due ? `<span class="task-badge task-due-badge ${isOverdue ? 'overdue' : ''}">${dueStr}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-delete-btn" data-id="${task.id}">✕</button>
      </div>
    `;
    div.querySelector('.task-complete-btn').addEventListener('click', () => completeTask(task.id));
    div.querySelector('.task-delete-btn').addEventListener('click', () => deleteTask(task.id));
    list.appendChild(div);
  });

  const total = State.tasks.length;
  const done = State.tasks.filter(t => t.completed).length;
  const remaining = total - done;
  $('#task-count').textContent = `${remaining} mission${remaining !== 1 ? 's' : ''} remaining`;
  const pct = total > 0 ? (done / total) * 100 : 0;
  $('#task-progress-bar').style.width = pct + '%';
}

function completeTask(id) {
  const task = State.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) {
    State.stats.totalFocusMinutes;
    confetti(40);
    toast(`Mission complete: "${task.text.slice(0, 30)}"`, '✓');
    checkAchievements();
  }
  Store.save('tasks', State.tasks);
  Store.save('stats', State.stats);
  renderTasks();
}

function deleteTask(id) {
  State.tasks = State.tasks.filter(t => t.id !== id);
  Store.save('tasks', State.tasks);
  renderTasks();
}

// ============================================================
// NOTES
// ============================================================
function initNotes() {
  $('#new-note-btn').addEventListener('click', createNote);
  $('#notes-search').addEventListener('input', renderNotesList);
  $('#delete-note-btn').addEventListener('click', deleteActiveNote);

  $$('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val;
      document.execCommand(cmd, false, val || null);
      $('#note-body').focus();
    });
  });

  $('#note-body').addEventListener('input', () => {
    saveCurrentNote();
    updateWordCount();
  });

  $('#note-title-input').addEventListener('input', () => saveCurrentNote());

  $('#note-tag-select').addEventListener('change', () => saveCurrentNote());

  $$('.note-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      $$('.note-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      saveCurrentNote();
    });
  });

  renderNotesList();
}

function createNote() {
  const note = {
    id: uid(),
    title: '',
    body: '',
    tag: 'none',
    color: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  State.notes.list.unshift(note);
  Store.save('notes', State.notes.list);
  State.notes.activeId = note.id;
  renderNotesList();
  openNote(note.id);
}

function renderNotesList() {
  const list = $('#notes-list-sidebar');
  list.innerHTML = '';
  const search = ($('#notes-search').value || '').toLowerCase();
  let notes = State.notes.list;
  if (search) notes = notes.filter(n => (n.title + n.body).toLowerCase().includes(search));
  notes.sort((a, b) => b.updatedAt - a.updatedAt);

  if (notes.length === 0) {
    list.innerHTML = '<div style="color:var(--text-faint);font-family:var(--font-mono);font-size:0.72rem;padding:20px;text-align:center;">No notes found.</div>';
    return;
  }

  notes.forEach(note => {
    const div = document.createElement('div');
    div.className = `note-sidebar-item ${State.notes.activeId === note.id ? 'active' : ''}`;
    const preview = note.body.replace(/<[^>]+>/g, '').slice(0, 40);
    const tagEmojis = { idea: '💡', important: '⚡', todo: '✅', research: '🔬', personal: '🌙', none: '' };
    div.innerHTML = `
      <div class="note-color-bar ${note.color || 'default'}"></div>
      <div class="note-sidebar-item-title">${note.title || 'Untitled Note'}</div>
      <div class="note-sidebar-item-preview">${preview || 'Empty note'}</div>
      <div class="note-sidebar-item-tag">${tagEmojis[note.tag] || ''} ${note.tag !== 'none' ? note.tag : ''}</div>
    `;
    div.addEventListener('click', () => {
      State.notes.activeId = note.id;
      renderNotesList();
      openNote(note.id);
    });
    list.appendChild(div);
  });
}

function openNote(id) {
  const note = State.notes.list.find(n => n.id === id);
  if (!note) return;
  $('#note-empty-state').classList.add('hidden');
  $('#note-editor').classList.remove('hidden');
  $('#note-title-input').value = note.title;
  $('#note-body').innerHTML = note.body;
  $('#note-tag-select').value = note.tag;
  $$('.note-color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === note.color);
  });
  updateWordCount();
}

function saveCurrentNote() {
  const id = State.notes.activeId;
  if (!id) return;
  const note = State.notes.list.find(n => n.id === id);
  if (!note) return;
  note.title = $('#note-title-input').value;
  note.body = $('#note-body').innerHTML;
  note.tag = $('#note-tag-select').value;
  note.color = ($('.note-color-dot.active') || { dataset: { color: 'default' } }).dataset.color;
  note.updatedAt = Date.now();

  clearTimeout(State.notes.saveTimeout);
  State.notes.saveTimeout = setTimeout(() => {
    Store.save('notes', State.notes.list);
    renderNotesList();
    const ind = $('#note-saved-indicator');
    ind.classList.add('show');
    setTimeout(() => ind.classList.remove('show'), 1500);
  }, 600);
}

function deleteActiveNote() {
  const id = State.notes.activeId;
  if (!id) return;
  State.notes.list = State.notes.list.filter(n => n.id !== id);
  State.notes.activeId = null;
  Store.save('notes', State.notes.list);
  $('#note-editor').classList.add('hidden');
  $('#note-empty-state').classList.remove('hidden');
  renderNotesList();
  toast('Note deleted', '◉');
}

function updateWordCount() {
  const text = ($('#note-body').textContent || '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('#word-count-btn').textContent = `Words: ${words}`;
}

// ============================================================
// MOOD
// ============================================================
function initMood() {
  $$('.mood-option').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('.mood-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      State.mood.selected = parseInt(opt.dataset.mood);
    });
  });

  const energySlider = $('#energy-slider');
  energySlider.addEventListener('input', e => {
    State.mood.energy = parseInt(e.target.value);
    $('#energy-val').textContent = e.target.value;
  });

  $$('.mood-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      const t = tag.dataset.tag;
      if (State.mood.tags.includes(t)) {
        State.mood.tags = State.mood.tags.filter(x => x !== t);
      } else {
        State.mood.tags.push(t);
      }
    });
  });

  $('#log-mood-btn').addEventListener('click', logMood);
  renderRecentMoods();
  updateMoodInsights();
  renderMoodChart();
}

function logMood() {
  if (State.mood.selected === null) {
    toast('Please select a mood first!', '◕');
    return;
  }
  const moodEmojis = { 5: '🚀', 4: '😄', 3: '😐', 2: '😔', 1: '🌧️' };
  const moodLabels = { 5: 'Phenomenal', 4: 'Great', 3: 'Okay', 2: 'Low', 1: 'Rough' };
  const entry = {
    id: uid(),
    mood: State.mood.selected,
    energy: State.mood.energy,
    note: $('#mood-note-input').value,
    tags: [...State.mood.tags],
    timestamp: Date.now(),
    date: today(),
  };
  State.mood.entries.unshift(entry);
  if (State.mood.entries.length > 300) State.mood.entries.pop();
  Store.save('mood_entries', State.mood.entries);

  const fb = $('#mood-feedback');
  const msgs = {
    5: "🚀 You're on fire! Channel that energy!",
    4: '😄 Great vibes! Keep it up!',
    3: '😐 Steady as she goes. You got this.',
    2: '😔 Rough patch. Be gentle with yourself.',
    1: '🌧️ Stormy weather. Tomorrow is new.',
  };
  fb.textContent = msgs[State.mood.selected];
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 4000);

  $$('.mood-option').forEach(o => o.classList.remove('selected'));
  State.mood.selected = null;
  $('#mood-note-input').value = '';
  $$('.mood-tag').forEach(t => t.classList.remove('active'));
  State.mood.tags = [];

  renderRecentMoods();
  updateMoodInsights();
  renderMoodChart();
  confetti(25);
  toast(`Mood logged: ${moodLabels[entry.mood]} (Energy: ${entry.energy}/10)`, moodEmojis[entry.mood]);
}

function renderRecentMoods() {
  const list = $('#recent-moods-list');
  list.innerHTML = '';
  const moodEmojis = { 5: '🚀', 4: '😄', 3: '😐', 2: '😔', 1: '🌧️' };
  const moodLabels = { 5: 'Phenomenal', 4: 'Great', 3: 'Okay', 2: 'Low', 1: 'Rough' };
  State.mood.entries.slice(0, 10).forEach(e => {
    const div = document.createElement('div');
    div.className = 'mood-history-item';
    const date = new Date(e.timestamp);
    div.innerHTML = `
      <div class="mood-history-emoji">${moodEmojis[e.mood]}</div>
      <div class="mood-history-info">
        <div class="mood-history-label">${moodLabels[e.mood]} • Energy ${e.energy}/10</div>
        <div class="mood-history-tags">${e.tags.join(' · ') || '—'}</div>
      </div>
      <div class="mood-history-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${pad(date.getHours())}:${pad(date.getMinutes())}</div>
    `;
    list.appendChild(div);
  });
}

function updateMoodInsights() {
  const entries = State.mood.entries;
  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—';
  const moodVals = entries.map(e => e.mood);
  const energyVals = entries.map(e => e.energy);
  const avgMood = avg(moodVals);
  const avgEnergy = avg(energyVals);
  const moodEmojis = { 5: '🚀', 4: '😄', 3: '😐', 2: '😔', 1: '🌧️' };

  const best = moodVals.length ? moodVals.reduce((max, v) => Math.max(max, v), 0) : null;
  $('#avg-mood-card').querySelector('.insight-val').textContent = avgMood !== '—' ? `${moodEmojis[Math.round(avgMood)]} ${avgMood}` : '—';
  $('#avg-energy-card').querySelector('.insight-val').textContent = avgEnergy !== '—' ? `⚡ ${avgEnergy}` : '—';
  $('#best-day-card').querySelector('.insight-val').textContent = best ? moodEmojis[best] : '—';
  $('#entries-card').querySelector('.insight-val').textContent = entries.length;
}

function renderMoodChart() {
  const canvas = $('#mood-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 500;
  const H = 200;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const last30 = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA');
    const entry = State.mood.entries.find(e => e.date === dateStr);
    last30.push({ date: dateStr, mood: entry ? entry.mood : null, energy: entry ? entry.energy : null });
  }

  const padX = 24, padY = 20;
  const w = W - padX * 2;
  const h = H - padY * 2;
  const step = w / 29;

  // Grid
  for (let i = 1; i <= 5; i++) {
    const y = padY + h - (i - 1) / 4 * h;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.strokeStyle = 'rgba(120,120,168,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Energy area
  const energyPts = last30.map((d, i) => ({
    x: padX + i * step,
    y: d.energy !== null ? padY + h - ((d.energy - 1) / 9) * h : null,
  }));
  ctx.beginPath();
  let started = false;
  energyPts.forEach((pt, i) => {
    if (pt.y === null) { started = false; return; }
    if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.strokeStyle = 'rgba(124,131,253,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Mood line
  const moodPts = last30.map((d, i) => ({
    x: padX + i * step,
    y: d.mood !== null ? padY + h - ((d.mood - 1) / 4) * h : null,
  }));
  ctx.beginPath();
  started = false;
  moodPts.forEach((pt) => {
    if (pt.y === null) { started = false; return; }
    if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.strokeStyle = '#ff6b35';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Dots
  moodPts.forEach(pt => {
    if (pt.y === null) return;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b35';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  });

  // X labels
  ctx.fillStyle = 'rgba(120,120,168,0.6)';
  ctx.font = '9px Space Mono, monospace';
  ctx.textAlign = 'center';
  [0, 7, 14, 21, 29].forEach(i => {
    const d = new Date(now);
    d.setDate(now.getDate() - (29 - i));
    ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), padX + i * step, H - 4);
  });
}

// ============================================================
// STATS
// ============================================================
function initStats() {
  renderStats();
}

function renderStats() {
  // Hero numbers
  $('#stat-total-sessions').textContent = State.stats.totalSessions;
  $('#stat-tasks-done').textContent = State.tasks.filter(t => t.completed).length;
  $('#stat-streak').textContent = State.stats.streak;

  // Habit rate this week
  const now = new Date();
  let totalPossible = 0, totalDone = 0;
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - 6 + i);
    return d.toLocaleDateString('en-CA');
  });
  State.habits.forEach(h => {
    weekDays.filter(d => d <= today()).forEach(d => {
      totalPossible++;
      if (h.completions[d]) totalDone++;
    });
  });
  const rate = totalPossible > 0 ? Math.round(totalDone / totalPossible * 100) : 0;
  $('#stat-habit-rate').textContent = rate + '%';

  renderWeeklyFocusChart();
  renderTaskDonutChart();
  renderAchievements();
  renderActivityHeatmap();
}

function renderWeeklyFocusChart() {
  const canvas = $('#weekly-focus-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 380;
  const H = 200;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  // Generate mock data based on session count
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const data = days.map(() => Math.max(0, Math.floor(Math.random() * State.stats.totalSessions * 0.3)));
  const maxVal = Math.max(...data, 1);

  const padX = 30, padY = 20, padB = 30;
  const w = W - padX * 2;
  const h = H - padY - padB;
  const barW = (w / days.length) * 0.6;
  const spacing = w / days.length;

  days.forEach((day, i) => {
    const barH = (data[i] / maxVal) * h;
    const x = padX + i * spacing + (spacing - barW) / 2;
    const y = padY + h - barH;

    const grad = ctx.createLinearGradient(0, y, 0, padY + h);
    grad.addColorStop(0, 'rgba(124,131,253,0.9)');
    grad.addColorStop(1, 'rgba(124,131,253,0.1)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = 'rgba(120,120,168,0.7)';
    ctx.font = '9px Space Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(day, x + barW / 2, H - 8);

    if (data[i] > 0) {
      ctx.fillStyle = 'rgba(200,200,255,0.7)';
      ctx.fillText(data[i], x + barW / 2, y - 4);
    }
  });
}

function renderTaskDonutChart() {
  const canvas = $('#task-donut-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 300, H = 200;
  canvas.width = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const cats = ['work', 'personal', 'health', 'learning', 'creative'];
  const colors = ['#ff6b35', '#7c83fd', '#51ffc8', '#ffe76e', '#ff4d8d'];
  const counts = cats.map(c => State.tasks.filter(t => t.category === c).length);
  const total = counts.reduce((a, b) => a + b, 0);

  if (total === 0) {
    ctx.fillStyle = 'rgba(120,120,168,0.4)';
    ctx.font = '11px Space Mono';
    ctx.textAlign = 'center';
    ctx.fillText('No tasks yet', W / 2, H / 2);
    return;
  }

  const cx = 90, cy = H / 2, R = 65, innerR = 35;
  let startAngle = -Math.PI / 2;

  counts.forEach((count, i) => {
    if (count === 0) return;
    const angle = (count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    startAngle += angle;
  });

  // Hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#10101e';
  ctx.fill();

  // Center text
  ctx.fillStyle = 'rgba(200,200,255,0.8)';
  ctx.font = 'bold 16px Space Mono';
  ctx.textAlign = 'center';
  ctx.fillText(total, cx, cy + 6);

  // Legend
  ctx.font = '9px Syne, sans-serif';
  cats.forEach((cat, i) => {
    if (counts[i] === 0) return;
    const y = 30 + i * 28;
    ctx.fillStyle = colors[i];
    ctx.fillRect(170, y - 8, 10, 10);
    ctx.fillStyle = 'rgba(200,200,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(`${cat} (${counts[i]})`, 186, y);
  });
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
const ACHIEVEMENTS = [
  { id: 'first_focus', icon: '🎯', name: 'First Focus', desc: 'Complete your first session', check: s => s.totalSessions >= 1 },
  { id: 'ten_sessions', icon: '🔟', name: 'Ten Sessions', desc: 'Complete 10 focus sessions', check: s => s.totalSessions >= 10 },
  { id: 'fifty_sessions', icon: '💎', name: 'Diamond Mind', desc: '50 focus sessions!', check: s => s.totalSessions >= 50 },
  { id: 'streak_3', icon: '🔥', name: 'On Fire', desc: '3 day streak', check: s => s.streak >= 3 },
  { id: 'streak_7', icon: '🌟', name: 'Week Warrior', desc: '7 day streak', check: s => s.streak >= 7 },
  { id: 'streak_30', icon: '🏆', name: 'Legend', desc: '30 day streak', check: s => s.streak >= 30 },
  { id: 'first_task', icon: '✅', name: 'Mission Ready', desc: 'Complete your first task', check: () => State.tasks.some(t => t.completed) },
  { id: 'ten_tasks', icon: '🚀', name: 'Task Crusher', desc: 'Complete 10 tasks', check: () => State.tasks.filter(t => t.completed).length >= 10 },
  { id: 'first_habit', icon: '💫', name: 'Habit Starter', desc: 'Create your first habit', check: () => State.habits.length >= 1 },
  { id: 'habit_streak_7', icon: '⚡', name: 'Power Habit', desc: 'Any habit at 7-day streak', check: () => State.habits.some(h => h.streak >= 7) },
  { id: 'mood_logger', icon: '🌈', name: 'Self Aware', desc: 'Log 7 mood entries', check: () => State.mood.entries.length >= 7 },
  { id: 'ten_notes', icon: '📝', name: 'Thought Weaver', desc: 'Create 10 notes', check: () => State.notes.list.length >= 10 },
];

function checkAchievements() {
  const unlocked = Store.load('achievements', []);
  let newUnlocks = [];
  ACHIEVEMENTS.forEach(a => {
    if (!unlocked.includes(a.id) && a.check(State.stats)) {
      unlocked.push(a.id);
      newUnlocks.push(a);
    }
  });
  if (newUnlocks.length) {
    Store.save('achievements', unlocked);
    newUnlocks.forEach(a => {
      setTimeout(() => {
        confetti(50);
        toast(`Achievement unlocked: ${a.name}!`, a.icon, 5000);
      }, 500);
    });
  }
}

function renderAchievements() {
  const unlocked = Store.load('achievements', []);
  const grid = $('#achievements-grid');
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const isUnlocked = unlocked.includes(a.id);
    const div = document.createElement('div');
    div.className = `achievement ${isUnlocked ? 'unlocked' : ''}`;
    div.innerHTML = `
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
    `;
    grid.appendChild(div);
  });
}

// ============================================================
// ACTIVITY HEATMAP
// ============================================================
function renderActivityHeatmap() {
  const container = $('#activity-heatmap');
  container.innerHTML = '';
  const now = new Date();
  const cells = 90;

  for (let i = cells - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA');
    const hasFocus = State.stats.lastActiveDate === dateStr;
    const hasTask = State.tasks.some(t => new Date(t.createdAt).toLocaleDateString('en-CA') === dateStr);
    const hasHabit = State.habits.some(h => h.completions[dateStr]);
    const hasMood = State.mood.entries.some(e => e.date === dateStr);
    const score = [hasFocus, hasTask, hasHabit, hasMood].filter(Boolean).length;

    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    if (score > 0) cell.dataset.level = Math.min(score, 4);
    cell.title = `${dateStr} — ${score} activities`;
    container.appendChild(cell);
  }
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd + [1-6] to switch panels
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '6') {
      e.preventDefault();
      const panels = ['focus','habits','tasks','notes','mood','stats'];
      const idx = parseInt(e.key) - 1;
      if (panels[idx]) {
        const item = $(`.nav-item[data-panel="${panels[idx]}"]`);
        if (item) item.click();
      }
    }
    // Space to start/stop timer when in focus panel
    if (e.code === 'Space' && $('#panel-focus').classList.contains('active') &&
        !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      $('#btn-start').click();
    }
  });
}

// ============================================================
// IDLE EASTER EGG
// ============================================================
function initIdleEasterEgg() {
  let idleTimer;
  const messages = [
    '✦ Still there? The cosmos awaits...',
    '◉ Your tasks miss you.',
    '🚀 The universe doesn\'t pause.',
    '◎ Ready when you are.',
    '⭐ Great things take focus.',
  ];
  let msgIdx = 0;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      toast(messages[msgIdx % messages.length], '✦', 4000);
      msgIdx++;
    }, 120000); // 2 minutes
  };
  document.addEventListener('mousemove', resetIdle);
  document.addEventListener('keydown', resetIdle);
  resetIdle();
}

// ============================================================
// KONAMI CODE EASTER EGG
// ============================================================
function initKonamiCode() {
  const code = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let pos = 0;
  document.addEventListener('keydown', e => {
    if (e.key === code[pos]) {
      pos++;
      if (pos === code.length) {
        pos = 0;
        confetti(200);
        toast('🎉 VORTEX ULTRA MODE ACTIVATED!', '✦', 5000);
        document.body.style.animation = 'none';
        document.documentElement.style.setProperty('--accent-3', '#ff4d8d');
        setTimeout(() => {
          document.documentElement.style.setProperty('--accent-3', '#7c83fd');
        }, 8000);
      }
    } else {
      pos = 0;
    }
  });
}

// ============================================================
// WINDOW RESIZE
// ============================================================
function initResize() {
  window.addEventListener('resize', () => {
    renderMoodChart();
    renderWeeklyFocusChart();
    renderTaskDonutChart();
  });
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  Store.loadAll();
  initSplash();
  initStarfield();
  initCursor();
  initClock();
  initNav();
  initTimer();
  initHabits();
  initTasks();
  initNotes();
  initMood();
  initStats();
  initKeyboardShortcuts();
  initIdleEasterEgg();
  initKonamiCode();
  initResize();

  // Auto-save every 30 seconds
  setInterval(() => Store.saveAll(), 30000);

  // Welcome toast after splash
  setTimeout(() => {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    toast(`${greeting}! Welcome to VORTEX. Press Ctrl+1–6 to navigate.`, '✦', 5000);
  }, 3200);
});
