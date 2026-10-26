import * as THREE from 'three';
import { World, Avatar } from './world.js';
import { P, buildWorld, newState, step, pointInSolid } from './physics.js';
import { sfx, unlock, toggleMute } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 800);
const world = new World(scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- state ----------
const me = { id: 0, name: '', color: 0xffffff, hp: 100, alive: true, tpN: 0, joined: false };
const st = newState(0, 5, 0);
let phys = null;                // physics world for current map
let env = {};                   // latest environment from server
let ents = [];
let phase = 'intermission', phaseLeft = 0, disasterName = '', aliveCount = 0;
const names = new Map(), others = new Map();
let myAvatar = null;
let specId = 0;
let netT = 0, ws = null, connected = false;
let camYaw = 0, camPitch = 0.35, camDist = 9, camDistNow = 9, camY = 5, localShake = 0, fovNow = 68;
let lastTick = -1;

// ---------- input ----------
const keys = new Set();
let jumpEdge = false, chatOpen = false, dragging = false;

addEventListener('keydown', (e) => {
  if (chatOpen) {
    if (e.code === 'Enter') { const v = $('chatInput').value.trim(); if (v) send({ t: 'chat', text: v }); closeChat(); }
    else if (e.code === 'Escape') closeChat();
    return;
  }
  if (!me.joined) return;
  if (e.code === 'Enter') { openChat(); e.preventDefault(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyQ' || e.code === 'ArrowLeft') cycleSpec(-1);
  if (e.code === 'KeyE' || e.code === 'ArrowRight') cycleSpec(1);
  if (e.code === 'Space') { if (!keys.has('Space')) jumpEdge = true; e.preventDefault(); }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function openChat() { chatOpen = true; keys.clear(); const c = $('chatInput'); c.style.display = 'block'; c.value = ''; c.focus(); if (document.pointerLockElement) document.exitPointerLock(); }
function closeChat() { chatOpen = false; $('chatInput').style.display = 'none'; $('chatInput').blur(); }

canvas.addEventListener('mousedown', () => {
  unlock();
  if (!me.joined) return;
  dragging = true;
  if (!document.pointerLockElement) { try { canvas.requestPointerLock(); } catch {} }
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!me.joined || chatOpen) return;
  if (document.pointerLockElement === canvas || dragging) {
    camYaw -= e.movementX * 0.0026;
    camPitch = clamp(camPitch + e.movementY * 0.0026, -0.35, 1.3);
  }
});
addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.006, 3.5, 18); }, { passive: true });

// ---------- networking ----------
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => {
    connected = true; setBanner('Connected', '');
    if (me.joined) send({ t: 'join', name: me.name });
  };
  ws.onclose = () => { connected = false; setBanner('Reconnecting...', 'The server may be waking up, this can take up to a minute'); setTimeout(connect, 1500); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      me.id = m.id; me.color = m.color; if (myAvatar) myAvatar.setColor(me.color);
      for (const o of m.others) names.set(o.id, { name: o.name, color: o.color });
      loadMap(m.map);
      break;
    case 'map': loadMap(m.map); break;
    case 'joined': names.set(m.id, { name: m.name, color: m.color }); break;
    case 'left': { const o = others.get(m.id); if (o) { scene.remove(o.av.group); others.delete(m.id); } names.delete(m.id); break; }
    case 'spawn':
      st.x = m.x; st.y = m.y; st.z = m.z; st.vx = st.vz = st.vy = st.kx = st.kz = 0; st.grounded = false;
      me.tpN = m.n; camY = m.y + 1.5; break;
    case 'imp':
      st.kx += m.x; st.kz += m.z; st.vy = clamp(st.vy + m.y, -60, 42);
      if (m.y > 0.5) st.grounded = false;
      break;
    case 'hp': {
      if (m.hp < me.hp - 0.5) { hurt(me.hp - m.hp); }
      me.hp = m.hp; updateHp(); break;
    }
    case 'phase': onPhase(m); break;
    case 'board': drawBoard(m.list); break;
    case 'kill':
      feed(m.id === me.id ? `You died: ${m.cause}` : `${m.name} was killed by ${m.cause}`);
      if (m.id === me.id) { sfx.die(); }
      break;
    case 'results':
      feed(m.survivors.length ? `Survivors: ${m.survivors.join(', ')}` : 'Nobody survived the ' + m.disaster);
      break;
    case 'chat': feed(`${m.name}: ${m.text}`); break;
    case 's': onSnap(m); break;
  }
}

