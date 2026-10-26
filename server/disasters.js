// Ten disasters. Each factory gets the round context and returns { update(dt) }.
// ctx: { map, rand, time, dur, env, alive(), damage(p,amt,cause), push(p,vx,vy,vz), addEnt(e), removeEnt(e), ents, ev(o), randomTarget(bias) }
import { maxTop, heightAt, covered } from './maps.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

// ---------- shared helpers ----------

export function spawnFall(ctx, o) {
  const ty = o.ty ?? 0;
  const s = o.from || [o.tx, ty + 95, o.tz];
  return ctx.addEnt({
    k: 'fall', style: o.style, x: s[0], y: s[1], z: s[2], tx: o.tx, ty, tz: o.tz,
    r: o.r, sc: o.sc || 1, p: 0, T: o.T,
    _s: s, _peak: o.peak || 0, _dmg: o.dmg, _e: 0, _cause: o.cause || 'a falling object',
  });
}

// Advances every falling object, handles impacts and area damage.
export function stepFalls(ctx, dt) {
  for (const e of [...ctx.ents]) {
    if (e.k !== 'fall') continue;
    e._e += dt;
    const p = clamp(e._e / e.T, 0, 1);
    e.p = p;
    e.x = e._s[0] + (e.tx - e._s[0]) * p;
    e.z = e._s[2] + (e.tz - e._s[2]) * p;
    e.y = e._s[1] + (e.ty - e._s[1]) * p + e._peak * 4 * p * (1 - p);
    if (p >= 1) {
      ctx.ev({ k: 'boom', x: e.tx, y: e.ty, z: e.tz, r: e.r, style: e.style });
      for (const pl of ctx.alive()) {
        const dx = pl.x - e.tx, dy = pl.y + 0.9 - e.ty, dz = pl.z - e.tz;
        const d = Math.hypot(dx, dy, dz);
        if (d < e.r) {
          ctx.damage(pl, e._dmg * (1 - 0.6 * d / e.r), e._cause);
          const hd = Math.hypot(dx, dz) || 1;
          const f = 16 * (1 - d / e.r) + 6;
          ctx.push(pl, dx / hd * f, 9 * (1 - d / e.r) + 3, dz / hd * f);
        }
      }
      ctx.removeEnt(e);
    }
  }
}

// Damage from the rising liquid (water, lava, acid).
export function applyLiquid(ctx, dt) {
  const L = ctx.env.liquid;
  if (!L) return;
  for (const p of ctx.alive()) {
    if (p.y >= L.level - 0.2) continue;
    if (L.kind === 'lava') ctx.damage(p, 85 * dt, 'lava');
    else if (L.kind === 'acid') ctx.damage(p, 28 * dt, 'acid');
    else ctx.damage(p, (p.y + 1.7 < L.level ? 24 : 6) * dt, 'the flood');
  }
}

const liquidBase = (map) => (map.ground != null ? 0 : -12);

// ---------- the ten disasters ----------

