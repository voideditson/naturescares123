import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MAPS, heightAt, clientMap } from './maps.js';
import { DISASTERS, stepFalls, applyLiquid } from './disasters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.get('/health', (req, res) => res.send('ok'));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m' }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

// ---------- timings ----------
const FAST = process.env.DZ_FAST === '1';
const INTERMISSION = FAST ? 2 : 10, PREP = FAST ? 2 : 8, RESULTS = FAST ? 2 : 7, TICK = 1 / 30;

// ---------- state ----------
const players = new Map();
let nextId = 1, entId = 1;
let phase = 'intermission';
let phaseT = INTERMISSION;
let map = MAPS[Math.floor(Math.random() * MAPS.length)];
let nextMap = map;
let disaster = DISASTERS[0];
let lastDisasterId = null, lastMapId = null;
let ents = [], events = [];
let env = freshEnv();
let ctx = null, runner = null, roundTime = 0;
const chosen = { disaster: null };

function freshEnv() {
  return { sky: null, dark: 0, shake: 0, weather: null, fogMul: 1, wind: null, liquid: null };
}
const pick = (arr, avoidId) => {
  const opts = arr.filter(a => a.id !== avoidId);
  return opts[Math.floor(Math.random() * opts.length)];
};
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (o) => { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const r2 = (v) => Math.round(v * 100) / 100;
const alivePlayers = () => [...players.values()].filter(p => p.alive);

function phaseMsg() {
  return {
    t: 'phase', phase, left: phaseT, nextMap: nextMap.name, map: map.name,
    disaster: (phase === 'active' || phase === 'results') && disaster ? { id: disaster.id, name: disaster.name, blurb: disaster.blurb, dur: disaster.dur } : null,
  };
}

function board() {
  broadcast({
    t: 'board',
    list: [...players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, alive: p.alive })),
  });
}

// ---------- players ----------
function spawnAll() {
  const spots = [...map.spawns].sort(() => Math.random() - 0.5);
  let i = 0;
  for (const p of players.values()) {
    const s = spots[i++ % spots.length];
    placePlayer(p, s.x + (i > spots.length ? Math.random() * 3 : 0), s.y, s.z + (i > spots.length ? Math.random() * 3 : 0));
    p.hp = 100; p.alive = true; p.cold = 0;
  }
}

function placePlayer(p, x, y, z) {
  p.x = x; p.y = y; p.z = z; p.tpN++;
  p.lastPos = { x, y, z, t: Date.now() };
  send(p.ws, { t: 'spawn', x, y: y + 0.05, z, n: p.tpN });
}

function damage(p, amt, cause) {
  if (!p.alive || amt <= 0) return;
  p.hp -= amt;
  p.lastHit = Date.now();
  p.cause = cause;
  p.hpDirty = true;
  if (p.hp <= 0) kill(p, cause);
}

function kill(p, cause) {
  if (!p.alive) return;
  p.hp = 0; p.alive = false; p.hpDirty = true;
  broadcast({ t: 'kill', id: p.id, name: p.name, cause });
  board();
}

function push(p, x, y, z) {
  p.imp.x += x; p.imp.y += y; p.imp.z += z;
}

// ---------- rounds ----------
function randomTarget(bias = 0.5) {
  const al = alivePlayers();
  for (let i = 0; i < 6; i++) {
    let x, z;
    if (al.length && Math.random() < bias) {
      const p = al[Math.floor(Math.random() * al.length)];
      const a = Math.random() * Math.PI * 2, d = Math.random() * 7;
      x = p.x + Math.cos(a) * d; z = p.z + Math.sin(a) * d;
    } else {
      x = (Math.random() * 2 - 1) * map.half * 0.95; z = (Math.random() * 2 - 1) * map.half * 0.95;
    }
    x = Math.max(-map.half, Math.min(map.half, x)); z = Math.max(-map.half, Math.min(map.half, z));
    const ty = heightAt(map, x, z);
    if (ty !== null) return { tx: x, tz: z, ty };
  }
  return { tx: 0, tz: 0, ty: heightAt(map, 0, 0) ?? 0 };
}

function setPhase(ph, t) {
  phase = ph; phaseT = t;
  broadcast(phaseMsg());
}

function startIntermission() {
  ents = []; events = []; env = freshEnv(); ctx = null; runner = null;
  nextMap = (process.env.DZ_MAP && MAPS.find(m => m.id === process.env.DZ_MAP)) || pick(MAPS, lastMapId);
  for (const p of players.values()) { p.hp = 100; p.alive = true; p.cold = 0; }
  setPhase('intermission', INTERMISSION);
  board();
}

function startPrep() {
  map = nextMap; lastMapId = map.id;
  disaster = (process.env.DZ_DISASTER && DISASTERS.find(d => d.id === process.env.DZ_DISASTER)) || pick(DISASTERS, lastDisasterId);
  lastDisasterId = disaster.id;
  broadcast({ t: 'map', map: clientMap(map) });
  spawnAll();
  setPhase('prep', PREP);
  board();
}

function startActive() {
  ents = []; events = []; env = freshEnv(); roundTime = 0;
  ctx = {
    map, rand: Math.random, time: 0, dur: disaster.dur, env, ents,
    players: () => [...players.values()],
    alive: alivePlayers,
    damage, push, randomTarget,
    ev: (o) => events.push(o),
    addEnt: (e) => { e.id = entId++; ents.push(e); return e; },
    removeEnt: (e) => { const i = ents.indexOf(e); if (i >= 0) ents.splice(i, 1); },
  };
  runner = disaster.create(ctx);
  setPhase('active', disaster.dur);
}

