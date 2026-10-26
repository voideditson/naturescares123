import * as THREE from 'three';

const STYLE_COLOR = { meteor: 0xff7a2a, bomb: 0xff3a1a, rock: 0x8a7f72, ice: 0x9fe6ff };
const LIQUID = { water: [0x2a7bd6, 0.62], lava: [0xff5a14, 0.92], acid: [0x7cff2a, 0.7] };
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tmpColor = new THREE.Color();

function checker(a, b) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 64);
  g.fillStyle = b; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 1.0);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(60, 100, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -55; sc.right = sc.top = 55; sc.near = 10; sc.far = 260;
    this.sun.shadow.bias = -0.0005;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.mapGroup = new THREE.Group(); this.entGroup = new THREE.Group(); this.fxGroup = new THREE.Group();
    scene.add(this.mapGroup, this.entGroup, this.fxGroup);
    this.objs = new Map(); this.fx = [];
    this.map = null; this.skyNow = new THREE.Color(0x8fd0ff); this.skyTarget = new THREE.Color(0x8fd0ff);
    this.dark = 0; this.fogMul = 1; this.liquidMesh = null; this.liquidLevel = null; this.weather = null;
    this.shake = 0;
    scene.fog = new THREE.FogExp2(0x8fd0ff, 0.004);
    scene.background = this.skyNow;
    this.initWeather();
  }

  loadMap(m) {
    this.map = m;
    this.mapGroup.traverse(o => { if (o.geometry && o.geometry !== unitBox) o.geometry.dispose(); });
    this.mapGroup.clear();
    this.clearEnts();
    const n = m.boxes.length;
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const im = new THREE.InstancedMesh(unitBox, mat, n);
    const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m.boxes.forEach((b, i) => {
      pos.set(b.x, b.y + b.h / 2, b.z); sc.set(b.w, b.h, b.d);
      mtx.compose(pos, q, sc); im.setMatrixAt(i, mtx);
      im.setColorAt(i, tmpColor.setHex(b.c));
    });
    im.castShadow = im.receiveShadow = true;
    this.mapGroup.add(im);
    if (m.ground != null) {
      const size = m.half * 2 + 600;
      const tex = checker('#ffffff', '#e3e3e3'); tex.repeat.set(size / 10, size / 10);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: m.ground, map: tex }));
      g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
      this.mapGroup.add(g);
      // arena edge marker
      const edge = new THREE.Mesh(new THREE.BoxGeometry(m.half * 2 + 2, 0.15, m.half * 2 + 2), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }));
      edge.position.y = 0.1; this.mapGroup.add(edge);
    } else {
      // clouds far below to sell the height
      const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
      for (let i = 0; i < 40; i++) {
        const c = new THREE.Mesh(unitBox, cm);
        c.scale.set(14 + Math.random() * 30, 3 + Math.random() * 3, 12 + Math.random() * 24);
        c.position.set((Math.random() - 0.5) * 360, -40 - Math.random() * 14, (Math.random() - 0.5) * 360);
        this.mapGroup.add(c);
      }
    }
    for (const p of m.pads || []) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.25, 20), new THREE.MeshBasicMaterial({ color: 0x3dffb0 }));
      pad.position.set(p.x, p.y + 0.12, p.z);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.6, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      arrow.position.set(p.x, p.y + 0.9, p.z);
      arrow.userData.pad = true;
      this.mapGroup.add(pad, arrow);
    }
    this.skyTarget.setHex(m.sky); this.skyNow.setHex(m.sky);
    this.scene.fog.color.copy(this.skyNow);
  }

  // ---------- environment ----------
  setEnv(env, dt, camPos, t) {
    const sky = env.sky != null ? env.sky : (this.map ? this.map.sky : 0x8fd0ff);
    this.skyTarget.setHex(sky);
    this.skyNow.lerp(this.skyTarget, 1 - Math.exp(-2 * dt));
    this.scene.fog.color.copy(this.skyNow);
    this.dark += ((env.dark || 0) - this.dark) * (1 - Math.exp(-2 * dt));
    this.fogMul += ((env.fogMul || 1) - this.fogMul) * (1 - Math.exp(-2 * dt));
    this.scene.fog.density = 0.0042 * this.fogMul * (1 + this.dark);
    this.hemi.intensity = 1.0 * (1 - this.dark * 0.65);
    this.sun.intensity = 1.6 * (1 - this.dark * 0.8);
    this.shake = env.shake || 0;
    this.setLiquid(env.liquid, dt, t);
    this.setWeather(env.weather, env.wind, dt, camPos);
    for (const o of this.mapGroup.children) if (o.userData.pad) o.rotation.y = t * 2;
  }

  setLiquid(L, dt, t) {
    if (!L) { if (this.liquidMesh) this.liquidMesh.visible = false; this.liquidLevel = null; return; }
    if (!this.liquidMesh) {
      this.liquidMesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ transparent: true, side: THREE.DoubleSide }));
      this.liquidMesh.rotation.x = -Math.PI / 2;
      this.scene.add(this.liquidMesh);
    }
    const [c, o] = LIQUID[L.kind] || LIQUID.water;
    this.liquidMesh.material.color.setHex(c);
    this.liquidMesh.material.opacity = o;
    this.liquidMesh.material.emissive.setHex(L.kind === 'lava' ? 0xff3000 : 0x000000);
    this.liquidMesh.visible = true;
    this.liquidLevel = L.level;
    this.liquidMesh.position.y = L.level + Math.sin(t * 1.6) * 0.07;
  }

  // ---------- weather ----------
  initWeather() {
    const N = 1400;
    this.wN = N;
    this.wPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.wPos[i * 3] = (Math.random() - 0.5) * 90; this.wPos[i * 3 + 1] = Math.random() * 50 - 5; this.wPos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3));
    this.wPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.25, transparent: true, depthWrite: false }));
    this.wPoints.frustumCulled = false; this.wPoints.visible = false;
    this.scene.add(this.wPoints);
    this.wLinePos = new Float32Array(N * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.wLinePos, 3));
    this.wLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
    this.wLines.frustumCulled = false; this.wLines.visible = false;
    this.scene.add(this.wLines);
  }

  setWeather(type, wind, dt, cam) {
    const w = wind || [0, 0];
    const lines = type === 'rain' || type === 'acid';
    this.wLines.visible = lines; this.wPoints.visible = type === 'snow' || type === 'ash';
    if (!type) return;
    const p = this.wPos;
    let vx = w[0] * 0.5, vy = -45, vz = w[1] * 0.5;
    if (type === 'snow') { vx = w[0] * 0.9; vy = -7; vz = w[1] * 0.9; this.wPoints.material.color.set(0xffffff); this.wPoints.material.size = 0.3; }
    if (type === 'ash') { vx = 2; vy = -2.5; vz = 1; this.wPoints.material.color.set(0xffb070); this.wPoints.material.size = 0.22; }
    if (type === 'acid') this.wLines.material.color.set(0x9dff40); else if (type === 'rain') this.wLines.material.color.set(0xbcd4ff);
    for (let i = 0; i < this.wN; i++) {
      const k = i * 3;
      p[k] += vx * dt; p[k + 1] += vy * dt; p[k + 2] += vz * dt;
      if (type === 'snow') p[k] += Math.sin(p[k + 1] * 0.7 + i) * 0.03;
      if (p[k + 1] < -5) { p[k + 1] += 50; }
      if (p[k] > 45) p[k] -= 90; else if (p[k] < -45) p[k] += 90;
      if (p[k + 2] > 45) p[k + 2] -= 90; else if (p[k + 2] < -45) p[k + 2] += 90;
    }
    this.wPoints.geometry.attributes.position.needsUpdate = true;
    this.wPoints.position.set(cam.x, cam.y - 5, cam.z);
    if (lines) {
      const L = this.wLinePos;
      for (let i = 0; i < this.wN; i++) {
        const k = i * 3, j = i * 6;
        L[j] = p[k]; L[j + 1] = p[k + 1]; L[j + 2] = p[k + 2];
        L[j + 3] = p[k] - vx * 0.02; L[j + 4] = p[k + 1] - vy * 0.02; L[j + 5] = p[k + 2] - vz * 0.02;
      }
      this.wLines.geometry.attributes.position.needsUpdate = true;
      this.wLines.position.set(cam.x, cam.y - 5, cam.z);
    }
  }

  // ---------- entities ----------
  clearEnts() {
    for (const o of this.objs.values()) this.entGroup.remove(o.group);
    this.objs.clear();
  }

  syncEnts(list, dt, t) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let o = this.objs.get(e.id);
      if (!o) {
        const b = BUILD[e.k];
        if (!b) continue;
        o = b(e); o.kind = e.k;
        this.objs.set(e.id, o); this.entGroup.add(o.group);
      }
      o.update(e, dt, t);
    }
    for (const [id, o] of this.objs) {
      if (!seen.has(id)) { this.entGroup.remove(o.group); this.objs.delete(id); }
    }
  }

  // ---------- one-shot effects ----------
  boom(ev) {
    const col = STYLE_COLOR[ev.style] || 0xffaa44;
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
    s.position.set(ev.x, ev.y + 0.5, ev.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(ev.x, ev.y + 0.15, ev.z);
    this.fxGroup.add(s, ring);
    const chunks = [];
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: col }));
      c.scale.setScalar(0.25 + Math.random() * 0.3);
      c.position.set(ev.x, ev.y + 0.5, ev.z);
      const a = Math.random() * 6.28, sp = 4 + Math.random() * ev.r;
      c.userData.v = new THREE.Vector3(Math.cos(a) * sp, 6 + Math.random() * 10, Math.sin(a) * sp);
      chunks.push(c); this.fxGroup.add(c);
    }
    let age = 0;
    this.fx.push((dt) => {
      age += dt;
      const p = age / 0.55;
      s.scale.setScalar(ev.r * 0.35 + p * ev.r * 0.75); s.material.opacity = Math.max(0, 0.85 * (1 - p));
      ring.scale.setScalar(ev.r * (0.4 + p * 1.1)); ring.material.opacity = Math.max(0, 0.7 * (1 - p));
      for (const c of chunks) { c.userData.v.y -= 30 * dt; c.position.addScaledVector(c.userData.v, dt); c.rotation.x += dt * 8; }
      if (age > 0.9) { this.fxGroup.remove(s, ring, ...chunks); return false; }
      return true;
    });
  }

  bolt(ev) {
    const mat = new THREE.LineBasicMaterial({ color: 0xeaf4ff });
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const pts = [];
      let x = ev.x, z = ev.z;
      for (let i = 0; i <= 14; i++) {
        const y = ev.y + 90 * (1 - i / 14);
        pts.push(new THREE.Vector3(x, y, z));
        x += (Math.random() - 0.5) * 6 * (k + 0.6); z += (Math.random() - 0.5) * 6 * (k + 0.6);
        if (i === 13) { x = ev.x; z = ev.z; }
      }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      lines.push(l); this.fxGroup.add(l);
    }
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 90, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.5 }));
    glow.position.set(ev.x, ev.y + 45, ev.z); this.fxGroup.add(glow);
    let age = 0;
    this.fx.push((dt) => {
      age += dt; glow.material.opacity = 0.5 * (1 - age / 0.3);
      if (age > 0.3) { this.fxGroup.remove(...lines, glow); return false; }
      return true;
    });
  }

  updateFx(dt) {
    this.fx = this.fx.filter(f => f(dt));
  }
}

