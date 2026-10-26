// Crisp character movement. Pure functions, no rendering.
export const P = {
  R: 0.42, H: 1.8,
  run: 13, sprint: 18.5,
  gAcc: 120, gDec: 150, airAcc: 46, airDrag: 5,
  gravity: 54, fallMul: 1.3, maxFall: 60,
  jump: 17.5, cut: 0.45, coyote: 0.11, buffer: 0.12,
  step: 0.55, padBoost: 31,
};

export function buildWorld(map) {
  const boxes = map.boxes.map(b => ({
    x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y0: b.y, y1: b.y + b.h,
  }));
  return { boxes, ground: map.ground != null, half: map.half, pads: map.pads || [], liquid: null };
}

export function newState(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, grounded: false, coyote: 0, jumpBuf: 0, canCut: false, swim: false, face: 0, speed: 0 };
}

function hit(w, x, y, z) {
  const R = P.R, top = y + P.H;
  for (const b of w.boxes) {
    if (x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1 && y < b.y1 - 0.0005 && top > b.y0) return true;
  }
  return false;
}

// Highest top among boxes blocking the player at this spot.
function blockTop(w, x, y, z) {
  const R = P.R, top = y + P.H;
  let m = -Infinity;
  for (const b of w.boxes) {
    if (x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1 && y < b.y1 - 0.0005 && top > b.y0) m = Math.max(m, b.y1);
  }
  return m;
}

// Highest surface directly under the feet, searching from just above the feet down to y - depth.
function floorUnder(w, x, y, z, depth) {
  const R = P.R * 0.92;
  let best = (w.ground && y - depth <= 0 && y + 0.02 >= 0) ? 0 : -Infinity;
  for (const b of w.boxes) {
    if (x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1) {
      if (b.y1 <= y + 0.02 && b.y1 >= y - depth && b.y1 > best) best = b.y1;
    }
  }
  return best;
}

export function pointInSolid(w, x, y, z, m = 0.3) {
  for (const b of w.boxes) {
    if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && y > b.y0 - m && y < b.y1 + m) return true;
  }
  return w.ground && y < 0.2;
}

// inp: { mx, mz (world-space move vector, length <= 1), jump (held), jumpPressed (edge), sprint }
export function step(s, inp, dt, w) {
  const ev = { jumped: false, landed: 0, pad: false };
  const level = w.liquid;
  const inLiquid = level != null && s.y < level - 0.45;
  s.swim = inLiquid;

  // horizontal control
  const hasIn = Math.abs(inp.mx) + Math.abs(inp.mz) > 0.01;
  let max = (inp.sprint ? P.sprint : P.run) * (inLiquid ? 0.6 : 1);
  const tvx = inp.mx * max, tvz = inp.mz * max;
  const acc = s.grounded ? (hasIn ? P.gAcc : P.gDec) : (hasIn ? P.airAcc : P.airDrag);
  const dvx = tvx - s.vx, dvz = tvz - s.vz, dl = Math.hypot(dvx, dvz), st = acc * dt;
  if (dl <= st) { s.vx = tvx; s.vz = tvz; } else { s.vx += dvx / dl * st; s.vz += dvz / dl * st; }

  // knockback decays
  const kd = Math.exp(-(s.grounded ? 3 : 0.9) * dt);
  s.kx *= kd; s.kz *= kd;
  const kl = Math.hypot(s.kx, s.kz);
  if (kl > 45) { s.kx *= 45 / kl; s.kz *= 45 / kl; }

  // jump timing
  s.coyote = s.grounded ? P.coyote : s.coyote - dt;
  s.jumpBuf = inp.jumpPressed ? P.buffer : s.jumpBuf - dt;
  if (s.jumpBuf > 0 && s.coyote > 0 && !inLiquid) {
    s.vy = P.jump; s.grounded = false; s.coyote = 0; s.jumpBuf = 0; s.canCut = true; ev.jumped = true;
  }
  if (!inp.jump && s.canCut && s.vy > 0) { s.vy *= P.cut; s.canCut = false; }
  if (s.vy <= 0) s.canCut = false;

  // jump pads
  for (const p of w.pads) {
    if (Math.hypot(s.x - p.x, s.z - p.z) < p.r && s.y < p.y + 0.35 && s.y > p.y - 0.2 && s.vy <= 0.1) {
      s.vy = P.padBoost; s.grounded = false; s.canCut = false; ev.pad = true;
    }
  }

  // vertical velocity
  if (inLiquid) {
    s.vy *= Math.exp(-3 * dt);
    s.vy -= P.gravity * 0.22 * dt;
    if (inp.jump) s.vy = Math.min(7.5, s.vy + 70 * dt);
  } else if (s.grounded && s.vy <= 0) {
    s.vy = 0;
  } else {
    s.vy -= P.gravity * (s.vy < 0 ? P.fallMul : 1) * dt;
    if (s.vy < -P.maxFall) s.vy = -P.maxFall;
  }

  // horizontal move, axis by axis, with step-up
  const wasGrounded = s.grounded;
  const tx = (s.vx + s.kx) * dt, tz = (s.vz + s.kz) * dt;
  moveAxis(s, w, tx, 0, wasGrounded);
  moveAxis(s, w, 0, tz, wasGrounded);

  // vertical move
  const prevY = s.y, ny = s.y + s.vy * dt;
  if (s.vy <= 0) {
    const f = floorUnder(w, s.x, prevY, s.z, Math.max(0.06, -s.vy * dt + 0.03));
    if (f > -Infinity && ny <= f + 0.001) {
      if (!s.grounded && s.vy < -9) ev.landed = -s.vy;
      s.y = f; s.vy = 0; s.grounded = true;
    } else {
      s.y = ny; s.grounded = false;
    }
  } else {
    if (hit(w, s.x, ny, s.z)) { s.vy = 0; s.canCut = false; } else s.y = ny;
    s.grounded = false;
  }

  if (w.ground) {
    const h = w.half;
    if (s.x > h) { s.x = h; s.vx = Math.min(0, s.vx); s.kx = Math.min(0, s.kx); }
    if (s.x < -h) { s.x = -h; s.vx = Math.max(0, s.vx); s.kx = Math.max(0, s.kx); }
    if (s.z > h) { s.z = h; s.vz = Math.min(0, s.vz); s.kz = Math.min(0, s.kz); }
    if (s.z < -h) { s.z = -h; s.vz = Math.max(0, s.vz); s.kz = Math.max(0, s.kz); }
  }

  s.speed = Math.hypot(s.vx + s.kx, s.vz + s.kz);
  return ev;
}

function moveAxis(s, w, dx, dz, grounded) {
  if (!dx && !dz) return;
  const nx = s.x + dx, nz = s.z + dz;
  if (!hit(w, nx, s.y, nz)) { s.x = nx; s.z = nz; return; }
  if (grounded || s.vy <= 0) {
    const top = blockTop(w, nx, s.y, nz);
    if (top - s.y <= P.step + 0.001 && !hit(w, nx, top + 0.002, nz)) {
      s.x = nx; s.z = nz; s.y = top + 0.002; return;
    }
  }
  if (dx) { s.vx = 0; s.kx = 0; }
  if (dz) { s.vz = 0; s.kz = 0; }
}
