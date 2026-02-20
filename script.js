/* ============================================================
   VORTEX II — Cosmic Productivity System
   script.js — Complete Application Logic
   ============================================================ */
'use strict';

// ============================================================
// ── UTILITY LIBRARY ─────────────────────────────────────────
// ============================================================
const U = {
  $:  (s,c=document) => c.querySelector(s),
  $$: (s,c=document) => [...c.querySelectorAll(s)],
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2,7),
  pad: n => String(n).padStart(2,'0'),
  fmt: s => `${U.pad(Math.floor(s/60))}:${U.pad(s%60)}`,
  fmtH: m => m>=60 ? `${(m/60).toFixed(1)}h` : `${m}m`,
  today: () => new Date().toISOString().slice(0,10),
  dayOfWeek: d => new Date(d).getDay(),
  clamp: (v,mn,mx) => Math.min(mx,Math.max(mn,v)),
  lerp: (a,b,t) => a+(b-a)*t,
  debounce(fn,ms){ let t; return(...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; },
  throttle(fn,ms){ let l=0; return(...a)=>{ const n=Date.now(); if(n-l>=ms){ l=n; fn(...a); } }; },
  deepClone: o => JSON.parse(JSON.stringify(o)),
  qs: s => document.querySelector(s),
  on: (el,ev,fn) => el?.addEventListener(ev,fn),
  off:(el,ev,fn) => el?.removeEventListener(ev,fn),
  delegate(parent,sel,ev,fn){
    parent?.addEventListener(ev,e=>{ const t=e.target.closest(sel); if(t)fn(e,t); });
  },
  animate(el,kf,opts){ if(!el)return; return el.animate(kf,{duration:300,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards',...opts}); },
  rand: (mn,mx) => mn + Math.random()*(mx-mn),
  randInt: (mn,mx) => Math.floor(mn + Math.random()*(mx-mn+1)),
  choice: arr => arr[Math.floor(Math.random()*arr.length)],
  daysAgo: n => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); },
};

// ============================================================
// ── STORE — localStorage with namespacing ───────────────────
// ============================================================
const Store = {
  NS: 'vx2_',
  set(k,v){ try{ localStorage.setItem(this.NS+k, JSON.stringify(v)); }catch(e){} },
  get(k,d=null){ try{ const v=localStorage.getItem(this.NS+k); return v!==null?JSON.parse(v):d; }catch(e){ return d; } },
  del(k){ localStorage.removeItem(this.NS+k); },
  clear(){ Object.keys(localStorage).filter(k=>k.startsWith(this.NS)).forEach(k=>localStorage.removeItem(k)); },
  export(){
    const out={};
    ['tasks','habits','notes','mood','stats','rewards','settings','achievements','timer_sessions']
      .forEach(k=>{ const v=this.get(k); if(v!==null)out[k]=v; });
    return out;
  },
  import(data){
    ['tasks','habits','notes','mood','stats','rewards','settings','achievements','timer_sessions']
      .forEach(k=>{ if(data[k]!==undefined) this.set(k,data[k]); });
  },
};

// ============================================================
// ── EVENT BUS ───────────────────────────────────────────────
// ============================================================
const Bus = {
  _map: new Map(),
  on(ev,fn){ if(!this._map.has(ev))this._map.set(ev,new Set()); this._map.get(ev).add(fn); },
  off(ev,fn){ this._map.get(ev)?.delete(fn); },
  emit(ev,...args){ this._map.get(ev)?.forEach(fn=>{ try{fn(...args);}catch(e){console.warn(ev,e);} }); },
};

// ============================================================
// ── STATE ───────────────────────────────────────────────────
// ============================================================
const S = {
  timer: {
    running: false, paused: false,
    mode: 'focus', totalSecs: 25*60, remaining: 25*60,
    session: 1, lapStart: 0, laps: [],
    startTs: 0, pausedAt: 0, driftOffset: 0,
    task: '', intervalId: null, rafId: null,
    msMode: false,
  },
  tasks:   Store.get('tasks', []),
  habits:  Store.get('habits', []),
  notes:   Store.get('notes', []),
  activeNoteId: null,
  mood:    Store.get('mood', []),
  stats:   Store.get('stats', {
    totalSessions:0, totalFocusMins:0, 
    lastDate:null, streak:0,
    tasksCompleted:0, habitsChecked:0, notesCreated:0, moodLogs:0,
    dailyFocus:{}, weeklyFocus:{},
  }),
  rewards: Store.get('rewards', {
    xp:0, level:1, achievements:[],
    owned:[], lastLogin: null,
  }),
  settings: Store.get('settings', {
    theme:'nebula', sound:true, soundVol:35,
    ambientVol:35, timerSound:true,
  }),
  ui: {
    activePanel: 'focus',
    activeMoodChart: '30d',
    activeMoodEmoji: null,
    selectedMoodTags: [],
    activeRewardTab: 'badges',
    cmdOpen: false, cmdIdx: 0, cmdItems:[],
    noteFilter: 'all',
    taskFilter: 'all', taskSort: 'date_desc',
    noteSaveTimer: null,
  },
  ambient: { actx: null, nodes: {}, type: 'none' },
};

// ============================================================
// ── AUDIO ENGINE ────────────────────────────────────────────
// ============================================================
const Audio = {
  ctx: null,
  masterGain: null,
  sfxGain: null,
  ambGain: null,
  ambNodes: [],
  init(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain(); this.masterGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value=.35; this.sfxGain.connect(this.masterGain);
      this.ambGain  = this.ctx.createGain(); this.ambGain.gain.value = S.settings.ambientVol/100; this.ambGain.connect(this.masterGain);
    }catch(e){ console.warn('AudioContext unavailable'); }
  },
  resume(){ if(this.ctx?.state==='suspended') this.ctx.resume(); },
  setAmbVol(v){ if(this.ambGain) this.ambGain.gain.linearRampToValueAtTime(v/100, this.ctx.currentTime+.1); },
  sfx(type){
    if(!S.settings.sound||!S.settings.timerSound) return;
    this.resume();
    if(!this.ctx) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.sfxGain);
    const configs = {
      tick:    { type:'sine', freq:880, dur:.05, vol:.08 },
      click:   { type:'sine', freq:660, dur:.06, vol:.12 },
      start:   { type:'sine', freq:[440,660,880], dur:.4, vol:.15 },
      pause:   { type:'sine', freq:[660,440], dur:.3, vol:.1 },
      done:    { type:'sine', freq:[440,554,659,880], dur:1.2, vol:.2 },
      lap:     { type:'triangle', freq:[440,550], dur:.35, vol:.15 },
      achieve: { type:'sine', freq:[523,659,784,1047], dur:1.5, vol:.25 },
      complete:{ type:'sine', freq:[660,880,1100], dur:.5, vol:.18 },
      error:   { type:'sawtooth', freq:200, dur:.25, vol:.08 },
      nav:     { type:'sine', freq:440, dur:.08, vol:.05 },
    };
    const c = configs[type] || configs.click;
    if(Array.isArray(c.freq)){
      const step = c.dur / c.freq.length;
      c.freq.forEach((f,i)=>{
        const oo = this.ctx.createOscillator();
        const gg = this.ctx.createGain();
        oo.connect(gg); gg.connect(this.sfxGain);
        oo.type = c.type; oo.frequency.value = f;
        gg.gain.setValueAtTime(0, now+i*step);
        gg.gain.linearRampToValueAtTime(c.vol, now+i*step+.02);
        gg.gain.linearRampToValueAtTime(0, now+(i+1)*step);
        oo.start(now+i*step); oo.stop(now+(i+1)*step+.05);
      });
    } else {
      o.type = c.type; o.frequency.value = c.freq;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(c.vol, now+.01);
      g.gain.linearRampToValueAtTime(0, now+c.dur);
      o.start(now); o.stop(now+c.dur+.05);
    }
  },
  stopAmbient(){
    this.ambNodes.forEach(n=>{ try{n.stop?n.stop():n.disconnect();}catch(e){} });
    this.ambNodes=[];
  },
  playAmbient(type){
    this.stopAmbient();
    if(type==='none'||!this.ctx) return;
    this.resume();
    const ct = this.ctx;
    const g = this.ambGain;
    if(type==='rain'){
      const buf=ct.createBuffer(1,ct.sampleRate*2,ct.sampleRate);
      const d=buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*.4;
      const src=ct.createBufferSource(); src.buffer=buf; src.loop=true;
      const flt=ct.createBiquadFilter(); flt.type='bandpass';
      flt.frequency.value=800; flt.Q.value=.6;
      src.connect(flt); flt.connect(g); src.start();
      this.ambNodes=[src,{stop:()=>{src.stop();flt.disconnect();}}];
    } else if(type==='forest'){
      const oscs=[200,300,400,500,600].map(f=>{
        const o=ct.createOscillator(); const gg=ct.createGain();
        o.type='sine'; o.frequency.value=f*(1+Math.random()*.1);
        gg.gain.value=.025+Math.random()*.015;
        o.connect(gg); gg.connect(g); o.start();
        const iv=setInterval(()=>o.frequency.setTargetAtTime(f*(1+Math.random()*.15),ct.currentTime,1+Math.random()*2),2500);
        o._iv=iv;
        return o;
      });
      this.ambNodes=oscs;
    } else if(type==='ocean'){
      let ph=0;
      const buf=ct.createBuffer(1,ct.sampleRate*4,ct.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++){
        ph+=.0008; d[i]=Math.sin(ph*.5)*Math.sin(ph*.3)*.35+(Math.random()-.5)*.05;
      }
      const src=ct.createBufferSource(); src.buffer=buf;
      src.loop=true;
      src.connect(g); src.start(); this.ambNodes=[src];
    } else if(type==='fire'){
      const buf=ct.createBuffer(1,ct.sampleRate*2,ct.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(0.1+Math.random()*.18);
      const src=ct.createBufferSource(); src.buffer=buf; src.loop=true;
      const lp=ct.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=700;
      src.connect(lp); lp.connect(g); src.start(); this.ambNodes=[src];
    } else if(type==='space'){
      const nodes=[55,82,110,165].map(f=>{
        const o=ct.createOscillator(); const gg=ct.createGain();
        o.type='sine'; o.frequency.value=f; gg.gain.value=.055;
        o.connect(gg); gg.connect(g); o.start(); return o;
      });
      this.ambNodes=nodes;
    } else if(type==='cafe'){
      const buf=ct.createBuffer(1,ct.sampleRate*3,ct.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*.15;
      const src=ct.createBufferSource(); src.buffer=buf; src.loop=true;
      const bp=ct.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1200; bp.Q.value=.4;
      src.connect(bp); bp.connect(g); src.start(); this.ambNodes=[src];
    } else if(type==='thunder'){
      const nodes=[];
      const makeThunder=()=>{
        if(!ct) return;
        const buf=ct.createBuffer(1,ct.sampleRate*.8,ct.sampleRate);
        const d=buf.getChannelData(0);
        for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(ct.sampleRate*.15))*.9;
        const src=ct.createBufferSource();
        src.buffer=buf;
        const gg=ct.createGain(); gg.gain.value=.6;
        src.connect(gg); gg.connect(g); src.start();
        nodes.push(src);
      };
      makeThunder();
      const iv=setInterval(makeThunder,3000+Math.random()*5000);
      this.ambNodes=[{stop:()=>clearInterval(iv)},...nodes];
    }
    S.ambient.type=type;
  },
};