function loadMap(m) {
  world.loadMap(m); phys = buildWorld(m); ents = [];
  for (const o of others.values()) o.snapped = false;
}

function onPhase(m) {
  const prev = phase;
  phase = m.phase; phaseLeft = m.left;
  if (m.phase === 'active' && m.disaster) {
    disasterName = m.disaster.name;
    $('alertName').textContent = m.disaster.name; $('alertBlurb').textContent = m.disaster.blurb;
    $('alert').classList.add('show'); setTimeout(() => $('alert').classList.remove('show'), 4200);
    sfx.start();
  }
  if (m.phase === 'prep') { feed(`New map: ${m.map}`); }
  if (m.phase === 'intermission') { disasterName = ''; }
  void prev;
}

function onSnap(m) {
  phase = m.ph; phaseLeft = m.left;
  env = m.env || {}; ents = m.ents;
  if (phys) phys.liquid = env.liquid ? env.liquid.level : null;
  let alive = 0;
  for (const [id, x, y, z, ry, anim, al] of m.pl) {
    if (al) alive++;
    if (id === me.id) {
      if (al !== (me.alive ? 1 : 0)) { me.alive = !!al; if (!al) { specId = 0; } }
      continue;
    }
    let o = others.get(id);
    if (!o) {
      const info = names.get(id) || { name: 'Player', color: 0xcccccc };
      o = { av: new Avatar(info.color, info.name), x, y, z, ry, tx: x, ty: y, tz: z, tr: ry, anim: 0, alive: true, snapped: false };
      scene.add(o.av.group); others.set(id, o);
    }
    o.tx = x; o.ty = y; o.tz = z; o.tr = ry; o.anim = anim; o.alive = !!al;
    if (!o.snapped) { o.x = x; o.y = y; o.z = z; o.snapped = true; }
  }
  aliveCount = alive;
  for (const e of m.ev || []) onEvent(e);
}

function onEvent(e) {
  const d = Math.hypot(e.x - st.x, e.z - st.z);
  if (e.k === 'boom') {
    world.boom(e);
    const near = clamp(1 - d / (e.r * 6 + 40), 0, 1);
    localShake = Math.max(localShake, near * 1.2);
    if (near > 0.02) sfx.boom(near);
  } else if (e.k === 'bolt') {
    world.bolt(e);
    const near = clamp(1 - d / 90, 0.15, 1);
    $('flash').style.opacity = String(0.7 * near); setTimeout(() => { $('flash').style.opacity = '0'; }, 70);
    localShake = Math.max(localShake, near * 0.6);
    sfx.thunder(near);
  }
}