// ---------- entity builders ----------
const mk = (geo, color, opts = {}) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, ...opts }));
const lam = (geo, color, opts = {}) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts })); m.castShadow = true; return m; };

const BUILD = {
  fall(e) {
    const g = new THREE.Group();
    const col = STYLE_COLOR[e.style] || 0xff8844;
    const body = e.style === 'ice' ? lam(new THREE.OctahedronGeometry(1, 0), col) : e.style === 'rock' ? lam(new THREE.IcosahedronGeometry(1, 0), col) : mk(new THREE.IcosahedronGeometry(1, 1), col);
    body.scale.setScalar(1.1 * (e.sc || 1));
    if (e.style === 'ice') body.scale.y *= 2.2;
    const glow = mk(new THREE.SphereGeometry(1.9 * (e.sc || 1), 12, 8), col, { transparent: true, opacity: 0.25 });
    const trail = mk(new THREE.ConeGeometry(1.0 * (e.sc || 1), 9 * (e.sc || 1), 8, 1, true), col, { transparent: true, opacity: 0.35 });
    trail.position.y = 4.5 * (e.sc || 1);
    if (e.style === 'meteor' || e.style === 'bomb') g.add(glow, trail);
    g.add(body);
    // ground telegraph
    const warn = new THREE.Group();
    const ring = mk(new THREE.RingGeometry(e.r * 0.93, e.r, 40), 0xff4a2a, { transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const disc = mk(new THREE.CircleGeometry(e.r, 40), 0xff3a1a, { transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    warn.add(ring, disc); warn.position.set(e.tx, e.ty + 0.12, e.tz);
    const root = new THREE.Group(); root.add(g, warn);
    return {
      group: root,
      update(en, dt, t) {
        g.position.set(en.x, en.y, en.z);
        body.rotation.x += dt * 3; body.rotation.z += dt * 2;
        disc.scale.setScalar(Math.max(0.02, en.p));
        ring.material.opacity = 0.5 + 0.4 * Math.sin(t * 14);
        if (en.style === 'meteor' || en.style === 'bomb') trail.lookAt(en.x, en.y + 100, en.z);
      },
    };
  },

  tornado(e) {
    const g = new THREE.Group();
    const rings = [];
    const H = e.h, n = 14;
    for (let i = 0; i < n; i++) {
      const h = H / n, y = i * h;
      const rb = 1.2 + (i / n) * 9, rt = 1.2 + ((i + 1) / n) * 9;
      const m = mk(new THREE.CylinderGeometry(rt, rb, h * 1.02, 14, 1, true), i % 2 ? 0x8d949c : 0xb6bcc4, { transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      m.position.y = y + h / 2; g.add(m); rings.push(m);
    }
    const bits = [];
    for (let i = 0; i < 16; i++) {
      const b = lam(unitBox, 0x6b5a48); b.scale.setScalar(0.4 + Math.random() * 0.5);
      b.userData = { a: Math.random() * 6.28, y: Math.random() * H, s: 2 + Math.random() * 2 };
      bits.push(b); g.add(b);
    }
    return {
      group: g,
      update(en, dt, t) {
        g.position.set(en.x, 0, en.z);
        rings.forEach((m, i) => { m.rotation.y = t * (3 + i * 0.25); m.position.x = Math.sin(t * 1.3 + i * 0.5) * i * 0.18; m.position.z = Math.cos(t * 1.1 + i * 0.4) * i * 0.18; });
        for (const b of bits) {
          const u = b.userData; u.a += dt * u.s;
          const rr = 1.5 + (u.y / H) * 9;
          b.position.set(Math.cos(u.a) * rr, u.y, Math.sin(u.a) * rr); b.rotation.x += dt * 5;
        }
      },
    };
  },

  hole(e) {
    const g = new THREE.Group();
    const core = mk(new THREE.SphereGeometry(e.r, 20, 14), 0x000000);
    const disk = mk(new THREE.TorusGeometry(e.r * 2.3, e.r * 0.45, 8, 48), 0xff8a2a, { transparent: true, opacity: 0.9 });
    const disk2 = mk(new THREE.TorusGeometry(e.r * 3.4, e.r * 0.25, 8, 48), 0xa24aff, { transparent: true, opacity: 0.6 });
    const halo = mk(new THREE.SphereGeometry(e.r * 6, 16, 12), 0x6a2aff, { transparent: true, opacity: 0.1 });
    disk.rotation.x = disk2.rotation.x = 1.25;
    g.add(core, disk, disk2, halo);
    return {
      group: g,
      update(en, dt, t) {
        g.position.set(en.x, en.y, en.z);
        disk.rotation.z = t * 2.5; disk2.rotation.z = -t * 1.6;
        halo.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
      },
    };
  },

  boulder(e) {
    const m = lam(new THREE.IcosahedronGeometry(e.r, 1), 0x7a6a58);
    const g = new THREE.Group(); g.add(m);
    let px = e.x, pz = e.z;
    return {
      group: g,
      update(en, dt) {
        const dx = en.x - px, dz = en.z - pz;
        g.position.set(en.x, en.y, en.z);
        m.rotation.z -= dx / en.r; m.rotation.x += dz / en.r;
        px = en.x; pz = en.z;
      },
    };
  },

  crack(e) {
    const g = new THREE.Group();
    const edge = mk(new THREE.PlaneGeometry(e.L * 2 + 1, e.W * 2 + 1), 0xff6a1a, { transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const pit = mk(new THREE.PlaneGeometry(e.L * 2, e.W * 2), 0x120a06, { side: THREE.DoubleSide });
    edge.rotation.x = pit.rotation.x = -Math.PI / 2; edge.position.y = 0.06; pit.position.y = 0.09;
    g.add(edge, pit);
    return {
      group: g,
      update(en, dt, t) {
        g.position.set(en.x, 0, en.z); g.rotation.y = -en.a;
        edge.material.opacity = en.open ? 0.9 : 0.35 + 0.35 * Math.sin(t * 12);
        edge.material.color.setHex(en.open ? 0xff3a0a : 0xffb02a);
        pit.material.color.setHex(en.open ? 0x1a0500 : 0x3a2a1a);
      },
    };
  },

  bolt(e) {
    const g = new THREE.Group();
    const ring = mk(new THREE.RingGeometry(e.r * 0.93, e.r, 40), 0xfff2a0, { transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const disc = mk(new THREE.CircleGeometry(e.r, 40), 0xfff2a0, { transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(ring, disc); g.position.set(e.x, e.y + 0.12, e.z);
    return {
      group: g,
      update(en, dt, t) { disc.scale.setScalar(Math.max(0.02, en.p)); ring.material.opacity = 0.5 + 0.45 * Math.sin(t * 20); },
    };
  },

  volcano(e) {
    const g = new THREE.Group();
    const cone = lam(new THREE.ConeGeometry(36, e.h, 9), 0x3a2a24);
    cone.position.y = e.h / 2;
    const cap = mk(new THREE.ConeGeometry(7, 9, 9), 0xff4a14);
    cap.position.y = e.h - 4.5;
    const glow = mk(new THREE.SphereGeometry(10, 12, 8), 0xff6a2a, { transparent: true, opacity: 0.35 });
    glow.position.y = e.h + 3;
    g.add(cone, cap, glow); g.position.set(e.x, e.y, e.z);
    return { group: g, update(en, dt, t) { glow.scale.setScalar(1 + Math.sin(t * 5) * 0.12); } };
  },
};

// ---------- player avatar ----------
function nameSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, 128, 34);
  g.fillStyle = '#fff'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(2.6, 0.65, 1); s.position.y = 2.55;
  return s;
}

export class Avatar {
  constructor(color, name) {
    this.group = new THREE.Group();
    const skin = 0xffd9a8;
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const part = (w, h, d, c, x, y, z, pivotTop = false) => {
      const m = new THREE.Mesh(unitBox, mat(c)); m.scale.set(w, h, d); m.castShadow = true;
      const holder = new THREE.Group(); holder.position.set(x, y, z);
      m.position.y = pivotTop ? -h / 2 : 0; holder.add(m); this.group.add(holder);
      return holder;
    };
    this.torso = part(0.8, 0.9, 0.45, color, 0, 1.15, 0);
    this.head = part(0.58, 0.58, 0.58, skin, 0, 1.9, 0);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const sx of [-0.14, 0.14]) { const e = new THREE.Mesh(unitBox, eyeMat); e.scale.set(0.08, 0.1, 0.02); e.position.set(sx, 0.04, 0.3); this.head.add(e); }
    this.armL = part(0.26, 0.8, 0.26, skin, -0.55, 1.55, 0, true);
    this.armR = part(0.26, 0.8, 0.26, skin, 0.55, 1.55, 0, true);
    this.legL = part(0.34, 0.75, 0.34, 0x2e3a59, -0.2, 0.75, 0, true);
    this.legR = part(0.34, 0.75, 0.34, 0x2e3a59, 0.2, 0.75, 0, true);
    this.label = nameSprite(name);
    this.group.add(this.label);
    this.phase = 0;
  }

  // speed: horizontal speed, air: not grounded, swim: in liquid
  pose(speed, air, swim, dt) {
    this.phase += dt * (6 + speed * 0.7);
    const k = Math.min(1, speed / 12);
    let sw = Math.sin(this.phase) * 0.9 * k, arm = -sw;
    if (air) { sw = 0.5; arm = -2.6; }
    if (swim) { sw = Math.sin(this.phase * 0.7) * 0.5; arm = Math.sin(this.phase * 0.7 + 3) * 1.2; }
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = arm; this.armR.rotation.x = -arm;
    this.torso.rotation.x = k * 0.12;
  }

  setColor(c) { this.torso.children[0].material.color.setHex(c); }
}