// ============================================================
// ── CANVAS BACKGROUND ───────────────────────────────────────
// ============================================================
const BG = {
  nebula: { ctx:null, t:0 },
  stars:  { ctx:null, pts:[], t:0 },
  particles:{ ctx:null, pts:[], t:0 },

  initNebula(){
    const c=U.$('#c-nebula');
    if(!c)return;
    c.width=window.innerWidth; c.height=window.innerHeight;
    this.nebula.ctx=c.getContext('2d');
    this.drawNebula();
  },
  drawNebula(){
    const {ctx}=this.nebula; if(!ctx)return;
    const W=ctx.canvas.width, H=ctx.canvas.height;
    ctx.clearRect(0,0,W,H);
    const theme=document.documentElement.dataset.theme||'nebula';
    const colors={nebula:['#00e5ff','#0040ff','#8000ff'],aurora:['#00ff80','#00e5ff','#40ff00'],pulsar:['#ff00aa','#aa00ff','#ff0055'],sol:['#ff6b35','#ffcc00','#ff3300'],void:['#8855ff','#5500ff','#cc00ff'],titan:['#ffcc00','#ff9500','#ff6600']};
    const [c1,c2,c3]=(colors[theme]||colors.nebula);
    [[W*.3,H*.35,.28,c1],[W*.7,H*.6,.22,c2],[W*.5,H*.2,.18,c3]].forEach(([x,y,r,col])=>{
      const g=ctx.createRadialGradient(x,y,0,x,y,r*Math.min(W,H));
      g.addColorStop(0,col+'22'); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    });
  },

  initStars(){
    const c=U.$('#c-stars'); if(!c)return;
    c.width=window.innerWidth; c.height=window.innerHeight;
    this.stars.ctx=c.getContext('2d');
    this.stars.pts=Array.from({length:280},()=>({
      x:Math.random()*c.width, y:Math.random()*c.height,
      r:Math.random()*1.6, o:.15+Math.random()*.8,
      sp:.3+Math.random()*1.4, ph:Math.random()*Math.PI*2,
      vx:(Math.random()-.5)*.04, vy:(Math.random()-.5)*.02,
    }));
    this.animStars();
  },
  animStars(){
    const {ctx,pts}=this.stars;
    if(!ctx){requestAnimationFrame(()=>this.animStars());return;}
    const W=ctx.canvas.width, H=ctx.canvas.height;
    ctx.clearRect(0,0,W,H);
    this.stars.t+=.005;
    pts.forEach(s=>{
      const op=s.o*(0.4+0.6*Math.sin(this.stars.t*s.sp+s.ph));
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(200,210,255,${op})`; ctx.fill();
      s.x=(s.x+s.vx+W)%W; s.y=(s.y+s.vy+H)%H;
    });
    requestAnimationFrame(()=>this.animStars());
  },

  initParticles(){
    const c=U.$('#c-particles'); if(!c)return;
    c.width=window.innerWidth; c.height=window.innerHeight;
    this.particles.ctx=c.getContext('2d');
    this.particles.pts=Array.from({length:30},()=>this.newParticle());
    this.animParticles();
  },
  newParticle(){
    const W=window.innerWidth, H=window.innerHeight;
    return { x:Math.random()*W, y:Math.random()*H, r:1+Math.random()*2,
      vx:(Math.random()-.5)*.3, vy:-.1-Math.random()*.4,
      o:0.1+Math.random()*.3, life:0, maxLife:200+Math.random()*300 };
  },
  animParticles(){
    const {ctx,pts}=this.particles; if(!ctx){requestAnimationFrame(()=>this.animParticles());return;}
    const W=ctx.canvas.width, H=ctx.canvas.height;
    ctx.clearRect(0,0,W,H);
    const theme=document.documentElement.dataset.theme||'nebula';
    const colors={nebula:'0,229,255',aurora:'77,255,145',pulsar:'255,77,166',sol:'255,107,53',void:'168,85,247',titan:'255,204,0'};
    const rgb=colors[theme]||colors.nebula;
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      p.life++; p.x+=p.vx; p.y+=p.vy;
      if(p.life>p.maxLife||p.y<-10||p.x<-10||p.x>W+10){ pts[i]=this.newParticle(); continue;
      }
      const fade=Math.sin(Math.PI*p.life/p.maxLife);
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(${rgb},${p.o*fade})`; ctx.fill();
    }
    requestAnimationFrame(()=>this.animParticles());
  },

  resize(){
    ['#c-nebula','#c-stars','#c-particles','#c-confetti'].forEach(id=>{
      const c=U.$(id); if(c){ c.width=window.innerWidth; c.height=window.innerHeight; }
    });
    this.drawNebula();
  },
};

// ============================================================
// ── CURSOR ENGINE ───────────────────────────────────────────
// ============================================================
const Cursor = {
  dot: null, ring: null, trailWrap: null,
  mx:0, my:0, cx:0, cy:0, rx:0, ry:0, last:0,
  trails:[],
  init(){
    this.dot=U.$('#cursor-dot');
    this.ring=U.$('#cursor-ring'); this.trailWrap=U.$('#cursor-trail-container');
    document.addEventListener('mousemove',e=>{ this.mx=e.clientX; this.my=e.clientY; this.spawnTrail(); });
    document.addEventListener('mousedown',()=>document.body.classList.add('cursor-click'));
    document.addEventListener('mouseup',()=>document.body.classList.remove('cursor-click'));
    document.addEventListener('mouseover',e=>{
      if(e.target.matches('button,a,input,select,textarea,[contenteditable],[data-hover]'))
        document.body.classList.add('cursor-hover');
      else document.body.classList.remove('cursor-hover');
    });
    this.tick();
  },
  spawnTrail(){
    const now=Date.now();
    if(now-this.last<40) return; this.last=now;
    const el=document.createElement('div'); el.className='cursor-trail';
    el.style.cssText=`left:${this.mx}px;top:${this.my}px;width:4px;height:4px;opacity:.6;`;
    this.trailWrap?.appendChild(el);
    setTimeout(()=>el.remove(),600);
  },
  tick(){
    const ease=.12, ease2=.08;
    this.cx+=(this.mx-this.cx)*ease; this.cy+=(this.my-this.cy)*ease;
    this.rx+=(this.mx-this.rx)*ease2; this.ry+=(this.my-this.ry)*ease2;
    if(this.dot){ this.dot.style.left=this.cx+'px'; this.dot.style.top=this.cy+'px';
    }
    if(this.ring){ this.ring.style.left=this.rx+'px'; this.ring.style.top=this.ry+'px'; }
    requestAnimationFrame(()=>this.tick());
  },
};

// ============================================================
// ── NOTIFICATIONS ───────────────────────────────────────────
// ============================================================
const Notify = {
  stack: null,
  init(){ this.stack=U.$('#notif-stack');
  },
  show(msg, type='info', duration=3500, icon=''){
    if(!this.stack)return;
    const icons={info:'✦',success:'✓',warning:'⚠',error:'✕'};
    const el=document.createElement('div');
    el.className=`notif-item ${type}`;
    el.innerHTML=`<span class="notif-icon">${icon||icons[type]||icons.info}</span><span class="notif-msg">${msg}</span>`;
    this.stack.appendChild(el);
    setTimeout(()=>{ el.classList.add('exit'); setTimeout(()=>el.remove(),350); }, duration);
  },
  success:(m,icon)=>Notify.show(m,'success',3200,icon),
  warn:(m,icon)=>Notify.show(m,'warning',4000,icon),
  error:(m,icon)=>Notify.show(m,'error',4000,icon),
  info:(m,icon)=>Notify.show(m,'info',3000,icon),
};

// ============================================================
// ── CONFETTI ENGINE ─────────────────────────────────────────
// ============================================================
const Confetti = {
  canvas: null, ctx: null, pieces: [], running: false, raf:0,
  init(){ this.canvas=U.$('#c-confetti');
    if(this.canvas) this.ctx=this.canvas.getContext('2d'); },
  burst(n=80){
    if(!this.ctx)return;
    this.canvas.width=window.innerWidth; this.canvas.height=window.innerHeight;
    const cx=window.innerWidth/2;
    const cols=['#00e5ff','#7c83fd','#51ffc8','#ffe76e','#ff4da6','#ff6b35','#a855f7'];
    for(let i=0;i<n;i++) this.pieces.push({
      x:cx+U.rand(-200,200), y:window.innerHeight*.4+U.rand(-100,100),
      vx:U.rand(-8,8), vy:U.rand(-14,-4), r:U.rand(4,9),
      rot:Math.random()*Math.PI*2, drot:U.rand(-.15,.15),
      color:U.choice(cols), life:1, shape:Math.random()>.5?'rect':'circle',
    });
    if(!this.running){ this.running=true; this.frame(); }
  },
  frame(){
    const {ctx,canvas}=this; if(!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    this.pieces=this.pieces.filter(p=>{
      p.vy+=.25; p.x+=p.vx; p.y+=p.vy; p.rot+=p.drot; p.life-=.012;
      if(p.life<=0)return false;
      ctx.save(); ctx.globalAlpha=p.life; ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      if(p.shape==='rect') ctx.fillRect(-p.r/2,-p.r*.6,p.r,p.r*.6);
      else{ ctx.beginPath(); ctx.arc(0,0,p.r/2,0,Math.PI*2); ctx.fill(); }
      ctx.restore(); return true;
    });
    if(this.pieces.length>0) this.raf=requestAnimationFrame(()=>this.frame());
    else{ this.running=false; ctx.clearRect(0,0,canvas.width,canvas.height); }
  },
};

// ============================================================
// ── XP / REWARDS SYSTEM ─────────────────────────────────────
// ============================================================
const XP = {
  LEVELS: [0,100,250,500,900,1400,2100,3000,4200,5800,8000,11000,15000,20000,27000,36000,48000,64000,85000,110000],
  earn(amount, reason=''){
    S.rewards.xp=(S.rewards.xp||0)+amount;
    const oldLv=S.rewards.level||1;
    S.rewards.level=this.calcLevel(S.rewards.xp);
    Store.set('rewards',S.rewards);
    if(S.rewards.level>oldLv){ this.onLevelUp(S.rewards.level); }
    Bus.emit('xp-change',S.rewards.xp,S.rewards.level);
    if(reason) Notify.info(`+${amount} XP — ${reason}`, '✦');
  },
  calcLevel(xp){
    for(let i=this.LEVELS.length-1;i>=0;i--) if(xp>=this.LEVELS[i]) return i+1;
    return 1;
  },
  xpForNext(){ const lv=S.rewards.level||1; return this.LEVELS[lv]||this.LEVELS[this.LEVELS.length-1];
  },
  xpForCur(){ const lv=(S.rewards.level||1)-1; return this.LEVELS[lv]||0; },
  pct(){ const c=this.xpForCur(),n=this.xpForNext(); return n===c?100:Math.min(100,((S.rewards.xp-c)/(n-c))*100);
  },
  onLevelUp(lv){
    Confetti.burst(120);
    Audio.sfx('achieve');
    Achievements.showPopup({icon:'🌟',name:`Level ${lv} Reached!`,desc:this.getLevelTitle(lv)+' — Keep going!',id:'level'});
    Notify.success(`Level up! You're now Level ${lv}: ${this.getLevelTitle(lv)}`, '🌟');
  },
  getLevelTitle(lv){
    const t=['Stardust','Comet','Asteroid','Meteor','Satellite','Astronaut','Explorer','Pioneer','Navigator','Commander','Voyager','Trailblazer','Sentinel','Guardian','Champion','Legend','Mythic','Cosmic','Nebular','Transcendent','Omniversal'];
    return t[Math.min(lv-1,t.length-1)]||'Cosmic Being';
  },
};

// ============================================================
// ── ACHIEVEMENTS ────────────────────────────────────────────
// ============================================================
const Achievements = {
  DEFS: [
    {id:'first_focus',icon:'🎯',name:'First Contact',desc:'Complete your first focus session',xp:50},
    {id:'focus_5',icon:'🔥',name:'Ignition',desc:'Complete 5 focus sessions',xp:75},
    {id:'focus_25',icon:'💫',name:'Hyperdrive',desc:'Complete 25 focus sessions',xp:150},
    {id:'focus_100',icon:'🌌',name:'Galactic Mind',desc:'100 focus sessions',xp:400},
    {id:'focus_500',icon:'🏆',name:'Cosmic Legend',desc:'500 focus sessions!',xp:2000},
    {id:'streak_3',icon:'🔥',name:'On Fire',desc:'3 day streak',xp:60},
    {id:'streak_7',icon:'⭐',name:'Week Warrior',desc:'7 day streak',xp:150},
    {id:'streak_30',icon:'🌟',name:'Month Master',desc:'30 day streak',xp:500},
    {id:'streak_100',icon:'💎',name:'Century',desc:'100 day streak',xp:2000},
    {id:'first_task',icon:'✅',name:'Mission Ready',desc:'Complete your first task',xp:30},
    {id:'tasks_10',icon:'🚀',name:'Launcher',desc:'Complete 10 tasks',xp:80},
    {id:'tasks_50',icon:'⚡',name:'Powerhouse',desc:'Complete 50 tasks',xp:200},
    {id:'tasks_200',icon:'🌠',name:'Task Titan',desc:'Complete 200 tasks',xp:600},
    {id:'first_habit',icon:'💧',name:'New Ritual',desc:'Add your first habit',xp:30},
    {id:'habits_7',icon:'🎖',name:'Habit Formed',desc:'Any habit hits 7-day streak',xp:120},
    {id:'habits_30',icon:'🏅',name:'Deep Groove',desc:'Any habit hits 30-day streak',xp:350},
    {id:'first_note',icon:'📝',name:'Thought Catcher',desc:'Create your first note',xp:25},
    {id:'notes_10',icon:'📚',name:'Archivist',desc:'Create 10 notes',xp:80},
    {id:'notes_50',icon:'🗂',name:'Librarian',desc:'Create 50 notes',xp:200},
    {id:'mood_7',icon:'🌈',name:'Self Aware',desc:'Log 7 mood entries',xp:70},
    {id:'mood_30',icon:'🧠',name:'Mindful',desc:'Log 30 mood entries',xp:180},
    {id:'level_5',icon:'🌙',name:'Rising',desc:'Reach Level 5',xp:0},
    {id:'level_10',icon:'🌟',name:'Stellar',desc:'Reach Level 10',xp:0},
    {id:'focus_2h',icon:'⏱',name:'Deep Work',desc:'Accumulate 2 hours focus in a day',xp:100},
    {id:'all_habits',icon:'🌈',name:'Perfect Day',desc:'Complete all habits in a single day',xp:200},
    {id:'konami',icon:'👾',name:'Cheat Code',desc:'You found the secret',xp:500},
    {id:'night_owl',icon:'🦉',name:'Night Owl',desc:'Use the app after midnight',xp:40},
    {id:'early_bird',icon:'🌅',name:'Early Bird',desc:'Use the app before 6am',xp:40},
    {id:'10notes_tagged',icon:'🏷',name:'Tagger',desc:'Create 10 tagged notes',xp:60},
    {id:'high_energy',icon:'⚡',name:'Supercharged',desc:'Log energy ≥ 9',xp:30},
  ],
  popup: null,
  init(){ this.popup=U.$('#achievement-popup');
  },
  check(){
    const s=S.stats, r=S.rewards, td=U.today();
    const unlocked=r.achievements||[];
    const unlock=(id)=>{
      if(unlocked.includes(id)) return;
      const def=this.DEFS.find(d=>d.id===id); if(!def) return;
      unlocked.push(id);
      S.rewards.achievements=unlocked;
      Store.set('rewards',S.rewards);
      XP.earn(def.xp,`Achievement: ${def.name}`);
      this.showPopup(def);
      Audio.sfx('achieve');
      Confetti.burst(50);
      Bus.emit('achievements-change');
    };
    if(s.totalSessions>=1) unlock('first_focus');
    if(s.totalSessions>=5) unlock('focus_5');
    if(s.totalSessions>=25) unlock('focus_25');
    if(s.totalSessions>=100) unlock('focus_100');
    if(s.totalSessions>=500) unlock('focus_500');
    if(s.streak>=3) unlock('streak_3');
    if(s.streak>=7) unlock('streak_7');
    if(s.streak>=30) unlock('streak_30');
    if(s.streak>=100) unlock('streak_100');
    if(S.tasks.some(t=>t.done)) unlock('first_task');
    if(S.tasks.filter(t=>t.done).length>=10) unlock('tasks_10');
    if(S.tasks.filter(t=>t.done).length>=50) unlock('tasks_50');
    if(S.tasks.filter(t=>t.done).length>=200) unlock('tasks_200');
    if(S.habits.length>=1) unlock('first_habit');
    if(S.habits.some(h=>h.streak>=7)) unlock('habits_7');
    if(S.habits.some(h=>h.streak>=30)) unlock('habits_30');
    if(S.notes.length>=1) unlock('first_note');
    if(S.notes.length>=10) unlock('notes_10');
    if(S.notes.length>=50) unlock('notes_50');
    if(S.mood.length>=7) unlock('mood_7');
    if(S.mood.length>=30) unlock('mood_30');
    if((S.rewards.level||1)>=5) unlock('level_5');
    if((S.rewards.level||1)>=10) unlock('level_10');
    const todayMins=s.dailyFocus?.[td]||0;
    if(todayMins>=120) unlock('focus_2h');
    const allHabitsDone=S.habits.length>0&&S.habits.every(h=>h.completions?.[td]);
    if(allHabitsDone) unlock('all_habits');
    const hr=new Date().getHours();
    if(hr>=0&&hr<2) unlock('night_owl');
    if(hr>=4&&hr<6) unlock('early_bird');
    if(S.notes.filter(n=>n.tag&&n.tag!=='none').length>=10) unlock('10notes_tagged');
    if(S.mood.some(m=>m.energy>=9)) unlock('high_energy');
  },
  showPopup(def){
    if(!this.popup) return;
    this.popup.innerHTML=`
      <div class="ap-icon">${def.icon}</div>
      <div class="ap-body">
        <div class="ap-badge">Achievement Unlocked</div>
        <div class="ap-name">${def.name}</div>
        <div class="ap-desc">${def.desc}</div>
      </div>`;
    this.popup.classList.remove('hidden');
    clearTimeout(this._hideT);
    this._hideT=setTimeout(()=>this.popup.classList.add('hidden'),5000);
  },
  render(){
    const grid=U.$('#achievements-grid'); if(!grid)return;
    const unlocked=S.rewards.achievements||[];
    grid.innerHTML=this.DEFS.map(d=>`
      <div class="ach-card ${unlocked.includes(d.id)?'unlocked':''}">
        <div class="ach-icon">${d.icon}</div>
        <div class="ach-name">${d.name}</div>
        <div class="ach-desc">${d.desc}</div>
      </div>`).join('');
  },
};

// ============================================================
// ── PRECISE TIMER ───────────────────────────────────────────
// ============================================================
const Timer = {
  ring: null, ringGlow: null, ringLap: null, tip: null, lapTip: null,
  CIRC_OUTER: 2*Math.PI*140, // 879.6
  CIRC_INNER: 2*Math.PI*120, // 753.9

  init(){
    this.ring     = U.$('#ring-main');
    this.ringGlow = U.$('#ring-glow');
    this.ringLap  = U.$('#ring-lap');
    this.tip      = U.$('#ring-tip');
    this.lapTip   = U.$('#ring-lap-tip');
    this.bindUI();
    this.refresh();
    this.startClock();
    this.updateMiniStats();
  },

  bindUI(){
    U.$('#tbtn-start').onclick  = () => { Audio.init(); this.toggle(); };
    U.$('#tbtn-reset').onclick  = () => { Audio.init(); this.reset(); };
    U.$('#tbtn-lap').onclick    = () => { Audio.init(); this.lap(); };
    U.$('#tbtn-skip').onclick   = () => { Audio.init(); this.skip(); };
    U.$$('.tmode').forEach(btn=>{
      btn.onclick=()=>{
        U.$$('.tmode').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const mode=btn.dataset.mode;
        if(mode==='custom'){ U.$('#custom-wrap').classList.toggle('hidden'); return; }
        U.$('#custom-wrap').classList.add('hidden');
        this.setMode(mode, parseInt(btn.dataset.mins));
        Audio.sfx('nav');
      };
    });
    U.$('#custom-set').onclick=()=>{
      const v=parseInt(U.$('#custom-mins').value);
      if(v>0&&v<=240){ this.setMode('custom',v); U.$('#custom-wrap').classList.add('hidden'); Audio.sfx('click'); }
    };
    U.$('#custom-mins').onkeydown=e=>{ if(e.key==='Enter') U.$('#custom-set').click();
    };
    U.$('#timer-task-input').oninput=e=>{ S.timer.task=e.target.value; U.$('#t-task-display').textContent=e.target.value; };

    U.$$('.amb-btn').forEach(b=>b.onclick=()=>{
      Audio.init();
      U.$$('.amb-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      Audio.playAmbient(b.dataset.snd);
    });
    U.$('#amb-vol').oninput=e=>{
      const v=parseInt(e.target.value);
      S.settings.ambientVol=v;
      U.$('#vol-pct').textContent=v+'%';
      Audio.setAmbVol(v);
      Store.set('settings',S.settings);
    };
    U.$('#amb-vol').value=S.settings.ambientVol;
    U.$('#vol-pct').textContent=S.settings.ambientVol+'%';
  },

  setMode(mode,mins){
    this.reset(true);
    S.timer.mode=mode;
    S.timer.totalSecs=mins*60;
    S.timer.remaining=mins*60;
    const labels={focus:'FOCUS',shortbreak:'BREAK',longbreak:'LONG BREAK',custom:'CUSTOM'};
    U.$('#t-mode-chip').textContent=labels[mode]||mode.toUpperCase();
    this.refresh();
  },

  toggle(){
    if(S.timer.running) this.pause(); else this.start();
  },

  start(){
    Audio.init(); Audio.resume();
    if(S.timer.remaining<=0) S.timer.remaining=S.timer.totalSecs;
    S.timer.startTs = performance.now() - (S.timer.totalSecs-S.timer.remaining)*1000;
    S.timer.running=true; S.timer.paused=false;
    S.timer.lapStart=S.timer.startTs;
    U.$('#tbtn-start').innerHTML='⏸'; U.$('#tbtn-start').classList.add('paused');
    U.$('.timer-card').classList.add('timer-pulsing');
    Audio.sfx('start');
    this.tick();
  },

  pause(){
    S.timer.running=false;
    S.timer.paused=true;
    cancelAnimationFrame(S.timer.rafId);
    U.$('#tbtn-start').innerHTML='▶'; U.$('#tbtn-start').classList.remove('paused');
    U.$('.timer-card').classList.remove('timer-pulsing');
    Audio.sfx('pause');
  },

  reset(silent=false){
    S.timer.running=false; S.timer.paused=false;
    cancelAnimationFrame(S.timer.rafId);
    S.timer.remaining=S.timer.totalSecs;
    S.timer.laps=[]; S.timer.lapStart=0;
    U.$('#tbtn-start').innerHTML='▶'; U.$('#tbtn-start').classList.remove('paused');
    U.$('.timer-card').classList.remove('timer-pulsing');
    this.refresh(); this.renderLaps();
    if(!silent) Audio.sfx('click');
  },

  skip(){
    this.pause();
    this.complete();
  },

  lap(){
    if(!S.timer.running) return;
    const elapsed = (performance.now()-S.timer.lapStart)/1000;
    S.timer.laps.push(elapsed);
    S.timer.lapStart=performance.now();
    this.renderLaps();
    this.animLapRing();
    Audio.sfx('lap');
    Notify.info(`Lap ${S.timer.laps.length}: ${U.fmt(Math.round(elapsed))}`,'◷');
  },

  renderLaps(){
    const el=U.$('#laps-list'); if(!el) return;
    if(S.timer.laps.length===0){ el.innerHTML='<div class="laps-empty">No laps recorded</div>'; return;
    }
    el.innerHTML=S.timer.laps.map((l,i)=>`
      <div class="lap-item">
        <span class="lap-num">LAP ${i+1}</span>
        <span>${U.fmt(Math.round(l))}</span>
      </div>`).join('');
    el.scrollTop=el.scrollHeight;
  },

  animLapRing(){
    if(!this.ringLap) return;
    this.ringLap.style.stroke='rgba(255,107,53,.9)';
    setTimeout(()=>{ if(this.ringLap) this.ringLap.style.stroke='rgba(255,107,53,.7)'; },300);
  },

  tick(){
    if(!S.timer.running) return;
    const now=performance.now();
    const elapsed=(now-S.timer.startTs)/1000;
    const rem=Math.max(0, S.timer.totalSecs - elapsed);
    S.timer.remaining=rem;
    this.refresh();
    if(rem<=0){ this.complete(); return; }
    S.timer.rafId=requestAnimationFrame(()=>this.tick());
  },

  refresh(){
    const rem=S.timer.remaining, total=S.timer.totalSecs;
    const secs=Math.ceil(rem);
    U.$('#t-digits').textContent=U.fmt(secs);
    const ms=Math.floor((rem%1)*100);
    U.$('#t-ms').textContent='.'+U.pad(ms);
    const ratio=total>0?(total-rem)/total:0;
    const offset=this.CIRC_OUTER*(1-ratio);
    if(this.ring)     this.ring.style.strokeDashoffset=offset;
    if(this.ringGlow) this.ringGlow.style.strokeDashoffset=offset;
    const lapRatio = S.timer.lapStart > 0 ? U.clamp((performance.now()-S.timer.lapStart)/1000/total,0,1) : 0;
    if(this.ringLap) this.ringLap.style.strokeDashoffset=this.CIRC_INNER*(1-lapRatio);
    this.moveTip(ratio, 140, this.tip);
    this.moveTip(lapRatio, 120, this.lapTip);
    document.title=S.timer.running ?
`${U.fmt(secs)} — VORTEX II` : 'VORTEX II';
  },

  moveTip(ratio,R,tipEl){
    if(!tipEl)return;
    const angle=-90+ratio*360;
    const rad=angle*Math.PI/180;
    const cx=160, cy=160;
    const x=cx+R*Math.cos(rad), y=cy+R*Math.sin(rad);
    tipEl.setAttribute('cx',x.toFixed(2));
    tipEl.setAttribute('cy',y.toFixed(2));
  },

  complete(){
    const mins=Math.floor(S.timer.totalSecs/60);
    S.timer.running=false;
    cancelAnimationFrame(S.timer.rafId);
    U.$('#tbtn-start').innerHTML='▶'; U.$('#tbtn-start').classList.remove('paused');
    U.$('.timer-card').classList.remove('timer-pulsing');
    U.$('.timer-card').classList.add('timer-done');
    setTimeout(()=>U.$('.timer-card')?.classList.remove('timer-done'),1500);

    if(S.timer.mode==='focus'){
      S.stats.totalSessions=(S.stats.totalSessions||0)+1;
      S.stats.totalFocusMins=(S.stats.totalFocusMins||0)+mins;
      const td=U.today();
      S.stats.dailyFocus=S.stats.dailyFocus||{};
      S.stats.dailyFocus[td]=(S.stats.dailyFocus[td]||0)+mins;
      this.updateStreak();
      S.timer.session=S.timer.session<4?S.timer.session+1:1;
      U.$('#t-session-info').textContent=`Session ${S.timer.session} of 4`;
      this.addSessionLog(S.timer.task||'Focus session', mins);
      Store.set('stats',S.stats);
      XP.earn(mins*2,`${mins}m focus session`);
      Confetti.burst(70);
      Audio.sfx('done');
      Notify.success(`Focus complete! ${mins} minutes logged 🚀`, '◎');
      Achievements.check();
      this.updateMiniStats();
    } else {
      Audio.sfx('complete');
      Notify.info('Break over! Ready to focus?','☕');
    }
  },

  updateStreak(){
    const last=S.stats.lastDate, now=U.today();
    if(!last){ S.stats.streak=1;
    }
    else if(last===now){ /* already counted */ }
    else{
      const diff=(new Date(now)-new Date(last))/(86400000);
      S.stats.streak=diff===1?(S.stats.streak||0)+1:1;
    }
    S.stats.lastDate=now;
  },

  addSessionLog(task,mins){
    const el=U.$('#session-log'); if(!el) return;
    const now=new Date();
    const div=document.createElement('div');
    div.className='session-log-item';
    div.textContent=`${U.pad(now.getHours())}:${U.pad(now.getMinutes())} — ${task} (${mins}m)`;
    el.prepend(div);
    if(el.children.length>10) el.lastChild?.remove();
    const sessions=Store.get('timer_sessions',[]);
    sessions.unshift({task,mins,ts:Date.now(),date:U.today()});
    if(sessions.length>200) sessions.length=200;
    Store.set('timer_sessions',sessions);
  },

  updateMiniStats(){
    const td=U.today();
    const todaySess=Store.get('timer_sessions',[]).filter(s=>s.date===td).length;
    const totalH=U.fmtH(S.stats.totalFocusMins||0);
    const wk = Object.entries(S.stats.dailyFocus||{})
      .filter(([d])=>d>=U.daysAgo(7))
      .reduce((a,[,v])=>a+v,0);
    U.$('#ms-today').textContent=todaySess;
    U.$('#ms-total').textContent=totalH;
    U.$('#ms-streak').textContent=(S.stats.streak||0)+'🔥';
    U.$('#ms-week').textContent=Math.round(wk/60*10)/10+'h';
    this.updateSidebarXP();
  },

  updateSidebarXP(){
    const pct=XP.pct();
    U.$('#sb-xp-bar').style.width=pct+'%';
    U.$('#sb-xp-label').textContent=`XP: ${S.rewards.xp||0}`;
  },

  startClock(){
    const update=()=>{
      const n=new Date();
      U.$('#sb-time').textContent=`${U.pad(n.getHours())}:${U.pad(n.getMinutes())}:${U.pad(n.getSeconds())}`;
      U.$('#sb-date').textContent=n.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    };
    update();
    setInterval(update,1000);
  },
};

// ============================================================
// ── TASKS ───────────────────────────────────────────────────
// ============================================================
const Tasks = {
  init(){
    U.$('#add-task-btn').onclick=()=>this.add();
    U.$('#task-text-input').onkeydown=e=>{ if(e.key==='Enter')this.add(); };
    U.$$('.flt').forEach(b=>b.onclick=()=>{ U.$$('.flt').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.ui.taskFilter=b.dataset.f; this.render(); Audio.sfx('nav'); });
    U.$('#task-search').oninput=U.debounce(()=>this.render(),250);
    U.$('#task-sort').onchange=e=>{ S.ui.taskSort=e.target.value; this.render(); };
    U.$('#clear-done-btn').onclick=()=>{ S.tasks=S.tasks.filter(t=>!t.done); this.save(); this.render(); Notify.info('Completed tasks cleared'); };
    U.delegate(U.$('#tasks-container'),'[data-task-done]','click',(_,el)=>this.complete(el.dataset.taskDone));
    U.delegate(U.$('#tasks-container'),'[data-task-del]','click',(_,el)=>this.delete(el.dataset.taskDel));
    this.render();
  },
  add(){
    const inp=U.$('#task-text-input'); const text=inp.value.trim();
    if(!text){ inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),400); Audio.sfx('error'); return;
    }
    const task={ id:U.uid(), text, pri:U.$('#task-pri').value, cat:U.$('#task-cat').value, due:U.$('#task-due-input').value, done:false, created:Date.now() };
    S.tasks.unshift(task); this.save(); this.render(); inp.value='';
    U.$('#task-due-input').value='';
    XP.earn(5,'New task added'); Audio.sfx('click');
    Notify.success(`Mission launched: "${text.slice(0,40)}"`, '◧');
    Achievements.check();
    this.updateBadge();
  },
  complete(id){
    const t=S.tasks.find(x=>x.id===id); if(!t) return;
    t.done=!t.done; t.completedAt=t.done?Date.now():null;
    if(t.done){
      S.stats.tasksCompleted=(S.stats.tasksCompleted||0)+1;
      Store.set('stats',S.stats);
      XP.earn(15,'Task completed'); Confetti.burst(35); Audio.sfx('complete');
      Notify.success(`Mission complete: "${t.text.slice(0,35)}"`, '✓');
      Achievements.check();
    }
    this.save(); this.render(); this.updateBadge();
  },
  delete(id){ S.tasks=S.tasks.filter(t=>t.id!==id); this.save(); this.render(); this.updateBadge(); Audio.sfx('click'); },
  save(){ Store.set('tasks',S.tasks);
  },
  updateBadge(){
    const active=S.tasks.filter(t=>!t.done).length;
    const nb=U.$('#nb-tasks');
    if(nb){ nb.textContent=active; nb.style.display=active>0?'flex':'none';
    }
  },
  filtered(){
    const f=S.ui.taskFilter, q=(U.$('#task-search')?.value||'').toLowerCase();
    const td=U.today();
    let t=[...S.tasks];
    if(f==='active')   t=t.filter(x=>!x.done);
    if(f==='done')     t=t.filter(x=>x.done);
    if(f==='critical') t=t.filter(x=>x.pri==='critical');
    if(f==='today')    t=t.filter(x=>x.due===td);
    if(q) t=t.filter(x=>x.text.toLowerCase().includes(q));
    const so=S.ui.taskSort;
    if(so==='date_desc')  t.sort((a,b)=>b.created-a.created);
    if(so==='date_asc')   t.sort((a,b)=>a.created-b.created);
    if(so==='priority'){const p={critical:0,high:1,medium:2,low:3}; t.sort((a,b)=>p[a.pri]-p[b.pri]||b.created-a.created);}
    if(so==='due')    t.sort((a,b)=>{ if(!a.due&&!b.due)return 0; if(!a.due)return 1; if(!b.due)return -1; return a.due.localeCompare(b.due); });
    if(so==='alpha')  t.sort((a,b)=>a.text.localeCompare(b.text));
    // Always show active first unless filter=done
    if(f==='all'||f==='critical') t.sort((a,b)=>a.done===b.done?0:a.done?1:-1);
    return t;
  },
  render(){
    const el=U.$('#tasks-container'); if(!el) return;
    const tasks=this.filtered(); const td=U.today();
    if(tasks.length===0){ el.innerHTML=`<div class="task-empty">No missions found. Launch one above! 🚀</div>`; }
    else{
      el.innerHTML=tasks.map(t=>{
        const isOverdue=t.due&&t.due<td&&!t.done;
        const catMap={work:'💼',personal:'🏠',health:'🏃',learn:'📚',creative:'🎨',finance:'💰'};
        return `<div class="task-item ${t.done?'completed':''}" data-pri="${t.pri}">
          <div class="task-priority-bar"></div>
          <button class="task-cb-wrap" data-task-done="${t.id}"><div class="task-cb ${t.done?'done':''}"></div></button>
          <div class="task-body">
            <div class="task-text">${t.text}</div>
       
            <div class="task-badges">
              <span class="task-badge">${catMap[t.cat]||''} ${t.cat}</span>
              <span class="task-badge">${t.pri}</span>
              ${t.due?`<span class="task-badge task-badge-due ${isOverdue?'overdue':''}">${isOverdue?'⚠ Overdue: ':'📅 '}${t.due}</span>`:''}
            </div>
          </div>
          <div class="task-actions">
          
            <button class="task-action-btn task-del-btn" data-task-del="${t.id}">✕</button>
          </div>
        </div>`;
      }).join('');
    }
    const total=S.tasks.length, done=S.tasks.filter(t=>t.done).length, active=total-done;
    U.$('#tf-counts').textContent=`${active} mission${active!==1?'s':''} active`;
    U.$('#tf-progress-bar').style.width=(total>0?done/total*100:0)+'%';
    U.$('#tf-pct').textContent=(total>0?Math.round(done/total*100):0)+'%';
  },
};

// ============================================================
// ── HABITS ──────────────────────────────────────────────────
// ============================================================
const Habits = {
  COLORS:{ cyan:'#00e5ff',orange:'#ff6b35',pink:'#ff4da6',lime:'#4dff91',amber:'#ffcc00',violet:'#a855f7' },
  FREQ_LABEL:{ daily:'Daily',weekdays:'Weekdays',weekends:'Weekends',mwf:'Mon/Wed/Fri',tth:'Tue/Thu' },

  init(){
    U.$('#add-habit-btn').onclick=()=>this.add();
    U.$('#habit-name-in').onkeydown=e=>{ if(e.key==='Enter')this.add(); };
    U.delegate(U.$('#habits-list'),'[data-habit-check]','click',(_,el)=>this.toggle(el.dataset.habitCheck));
    U.delegate(U.$('#habits-list'),'[data-habit-del]','click',(_,el)=>this.delete(el.dataset.habitDel));
    this.render(); this.renderWeekGrid(); this.renderConstellation();
  },
  add(){
    const name=U.$('#habit-name-in').value.trim();
    if(!name){ U.$('#habit-name-in').classList.add('shake'); setTimeout(()=>U.$('#habit-name-in')?.classList.remove('shake'),400); Audio.sfx('error');
      return; }
    const habit={id:U.uid(),name,icon:U.$('#habit-icon-in').value,freq:U.$('#habit-freq-in').value,color:U.$('#habit-color-in').value,goal:U.$('#habit-goal-in').value,streak:0,completions:{},best:0,created:U.today()};
    S.habits.push(habit); this.save(); this.render(); this.renderWeekGrid(); this.renderConstellation();
    U.$('#habit-name-in').value=''; U.$('#habit-goal-in').value='';
    XP.earn(10,'New habit created'); Audio.sfx('click');
    Notify.success(`Habit "${name}" added!`, habit.icon);
    Achievements.check(); this.updateBadge();
  },
  toggle(id){
    const h=S.habits.find(x=>x.id===id); if(!h) return;
    const td=U.today();
    if(h.completions[td]){ delete h.completions[td]; h.streak=Math.max(0,h.streak-1); }
    else{
      h.completions[td]=true; h.streak++;
      if(h.streak>h.best) h.best=h.streak;
      XP.earn(8,'Habit checked');
      Confetti.burst(20); Audio.sfx('complete');
      S.stats.habitsChecked=(S.stats.habitsChecked||0)+1;
      Store.set('stats',S.stats);
      Notify.success(`${h.icon} ${h.name} done!`, '◈');
      Achievements.check();
    }
    this.save(); this.render(); this.renderWeekGrid(); this.renderConstellation();
  },
  delete(id){ S.habits=S.habits.filter(h=>h.id!==id); this.save(); this.render(); this.renderWeekGrid(); this.renderConstellation(); this.updateBadge(); Audio.sfx('click'); },
  save(){ Store.set('habits',S.habits);
  },
  updateBadge(){
    const td=U.today();
    const done=S.habits.filter(h=>h.completions?.[td]).length;
    const nb=U.$('#nb-habits');
    if(nb){ nb.textContent=`${done}/${S.habits.length}`; nb.style.display=S.habits.length>0?'flex':'none';
    }
  },
  render(){
    const el=U.$('#habits-list'); if(!el) return;
    const td=U.today();
    if(S.habits.length===0){ el.innerHTML=`<div style="color:var(--tx-faint);font-family:var(--font-mono);font-size:.78rem;padding:20px;text-align:center">Add a habit above to start tracking.</div>`; return;
    }
    el.innerHTML=S.habits.map(h=>{
      const done=!!h.completions?.[td];
      const col=this.COLORS[h.color]||'#00e5ff';
      const streakPct=Math.min(h.streak*3.33,100);
      return `<div class="habit-card" data-color="${h.color}">
        <button class="habit-check ${done?'done':''}" data-habit-check="${h.id}">${done?'':'<span style="font-size:1.1rem">${h.icon}</span>'}</button>
        <div class="habit-info">
          <div class="habit-name">${h.icon} ${h.name}</div>
          <div class="habit-freq">${this.FREQ_LABEL[h.freq]||h.freq}</div>
          ${h.goal?`<div class="habit-goal">"${h.goal}"</div>`:''}
          <div 
class="habit-streak-row">
            <div class="habit-streak-bar"><div class="habit-streak-fill" style="width:${streakPct}%;background:${col}"></div></div>
            <div class="habit-streak-num">${h.streak}🔥 / best ${h.best||0}</div>
          </div>
        </div>
        <button class="habit-del-btn" data-habit-del="${h.id}" title="Delete">✕</button>
      </div>`;
    }).join('');
    this.renderSummary();
  },
  renderSummary(){
    const el=U.$('#habit-summary'); if(!el) return;
    const td=U.today();
    const done=S.habits.filter(h=>h.completions?.[td]).length;
    const pct=S.habits.length?Math.round(done/S.habits.length*100):0;
    const topStreak=S.habits.reduce((a,h)=>Math.max(a,h.streak||0),0);
    el.innerHTML=`<b>${done}/${S.habits.length}</b> habits done today (${pct}%) · Top streak: <b>${topStreak} days 🔥</b>`;
  },
  renderWeekGrid(){
    const el=U.$('#habit-week-grid');
    if(!el) return;
    if(S.habits.length===0){ el.innerHTML=''; return; }
    const now=new Date(); const dow=now.getDay();
    const days=Array.from({length:7},(_,i)=>{ const d=new Date(now); d.setDate(now.getDate()-(dow===0?6:dow-1)+i); return d.toISOString().slice(0,10); });
    const dayLabels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let html=`<div class="hwg-header"><span></span>${dayLabels.map(d=>`<span class="hwg-day">${d}</span>`).join('')}</div>`;
    S.habits.forEach(h=>{
      html+=`<div class="hwg-row"><span class="hwg-icon">${h.icon}</span>${days.map(d=>{
        const future=d>U.today(); const done=!!h.completions?.[d];
        return `<div class="hwg-cell ${done?'done':''} ${future?'future':''}" data-color="${h.color}" title="${d}"></div>`;
      }).join('')}</div>`;
    });
    el.innerHTML=html;
  },
  renderConstellation(){
    const cvs=U.$('#constellation-cvs'); if(!cvs) return;
    const ctx=cvs.getContext('2d'); const W=cvs.width, H=cvs.height;
    ctx.clearRect(0,0,W,H);
    const pts=[];
    S.habits.forEach(h=>{
      Object.keys(h.completions||{}).forEach(d=>{
        if(h.completions[d]) pts.push({ x:20+Math.random()*(W-40), y:20+Math.random()*(H-40), r:1.5+Math.random()*3, color:this.COLORS[h.color]||'#00e5ff' });
      });
    });
    // connections
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
      const dx=pts[j].x-pts[i].x, dy=pts[j].y-pts[i].y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<70){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
        ctx.strokeStyle=`rgba(100,120,255,${0.18-dist/600})`; ctx.lineWidth=.7; ctx.stroke(); }
    }
    // stars
    pts.forEach(p=>{
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*2.5);
      g.addColorStop(0,p.color+'dd'); g.addColorStop(1,p.color+'00');
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=g; ctx.fill();
    });
    if(pts.length===0){
      ctx.fillStyle='rgba(90,90,138,0.5)'; ctx.font='12px JetBrains Mono,monospace'; ctx.textAlign='center';
      ctx.fillText('Complete habits to grow your constellation',W/2,H/2);
    }
  },
};