export const DISASTERS = [
  {
    id: 'meteor', name: 'Meteor Shower', dur: 60,
    blurb: 'Fireballs rain from the sky. Keep moving, get under cover.',
    create(ctx) {
      let acc = 0, mega = 12;
      ctx.env.dark = 0.25; ctx.env.sky = 0x3a2a4a; ctx.env.weather = 'ash';
      return {
        update(dt) {
          const t = ctx.time;
          acc += dt * (2.2 + (t / ctx.dur) * 3.5);
          while (acc >= 1) {
            acc -= 1;
            spawnFall(ctx, { style: 'meteor', ...ctx.randomTarget(0.55), r: 5, dmg: 55, T: 1.7, cause: 'a meteor' });
          }
          mega -= dt;
          if (mega <= 0) {
            mega = 8 + ctx.rand() * 5;
            spawnFall(ctx, { style: 'meteor', ...ctx.randomTarget(0.9), r: 13, dmg: 100, T: 3, sc: 2.6, cause: 'a mega meteor' });
          }
          ctx.env.shake = 0.08;
        },
      };
    },
  },
  {
    id: 'flood', name: 'Flash Flood', dur: 60,
    blurb: 'The water is rising fast. Climb as high as you can.',
    create(ctx) {
      const base = liquidBase(ctx.map), top = clamp(maxTop(ctx.map) * 0.82, 4, 12);
      ctx.env.liquid = { kind: 'water', level: base };
      ctx.env.weather = 'rain'; ctx.env.dark = 0.3; ctx.env.sky = 0x586878;
      return {
        update() {
          const p = clamp((ctx.time - 3) / (ctx.dur - 12), 0, 1);
          ctx.env.liquid.level = base + (top - base) * p;
        },
      };
    },
  },
  {
    id: 'tornado', name: 'Tornado Outbreak', dur: 60,
    blurb: 'Twisters wander the map and fling anyone nearby.',
    create(ctx) {
      const half = ctx.map.half;
      const tors = [];
      const spawn = () => {
        const a = ctx.rand() * TAU;
        const t = ctx.addEnt({ k: 'tornado', x: Math.cos(a) * half * 0.9, z: Math.sin(a) * half * 0.9, r: 4, h: 34, _tx: 0, _tz: 0 });
        tors.push(t);
      };
      spawn(); spawn();
      ctx.env.dark = 0.2; ctx.env.sky = 0x6c7680; ctx.env.weather = 'rain';
      let third = false;
      return {
        update(dt) {
          if (!third && ctx.time > 25) { third = true; spawn(); }
          const alive = ctx.alive();
          for (const t of tors) {
            if (Math.hypot(t._tx - t.x, t._tz - t.z) < 4) {
              if (alive.length && ctx.rand() < 0.55) {
                const p = alive[Math.floor(ctx.rand() * alive.length)];
                t._tx = p.x; t._tz = p.z;
              } else { t._tx = (ctx.rand() * 2 - 1) * half * 0.85; t._tz = (ctx.rand() * 2 - 1) * half * 0.85; }
            }
            const dx = t._tx - t.x, dz = t._tz - t.z, d = Math.hypot(dx, dz) || 1;
            t.x += dx / d * 7 * dt; t.z += dz / d * 7 * dt;
            for (const p of alive) {
              const px = t.x - p.x, pz = t.z - p.z, pd = Math.hypot(px, pz);
              const R = 28;
              if (pd > R) continue;
              const ux = px / (pd || 1), uz = pz / (pd || 1);
              const s = 1 - pd / R;
              let ax = ux * 22 * s, az = uz * 22 * s, ay = 0;
              if (pd < 12) { // swirl
                const sw = 38 * (1 - pd / 12);
                ax += -uz * sw; az += ux * sw;
              }
              if (pd < 7) { ay = 78 * (1 - pd / 7) + 20; ctx.damage(p, 32 * dt, 'a tornado'); }
              ctx.push(p, ax * dt, ay * dt, az * dt);
            }
          }
        },
      };
    },
  },
  {
    id: 'quake', name: 'Earthquake', dur: 50,
    blurb: 'The ground shakes, rocks fall, and fissures split open.',
    create(ctx) {
      let rock = 0, shove = 0, crack = 3;
      ctx.env.dark = 0.1; ctx.env.sky = 0x9a8a78; ctx.env.weather = 'ash';
      return {
        update(dt) {
          const t = ctx.time;
          ctx.env.shake = 0.55 + 0.35 * Math.sin(t * 0.8);
          rock += dt * (1.3 + (t / ctx.dur) * 2);
          while (rock >= 1) { rock -= 1; spawnFall(ctx, { style: 'rock', ...ctx.randomTarget(0.4), r: 3.2, dmg: 32, T: 1.3, cause: 'falling rocks' }); }
          shove -= dt;
          if (shove <= 0) {
            shove = 0.3;
            for (const p of ctx.alive()) {
              const a = ctx.rand() * TAU;
              ctx.push(p, Math.cos(a) * 5, p.grounded ? 3.5 : 0, Math.sin(a) * 5);
            }
          }
          crack -= dt;
          if (crack <= 0 && ctx.map.ground != null) {
            crack = 3.5;
            const al = ctx.alive();
            let x, z;
            if (al.length && ctx.rand() < 0.6) { const p = al[Math.floor(ctx.rand() * al.length)]; x = p.x; z = p.z; }
            else { x = (ctx.rand() * 2 - 1) * ctx.map.half * 0.8; z = (ctx.rand() * 2 - 1) * ctx.map.half * 0.8; }
            ctx.addEnt({ k: 'crack', x, z, a: ctx.rand() * Math.PI, L: 13, W: 1.8, open: 0, y: 0, _e: 0 });
          }
          for (const e of [...ctx.ents]) {
            if (e.k !== 'crack') continue;
            e._e += dt;
            if (e._e > 2 && !e.open) { e.open = 1; ctx.ev({ k: 'boom', x: e.x, y: 0, z: e.z, r: 6, style: 'rock' }); }
            if (e.open) {
              const c = Math.cos(e.a), s = Math.sin(e.a);
              for (const p of ctx.alive()) {
                const dx = p.x - e.x, dz = p.z - e.z;
                const u = dx * c + dz * s, v = -dx * s + dz * c;
                if (Math.abs(u) < e.L && Math.abs(v) < e.W && p.y < 1.2) ctx.damage(p, 110 * dt, 'a fissure');
              }
            }
            if (e._e > 9) ctx.removeEnt(e);
          }
        },
      };
    },
  },
  {
    id: 'volcano', name: 'Volcanic Eruption', dur: 60,
    blurb: 'Lava bombs arc across the sky while lava floods the ground.',
    create(ctx) {
      const half = ctx.map.half, base = liquidBase(ctx.map) - (ctx.map.ground != null ? 0 : -2);
      const top = clamp(maxTop(ctx.map) * 0.55, 3, 7);
      const vx = -(half + 22), vz = 0, vy = 36;
      ctx.addEnt({ k: 'volcano', x: vx, z: vz, y: ctx.map.ground != null ? 0 : -8, h: vy });
      ctx.env.liquid = { kind: 'lava', level: base };
      ctx.env.dark = 0.4; ctx.env.sky = 0x5a2a20; ctx.env.weather = 'ash';
      let acc = 0;
      return {
        update(dt) {
          const t = ctx.time;
          ctx.env.liquid.level = base + (top - base) * clamp((t - 8) / (ctx.dur - 16), 0, 1);
          ctx.env.shake = 0.18;
          acc += dt * (1.2 + (t / ctx.dur) * 1.8);
          while (acc >= 1) {
            acc -= 1;
            spawnFall(ctx, { style: 'bomb', ...ctx.randomTarget(0.5), from: [vx, vy, vz], peak: 38, r: 6.5, dmg: 55, T: 2.8, cause: 'a lava bomb' });
          }
        },
      };
    },
  },
  {
    id: 'lightning', name: 'Lightning Storm', dur: 50,
    blurb: 'Watch the glowing circles. Get out before the bolt lands.',
    create(ctx) {
      let acc = 0;
      ctx.env.dark = 0.55; ctx.env.sky = 0x252c3a; ctx.env.weather = 'rain';
      return {
        update(dt) {
          const t = ctx.time;
          acc += dt * (0.7 + (t / ctx.dur) * 1.8);
          while (acc >= 1) {
            acc -= 1;
            const tg = ctx.randomTarget(0.6);
            ctx.addEnt({ k: 'bolt', x: tg.tx, z: tg.tz, y: tg.ty, r: 4.5, p: 0, _e: 0 });
          }
          for (const e of [...ctx.ents]) {
            if (e.k !== 'bolt') continue;
            e._e += dt; e.p = clamp(e._e / 1.1, 0, 1);
            if (e._e >= 1.1) {
              ctx.ev({ k: 'bolt', x: e.x, y: e.y, z: e.z });
              for (const p of ctx.alive()) {
                const d = Math.hypot(p.x - e.x, p.z - e.z);
                if (d < e.r) {
                  ctx.damage(p, 95 * (1 - 0.5 * d / e.r), 'lightning');
                  ctx.push(p, (p.x - e.x) / (d || 1) * 12, 10, (p.z - e.z) / (d || 1) * 12);
                }
              }
              ctx.removeEnt(e);
            }
          }
        },
      };
    },
  },
  {
    id: 'blizzard', name: 'Blizzard', dur: 60,
    blurb: 'Howling wind, ice shards, and bitter cold. Find shelter.',
    create(ctx) {
      let ang = ctx.rand() * TAU, turn = 5, ice = 0;
      ctx.env.dark = 0.1; ctx.env.sky = 0xc4d0dc; ctx.env.weather = 'snow'; ctx.env.fogMul = 2.8;
      for (const p of ctx.players()) p.cold = 0;
      return {
        update(dt) {
          const t = ctx.time;
          turn -= dt;
          if (turn <= 0) { turn = 4 + ctx.rand() * 3; ang += (ctx.rand() - 0.5) * 2.4; }
          const gust = 14 + 20 * (0.5 + 0.5 * Math.sin(t * 0.55));
          const wx = Math.cos(ang), wz = Math.sin(ang);
          ctx.env.wind = [wx * gust, wz * gust];
          for (const p of ctx.alive()) {
            const sheltered = covered(ctx.map, p.x, p.y, p.z);
            p.cold = Math.max(0, (p.cold || 0) + (sheltered ? -3 : 1) * dt);
            if (!sheltered) ctx.push(p, wx * gust * dt, 0, wz * gust * dt);
            if (p.cold > 12) ctx.damage(p, 4 * dt, 'the cold');
          }
          ice += dt * (1 + (t / ctx.dur));
          while (ice >= 1) { ice -= 1; spawnFall(ctx, { style: 'ice', ...ctx.randomTarget(0.5), r: 3.4, dmg: 30, T: 1.4, cause: 'an ice shard' }); }
        },
      };
    },
  },
  {
    id: 'acid', name: 'Acid Rain', dur: 55,
    blurb: 'The rain burns. Stay under a roof, and stay above the pools.',
    create(ctx) {
      const base = liquidBase(ctx.map), top = clamp(maxTop(ctx.map) * 0.35, 2, 3.5);
      ctx.env.liquid = { kind: 'acid', level: base - 1 };
      ctx.env.dark = 0.3; ctx.env.sky = 0x5f7a3a; ctx.env.weather = 'acid';
      return {
        update(dt) {
          const t = ctx.time;
          ctx.env.liquid.level = (base - 1) + (top - base + 1) * clamp((t - 12) / (ctx.dur - 20), 0, 1);
          const dps = 5 + 7 * (t / ctx.dur);
          for (const p of ctx.alive()) if (!covered(ctx.map, p.x, p.y, p.z)) ctx.damage(p, dps * dt, 'acid rain');
        },
      };
    },
  },
  {
    id: 'blackhole', name: 'Black Hole', dur: 55,
    blurb: 'A singularity is dragging everything in. Run.',
    create(ctx) {
      const half = ctx.map.half, holes = [];
      const spawn = (r) => {
        const a = ctx.rand() * TAU, d = half * 0.5 * ctx.rand();
        holes.push(ctx.addEnt({ k: 'hole', x: Math.cos(a) * d, y: ctx.map.ground != null ? 9 : 5, z: Math.sin(a) * d, r, _tx: 0, _tz: 0 }));
      };
      spawn(3.2);
      ctx.env.dark = 0.4; ctx.env.sky = 0x150b26; ctx.env.shake = 0.2;
      let second = false;
      return {
        update(dt) {
          if (!second && ctx.time > 28) { second = true; spawn(2.4); }
          const alive = ctx.alive();
          for (const h of holes) {
            if (Math.hypot(h._tx - h.x, h._tz - h.z) < 4) {
              if (alive.length && ctx.rand() < 0.5) { const p = alive[Math.floor(ctx.rand() * alive.length)]; h._tx = p.x; h._tz = p.z; }
              else { h._tx = (ctx.rand() * 2 - 1) * half * 0.7; h._tz = (ctx.rand() * 2 - 1) * half * 0.7; }
            }
            const dx = h._tx - h.x, dz = h._tz - h.z, dd = Math.hypot(dx, dz) || 1;
            h.x += dx / dd * 4 * dt; h.z += dz / dd * 4 * dt;
            for (const p of alive) {
              const ex = h.x - p.x, ey = h.y - (p.y + 0.9), ez = h.z - p.z;
              const d = Math.hypot(ex, ey, ez);
              const R = 50;
              if (d < h.r + 1.2) { ctx.damage(p, 999, 'the black hole'); continue; }
              if (d > R) continue;
              const s = 1 - d / R;
              const a = 6 + 46 * s * s;
              ctx.push(p, ex / d * a * dt, ey / d * a * 0.5 * dt, ez / d * a * dt);
            }
          }
        },
      };
    },
  },
  {
    id: 'boulders', name: 'Boulder Stampede', dur: 55,
    blurb: 'Giant boulders roll across the map. Get high or dodge.',
    create(ctx) {
      const half = ctx.map.half;
      let cd = 1;
      ctx.env.dark = 0.1; ctx.env.sky = 0xb08a60; ctx.env.weather = 'ash'; ctx.env.shake = 0.12;
      return {
        update(dt) {
          const t = ctx.time;
          cd -= dt;
          if (cd <= 0) {
            cd = 1.5 - (t / ctx.dur) * 0.8;
            const big = ctx.rand() < 0.15, r = big ? 5.5 : 3.2;
            const dir = ctx.rand() < 0.5 ? -1 : 1, axisX = ctx.rand() < 0.5;
            const al = ctx.alive();
            let lane = (ctx.rand() * 2 - 1) * half * 0.9;
            if (al.length && ctx.rand() < 0.55) { const p = al[Math.floor(ctx.rand() * al.length)]; lane = axisX ? p.z : p.x; }
            const sp = (big ? 12 : 17 + ctx.rand() * 6) * dir, start = -dir * (half + 14);
            ctx.addEnt({
              k: 'boulder', r, x: axisX ? start : lane, y: r, z: axisX ? lane : start,
              _vx: axisX ? sp : 0, _vz: axisX ? 0 : sp, _hit: new Map(),
            });
          }
          for (const e of [...ctx.ents]) {
            if (e.k !== 'boulder') continue;
            e.x += e._vx * dt; e.z += e._vz * dt;
            if (Math.abs(e.x) > half + 18 || Math.abs(e.z) > half + 18) { ctx.removeEnt(e); continue; }
            for (const p of ctx.alive()) {
              if (Math.hypot(p.x - e.x, p.z - e.z) < e.r + 0.5 && p.y < e.y + e.r * 0.7 && (e._hit.get(p.id) || 0) < ctx.time - 1) {
                e._hit.set(p.id, ctx.time);
                const vl = Math.hypot(e._vx, e._vz) || 1;
                ctx.damage(p, e.r > 4 ? 75 : 48, 'a boulder');
                ctx.push(p, e._vx / vl * 24, 11, e._vz / vl * 24);
              }
            }
          }
        },
      };
    },
  },
];
