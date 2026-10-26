// Map data. Boxes: x,z = center, y = base height, w = x size, h = height, d = z size, c = color.

const B = (x, y, z, w, h, d, c) => ({ x, y, z, w, h, d, c });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Walk-in house with a door on the +z side, a roof, and stairs up to the roof on the +x side.
function house(cx, cz, w, d, h, wallC, roofC) {
  const t = 0.5, door = 3, out = [];
  out.push(B(cx, 0, cz - d / 2 + t / 2, w, h, t, wallC));
  out.push(B(cx - w / 2 + t / 2, 0, cz, t, h, d, wallC));
  out.push(B(cx + w / 2 - t / 2, 0, cz, t, h, d, wallC));
  const seg = (w - door) / 2;
  out.push(B(cx - w / 2 + seg / 2, 0, cz + d / 2 - t / 2, seg, h, t, wallC));
  out.push(B(cx + w / 2 - seg / 2, 0, cz + d / 2 - t / 2, seg, h, t, wallC));
  out.push(B(cx, 3.2, cz + d / 2 - t / 2, door, h - 3.2, t, wallC));
  out.push(B(cx, h, cz, w + 1, 0.4, d + 1, roofC));
  out.push(...stairs(cx + w / 2 + 0.6, cz, Math.round(h / 0.5), 1, 0, 2.5, 1.1, 0.5, 0x9a8f80));
  return out;
}

// Stairs: the highest step sits at (x,z), lower steps extend away along (ax,az).
function stairs(x, z, n, ax, az, width, len, stepH, c) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = n - 1 - i;
    const alongX = ax !== 0;
    out.push(B(x + ax * k * len, 0, z + az * k * len, alongX ? len : width, (i + 1) * stepH, alongX ? width : len, c));
  }
  return out;
}

function ziggurat(cx, cz, size, tiers, tierH, shrink, c) {
  const out = [];
  for (let t = 0; t < tiers; t++) {
    const s = size - t * shrink;
    const shade = c + (t % 2 ? 0x080808 : 0);
    out.push(B(cx, 0, cz, s, (t + 1) * tierH, s, shade));
  }
  return out;
}

function ring(r, n, y, off = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return out;
}

function suburbia() {
  const boxes = [];
  const cols = [0xe8d9b5, 0xd9a5a5, 0xa5c4d9, 0xc9d9a5, 0xd9c2a5, 0xcfa5d9];
  const spots = [[-34, -32], [34, -32], [-34, 30], [34, 30], [0, -42], [0, 42], [-48, 0], [48, 0]];
  spots.forEach(([x, z], i) => boxes.push(...house(x, z, 12, 10, 5, cols[i % cols.length], 0x8a3b32)));
  boxes.push(...ziggurat(0, 0, 26, 5, 1.3, 4.5, 0x6fa05a));
  boxes.push(B(-18, 0, 0, 3, 2, 3, 0x777777), B(18, 0, 10, 3, 1.4, 3, 0x777777), B(16, 0, -16, 4, 2.6, 4, 0x777777));
  return {
    id: 'suburbia', name: 'Quiet Suburbia', half: 62, ground: 0x5c9e4f,
    sky: 0x8fd0ff, fog: 0x8fd0ff, boxes, pads: [],
    spawns: ring(22, 8, 0, 0.3).concat(ring(52, 8, 0, 0.6)).filter(s => Math.abs(s.x) < 60 && Math.abs(s.z) < 60),
  };
}

function city() {
  const boxes = [];
  const towers = [[-36, -36, 9], [34, -38, 7], [-38, 20, 5], [40, 24, 8], [0, -6, 9], [-6, 40, 4], [8, -50, 6]];
  towers.forEach(([x, z, t], i) => boxes.push(...ziggurat(x, z, 15, t, 1.6, 1.4, 0x7d8590 + i * 0x020202)));
  boxes.push(...house(-14, -34, 10, 8, 5, 0xb0b5bd, 0x444b55));
  boxes.push(...house(18, 4, 10, 8, 5, 0xc4b79a, 0x444b55));
  boxes.push(...house(-20, 40, 10, 8, 5, 0xb5bdb0, 0x444b55));
  boxes.push(...house(46, -4, 10, 8, 5, 0xbdb0b5, 0x444b55));
  const pads = [[-22, -22], [22, -22], [-24, 8], [20, 30], [-8, 22]].map(([x, z]) => ({ x, z, r: 2.2, y: 0 }));
  return {
    id: 'city', name: 'Skyscraper District', half: 68, ground: 0x4a4f57,
    sky: 0x9fb4c8, fog: 0x9fb4c8, boxes, pads,
    spawns: ring(30, 8, 0, 0.2).concat(ring(55, 6, 0, 0.5)),
  };
}