// ============================================================
// ── NOTES ───────────────────────────────────────────────────
// ============================================================
const Notes = {
  init(){
    U.$('#new-note-btn').onclick=()=>this.create();
    U.$('#note-empty-new')?.onclick=()=>this.create();
    U.$('#del-note-btn').onclick=()=>this.delete();
    U.$('#notes-search-in').oninput=U.debounce(()=>this.renderList(),250);
    U.$$('.note-flt').forEach(b=>b.onclick=()=>{ U.$$('.note-flt').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.ui.noteFilter=b.dataset.f; this.renderList(); });
    U.$$('.ntb').forEach(btn=>{
      btn.onmousedown=(e)=>{ e.preventDefault(); const cmd=btn.dataset.cmd,val=btn.dataset.val; document.execCommand(cmd,false,val||null); U.$('#note-body')?.focus(); };
    });
    U.$('#ntb-link')?.addEventListener('mousedown',e=>{ e.preventDefault(); const url=prompt('URL:'); if(url) document.execCommand('createLink',false,url); });
    U.$('#ntb-hr')?.addEventListener('mousedown',e=>{ e.preventDefault(); document.execCommand('insertHTML',false,'<hr/>'); });
    U.$('#ntb-clear')?.addEventListener('mousedown',e=>{ e.preventDefault(); document.execCommand('removeFormat',false,null); });
    U.$('#note-body')?.addEventListener('input',()=>{ this.scheduleSave(); this.updateWordCount(); });
    U.$('#note-title-in')?.addEventListener('input',()=>this.scheduleSave());
    U.$('#note-tag-in')?.addEventListener('change',()=>this.scheduleSave());
    U.$$('.nc-dot').forEach(d=>d.onclick=()=>{ U.$$('.nc-dot').forEach(x=>x.classList.remove('active')); d.classList.add('active'); this.scheduleSave(); });
    this.renderList();
    this.updateBadge();
  },
  create(){
    const note={id:U.uid(),title:'',body:'',tag:'none',color:'default',created:Date.now(),updated:Date.now()};
    S.notes.unshift(note); Store.set('notes',S.notes);
    S.activeNoteId=note.id; this.renderList();
    this.openNote(note.id);
    S.stats.notesCreated=(S.stats.notesCreated||0)+1; Store.set('stats',S.stats);
    XP.earn(5,'Note created'); Achievements.check(); Audio.sfx('click');
    this.updateBadge();
  },
  delete(){
    if(!S.activeNoteId)return;
    S.notes=S.notes.filter(n=>n.id!==S.activeNoteId);
    S.activeNoteId=null; Store.set('notes',S.notes);
    U.$('#note-editor').classList.add('hidden');
    U.$('#note-empty').classList.remove('hidden');
    this.renderList(); this.updateBadge(); Audio.sfx('click'); Notify.info('Note deleted');
  },
  openNote(id){
    const note=S.notes.find(n=>n.id===id); if(!note)return;
    S.activeNoteId=id;
    U.$('#note-empty').classList.add('hidden');
    U.$('#note-editor').classList.remove('hidden');
    U.$('#note-title-in').value=note.title;
    U.$('#note-body').innerHTML=note.body;
    U.$('#note-tag-in').value=note.tag||'none';
    U.$$('.nc-dot').forEach(d=>d.classList.toggle('active',d.dataset.c===(note.color||'default')));
    this.updateWordCount(); Audio.sfx('nav');
    this.renderList();
  },
  scheduleSave(){
    clearTimeout(S.ui.noteSaveTimer);
    S.ui.noteSaveTimer=setTimeout(()=>this.save(),600);
    const ind=U.$('#note-status'); if(ind){ ind.textContent='saving…'; ind.classList.add('show');
    }
  },
  save(){
    const id=S.activeNoteId; if(!id) return;
    const note=S.notes.find(n=>n.id===id); if(!note) return;
    note.title=U.$('#note-title-in').value;
    note.body=U.$('#note-body').innerHTML;
    note.tag=U.$('#note-tag-in').value;
    note.color=(U.$$('.nc-dot').find(d=>d.classList.contains('active'))?.dataset.c)||'default';
    note.updated=Date.now();
    Store.set('notes',S.notes);
    const ind=U.$('#note-status'); if(ind){ ind.textContent='saved'; setTimeout(()=>ind.classList.remove('show'),1500); }
    this.renderList();
  },
  updateWordCount(){
    const body=U.$('#note-body');
    if(!body)return;
    const text=(body.textContent||'').trim();
    const words=text?text.split(/\s+/).length:0;
    const readTime=Math.max(1,Math.round(words/200));
    U.$('#note-wc').textContent=`${words} words`;
    U.$('#note-rt').textContent=`~${readTime} min read`;
  },
  updateBadge(){
    const nb=U.$('#nb-notes');
    if(nb){ nb.textContent=S.notes.length; nb.style.display=S.notes.length>0?'flex':'none'; }
  },
  filtered(){
    const q=(U.$('#notes-search-in')?.value||'').toLowerCase();
    const f=S.ui.noteFilter;
    let notes=[...S.notes].sort((a,b)=>b.updated-a.updated);
    if(f!=='all') notes=notes.filter(n=>n.tag===f);
    if(q) notes=notes.filter(n=>(n.title+' '+n.body.replace(/<[^>]+>/g,'')).toLowerCase().includes(q));
    return notes;
  },
  renderList(){
    const el=U.$('#notes-list'); if(!el) return;
    const notes=this.filtered();
    const tagEmoji={idea:'💡',important:'⚡',todo:'✅',research:'🔬',personal:'🌙',none:''};
    if(notes.length===0){ el.innerHTML=`<div style="color:var(--tx-faint);font-size:.78rem;padding:20px;text-align:center;font-family:var(--font-mono)">No notes found.</div>`; return; }
    el.innerHTML=notes.map(n=>{
      const preview=n.body.replace(/<[^>]+>/g,'').slice(0,50)||'Empty note';
      const date=new Date(n.updated).toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return `<div class="note-list-item ${S.activeNoteId===n.id?'active':''}" data-note-id="${n.id}">
        <div class="note-color-stripe ${n.color||'default'}"></div>
        <div class="note-li-title">${n.title||'Untitled Note'}</div>
        <div class="note-li-preview">${preview}</div>
        <div class="note-li-meta">
          <span>${tagEmoji[n.tag]||''} ${n.tag&&n.tag!=='none'?n.tag:''}</span>
          <span>${date}</span>
     
        </div>
      </div>`;
    }).join('');
    U.$$('.note-list-item').forEach(item=>{
      item.onclick=()=>this.openNote(item.dataset.noteId);
    });
  },
};