// ---------- HUD ----------
function setBanner(a, b) { $('bannerMain').textContent = a; $('bannerSub').textContent = b; }
function feed(text) {
  const d = document.createElement('div'); d.textContent = text; $('feed').appendChild(d);
  setTimeout(() => d.remove(), 9000);
  while ($('feed').children.length > 7) $('feed').firstChild.remove();
}
function updateHp() {
  const f = $('hpfill'); f.style.width = clamp(me.hp, 0, 100) + '%';
  f.style.background = me.hp > 60 ? '#4be36b' : me.hp > 30 ? '#ffc94a' : '#ff4a4a';
  $('hptext').textContent = Math.ceil(me.hp);
}
function hurt(amt) {
  const v = $('vignette'); v.style.opacity = String(clamp(amt / 40, 0.3, 1));
  setTimeout(() => { v.style.opacity = '0'; }, 160);
  if (amt > 8) { sfx.hit(); localShake = Math.max(localShake, 0.35); }
}
function drawBoard(list) {
  list.sort((a, b) => b.score - a.score);
  $('board').innerHTML = '<div class="row"><b>Players</b><b>Score</b></div>' +
    list.slice(0, 12).map(p => `<div class="row ${p.alive ? '' : 'dead'} ${p.id === me.id ? 'me' : ''}"><span></span><span>${p.score}</span></div>`).join('');
  const rows = $('board').querySelectorAll('.row span:first-child');
  list.slice(0, 12).forEach((p, i) => { rows[i].textContent = p.name; });
}
function updateBanner() {
  const t = Math.ceil(phaseLeft);
  if (phase === 'intermission') setBanner('Intermission', `Next round starts in ${t}s`);
  else if (phase === 'prep') setBanner(`Get ready: ${t}`, 'Find a good spot before the disaster hits');
  else if (phase === 'active') setBanner(`${disasterName}  ${t}s`, `${aliveCount} alive`);
  else if (phase === 'results') setBanner('Round over', '');
}
function cycleSpec(d) {
  if (me.alive) return;
  const ids = [...others.entries()].filter(([, o]) => o.alive).map(([id]) => id);
  if (!ids.length) { specId = 0; return; }
  const i = ids.indexOf(specId);
  specId = ids[(i + d + ids.length) % ids.length];
}

// ---------- join ----------
$('nameInput').value = (() => { try { return localStorage.getItem('dz_name') || ''; } catch { return ''; } })();
function join() {
  me.name = $('nameInput').value.trim().slice(0, 16) || 'Player' + Math.floor(Math.random() * 900 + 100);
  try { localStorage.setItem('dz_name', me.name); } catch {}
  me.joined = true; unlock();
  $('join').style.display = 'none';
  myAvatar = new Avatar(0xffffff, me.name); myAvatar.label.visible = false;
  scene.add(myAvatar.group);
  send({ t: 'join', name: me.name });
  try { canvas.requestPointerLock(); } catch {}
}
$('playBtn').onclick = join;
$('nameInput').addEventListener('keydown', (e) => { if (e.code === 'Enter') join(); });