function mountain() {
  const boxes = [];
  boxes.push(...ziggurat(0, 0, 64, 8, 1.4, 7, 0x9aa3ad));
  boxes.push(...house(-50, 20, 11, 9, 5, 0x8b5e3c, 0x5a3a24));
  boxes.push(...house(50, -22, 11, 9, 5, 0x8b5e3c, 0x5a3a24));
  boxes.push(...house(-8, 56, 11, 9, 5, 0x8b5e3c, 0x5a3a24));
  boxes.push(B(-48, 0, -40, 8, 2, 8, 0x6d747c), B(-44, 0, -36, 5, 3.2, 5, 0x6d747c), B(46, 0, 40, 8, 2, 8, 0x6d747c), B(42, 0, 36, 5, 3.2, 5, 0x6d747c));
  return {
    id: 'mountain', name: 'Frostpeak Summit', half: 72, ground: 0xe6eef5,
    sky: 0xb9d6ee, fog: 0xc9dff0, boxes, pads: [],
    spawns: ring(46, 10, 0, 0.1).filter(s => Math.abs(s.x) > 35 || Math.abs(s.z) > 35),
  };
}

function ruins() {
  const r = rng(77);
  const boxes = [];
  boxes.push(...ziggurat(0, 0, 30, 7, 1.5, 3.8, 0xc9b27d));
  // climbable pillar clusters
  const clusters = [[-40, -36], [40, -34], [-42, 34], [38, 38], [0, 52], [0, -54]];
  clusters.forEach(([cx, cz]) => {
    for (let i = 0; i < 4; i++) boxes.push(B(cx + i * 3.6, 0, cz + (i % 2) * 3, 3, 1.2 + i * 1.5, 3, 0xb89f6a));
  });
  // arches
  [[-22, -8], [24, 12], [-4, 30], [-6, -30]].forEach(([x, z]) => {
    boxes.push(B(x - 3.5, 0, z, 2.2, 7, 2.2, 0xb89f6a), B(x + 3.5, 0, z, 2.2, 7, 2.2, 0xb89f6a), B(x, 7, z, 10, 1.6, 2.6, 0xc9b27d));
  });
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, d = 25 + r() * 30;
    boxes.push(B(Math.cos(a) * d, 0, Math.sin(a) * d, 1.4 + r() * 6, 1 + r() * 2.4, 1.2, 0xa89060));
  }
  return {
    id: 'ruins', name: 'Sunken Ruins', half: 66, ground: 0xd8c48f,
    sky: 0xf0c987, fog: 0xf0d6a0, boxes, pads: [],
    spawns: ring(20, 6, 0, 0.35).concat(ring(46, 6, 0, 0.2)).filter(s => Math.abs(s.x) < 64),
  };
}

function sky() {
  const boxes = [];
  const isle = (x, z, c) => boxes.push(B(x, -4, z, 14, 4, 14, c));
  boxes.push(B(0, -4, 0, 26, 4, 26, 0x6fb06a));
  boxes.push(...ziggurat(0, 0, 12, 3, 1.5, 3, 0x8a8f99));
  const spots = [[38, 0], [-38, 0], [0, 38], [0, -38], [38, 38], [-38, 38], [38, -38], [-38, -38]];
  spots.forEach(([x, z], i) => {
    isle(x, z, i % 2 ? 0x7fc4d9 : 0xd9c47f);
    if (i % 2 === 0) boxes.push(...ziggurat(x, z, 8, 4, 1.7, 1.5, 0x8a8f99));
    else boxes.push(...house(x - 3, z, 6, 6, 3, 0xe0d8c8, 0x7a4a3a));
  });
  const plank = (x, z, w, d) => boxes.push(B(x, -0.4, z, w, 0.4, d, 0xa07a4a));
  plank(22, 0, 19, 3); plank(-22, 0, 19, 3); plank(0, 22, 3, 19); plank(0, -22, 3, 19);
  [[38, 19], [-38, 19], [38, -19], [-38, -19]].forEach(([x, z]) => plank(x, z, 3, 19));
  [[19, 38], [-19, 38], [19, -38], [-19, -38]].forEach(([x, z]) => plank(x, z, 19, 3));
  return {
    id: 'sky', name: 'Floating Isles', half: 56, ground: null, void: -30,
    sky: 0x6ab6ff, fog: 0x9fd0ff, boxes, pads: [],
    spawns: ring(9.5, 8, 0, 0.1),
  };
}

export const MAPS = [suburbia(), city(), mountain(), ruins(), sky()];
// Drop any spawn that would land inside a solid.
for (const m of MAPS) {
  m.spawns = m.spawns.filter(s => {
    const h = heightAt(m, s.x, s.z);
    return h !== null && Math.abs(h - s.y) < 0.01;
  });
}

// Highest solid top at (x,z) or the ground level. Returns null over the void.
export function heightAt(map, x, z) {
  let best = map.ground != null ? 0 : null;
  for (const b of map.boxes) {
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) {
      const top = b.y + b.h;
      if (best === null || top > best) best = top;
    }
  }
  return best;
}

export function maxTop(map) {
  let m = 0;
  for (const b of map.boxes) m = Math.max(m, b.y + b.h);
  return m;
}

// True if something solid sits above the player's head.
export function covered(map, x, y, z) {
  for (const b of map.boxes) {
    if (b.y > y + 1.2 && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return true;
  }
  return false;
}

export function clientMap(map) {
  return {
    id: map.id, name: map.name, half: map.half, ground: map.ground, void: map.void ?? null,
    sky: map.sky, fog: map.fog, boxes: map.boxes, pads: map.pads,
  };
}