// ============================================================
// ── MOOD ────────────────────────────────────────────────────
// ============================================================
const Mood = {
  EMOJIS:{5:'🚀',4:'😄',3:'😐',2:'😔',1:'🌧'},
  LABELS:{5:'Phenomenal',4:'Great',3:'Okay',2:'Low',1:'Rough'},
  RESPONSES:{
    5:["You're absolutely thriving! Channel that cosmic energy! 🚀","Phenomenal energy today — the universe is with you!","Maximum velocity achieved! 🌟"],
    4:["Great vibes! Keep that momentum flowing! 😄","Solid energy — you're in a good orbital path.","Looking good! Steady as she goes."],
    3:["Steady state. Small steps forward count. 😐","Neutral is fine — just keep orbiting.","Stable trajectory. You're doing okay."],
    2:["Rough patch? That's just gravity. You'll rise. 😔","Even stars have dim phases. Rest if needed.","Be gentle with yourself. Tomorrow is new."],
    1:["Storm season. This too shall pass. 🌧","Even black holes have event horizons — brighter on the other side.","Rest. Recharge. The cosmos supports you."]
  },

  init(){
    U.$$('.me-btn').forEach(b=>b.onclick=()=>{ U.$$('.me-btn').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); S.ui.activeMoodEmoji=parseInt(b.dataset.v); Audio.sfx('click'); });
    ['mood','energy','focus-mood','stress'].forEach(id=>{
      const sl=U.$(`#sl-${id}`), sv=U.$(`#sv-${id.replace('-mood','')}`)||U.$(`#sv-focus`);
      if(sl&&sv) sl.oninput=()=>{ sv.textContent=sl.value; };
    });
    // Fix ids
    U.$('#sl-focus-mood')?.addEventListener('input',e=>{ U.$('#sv-focus').textContent=e.target.value; });
    U.$$('.mt-tag').forEach(t=>t.onclick=()=>{ t.classList.toggle('active'); const tag=t.dataset.t; if(S.ui.selectedMoodTags.includes(tag)) S.ui.selectedMoodTags=S.ui.selectedMoodTags.filter(x=>x!==tag); else S.ui.selectedMoodTags.push(tag); });
    U.$('#log-mood-btn').onclick=()=>this.log();
    U.$$('.ct-tab').forEach(t=>t.onclick=()=>{ U.$$('.ct-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
      S.ui.activeMoodChart=t.dataset.ct; this.renderChart(); });
    this.renderChart(); this.renderHistory(); this.renderInsights();
  },
  log(){
    if(S.ui.activeMoodEmoji===null){ Notify.warn('Select a mood emoji first!','◕'); Audio.sfx('error'); return;
    }
    const entry={
      id:U.uid(),
      mood:S.ui.activeMoodEmoji,
      slMood:parseInt(U.$('#sl-mood')?.value||5),
      energy:parseInt(U.$('#sl-energy')?.value||5),
      focus:parseInt(U.$('#sl-focus-mood')?.value||5),
      stress:parseInt(U.$('#sl-stress')?.value||5),
      note:U.$('#mood-note')?.value||'',
      tags:[...S.ui.selectedMoodTags],
      ts:Date.now(), date:U.today(),
    };
    S.mood.unshift(entry); if(S.mood.length>500) S.mood.length=500;
    Store.set('mood',S.mood);
    S.stats.moodLogs=(S.stats.moodLogs||0)+1; Store.set('stats',S.stats);
    XP.earn(10,'Mood logged'); Achievements.check(); Audio.sfx('complete');
    const resp=U.choice(this.RESPONSES[entry.mood]||this.RESPONSES[3]);
    const fb=U.$('#mood-response');
    if(fb){ fb.textContent=resp; fb.classList.remove('hidden'); setTimeout(()=>fb.classList.add('hidden'),5000);
    }
    // Reset
    U.$$('.me-btn').forEach(x=>x.classList.remove('selected')); S.ui.activeMoodEmoji=null;
    U.$$('.mt-tag').forEach(t=>t.classList.remove('active')); S.ui.selectedMoodTags=[];
    if(U.$('#mood-note')) U.$('#mood-note').value='';
    this.renderChart(); this.renderHistory(); this.renderInsights();
    Notify.success(`Mood logged: ${this.LABELS[entry.mood]} · Energy ${entry.energy}/10`,this.EMOJIS[entry.mood]);
  },
  renderChart(){
    const mode=S.ui.activeMoodChart;
    const c30=U.$('#mood-main-chart'), cRad=U.$('#mood-radar-chart');
    if(mode==='radar'){
      c30.classList.add('hidden'); cRad.classList.remove('hidden');
      this.drawRadar(cRad);
    } else {
      c30.classList.remove('hidden'); cRad.classList.add('hidden');
      this.drawLine(c30, mode==='90d'?90:30);
    }
  },
  drawLine(cvs,days){
    const W=cvs.width=cvs.offsetWidth||600, H=200; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const padX=30,padY=16,padB=30, w=W-padX*2, h=H-padY-padB;
    const step=w/(days-1);
    const labels=Array.from({length:days},(_,i)=>U.daysAgo(days-1-i));
    const moodByDay=new Map(labels.map(d=>{ const e=S.mood.find(m=>m.date===d); return [d,e?{mood:e.mood,energy:e.energy,focus:e.focus,stress:e.stress}:null]; }));
    // Grid
    for(let i=1;i<=5;i++){
      const y=padY+h-(i-1)/4*h;
      ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y);
      ctx.strokeStyle='rgba(100,120,255,.07)'; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle='rgba(90,90,138,.5)'; ctx.font='9px JetBrains Mono'; ctx.textAlign='left';
      ctx.fillText(i,padX-18,y+3);
    }
    // Energy line (thin, muted)
    const drawLine=(getVal,color,lw)=>{
      ctx.beginPath();
      let started=false;
      labels.forEach((d,i)=>{
        const v=moodByDay.get(d); if(!v||getVal(v)===null){started=false;return;}
        const x=padX+i*step, y=padY+h-(getVal(v)-1)/4*h;
        if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
      });
      ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.stroke();
    };
    drawLine(v=>v?v.energy/2:null,'rgba(124,131,253,.35)',1.2);
    drawLine(v=>v?v.mood:null,'rgba(0,229,255,.9)',2.5);
    // Dots
    labels.forEach((d,i)=>{
      const v=moodByDay.get(d); if(!v) return;
      const x=padX+i*step, y=padY+h-(v.mood-1)/4*h;
      ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2);
      ctx.fillStyle='#00e5ff'; ctx.fill();
      ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
    });
    // X labels (sparse)
    ctx.fillStyle='rgba(90,90,138,.6)'; ctx.font='9px JetBrains Mono'; ctx.textAlign='center';
    const step2=Math.floor(days/5);
    for(let i=0;i<days;i+=step2){
      const d=new Date(labels[i]);
      ctx.fillText(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),padX+i*step,H-4);
    }
  },
  drawRadar(cvs){
    if(S.mood.length===0) return;
    const W=cvs.width=cvs.offsetWidth||300, H=300; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const cx=W/2, cy=H/2, R=100;
    const axes=[{lbl:'Mood',key:'slMood'},{lbl:'Energy',key:'energy'},{lbl:'Focus',key:'focus'},{lbl:'Calmness',key:'stress',inv:true}];
    const n=axes.length;
    const recent=S.mood.slice(0,7);
    const avg=k=>recent.length?recent.reduce((a,e)=>a+(e[k]||5),0)/recent.length:5;
    const vals=axes.map(a=>{ let v=avg(a.key); if(a.inv) v=11-v; return v/10; });
    // Grid circles
    [.25,.5,.75,1].forEach(r=>{
      ctx.beginPath();
      for(let i=0;i<n;i++){
        const a=-Math.PI/2+i/n*Math.PI*2;
        const x=cx+R*r*Math.cos(a), y=cy+R*r*Math.sin(a);
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.closePath(); ctx.strokeStyle='rgba(100,120,255,.12)'; ctx.lineWidth=1; ctx.stroke();
    });
    // Axes
    axes.forEach((_,i)=>{
      const a=-Math.PI/2+i/n*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a));
      ctx.strokeStyle='rgba(100,120,255,.2)'; ctx.lineWidth=1; ctx.stroke();
    });
    // Data polygon
    ctx.beginPath();
    vals.forEach((v,i)=>{
      const a=-Math.PI/2+i/n*Math.PI*2;
      const x=cx+R*v*Math.cos(a), y=cy+R*v*Math.sin(a);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.closePath();
    ctx.fillStyle='rgba(0,229,255,.12)'; ctx.fill();
    ctx.strokeStyle='rgba(0,229,255,.8)'; ctx.lineWidth=2; ctx.stroke();
    // Dots
    vals.forEach((v,i)=>{
      const a=-Math.PI/2+i/n*Math.PI*2;
      const x=cx+R*v*Math.cos(a), y=cy+R*v*Math.sin(a);
      ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2);
      ctx.fillStyle='#00e5ff'; ctx.fill();
    });
    // Labels
    ctx.fillStyle='rgba(200,200,255,.7)'; ctx.font='11px Outfit,sans-serif'; ctx.textAlign='center';
    axes.forEach((ax,i)=>{
      const a=-Math.PI/2+i/n*Math.PI*2;
      const x=cx+(R+18)*Math.cos(a), y=cy+(R+18)*Math.sin(a)+4;
      ctx.fillText(ax.lbl,x,y);
    });
  },
  renderInsights(){
    const el=U.$('#mood-insights-row'); if(!el) return;
    if(S.mood.length===0){ el.innerHTML=''; return; }
    const avg=key=>S.mood.length?(S.mood.reduce((a,e)=>a+(e[key]||5),0)/S.mood.length).toFixed(1):'—';
    const best=S.mood.reduce((a,e)=>Math.max(a,e.mood),0);
    const ins=[
      {val:`${this.EMOJIS[Math.round(avg('mood'))]} ${avg('mood')}`,lbl:'Avg Mood'},
      {val:`⚡ ${avg('energy')}`,lbl:'Avg Energy'},
      {val:`🎯 ${avg('focus')}`,lbl:'Avg Focus'},
      {val:S.mood.length,lbl:'Check-ins'},
      {val:`${this.EMOJIS[best]}`,lbl:'Best Day'},
    ];
    el.innerHTML=ins.map(i=>`<div class="mood-insight-card"><div class="mi-val">${i.val}</div><div class="mi-lbl">${i.lbl}</div></div>`).join('');
  },
  renderHistory(){
    const el=U.$('#mood-history'); if(!el) return;
    if(S.mood.length===0){ el.innerHTML=''; return;
    }
    el.innerHTML=S.mood.slice(0,15).map(e=>{
      const d=new Date(e.ts);
      const axes=`M:${e.slMood||e.mood} E:${e.energy} F:${e.focus} S:${e.stress}`;
      return `<div class="mood-history-item">
        <span class="mhi-emoji">${this.EMOJIS[e.mood]}</span>
        <div class="mhi-info">
          <div class="mhi-label">${this.LABELS[e.mood]} · Energy ${e.energy}/10</div>
          <div class="mhi-tags">${e.tags?.join(' · ')||'—'}</div>
          <div class="mhi-axes">${axes}</div>
        </div>
      
        <div class="mhi-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}</div>
      </div>`;
    }).join('');
  },
};