// ---------- main loop ----------
const STEP = 1 / 120;
let acc = 0, prev = performance.now(), clock = 0;
const tmp = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now; clock += dt;

  if (me.joined && phys && me.alive) {
    // input -> world space move vector
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const inp = { mx, mz, jump: keys.has('Space'), jumpPressed: false, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    acc += dt;
    while (acc >= STEP) {
      inp.jumpPressed = jumpEdge; jumpEdge = false;
      const ev = step(st, inp, STEP, phys);
      if (ev.jumped) sfx.jump();
      if (ev.landed) sfx.land(ev.landed);
      if (ev.pad) sfx.pad();
      acc -= STEP;
    }
    if (ml > 0.1) {
      const target = Math.atan2(mx, mz);
      let d = target - st.face; d = Math.atan2(Math.sin(d), Math.cos(d));
      st.face += d * (1 - Math.exp(-22 * dt));
    }
  }

  // local avatar
  if (myAvatar) {
    myAvatar.group.visible = me.alive;
    myAvatar.group.position.set(st.x, st.y, st.z);
    myAvatar.group.rotation.y = st.face;
    myAvatar.pose(st.speed, !st.grounded && !st.swim, st.swim, dt);
  }

  // remote avatars (smoothed)
  const k = 1 - Math.exp(-16 * dt);
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
    let d = o.tr - o.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); o.ry += d * k;
    const spd = Math.hypot(o.tx - o.x, o.tz - o.z) * 14;
    o.av.group.visible = o.alive;
    o.av.group.position.set(o.x, o.y, o.z); o.av.group.rotation.y = o.ry;
    o.av.pose(o.anim === 1 ? Math.max(spd, 9) : spd, o.anim === 2, o.anim === 3, dt);
  }

  // camera
  let tx = st.x, ty = st.y, tz = st.z;
  if (!me.alive) {
    let o = others.get(specId);
    if (!o || !o.alive) { cycleSpec(1); o = others.get(specId); }
    if (o && o.alive) { tx = o.x; ty = o.y; tz = o.z; }
    else { tx = 0; ty = 12; tz = 0; camYaw += dt * 0.15; }
    $('spec').textContent = o && o.alive ? `Spectating ${names.get(specId)?.name || 'player'}  (Q / E to switch)` : 'Everyone is down';
  } else $('spec').textContent = '';
  camY += (ty + 1.6 - camY) * (1 - Math.exp(-20 * dt));
  const cy = Math.abs(ty + 1.6 - camY) > 6 ? ty + 1.6 : camY;
  const cosP = Math.cos(camPitch), sinP = Math.sin(camPitch);
  const dx = Math.sin(camYaw) * cosP, dy = sinP, dz = Math.cos(camYaw) * cosP;
  let allow = camDist;
  if (phys) {
    for (let i = 1; i <= 12; i++) {
      const dd = camDist * i / 12;
      if (pointInSolid(phys, tx + dx * dd, cy + dy * dd, tz + dz * dd, 0.25)) { allow = Math.max(1.2, dd - camDist / 12); break; }
    }
  }
  camDistNow += (allow - camDistNow) * (1 - Math.exp((allow < camDistNow ? -30 : -6) * dt));
  localShake = Math.max(0, localShake - dt * 1.8);
  const sh = (world.shake * 0.35 + localShake * 0.5);
  camera.position.set(tx + dx * camDistNow + (Math.random() - 0.5) * sh, cy + dy * camDistNow + (Math.random() - 0.5) * sh, tz + dz * camDistNow + (Math.random() - 0.5) * sh);
  camera.lookAt(tx, cy + 0.1, tz);
  const fovT = 68 + clamp((st.speed - 12) * 0.9, 0, 9);
  fovNow += (fovT - fovNow) * (1 - Math.exp(-6 * dt));
  if (Math.abs(camera.fov - fovNow) > 0.05) { camera.fov = fovNow; camera.updateProjectionMatrix(); }

  // sun follows the view so shadows stay sharp
  const sx = Math.round(tx / 4) * 4, sz = Math.round(tz / 4) * 4;
  world.sun.position.set(sx + 60, 100, sz + 40); world.sun.target.position.set(sx, 0, sz);

  world.setEnv(env, dt, camera.position, clock);
  world.syncEnts(ents, dt, clock);
  world.updateFx(dt);

  // liquid tint when the camera is under it
  const L = env.liquid;
  if (L && camera.position.y < L.level) {
    const c = L.kind === 'lava' ? 'rgba(255,70,10,.75)' : L.kind === 'acid' ? 'rgba(120,255,40,.5)' : 'rgba(20,80,200,.5)';
    $('tint').style.background = c; $('tint').style.opacity = '1';
  } else $('tint').style.opacity = '0';

  updateBanner();
  renderer.render(scene, camera);

  // network position at 20Hz
  netT += dt;
  if (netT >= 0.05 && me.joined && connected) {
    netT = 0;
    const anim = st.swim ? 3 : !st.grounded ? 2 : st.speed > 1.5 ? 1 : 0;
    send({ t: 'p', n: me.tpN, x: +st.x.toFixed(2), y: +st.y.toFixed(2), z: +st.z.toFixed(2), ry: +st.face.toFixed(2), a: anim, g: st.grounded ? 1 : 0 });
  }
}

connect();
requestAnimationFrame(frame);
window.__dz = { st, me, world, others }; // handy for debugging in the console