function startResults() {
  const survivors = alivePlayers();
  for (const p of survivors) p.score += 50;
  broadcast({ t: 'results', survivors: survivors.map(p => p.name), disaster: disaster.name });
  setPhase('results', RESULTS);
  board();
  ents = []; env = freshEnv();
}

// ---------- main loop ----------
let last = Date.now(), boardT = 0, hpT = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (players.size === 0) return; // idle server does nothing

  phaseT -= dt;
  if (phase === 'intermission' && phaseT <= 0) startPrep();
  else if (phase === 'prep' && phaseT <= 0) startActive();
  else if (phase === 'active') {
    roundTime += dt; ctx.time = roundTime;
    runner.update(dt);
    stepFalls(ctx, dt);
    applyLiquid(ctx, dt);
    if (roundTime >= disaster.dur || alivePlayers().length === 0) startResults();
    boardT += dt;
    if (boardT >= 1) { boardT = 0; for (const p of alivePlayers()) p.score += 1; board(); }
  } else if (phase === 'results' && phaseT <= 0) startIntermission();

  // per-player upkeep
  for (const p of players.values()) {
    if (!p.alive) { p.imp.x = p.imp.y = p.imp.z = 0; continue; }
    if (p.y < (map.ground != null ? -25 : map.void ?? -30)) kill(p, 'falling');
    if (Date.now() - p.lastHit > 4000 && p.hp < 100) { p.hp = Math.min(100, p.hp + 3 * dt); p.hpDirty = true; }
    if (p.imp.x || p.imp.y || p.imp.z) {
      send(p.ws, { t: 'imp', x: r2(p.imp.x), y: r2(p.imp.y), z: r2(p.imp.z) });
      p.imp.x = p.imp.y = p.imp.z = 0;
    }
  }
  hpT += dt;
  if (hpT > 0.1) {
    hpT = 0;
    for (const p of players.values()) if (p.hpDirty) { p.hpDirty = false; send(p.ws, { t: 'hp', hp: Math.round(p.hp), cause: p.cause || '' }); }
  }

  const snap = {
    t: 's', ph: phase, left: Math.max(0, r2(phaseT)),
    pl: [...players.values()].map(p => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.anim, p.alive ? 1 : 0]),
    ents: ents.map(e => { const o = {}; for (const k in e) if (k[0] !== '_') o[k] = typeof e[k] === 'number' ? r2(e[k]) : e[k]; return o; }),
    env, ev: events,
  };
  events = [];
  broadcast(snap);
}, TICK * 1000);

// ---------- connections ----------
const COLORS = [0xff5a5a, 0xffa23a, 0xffe14a, 0x6be36b, 0x4ad6c8, 0x5aa0ff, 0x9a7bff, 0xff7bd5];
wss.on('connection', (ws) => {
  const id = nextId++;
  const p = {
    id, ws, name: 'Player' + id, color: COLORS[id % COLORS.length], x: 0, y: 0, z: 0, ry: 0, anim: 0,
    hp: 100, alive: true, score: 0, lastHit: 0, tpN: 0, imp: { x: 0, y: 0, z: 0 }, joined: false,
    lastPos: null, cold: 0,
  };
  players.set(id, p);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      p.name = String(m.name || '').replace(/[^\w \-.]/g, '').slice(0, 16) || p.name;
      p.joined = true;
      send(ws, { t: 'hello', id, color: p.color, map: clientMap(map), others: [...players.values()].map(o => ({ id: o.id, name: o.name, color: o.color })) });
      send(ws, phaseMsg());
      const s = map.spawns[Math.floor(Math.random() * map.spawns.length)];
      // late joiners during a live round spectate until the next one
      p.alive = phase !== 'active' && phase !== 'results';
      placePlayer(p, s.x, s.y, s.z);
      broadcast({ t: 'joined', id, name: p.name, color: p.color });
      board();
    } else if (m.t === 'p' && p.joined) {
      if (m.n !== p.tpN) return;
      const x = +m.x, y = +m.y, z = +m.z;
      if (!Number.isFinite(x + y + z)) return;
      const now = Date.now();
      if (p.lastPos) {
        const dtm = Math.max(0.02, (now - p.lastPos.t) / 1000);
        const dist = Math.hypot(x - p.lastPos.x, z - p.lastPos.z);
        if (dist > 90 * dtm + 12) { placePlayer(p, p.lastPos.x, p.lastPos.y, p.lastPos.z); return; }
      }
      p.x = Math.max(-300, Math.min(300, x)); p.y = Math.max(-200, Math.min(200, y)); p.z = Math.max(-300, Math.min(300, z));
      p.ry = +m.ry || 0; p.anim = m.a | 0; p.grounded = !!m.g;
      p.lastPos = { x: p.x, y: p.y, z: p.z, t: now };
    } else if (m.t === 'chat' && p.joined) {
      const text = String(m.text || '').slice(0, 120).trim();
      if (text) broadcast({ t: 'chat', name: p.name, color: p.color, text });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ t: 'left', id });
    board();
    if (players.size === 0) { startIntermission(); }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

startIntermission();
server.listen(PORT, () => console.log('Disaster Zone listening on ' + PORT));