// ============================================================
// ── STATS CHARTS ────────────────────────────────────────────
// ============================================================
const Charts = {
  initAll(){
    this.drawHeroRow();
    this.drawWeeklyFocus();
    this.drawDonut();
    this.drawTrend();
    this.drawRadar();
    this.drawHeatmap();
    Achievements.render();
  },
  drawHeroRow(){
    const el=U.$('#stats-hero-row'); if(!el) return;
    const td=U.today();
    const habRate=()=>{ let p=0,d=0;
      S.habits.forEach(h=>{ Object.keys(h.completions||{}).filter(x=>x>=U.daysAgo(7)&&x<=td).forEach(()=>{p++; d++;p--;p++;}); }); return p>0?Math.round(d/p*100):0; };
    const items=[
      {icon:'◎',num:S.stats.totalSessions||0,lbl:'Focus Sessions',sub:'All time'},
      {icon:'◧',num:S.tasks.filter(t=>t.done).length,lbl:'Tasks Crushed',sub:'Completed'},
      {icon:'🔥',num:S.stats.streak||0,lbl:'Day Streak',sub:'Keep it up'},
      {icon:'◈',num:S.habits.filter(h=>h.completions?.[td]).length+'/'+S.habits.length,lbl:'Habits Today',sub:'Completed'},
      {icon:'📝',num:S.notes.length,lbl:'Notes',sub:'Created'},
      {icon:'✦',num:S.rewards.xp||0,lbl:'Total XP',sub:`Level ${S.rewards.level||1}`},
    ];
    el.innerHTML=items.map(i=>`<div class="stat-hero"><div class="sh-icon">${i.icon}</div><div class="sh-num">${i.num}</div><div class="sh-label">${i.lbl}</div><div class="sh-sub">${i.sub}</div></div>`).join('');
  },
  drawWeeklyFocus(){
    const cvs=U.$('#chart-weekly-focus'); if(!cvs)return;
    const W=cvs.width=cvs.offsetWidth||380, H=180; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const now=new Date(); const dow=now.getDay()===0?6:now.getDay()-1;
    const data=days.map((_,i)=>{ const d=new Date(now); d.setDate(now.getDate()-dow+i); const ds=d.toISOString().slice(0,10); return (S.stats.dailyFocus?.[ds]||0)/60; });
    const maxVal=Math.max(...data,0.5);
    const padX=32,padY=16,padB=26;
    const w=W-padX*2, h=H-padY-padB;
    const barW=(w/days.length)*.56, spacing=w/days.length;
    days.forEach((day,i)=>{
      const bh=Math.max(0,(data[i]/maxVal)*h);
      const x=padX+i*spacing+(spacing-barW)/2, y=padY+h-bh;
      const g=ctx.createLinearGradient(0,y,0,padY+h);
      g.addColorStop(0,'rgba(0,229,255,.9)'); g.addColorStop(1,'rgba(0,229,255,.1)');
      ctx.fillStyle=g;
      ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,barW,bh,[4,4,0,0]); else ctx.rect(x,y,barW,bh);
      ctx.fill();
      ctx.fillStyle='rgba(90,90,138,.7)'; ctx.font='9px JetBrains Mono'; ctx.textAlign='center';
      ctx.fillText(day,x+barW/2,H-6);
      if(data[i]>0.05){
        ctx.fillStyle='rgba(200,210,255,.8)';
        ctx.fillText(data[i].toFixed(1)+'h',x+barW/2,y-4);
      }
  
    });
  },
  drawDonut(){
    const cvs=U.$('#chart-donut'); if(!cvs)return;
    const W=280, H=180; cvs.width=W; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const cats=['work','personal','health','learn','creative','finance'];
    const cols=['#00e5ff','#7c83fd','#4dff91','#ffe76e','#ff4da6','#ff6b35'];
    const counts=cats.map(c=>S.tasks.filter(t=>t.cat===c).length);
    const total=counts.reduce((a,b)=>a+b,0);
    if(total===0){ ctx.fillStyle='rgba(90,90,138,.4)'; ctx.font='11px JetBrains Mono'; ctx.textAlign='center'; ctx.fillText('No tasks yet',W/2,H/2); return;
    }
    const cx=80, cy=H/2, R=60, inner=28; let ang=-Math.PI/2;
    counts.forEach((c,i)=>{
      if(c===0)return;
      const slice=(c/total)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,ang,ang+slice); ctx.closePath();
      ctx.fillStyle=cols[i]; ctx.fill(); ang+=slice;
    });
    ctx.beginPath(); ctx.arc(cx,cy,inner,0,Math.PI*2); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--card')||'#111124'; ctx.fill();
    ctx.fillStyle='rgba(200,200,255,.8)'; ctx.font='bold 14px JetBrains Mono'; ctx.textAlign='center'; ctx.fillText(total,cx,cy+5);
    ctx.font='9px Outfit';
    cats.forEach((cat,i)=>{
      if(counts[i]===0) return;
      const y=22+i*25;
      ctx.fillStyle=cols[i]; ctx.fillRect(152,y-8,10,10);
      ctx.fillStyle='rgba(200,200,255,.7)'; ctx.textAlign='left'; ctx.font='9px Outfit';
      ctx.fillText(`${cat} (${counts[i]})`,168,y);
    });
  },
  drawTrend(){
    const cvs=U.$('#chart-trend'); if(!cvs)return;
    const W=cvs.width=cvs.offsetWidth||380, H=180; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const days=30; const padX=30,padY=14,padB=26;
    const w=W-padX*2, h=H-padY-padB;
    const labels=Array.from({length:days},(_,i)=>U.daysAgo(days-1-i));
    const data=labels.map(d=>(S.stats.dailyFocus?.[d]||0)/60);
    const maxVal=Math.max(...data,0.5);
    const step=w/(days-1);
    // Area fill
    ctx.beginPath();
    data.forEach((v,i)=>{ const x=padX+i*step, y=padY+h-(v/maxVal)*h; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.lineTo(padX+(days-1)*step,padY+h); ctx.lineTo(padX,padY+h); ctx.closePath();
    const grad=ctx.createLinearGradient(0,padY,0,padY+h);
    grad.addColorStop(0,'rgba(0,229,255,.25)'); grad.addColorStop(1,'rgba(0,229,255,.02)');
    ctx.fillStyle=grad; ctx.fill();
    // Line
    ctx.beginPath();
    data.forEach((v,i)=>{ const x=padX+i*step, y=padY+h-(v/maxVal)*h; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.strokeStyle='rgba(0,229,255,.85)'; ctx.lineWidth=2; ctx.stroke();
    // X labels
    ctx.fillStyle='rgba(90,90,138,.6)'; ctx.font='9px JetBrains Mono'; ctx.textAlign='center';
    [0,7,14,21,29].forEach(i=>{ const d=new Date(labels[i]); ctx.fillText(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),padX+i*step,H-4); });
  },
  drawRadar(){
    const cvs=U.$('#chart-radar'); if(!cvs)return;
    const W=280, H=180; cvs.width=W; cvs.height=H;
    const ctx=cvs.getContext('2d'); ctx.clearRect(0,0,W,H);
    const cx=W/2, cy=H/2, R=70;
    const total=S.tasks.length||1, donePct=S.tasks.filter(t=>t.done).length/total;
    const allHabit=S.habits.length>0?S.habits.filter(h=>h.streak>0).length/S.habits.length:0;
    const moodAvg=S.mood.length?(S.mood.slice(0,7).reduce((a,e)=>a+e.mood,0)/Math.min(S.mood.length,7)/5):0;
    const focusPct=Math.min((S.stats.totalSessions||0)/100,1);
    const notesPct=Math.min((S.notes.length)/20,1);
    const vals=[donePct,allHabit,moodAvg,focusPct,notesPct];
    const lbls=['Tasks','Habits','Mood','Focus','Notes'];
    const n=vals.length;
    [.25,.5,.75,1].forEach(r=>{ ctx.beginPath(); for(let i=0;i<n;i++){ const a=-Math.PI/2+i/n*Math.PI*2; const x=cx+R*r*Math.cos(a),y=cy+R*r*Math.sin(a); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.closePath(); ctx.strokeStyle='rgba(100,120,255,.1)'; ctx.stroke(); });
    vals.forEach((_,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a)); ctx.strokeStyle='rgba(100,120,255,.2)'; ctx.stroke(); });
    ctx.beginPath();
    vals.forEach((v,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2, x=cx+R*v*Math.cos(a), y=cy+R*v*Math.sin(a); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.closePath(); ctx.fillStyle='rgba(0,229,255,.1)'; ctx.fill();
    ctx.strokeStyle='rgba(0,229,255,.8)'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='rgba(200,200,255,.7)'; ctx.font='10px Outfit';  ctx.textAlign='center';
    lbls.forEach((l,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2; ctx.fillText(l,cx+(R+14)*Math.cos(a),cy+(R+14)*Math.sin(a)+4); });
  },
  drawHeatmap(){
    const el=U.$('#heatmap');
    if(!el)return;
    const N=90;
    el.innerHTML=Array.from({length:N},(_,i)=>{
      const d=U.daysAgo(N-1-i);
      const hasFocus=(S.stats.dailyFocus?.[d]||0)>0;
      const hasTask=S.tasks.some(t=>new Date(t.created).toISOString().slice(0,10)===d);
      const hasHabit=S.habits.some(h=>h.completions?.[d]);
      const hasMood=S.mood.some(m=>m.date===d);
      const score=[hasFocus,hasTask,hasHabit,hasMood].filter(Boolean).length;
      return `<div class="hm-cell" ${score?`data-lv="${Math.min(score,4)}"`:''}  title="${d}: ${score} activities"></div>`;
    }).join('');
  },
};

// ============================================================
// ── REWARDS ─────────────────────────────────────────────────
// ============================================================
const Rewards = {
  BADGES:[
    {id:'explorer',icon:'🔭',name:'Explorer',desc:'First steps into the cosmos',xp:0},
    {id:'igniter',icon:'🔥',name:'Igniter',desc:'Start 10 focus sessions',xp:50},
    {id:'voyager',icon:'🚀',name:'Voyager',desc:'Complete 25 sessions',xp:150},
    {id:'nebular',icon:'🌌',name:'Nebular',desc:'Log 30 mood entries',xp:180},
    {id:'crusader',icon:'⚔️',name:'Crusader',desc:'Finish 50 tasks',xp:200},
    {id:'architect',icon:'🏗',name:'Architect',desc:'Create 15 notes',xp:80},
    {id:'ritualist',icon:'◈',name:'Ritualist',desc:'Build 5 habits',xp:100},
    {id:'titan',icon:'💎',name:'Titan',desc:'Reach Level 10',xp:0},
    {id:'sovereign',icon:'👑',name:'Sovereign',desc:'Reach Level 15',xp:0},
    {id:'phoenix',icon:'🦅',name:'Phoenix',desc:'30-day streak',xp:0},
  ],
  SHOP:[
    {id:'th_aurora',icon:'🌿',name:'Aurora Theme',desc:'Lush green cosmos',cost:200,type:'theme',val:'aurora'},
    {id:'th_pulsar',icon:'💜',name:'Pulsar Theme',desc:'Pink & violet cosmos',cost:250,type:'theme',val:'pulsar'},
    {id:'th_sol',icon:'☀️',name:'Sol Theme',desc:'Fiery orange cosmos',cost:200,type:'theme',val:'sol'},
    {id:'th_void',icon:'🔮',name:'Void Theme',desc:'Deep purple cosmos',cost:250,type:'theme',val:'void'},
    {id:'th_titan',icon:'⚡',name:'Titan Theme',desc:'Electric gold cosmos',cost:300,type:'theme',val:'titan'},
    {id:'ava_star',icon:'⭐',name:'Star Avatar',desc:'Sparkly new avatar',cost:150,type:'avatar',val:'⭐'},
    {id:'ava_comet',icon:'☄️',name:'Comet Avatar',desc:'Streaking avatar',cost:200,type:'avatar',val:'☄️'},
    {id:'ava_planet',icon:'🪐',name:'Planet Avatar',desc:'Ringed world',cost:250,type:'avatar',val:'🪐'},
    {id:'ava_galaxy',icon:'🌀',name:'Galaxy Avatar',desc:'Spiral perfection',cost:400,type:'avatar',val:'🌀'},
  ],
  MILESTONES:[
    {id:'m1',icon:'🎯',name:'First Orbit',desc:'Complete 10 total sessions',target:10,key:'totalSessions'},
    {id:'m2',icon:'🌙',name:'Night Shift',desc:'Complete 50 sessions',target:50,key:'totalSessions'},
    {id:'m3',icon:'🌟',name:'Century',desc:'Complete 100 sessions',target:100,key:'totalSessions'},
    {id:'m4',icon:'💫',name:'Titan Run',desc:'Accumulate 1000 focus minutes',target:1000,key:'totalFocusMins'},
    {id:'m5',icon:'🏆',name:'Task Master',desc:'Complete 100 tasks',target:100,key:'tasksCompleted'},
    {id:'m6',icon:'📚',name:'Scholar',desc:'Create 25 notes',target:25,key:'notesCreated'},
    {id:'m7',icon:'🧘',name:'Mindful',desc:'Log 50 mood entries',target:50,key:'moodLogs'},
    {id:'m8',icon:'🔥',name:'10-Day Streak',desc:'10-day streak',target:10,key:'streak'},
  ],

  init(){
    U.$$('.rt-tab').forEach(t=>t.onclick=()=>{ 
      U.$$('.rt-tab').forEach(x=>x.classList.remove('active')); 
      t.classList.add('active'); 
      U.$$('.rt-panel').forEach(p=>{ p.classList.remove('active'); p.classList.add('hidden'); }); 
      const panel=U.$(`#rt-${t.dataset.rt}`); 
      panel?.classList.add('active'); 
      panel?.classList.remove('hidden'); 
      S.ui.activeRewardTab=t.dataset.rt; 
      Audio.sfx('nav'); 
    });
    this.render();
    Bus.on('xp-change',()=>this.renderProfile());
    Bus.on('achievements-change',()=>this.render());
  },
  
  renderProfile(){
    const lvlEl = U.$('#rp-level');
    if (lvlEl) lvlEl.textContent=`Level ${S.rewards.level||1}`;
    
    const nameEl = U.$('#rp-name');
    if (nameEl) nameEl.textContent=XP.getLevelTitle(S.rewards.level||1);
    
    const xpTextEl = U.$('#rp-xp-text');
    if (xpTextEl) xpTextEl.textContent=`${S.rewards.xp} / ${XP.xpForNext()} XP`;
    
    const xpFillEl = U.$('#rp-xp-fill');
    if (xpFillEl) xpFillEl.style.width=XP.pct()+'%';
    
    const totXpEl = U.$('#rpm-total-xp');
    if (totXpEl) totXpEl.textContent=S.rewards.xp||0;
    
    const badEl = U.$('#rpm-badges');
    if (badEl) badEl.textContent=(S.rewards.achievements||[]).length;
    
    const strkEl = U.$('#rpm-streak');
    if (strkEl) strkEl.textContent=S.stats.streak||0;
    
    const av=S.rewards.owned?.find(o=>o.type==='avatar')?.val||'◈';
    const avEl = U.$('#rp-avatar');
    if (avEl) avEl.textContent=av;
    
    Timer.updateMiniStats();
  },
  
  render(){ 
    this.renderProfile();
    this.renderBadges();
    this.renderShop();
    this.renderMilestones();
  },

  renderBadges(){
    const el=U.$('#rt-badges'); if(!el)return;
    const unlocked=S.rewards.achievements||[];
    el.innerHTML=this.BADGES.map(b=>`
      <div class="ach-card ${unlocked.includes(b.id)?'unlocked':''}">
        <div class="ach-icon">${b.icon}</div>
        <div class="ach-name">${b.name}</div>
        <div class="ach-desc">${b.desc}</div>
      </div>`).join('');
  },

  renderShop(){
    const el=U.$('#rt-shop'); if(!el)return;
    const owned=S.rewards.owned||[];
    el.innerHTML=this.SHOP.map(s=>{
      const isOwned=owned.find(o=>o.id===s.id);
      return `
      <div class="ach-card ${isOwned?'unlocked':''}">
        <div class="ach-icon">${s.icon}</div>
        <div class="ach-name">${s.name}</div>
        <div class="ach-desc">${s.desc}</div>
        ${!isOwned?`<button class="btn btn-sm" onclick="Rewards.buy('${s.id}')">${s.cost} XP</button>`:`<div class="ach-badge" style="margin-top:8px;font-size:0.8rem;color:var(--tx-faint)">Owned</div>`}
      </div>`;
    }).join('');
  },

  renderMilestones(){
    const el=U.$('#rt-milestones'); if(!el)return;
    el.innerHTML=this.MILESTONES.map(m=>{
      const val=S.stats[m.key]||0;
      const pct=Math.min((val/m.target)*100,100);
      const done=val>=m.target;
      return `
      <div class="ach-card ${done?'unlocked':''}">
        <div class="ach-icon">${m.icon}</div>
        <div class="ach-name">${m.name}</div>
        <div class="ach-desc">${m.desc}</div>
        <div class="habit-streak-row" style="margin-top:10px">
          <div class="habit-streak-bar"><div class="habit-streak-fill" style="width:${pct}%;background:var(--ac-1)"></div></div>
          <div class="habit-streak-num">${val}/${m.target}</div>
        </div>
      </div>`;
    }).join('');
  },

  buy(id){
    const item=this.SHOP.find(s=>s.id===id); if(!item)return;
    const owned=S.rewards.owned||[];
    if(owned.find(o=>o.id===id)) { Notify.info('Already owned!'); return; }
    if((S.rewards.xp||0)<item.cost){ Notify.warn('Not enough XP! Keep focusing.','💎'); Audio.sfx('error'); return; }
    
    S.rewards.xp-=item.cost;
    owned.push(item);
    S.rewards.owned=owned;
    Store.set('rewards',S.rewards);
    Bus.emit('xp-change',S.rewards.xp,S.rewards.level);
    
    this.renderShop(); 
    this.renderProfile(); 
    Audio.sfx('achieve'); 
    Confetti.burst(40);
    Notify.success(`Purchased ${item.name}!`, item.icon);
    
    // Apply immediately if it's a theme
    if(item.type==='theme'){
      S.settings.theme=item.val;
      Store.set('settings',S.settings);
      document.documentElement.dataset.theme=item.val;
      BG.resize();
    }
  }
};

// ============================================================
// ── APP BOOTSTRAP ───────────────────────────────────────────
// ============================================================
const App = {
  init(){
    this.bindNav();
    this.bindSettings();
    this.applyTheme();
    
    // Init modules
    Audio.init();
    Cursor.init();
    Notify.init();
    Confetti.init();
    Achievements.init();
    Timer.init();
    Tasks.init();
    Habits.init();
    Notes.init();
    Mood.init();
    Charts.initAll();
    Rewards.init();
    
    BG.initNebula();
    BG.initStars();
    BG.initParticles();
    window.addEventListener('resize', U.debounce(()=>BG.resize(), 250));
    
    // Initial Greeting
    setTimeout(() => {
      Notify.info('Cosmic systems online. Welcome back!','🚀');
    }, 500);
  },
  
  bindNav(){
    // Map navigation elements to their views
    U.$$('.nav-btn, .nav-item').forEach(btn=>{
      btn.onclick=()=>{
        U.$$('.nav-btn, .nav-item').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const view=btn.dataset.view;
        if (!view) return;
        
        U.$$('.view-panel').forEach(p=>{ p.classList.remove('active'); p.classList.add('hidden'); });
        const panel=U.$(`#view-${view}`);
        panel?.classList.add('active'); panel?.classList.remove('hidden');
        S.ui.activePanel=view;
        Audio.sfx('nav');
        
        // Re-render heavy views dynamically when switched to
        if(view==='stats') Charts.initAll();
        if(view==='rewards') Rewards.render();
      };
    });
  },
  
  bindSettings(){
    const th=U.$('#settings-theme');
    if(th){
      th.value=S.settings.theme||'nebula';
      th.onchange=e=>{
        S.settings.theme=e.target.value;
        Store.set('settings',S.settings);
        this.applyTheme();
        Audio.sfx('click');
      };
    }
    const snd=U.$('#settings-sound');
    if(snd){
      snd.checked=S.settings.sound;
      snd.onchange=e=>{
        S.settings.sound=e.target.checked;
        Store.set('settings',S.settings);
      };
    }
    const timerSnd=U.$('#settings-timer-sound');
    if(timerSnd){
      timerSnd.checked=S.settings.timerSound;
      timerSnd.onchange=e=>{
        S.settings.timerSound=e.target.checked;
        Store.set('settings',S.settings);
      };
    }
    
    // Settings Modals / Actions
    U.$('#data-export-btn')?.addEventListener('click', () => {
      const data = Store.export();
      const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `vortex-backup-${U.today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Notify.success('Data exported successfully','💾');
    });
    
    U.$('#data-import-btn')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        if(!file)return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const data = JSON.parse(ev.target.result);
            Store.import(data);
            Notify.success('Data imported! Reloading...','♻️');
            setTimeout(()=>location.reload(), 1500);
          } catch(err) {
            Notify.error('Invalid backup file','✕');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
    
    U.$('#data-clear-btn')?.addEventListener('click', () => {
      if(confirm('Are you sure you want to clear ALL data? This cannot be undone.')) {
        Store.clear();
        location.reload();
      }
    });
  },
  
  applyTheme(){
    document.documentElement.dataset.theme=S.settings.theme||'nebula';
    BG.resize();
  }
};

// ============================================================
// ── IGNITION ────────────────────────────────────────────────
// ============================================================
document.addEventListener('DOMContentLoaded', () => App.init());
