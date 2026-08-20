// critters — sim.js
// Pure simulation: infinite chunked world, biomes, structures, plants, critters,
// genes, speciation, nests, materials, gases, fire, weather, explosions.
// No DOM; loadable in node for the balance harness.
// Genes are the body. The environment is the only level designer.

const CFG = {
  CS: 20, CH: 16, CHPX: 320,
  ACT: 1600,              // full-rate sim half-window around the camera
  ACT2: 3000,             // quarter-rate outer band (the old hard barrier, now soft + far)
  FAR: 120000,            // |x| or |y| beyond this = the farlands
  PLANT_E: 28, TREE_E: 130,
  PLANT_CHUNK_CAP: 45,
  BASE_UPK: 0.0022, MOVE_UPK: 0.009,
  REPRO_AT: 0.72, MATURITY: 260,
  MUT: 0.04, MUT_BIG: 0.03, MUT_BIG_S: 0.35,
  SP_DIST: 1.2,
  SOFT_CAP: 1900,
  DECIDE_EVERY: 8,
  NEST_R: 30, NEST_ADOPT: 1400, NEST_LEASH: 340,
  BLOOD_R: 260, BLOOD_LIFE: 2400,
  GAS_CAP: 700, FIRE_CAP: 500,
};

// ---------- THE MATERIAL TABLE ----------
// props: block · swim · speed/turn · drain (neg heals) · kill (silent = no instinct, no smoke)
// rad · mut · sac · grow · fertFix · dig · cool {to,p} · burn (flammable, ->ash)
// boom {r, fuse, touch, unstable, glass, fallout} · decor (place-mode object sprite)
const MATS = {
  0:  { name: 'ground',     cat: 'soil',    col: [210, 192, 130], grow: true, dig: true },
  14: { name: 'sand',       cat: 'soil',    col: [222, 202, 146], grow: true, dig: true, fertFix: 0.12 },
  13: { name: 'clay',       cat: 'soil',    col: [188, 122, 84], grow: true, dig: true, fertFix: 0.25 },
  15: { name: 'loam',       cat: 'soil',    col: [128, 100, 58],  grow: true, dig: true, fertFix: 1.0 },
  16: { name: 'ash',        cat: 'soil',    col: [138, 132, 122], grow: true, dig: true, fertFix: 0.9 },
  5:  { name: 'mud',        cat: 'soil',    col: [146, 112, 70],  grow: true, dig: true, speed: 0.55, fertFix: 0.85 },
  17: { name: 'permafrost', cat: 'soil',    col: [188, 204, 200], grow: true, dig: true, fertFix: 0.05, drain: 0.03, speed: 0.85 },
  11: { name: 'salt',       cat: 'soil',    col: [228, 222, 202], drain: 0.05 },
  1:  { name: 'wall',       cat: 'rock',    col: [148, 128, 100], block: true },
  4:  { name: 'rock',       cat: 'rock',    col: [118, 110, 98], block: true, decor: true },
  18: { name: 'granite',    cat: 'rock',    col: [151, 142, 133], block: true, decor: true },
  19: { name: 'basalt',     cat: 'rock',    col: [82, 78, 80],    block: true, decor: true },
  20: { name: 'obsidian',   cat: 'rock',    col: [58, 50, 64],    block: true, decor: true },
  21: { name: 'sandstone',  cat: 'rock',    col: [206, 176, 122], block: true, decor: true },
  22: { name: 'marble',     cat: 'rock',    col: [222, 218, 206], block: true, decor: true },
  38: { name: 'coal',       cat: 'rock',    col: [52, 48, 46],    block: true, decor: true, burn: 220 },
  40: { name: 'glass',      cat: 'rock',    col: [172, 208, 196] },
  23: { name: 'iron',       cat: 'metal',   col: [126, 130, 138], block: true, decor: true },
  24: { name: 'copper',     cat: 'metal',   col: [190, 116, 74],  block: true, decor: true },
  25: { name: 'gold',       cat: 'metal',   col: [222, 174, 62],  block: true, decor: true },
  26: { name: 'silver',     cat: 'metal',   col: [198, 202, 208], block: true, decor: true },
  27: { name: 'lead',       cat: 'metal',   col: [96, 100, 110], block: true, decor: true },
  8:  { name: 'uranium',    cat: 'metal',   col: [178, 186, 70],  rad: 1 },
  28: { name: 'plutonium',  cat: 'metal',   col: [148, 178, 112], rad: 2.5 },
  29: { name: 'mercury',    cat: 'metal',   col: [162, 170, 178], swim: true, drain: 0.3 },
  2:  { name: 'water',      cat: 'liquid',  col: [64, 128, 150], swim: true },
  30: { name: 'deep water', cat: 'liquid',  col: [42, 96, 122],  swim: true, speed: 0.8, drain: 0.02 },
  33: { name: 'brine',      cat: 'liquid',  col: [96, 150, 148], swim: true, drain: 0.08 },
  31: { name: 'acid',       cat: 'liquid',  col: [148, 186, 62],  swim: true, drain: 0.5 },
  32: { name: 'tar',        cat: 'liquid',  col: [56, 50, 46],    swim: true, speed: 0.15, drain: 0.05, burn: 300 },
  10: { name: 'lava',       cat: 'liquid',  col: [214, 92, 40],   kill: true, cool: { to: 4, p: 0.04 } },
  9:  { name: 'ice',        cat: 'liquid',  col: [178, 216, 222], speed: 1.35, turn: 0.3, drain: 0.06 },
  12: { name: 'goo',        cat: 'liquid',  col: [206, 160, 66],  speed: 0.22, burn: 120 },
  6:  { name: 'glowmoss',   cat: 'strange', col: [140, 208, 110], grow: true, dig: true, fertFix: 1.3 },
  7:  { name: 'bloodstone', cat: 'strange', col: [138, 52, 48],   sac: true, dig: true },
  34: { name: 'ichor',      cat: 'strange', col: [162, 62, 70],   swim: true, drain: -0.25 },
  35: { name: 'void',       cat: 'strange', col: [34, 30, 40],    kill: true, silent: true },
  36: { name: 'mutagen',    cat: 'strange', col: [98, 170, 158], mut: 2 },
  37: { name: 'crystal',    cat: 'strange', col: [170, 190, 214], block: true, decor: true },
  45: { name: 'monolith',   cat: 'strange', col: [44, 42, 52],    block: true, decor: true, artifact: 'mono' },
  46: { name: 'idol',       cat: 'strange', col: [178, 134, 58],  block: true, decor: true, artifact: 'idol' },
  39: { name: 'fallout',    cat: 'strange', col: [150, 160, 108], rad: 1.2, cool: { to: 16, p: 0.004 } },
  41: { name: 'powder',     cat: 'boom',    col: [122, 112, 92],  dig: true, boom: { r: 45, fuse: 2, touch: true } },
  42: { name: 'boomstone',  cat: 'boom',    col: [178, 92, 58],   boom: { r: 95, fuse: 45, touch: true } },
  43: { name: 'corestone',  cat: 'boom',    col: [110, 96, 140],  boom: { r: 240, fuse: 70, glass: true, fallout: true } },
  44: { name: 'twitchstone',cat: 'boom',    col: [162, 142, 96],  boom: { r: 70, fuse: 30, touch: true, unstable: 0.0006 } },
};

const GASES = {
  tox:    { name: 'toxin',      col: '150,160,70',  dmg: 0.6 },
  spore:  { name: 'spore',      col: '128,150,88',  seed: true },
  pher:   { name: 'pheromone',  col: '190,140,150', lure: true },
  dizzy:  { name: 'dizzy gas',  col: '170,160,190', confuse: true },
  clone:  { name: 'clone gas',  col: '150,180,170', clone: true },
  grow:   { name: 'growth gas', col: '170,150,100', size: 0.012 },
  shrink: { name: 'shrink gas', col: '150,140,170', size: -0.012 },
  fear:   { name: 'fear gas',   col: '190,170,120', fear: true },
  sleep:  { name: 'sleep gas',  col: '130,150,180', sleep: true },
  rage:   { name: 'rage gas',   col: '180,100,90',  rage: true },
  smoke:  { name: 'smoke',      col: '110,105,95' },
  mia:    { name: 'miasma',     col: '120,130,105' },
};

// base creatures for the LIFE tab — summoned, not evolved
const LIFE_PRESETS = {
  proto:   { name: 'protozoan', g: { siz: 0.5, spd: 0.5, sen: 0.5, hue: 0.45, diet: 0.3, rep: 0.3, seg: 0.4, spik: 0.1, legs: 0.5, tail: 0.3, eyes: 0.5, pat: 0.2, ven: 0.05, bur: 0.05, pho: 0.05, soc: 0.1, cst: 0.5 } },
  grazer:  { name: 'grazer',    g: { siz: 0.3, spd: 0.5, sen: 0.5, hue: 0.3, diet: 0.05, rep: 0.2, seg: 0.2, spik: 0.1, legs: 0.5, tail: 0.3, eyes: 0.6, pat: 0.2, ven: 0.02, bur: 0.1, pho: 0.05, soc: 0.1, cst: 0.5 } },
  hunter:  { name: 'hunter',    g: { siz: 0.55, spd: 0.7, sen: 0.6, hue: 0.02, diet: 0.85, rep: 0.3, seg: 0.5, spik: 0.1, legs: 0.7, tail: 0.5, eyes: 0.2, pat: 0.5, ven: 0.3, bur: 0.02, pho: 0.02, soc: 0.05, cst: 0.5 } },
  swimmer: { name: 'swimmer',   g: { siz: 0.35, spd: 0.7, sen: 0.55, hue: 0.55, diet: 0.15, rep: 0.3, seg: 0.5, spik: 0.05, legs: 0.05, tail: 0.9, eyes: 0.4, pat: 0.4, ven: 0.02, bur: 0.02, pho: 0.05, soc: 0.1, cst: 0.5 } },
  queenling:{ name: 'queenling',g: { siz: 0.5, spd: 0.4, sen: 0.5, hue: 0.09, diet: 0.4, rep: 0.6, seg: 0.9, spik: 0.3, legs: 0.8, tail: 0.1, eyes: 0.85, pat: 0.5, ven: 0.05, bur: 0.05, pho: 0.05, soc: 0.85, cst: 0.5 } },
};

// ---------- rng + noise ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function h2(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 974634721)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, scale, s) {
  const gx = Math.floor(x / scale), gy = Math.floor(y / scale);
  let fx = x / scale - gx, fy = y / scale - gy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(gx, gy, s), b = h2(gx + 1, gy, s), c = h2(gx, gy + 1, s), d = h2(gx + 1, gy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ---------- species names ----------
const SYL = ['bo','mi','ta','ru','ke','zu','pip','mor','fen','gla','nib','vex','olo','squ','dro','ya','lu','chi','wam','ot'];
function spName(w) {
  const r = w.rand, n = 2 + ((r() * 2) | 0);
  let s = '';
  for (let i = 0; i < n; i++) s += SYL[(r() * SYL.length) | 0];
  return s[0].toUpperCase() + s.slice(1);
}

// ---------- genes ----------
const FUNC_GENES = ['siz','spd','sen','diet','rep','ven','bur','pho','soc','cst'];
const FORM_GENES = ['seg','spik','legs','tail','eyes','pat'];
const GENES = [...FUNC_GENES, 'hue', ...FORM_GENES];
function gauss(r) { return r() + r() + r() - 1.5; }

function mutate(w, g, scale) {
  const s = Math.min(5, scale || 1);
  const r = w.rand, m = { ...g };
  for (const k of GENES) {
    m[k] += gauss(r) * CFG.MUT * 2 * s;
    if (r() < CFG.MUT_BIG * s) m[k] += gauss(r) * CFG.MUT_BIG_S * 2;
    if (k === 'hue') { m[k] = ((m[k] % 1) + 1) % 1; }
    else m[k] = Math.min(1, Math.max(0, m[k]));
  }
  return m;
}

function mixGenes(w, a, b, scale) {
  const r = w.rand, g = {};
  for (const k of GENES) g[k] = r() < 0.5 ? a[k] : b[k];
  return mutate(w, g, scale);
}

function hueDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 1 - d); }
function geneDist(a, b) {
  let s = 0;
  for (const k of FUNC_GENES) { const d = a[k] - b[k]; s += d * d; }
  for (const k of FORM_GENES) { const d = (a[k] - b[k]) * 0.8; s += d * d; }
  const hd = hueDist(a.hue, b.hue); s += hd * hd * 0.5;
  return Math.sqrt(s);
}

function mutScale(c) { return (1 + (c.bb || 0) * 1.2) * (1 + (c.rad || 0) * 2.5) * (1 + (c.tmut || 0)); }
function reproAt(c) { return CFG.REPRO_AT * (1 - 0.25 * Math.min(1, c.bb || 0)); }

// ---------- world ----------
function makeWorld(seed) {
  const w = {
    seed: seed || 1, tick: 0, rand: mulberry32(seed || 1),
    view: { x: 0, y: 0 },
    chunks: new Map(),
    plantCount: 0,
    critters: [], corpses: [], nests: [],
    blood: [], sacrifices: 0,
    gas: [], wind: 0,
    fires: [], fuses: [],
    artifacts: [], sites: [],
    weather: { state: 'clear', t: 4000 },
    species: new Map(), spNext: 1, nestNext: 1,
    nextId: 1, events: [], dirty: new Set(),
    hash: new Map(), activeN: 0,
    achDone: new Set(),
    stillSp: 0, firstSp: 0,
  };
  // site zero — one per seed, far out, always there
  const za = h2(9, 9, w.seed) * Math.PI * 2, zd = 52000 + h2(8, 8, w.seed) * 30000;
  w.zeroX = Math.round(Math.cos(za) * zd); w.zeroY = Math.round(Math.sin(za) * zd);
  const [sx, sy] = findSpawn(w);
  w.view.x = sx; w.view.y = sy;
  seedLife(w, sx, sy);
  return w;
}

function chunkKey(cx, cy) { return cx + ',' + cy; }

// ---------- structures (hand-authored templates, seeded placement) ----------
// lattice: every 8x8-chunk region may hold one site; each chunk stamps its slice.
const STRUCTS = {
  altar:    { hs: 6 },   // half-size in cells
  city:     { hs: 24 },
  lab:      { hs: 8 },
  scorched: { hs: 12 },
  zero:     { hs: 22 },
};

function siteForRegion(w, rx, ry) {
  const s = w.seed | 0;
  const r1 = h2(rx, ry, s + 501);
  const cxpx = (rx * 8 + 1 + h2(rx, ry, s + 502) * 6) * CFG.CHPX;
  const cypx = (ry * 8 + 1 + h2(rx, ry, s + 503) * 6) * CFG.CHPX;
  const dist = Math.max(Math.abs(cxpx), Math.abs(cypx));
  if (dist > CFG.FAR) return null;
  let kind = null;
  if (dist < 22000) { if (r1 < 0.045) kind = 'altar'; }
  else if (dist < 60000) {
    if (r1 < 0.05) kind = 'city';
    else if (r1 < 0.1) kind = 'lab';
    else if (r1 < 0.13) kind = 'altar';
  } else {
    if (r1 < 0.09) kind = 'scorched';
    else if (r1 < 0.13) kind = 'lab';
    else if (r1 < 0.16) kind = 'city';
  }
  if (!kind) return null;
  return { kind, x: cxpx, y: cypx };
}

// returns a material id, or -1 for no change. u,v are cell offsets from site center.
function structCell(kind, u, v, hsh) {
  const au = Math.abs(u), av = Math.abs(v), d = Math.hypot(u, v);
  if (kind === 'altar') {
    if (au > 6 || av > 6) return -1;
    if (au >= 5 && av >= 5) return 22;                      // marble corner pillars
    if (au <= 1 && av <= 1) return 7;                       // the stone
    if (d > 4.6 && d < 6.2 && hsh < 0.5) return 16;         // ash ring
    if (hsh < 0.22) return 6;                               // glowmoss reclaiming it
    return -1;
  }
  if (kind === 'city') {
    if (au > 24 || av > 24) return -1;
    if (au <= 5 && av <= 5) {                               // the plaza
      if (au <= 0 && av <= 0) return 45;                    // something they raised
      return hsh < 0.7 ? 22 : 16;
    }
    const mu = ((u % 12) + 12) % 12, mv = ((v % 12) + 12) % 12;
    if (mu < 2 || mv < 2) return hsh < 0.8 ? 13 : -1;       // clay streets
    const edge = mu === 3 || mu === 10 || mv === 3 || mv === 10;
    const inner = mu > 3 && mu < 10 && mv > 3 && mv < 10;
    if (edge) return hsh < 0.55 ? (hsh < 0.28 ? 22 : 21) : -1; // ruined walls, marble + sandstone
    if (inner) { if (mu === 6 && mv === 6 && hsh < 0.7) return 38; return hsh < 0.12 ? 16 : -1; } // hearths, ash
    return -1;
  }
  if (kind === 'lab') {
    if (d > 8.5) return -1;
    if (d > 6.5 && d < 8 && hsh < 0.65) return 37;          // crystal ring
    if (d < 1.8) return 36;                                 // the pool
    if (hsh < 0.1) return 8;                                // the fuel they used
    if (hsh < 0.22) return 40;                              // floor fused to glass
    return -1;
  }
  if (kind === 'scorched') {
    if (d > 12.5) return -1;
    if (d < 4.5) return hsh < 0.15 ? 39 : 40;               // glass heart, fallout freckles
    if (d < 9.5) return hsh < 0.6 ? 16 : -1;                // ash
    if (hsh < 0.15) return 20;                              // obsidian shards
    return -1;
  }
  if (kind === 'zero') {
    if (d > 22) return -1;
    if (d < 1.4) return 35;                                 // the wound
    if (d < 3.2) return 34;                                 // the world bleeding
    if (d < 9) return 40;
    if (d < 14) return hsh < 0.7 ? 16 : 40;
    if (d > 15 && d < 17 && hsh < 0.4) return 37;
    if (hsh < 0.08) return 39;
    return -1;
  }
  return -1;
}

function stampStructures(w, cx, cy, terrain, fert) {
  const s = w.seed | 0;
  const sites = [];
  const rx = Math.floor(cx / 8), ry = Math.floor(cy / 8);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const site = siteForRegion(w, rx + dx, ry + dy);
    if (site) sites.push(site);
  }
  if (Math.abs(cx * CFG.CHPX - w.zeroX) < STRUCTS.zero.hs * CFG.CS + CFG.CHPX &&
      Math.abs(cy * CFG.CHPX - w.zeroY) < STRUCTS.zero.hs * CFG.CS + CFG.CHPX)
    sites.push({ kind: 'zero', x: w.zeroX, y: w.zeroY });
  for (const site of sites) {
    const hs = STRUCTS[site.kind].hs * CFG.CS;
    const x0 = cx * CFG.CHPX, y0 = cy * CFG.CHPX;
    if (x0 + CFG.CHPX < site.x - hs || x0 > site.x + hs ||
        y0 + CFG.CHPX < site.y - hs || y0 > site.y + hs) continue;
    const ccx = Math.floor(site.x / CFG.CS), ccy = Math.floor(site.y / CFG.CS);
    for (let j = 0; j < CFG.CH; j++) for (let i = 0; i < CFG.CH; i++) {
      const gcx = cx * 16 + i, gcy = cy * 16 + j;
      const m = structCell(site.kind, gcx - ccx, gcy - ccy, h2(gcx, gcy, s + 601));
      if (m >= 0) { terrain[i + j * CFG.CH] = m; if (!(MATS[m] || MATS[0]).grow) fert[i + j * CFG.CH] = 0; }
    }
    // the chunk holding the center registers the site + wakes its keepers
    if (Math.floor(site.x / CFG.CHPX) === cx && Math.floor(site.y / CFG.CHPX) === cy) {
      w.sites.push({ kind: site.kind, x: site.x, y: site.y });
      if ((MATS[45].artifact) && site.kind === 'city') w.artifacts.push({ x: site.x, y: site.y, kind: 'mono' });
      if (site.kind === 'altar') spawnStillfolk(w, site.x, site.y, 4);
      if (site.kind === 'zero') { spawnStillfolk(w, site.x, site.y, 6); spawnFirstOne(w, site.x, site.y); }
    }
  }
}

// ---------- worldgen ----------
function genChunk(w, cx, cy) {
  const terrain = new Uint8Array(CFG.CH * CFG.CH);
  const fert = new Float32Array(CFG.CH * CFG.CH);
  const elevA = new Float32Array(CFG.CH * CFG.CH);
  const s = w.seed | 0;
  const far = Math.abs(cx * CFG.CHPX) > CFG.FAR || Math.abs(cy * CFG.CHPX) > CFG.FAR;
  let forestish = 0;
  for (let j = 0; j < CFG.CH; j++) for (let i = 0; i < CFG.CH; i++) {
    const wx = cx * CFG.CHPX + i * CFG.CS + 10, wy = cy * CFG.CHPX + j * CFG.CS + 10;
    const k = i + j * CFG.CH;
    if (far) {
      const g = vnoise(wx, wy, 60, s + 99);
      const stripe = ((Math.floor(wx / 160) ^ Math.floor(wy / 160)) & 7) === 0;
      if (stripe) { terrain[k] = 4; fert[k] = 0; }
      else if (g > 0.72) { terrain[k] = 6; fert[k] = 1.3; }
      else if (g < 0.18) { terrain[k] = 2; fert[k] = 0; }
      else { terrain[k] = 0; fert[k] = g * 0.8; }
      continue;
    }
    // satellite geography: drainage networks carve the land, green follows the water
    const wxp = wx + (vnoise(wx, wy, 700, s + 31) - 0.5) * 620;
    const wyp = wy + (vnoise(wx, wy, 700, s + 37) - 0.5) * 620;
    const cont = vnoise(wx, wy, 3800, s + 51) * 0.75 + vnoise(wx, wy, 1300, s + 52) * 0.25;
    const ridge = 1 - Math.abs(2 * vnoise(wxp, wyp, 2600, s + 53) - 1); // ranges are LINES
    const detail = vnoise(wxp, wyp, 420, s + 7) * 0.6 + vnoise(wxp, wyp, 140, s + 11) * 0.4;
    const T0 = vnoise(wx, wy, 6200, s + 17) * 0.7 + vnoise(wx, wy, 1500, s + 18) * 0.3; // climate bands
    const M = vnoise(wx, wy, 4200, s + 13) * 0.65 + vnoise(wx, wy, 1100, s + 14) * 0.35;
    // nested valley systems — big rivers, tributaries, brooks — each carves less deep;
    // where they cross they join, and that is what erosion looks like from orbit
    const v1 = Math.abs(vnoise(wxp, wyp, 2600, s + 23) - 0.5);
    const v2 = Math.abs(vnoise(wxp, wyp, 1050, s + 24) - 0.5);
    const v3 = Math.abs(vnoise(wxp, wyp, 430, s + 25) - 0.5);
    const wet = 0.45 + M * 0.8;
    const carve = Math.max(0, 0.075 - v1) / 0.075 * 0.085 +
                  Math.max(0, 0.045 - v2) / 0.045 * 0.045 * wet +
                  Math.max(0, 0.028 - v3) / 0.028 * 0.022 * wet;
    let H = cont * 0.52 + detail * 0.16 + ridge * ridge * 0.36 - carve;
    elevA[k] = H;
    const T = T0 - Math.max(0, H - 0.55) * 0.55; // lapse rate: altitude IS cold
    const SEA = 0.42;
    const riparian = carve > 0.014;
    if (H < SEA - 0.05) { terrain[k] = 30; fert[k] = 0; continue; }     // open deep
    if (H < SEA) { terrain[k] = 2; fert[k] = 0; continue; }             // sea, lakes, rivers — all carved
    if (H < SEA + 0.018) {                                              // every waterline gets a bank
      terrain[k] = T > 0.55 ? 14 : 5; fert[k] = 0.9; continue;
    }
    if (H > 0.78) {                                                     // peaks: snow, or fire
      if (ridge > 0.9 && T > 0.72) { terrain[k] = h2(wx | 0, wy | 0, s + 41) < 0.3 ? 10 : 19; fert[k] = 0; continue; }
      terrain[k] = T < 0.45 ? 17 : 4; fert[k] = 0; continue;
    }
    if (H > 0.7) { terrain[k] = T < 0.3 ? 18 : T > 0.72 ? 21 : 4; fert[k] = 0; continue; } // the range itself
    if (H > 0.65) { terrain[k] = 0; fert[k] = riparian ? 0.35 : 0.06; continue; } // foothills, green in the canyons
    if (T < 0.24) { terrain[k] = 17; fert[k] = 0.1; continue; }         // tundra
    if (T > 0.68 && M < 0.34) {                                         // desert belt
      if (riparian) { terrain[k] = 0; fert[k] = 0.85; forestish++; continue; } // the green river ribbon
      terrain[k] = M < 0.15 ? 11 : 14; fert[k] = 0.07; continue;
    }
    if (H < SEA + 0.04 && M > 0.6 && T > 0.5) {                         // wetlands hug the water
      terrain[k] = h2(wx | 0, wy | 0, s + 43) < 0.25 ? 2 : 5;
      fert[k] = 1.0; forestish++; continue;
    }
    terrain[k] = 0;
    let f = M * 0.55 + 0.1 + (riparian ? 0.45 : 0) + (H < SEA + 0.1 ? 0.12 : 0) - Math.max(0, H - 0.58) * 1.2;
    if (M > 0.55 || (riparian && M > 0.35)) forestish++;                // forest follows the rain AND the rivers
    fert[k] = Math.min(1.15, Math.max(0.06, f));
  }
  stampStructures(w, cx, cy, terrain, fert);
  // hillshade: light from the northwest, like every map you have ever seen
  const shade = new Int8Array(CFG.CH * CFG.CH);
  for (let j = 1; j < CFG.CH; j++) for (let i = 1; i < CFG.CH; i++) {
    const k2 = i + j * CFG.CH;
    shade[k2] = Math.max(-24, Math.min(24, (elevA[k2 - 1 - CFG.CH] - elevA[k2]) * 620));
  }
  const ch = { cx, cy, terrain, fert, shade, plants: [], decor: [], biome: forestish > 80 ? 'forest' : '' };
  const r = w.rand;
  const tries = ch.biome === 'forest' ? 34 : 12; // forests arrive FULL of trees
  for (let t = 0; t < tries; t++) {
    const k = (r() * CFG.CH * CFG.CH) | 0;
    const def = MATS[terrain[k]] || MATS[0];
    if (def.grow && r() < (def.fertFix !== undefined ? def.fertFix : fert[k]) * 0.8) {
      addPlant(w, ch, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + r() * CFG.CS,
                      cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + r() * CFG.CS,
                      ch.biome === 'forest' && r() < 0.55);
    }
  }
  return ch;
}

function getChunk(w, cx, cy) {
  const key = chunkKey(cx, cy);
  let ch = w.chunks.get(key);
  if (!ch) { ch = genChunk(w, cx, cy); w.chunks.set(key, ch); }
  return ch;
}

function cellOf(w, x, y) {
  const cx = Math.floor(x / CFG.CHPX), cy = Math.floor(y / CFG.CHPX);
  const ch = getChunk(w, cx, cy);
  const i = Math.min(CFG.CH - 1, Math.max(0, Math.floor((x - cx * CFG.CHPX) / CFG.CS)));
  const j = Math.min(CFG.CH - 1, Math.max(0, Math.floor((y - cy * CFG.CHPX) / CFG.CS)));
  return [ch, i + j * CFG.CH];
}

function terrAt(w, x, y) { const [ch, k] = cellOf(w, x, y); return ch.terrain[k]; }
function matAt(w, x, y) { return MATS[terrAt(w, x, y)] || MATS[0]; }
function openGround(w, x, y) { return !!matAt(w, x, y).dig; }

function passableFor(w, c, x, y) {
  const d = matAt(w, x, y);
  if (d.block) return false;
  if (d.kill && !d.silent) return false;
  if (d.swim) return c.swimV > 0;
  return true;
}

function findSpawn(w) {
  for (let rad = 0; rad < 60; rad++) {
    for (let a = 0; a < 12; a++) {
      const x = Math.cos(a) * rad * 300, y = Math.sin(a) * rad * 300;
      if (terrAt(w, x, y) === 0) return [x, y];
    }
  }
  return [0, 0];
}

// ---------- achievements ----------
function ach(w, id, msg) {
  if (w.achDone.has(id)) return;
  w.achDone.add(id);
  w.events.push({ tick: w.tick, kind: 'ach', id, msg });
}

// ---------- species ----------
function newSpecies(w, genome, parentSp, fixedName) {
  const id = w.spNext++;
  const rec = { id, name: fixedName || spName(w), founder: { ...genome }, count: 0, born: w.tick, parent: parentSp, peak: 0, announced: !!fixedName };
  w.species.set(id, rec);
  return id;
}

function assignSpecies(w, genome, parentSp) {
  const p = w.species.get(parentSp);
  if (p && geneDist(genome, p.founder) <= CFG.SP_DIST) return parentSp;
  return newSpecies(w, genome, parentSp);
}

function spGain(w, id) {
  const s = w.species.get(id);
  if (!s) return;
  s.count++;
  if (s.count > s.peak) s.peak = s.count;
  if (!s.announced && s.count >= 6) {
    s.announced = true;
    const p = s.parent != null ? w.species.get(s.parent) : null;
    w.events.push({ tick: w.tick, kind: 'new', hue: s.founder.hue,
      msg: p ? `NEW SPECIES: ${s.name} (SPLIT FROM ${p.name})` : `SPECIES ESTABLISHED: ${s.name}` });
    if (p) ach(w, 'speciate', 'a species split in two');
  }
}
function spLose(w, id) {
  const s = w.species.get(id);
  if (s && --s.count === 0 && s.announced) {
    w.events.push({ tick: w.tick, kind: 'ext', msg: `${s.name} WENT EXTINCT`, hue: s.founder.hue });
    ach(w, 'extinct', 'a species went extinct');
  }
}

// ---------- critters ----------
function derive(c) {
  const g = c.g;
  c.r = 3 + g.siz * 11;
  c.maxE = c.r * c.r * 3;
  c.vmax = 0.4 + g.spd * 1.8;
  c.nEyes = g.eyes < 0.25 ? 1 : g.eyes < 0.7 ? 2 : 3;
  c.arc = c.nEyes === 1 ? 110 : c.nEyes === 2 ? 220 : 340;
  c.cosArc = Math.cos((c.arc / 2) * Math.PI / 180);
  c.senEff = (30 + g.sen * 130) * (c.nEyes === 1 ? 1.3 : c.nEyes === 2 ? 1 : 0.85);
  c.senR = c.senEff;
  const boost = 1 + (1 - g.seg) * 0.15;
  c.landV = c.vmax * (0.55 + 0.45 * g.legs) * boost;
  c.swimV = g.legs < 0.3 ? c.vmax * (0.25 + g.tail * 0.9) * boost : 0;
  c.turnCap = 0.14 + g.seg * 0.4;
  c.effR = c.r * (1 + g.spik * 0.6);
  c.upkI = CFG.BASE_UPK * c.r * c.r * (1 + g.spik * 0.5 + g.pat * 0.25 + g.ven * 0.3);
  c.huntR = c.r * (0.85 + g.ven * 0.55);
}

function canSee(c, tx, ty, mult) {
  const ox = tx - c.x, oy = ty - c.y, d2 = ox * ox + oy * oy;
  const R = c.senEff * (mult || 1);
  if (d2 > R * R) return false;
  if (d2 < 4) return true;
  return (Math.cos(c.dir) * ox + Math.sin(c.dir) * oy) >= c.cosArc * Math.sqrt(d2);
}

function turnToward(c, want, cap) {
  let d = want - c.dir;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  c.dir += Math.max(-cap, Math.min(cap, d));
}

function spawnCritter(w, x, y, g, sp, e) {
  const c = {
    id: w.nextId++, x, y, dir: w.rand() * Math.PI * 2,
    g, sp, e, age: 0, mode: 'wander', target: null,
    hideT: 0, kills: 0, nestId: 0, role: null, swam: false,
    sleep: 0, rage: 0, cgen: 0,
    maxAge: 2600 + g.siz * 3600 + w.rand() * 900,
  };
  derive(c);
  c.e = Math.min(e, c.maxE);
  w.critters.push(c);
  spGain(w, sp);
  if (g.ven > 0.5) ach(w, 'venom', 'venom evolved');
  if (g.pho > 0.5) ach(w, 'photo', 'a critter is going plant');
  if (g.spik > 0.85) ach(w, 'spiky', 'born fully armored');
  if (c.r > 13.5) ach(w, 'giant', 'a true giant was born');
  return c;
}

function spawnStillfolk(w, x, y, n) {
  if (!w.stillSp) {
    w.stillSp = newSpecies(w, { siz: 0.5, spd: 0.06, sen: 0.9, hue: 0.13, diet: 0, rep: 0.9,
      seg: 0.1, spik: 0, legs: 0.4, tail: 0, eyes: 0.95, pat: 0, ven: 0, bur: 0, pho: 0.95, soc: 0, cst: 0.5 }, null, 'Stillfolk');
  }
  const f = w.species.get(w.stillSp).founder;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = spawnCritter(w, x + Math.cos(a) * 90, y + Math.sin(a) * 90, { ...f }, w.stillSp, 999);
    c.maxAge = 900000; c.age = 0; c.still = true;
    c.dir = Math.atan2(y - c.y, x - c.x); // they face the stone
  }
}

function spawnFirstOne(w, x, y) {
  if (w.firstSp) return;
  w.firstSp = newSpecies(w, { siz: 1, spd: 0.02, sen: 1, hue: 0.98, diet: 0, rep: 0,
    seg: 0.1, spik: 0.6, legs: 0.2, tail: 0, eyes: 0.1, pat: 0.9, ven: 0, bur: 0, pho: 1, soc: 0, cst: 0.5 }, null, 'The First One');
  const f = w.species.get(w.firstSp).founder;
  const c = spawnCritter(w, x, y - 480, { ...f }, w.firstSp, 9999);
  c.maxAge = 9000000; c.still = true;
  c.dir = Math.atan2(y - c.y, x - c.x);
}

function summonCritter(w, x, y, genes, presetName) {
  const key = JSON.stringify(genes);
  w.summonSp = w.summonSp || new Map();
  let sp = w.summonSp.get(key);
  if (!sp) { sp = newSpecies(w, genes, null); w.summonSp.set(key, sp); }
  const c = spawnCritter(w, x, y, { ...genes }, sp, 9999);
  c.age = CFG.MATURITY;
  ach(w, 'creator', 'you made something alive');
  return c;
}

function seedLife(w, ax, ay) {
  const r = w.rand;
  const ext = { ven: 0.03, bur: 0.05, pho: 0.03, soc: 0.08, cst: 0.5 };
  const seeds = [
    { siz: 0.22, spd: 0.55, sen: 0.5,  hue: 0.30, diet: 0.05, rep: 0.2,
      seg: 0.1, spik: 0.0, legs: 0.5, tail: 0.3, eyes: 0.5, pat: 0.15, ...ext },
    { siz: 0.5,  spd: 0.4,  sen: 0.45, hue: 0.09, diet: 0.4,  rep: 0.55,
      seg: 0.9, spik: 0.35, legs: 0.8, tail: 0.1, eyes: 0.85, pat: 0.55, ...ext, soc: 0.75 },
    { siz: 0.35, spd: 0.7,  sen: 0.6,  hue: 0.55, diet: 0.15, rep: 0.3,
      seg: 0.5, spik: 0.0, legs: 0.05, tail: 0.9, eyes: 0.1, pat: 0.85, ...ext },
    { siz: 0.68, spd: 0.25, sen: 0.35, hue: 0.42, diet: 0.1,  rep: 0.2,
      seg: 0.15, spik: 0.9, legs: 0.6, tail: 0.05, eyes: 0.5, pat: 0.3, ...ext },
    { siz: 0.4,  spd: 0.3,  sen: 0.7,  hue: 0.75, diet: 0.2,  rep: 0.25,
      seg: 0.35, spik: 0.0, legs: 0.0, tail: 0.4, eyes: 0.6, pat: 0.6, ...ext },
    { siz: 0.3,  spd: 0.85, sen: 0.55, hue: 0.02, diet: 0.5,  rep: 0.6,
      seg: 0.6, spik: 0.15, legs: 0.9, tail: 0.6, eyes: 0.9, pat: 0.15, ...ext },
  ];
  for (let s = 0; s < seeds.length; s++) {
    const base = seeds[s];
    const sp = newSpecies(w, base, null);
    const ang = (s / seeds.length) * Math.PI * 2 + r();
    const cx = ax + Math.cos(ang) * 450, cy = ay + Math.sin(ang) * 450;
    for (let i = 0; i < 32; i++) {
      const g = mutate(w, base);
      let x = cx + gauss(r) * 260, y = cy + gauss(r) * 260;
      if (!openGround(w, x, y)) { x = cx; y = cy; }
      const c = spawnCritter(w, x, y, g, sp, 999);
      c.e = c.maxE * (0.5 + r() * 0.3);
      c.age = (r() * CFG.MATURITY) | 0;
    }
  }
}

// ---------- plants ----------
function addPlant(w, ch, x, y, big) {
  if (ch.plants.length >= CFG.PLANT_CHUNK_CAP) return;
  ch.plants.push({ x, y, dead: false, big: !!big, e: big ? CFG.TREE_E : CFG.PLANT_E });
  w.plantCount++;
}

function removePlant(w, ch, idx) {
  const p = ch.plants[idx];
  if (!p || p.dead) return;
  p.dead = true;
  const last = ch.plants.pop();
  if (last !== p) ch.plants[idx] = last;
  w.plantCount--;
}

function growPlants(w, cx0, cy0, cx1, cy1) {
  const r = w.rand;
  const wxMul = w.weather.state === 'rain' || w.weather.state === 'storm' ? 1.6 :
    w.weather.state === 'drought' ? 0.35 : 1;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    if (((cx * 3 + cy * 7 + w.tick) % 3) !== 0) continue; // stagger growth across the window
    const ch = getChunk(w, cx, cy);
    const k = (r() * CFG.CH * CFG.CH) | 0;
    const t = ch.terrain[k];
    const def = MATS[t] || MATS[0];
    if (def.cool && r() < def.cool.p) {
      ch.terrain[k] = def.cool.to;
      w.dirty.add(chunkKey(cx, cy));
      if (t === 10 && r() < 0.4) emitGas(w, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS, cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS, 'smoke', 0.6);
      continue;
    }
    if (def.boom && def.boom.unstable && r() < def.boom.unstable) { // twitchstone twitches
      lightFuse(w, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + 10, cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + 10, 8);
      continue;
    }
    if (t === 10 && r() < 0.3) { // lava ignites its edges
      igniteAt(w, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + 10 + (r() - 0.5) * 60,
                  cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + 10 + (r() - 0.5) * 60, false);
    }
    if (ch.plants.length >= CFG.PLANT_CHUNK_CAP) continue;
    if (!def.grow) continue;
    const f = (def.fertFix !== undefined ? def.fertFix : ch.fert[k]) * wxMul;
    if (r() > f * 0.55) continue;
    addPlant(w, ch, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + r() * CFG.CS,
                    cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + r() * CFG.CS,
                    ch.biome === 'forest' && r() < 0.25);
  }
}

function nearestPlant(w, c) {
  const rad = c.senEff;
  const cx0 = Math.floor((c.x - rad) / CFG.CHPX), cx1 = Math.floor((c.x + rad) / CFG.CHPX);
  const cy0 = Math.floor((c.y - rad) / CFG.CHPX), cy1 = Math.floor((c.y + rad) / CFG.CHPX);
  let best = null, bch = null, bd = rad * rad;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ch = w.chunks.get(chunkKey(cx, cy));
    if (!ch) continue;
    for (let i = 0; i < ch.plants.length; i++) {
      const p = ch.plants[i];
      const dx = p.x - c.x;
      if (dx * dx >= bd) continue;
      const d = dx * dx + (p.y - c.y) * (p.y - c.y);
      if (d < bd && canSee(c, p.x, p.y)) { bd = d; best = p; bch = ch; }
    }
  }
  return best ? { p: best, ch: bch } : null;
}

// ---------- gases ----------
function paintGas(w, x, y, rad, type) {
  const r = w.rand;
  for (let i = 0; i < 3; i++) {
    if (w.gas.length >= CFG.GAS_CAP) w.gas.shift();
    w.gas.push({ x: x + gauss(r) * rad * 0.5, y: y + gauss(r) * rad * 0.5,
      vx: gauss(r) * 0.3, vy: gauss(r) * 0.3, amt: 1, type: type || 'tox' });
  }
}

function emitGas(w, x, y, type, amt) {
  if (w.gas.length >= CFG.GAS_CAP) w.gas.shift();
  w.gas.push({ x, y, vx: gauss(w.rand) * 0.2, vy: gauss(w.rand) * 0.2 - 0.15, amt, type });
}

function stepGas(w) {
  w.wind += (w.rand() - 0.5) * 0.012;
  const wf = w.weather.state === 'storm' ? 0.5 : 0.22;
  const wvx = Math.cos(w.wind) * wf, wvy = Math.sin(w.wind) * wf;
  const g = w.gas; let k = 0;
  for (let i = 0; i < g.length; i++) {
    const p = g[i];
    p.x += p.vx + wvx; p.y += p.vy + wvy;
    p.vx = p.vx * 0.98 + gauss(w.rand) * 0.05;
    p.vy = p.vy * 0.98 + gauss(w.rand) * 0.05;
    const gd = GASES[p.type] || GASES.smoke;
    p.amt *= gd.dmg || gd.lure || gd.clone ? 0.9985 : 0.996;
    if ((i + w.tick) % 4 === 0 && p.amt > 0.1) {
      if (gd.dmg) queryCritters(w, p.x, p.y, 55, (c) => {
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 55 * 55) c.e -= p.amt * gd.dmg;
      });
      if (gd.lure) queryCritters(w, p.x, p.y, 130, (c) => {
        turnToward(c, Math.atan2(p.y - c.y, p.x - c.x), 0.25);
      });
      if (gd.fear) queryCritters(w, p.x, p.y, 130, (c) => {
        turnToward(c, Math.atan2(c.y - p.y, c.x - p.x), 0.35);
      });
      if (gd.confuse) queryCritters(w, p.x, p.y, 60, (c) => {
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 60 * 60) c.dir += (w.rand() - 0.5) * 1.6;
      });
      if (gd.sleep) queryCritters(w, p.x, p.y, 60, (c) => {
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 60 * 60 && !c.still) c.sleep = 30;
      });
      if (gd.rage) queryCritters(w, p.x, p.y, 60, (c) => {
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 60 * 60 && !c.still) c.rage = 300;
      });
      if (gd.size) queryCritters(w, p.x, p.y, 60, (c) => {
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 60 * 60 && !c.still) {
          c.g.siz = Math.min(1, Math.max(0, c.g.siz + gd.size));
          const frac = c.e / c.maxE; derive(c); c.e = frac * c.maxE;
        }
      });
      if (gd.clone && w.activeN < CFG.SOFT_CAP) {
        let victim = null;
        queryCritters(w, p.x, p.y, 60, (c) => {
          if (!victim && !c.still && (c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 60 * 60) victim = c;
        });
        if (victim && w.rand() < 0.3) { // flawed copies — each generation comes out wronger
          const cg = (victim.cgen || 0) + 1;
          const g2 = mutate(w, victim.g, 1.6 + cg * 0.9);
          const sp = assignSpecies(w, g2, victim.sp);
          const cl = spawnCritter(w, p.x + gauss(w.rand) * 10, p.y + gauss(w.rand) * 10, g2, sp, victim.e);
          cl.cgen = cg;
          ach(w, 'clone', 'the copies are not quite right');
          p.amt = 0; // the cloud spends itself
        }
      }
    }
    const alive = p.amt > 0.06;
    if (!alive && gd.seed && w.rand() < 0.6) {
      const [ch2, k2] = cellOf(w, p.x, p.y);
      if ((MATS[ch2.terrain[k2]] || MATS[0]).grow) addPlant(w, ch2, p.x, p.y);
    }
    if (alive &&
        Math.abs(p.x - w.view.x) < 4500 && Math.abs(p.y - w.view.y) < 4500) g[k++] = p;
  }
  g.length = k;
}

// ---------- fire ----------
function igniteAt(w, x, y, force) {
  if (w.fires.length >= CFG.FIRE_CAP) return;
  // fire needs fuel: a plant nearby, or a flammable material
  const [ch, k] = cellOf(w, x, y);
  const def = MATS[ch.terrain[k]] || MATS[0];
  let fuel = !!def.burn || force;
  if (!fuel) {
    for (const p of ch.plants) {
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < 26 * 26) { fuel = true; break; }
    }
  }
  if (fuel) w.fires.push({ x, y, life: 90 + w.rand() * 80 });
}

function stepFire(w) {
  const raining = w.weather.state === 'rain' || w.weather.state === 'storm';
  const fs = w.fires; let k = 0;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    f.life -= raining ? 4 : 1;
    if ((i + w.tick) % 3 === 0) {
      const [ch, ci2] = cellOf(w, f.x, f.y);
      // eat plants, spread through them
      for (let pi = ch.plants.length - 1; pi >= 0; pi--) {
        const p = ch.plants[pi];
        const d2 = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
        if (d2 < 30 * 30) {
          removePlant(w, ch, pi);
          f.life += 25;
          if (w.fires.length < CFG.FIRE_CAP && w.rand() < 0.75)
            w.fires.push({ x: p.x + gauss(w.rand) * 14, y: p.y + gauss(w.rand) * 14, life: 90 });
        }
      }
      // burn flammable ground (coal seams, tar, goo) down to ash
      const def = MATS[ch.terrain[ci2]] || MATS[0];
      if (def.burn && w.rand() < 0.12) {
        ch.terrain[ci2] = 16;
        w.dirty.add(chunkKey(ch.cx, ch.cy));
        f.life += def.burn;
        for (const [dx2, dy2] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
          if ((matAt(w, f.x + dx2, f.y + dy2).burn) && w.fires.length < CFG.FIRE_CAP && w.rand() < 0.6)
            w.fires.push({ x: f.x + dx2, y: f.y + dy2, life: 120 });
        }
      }
      // hurt and panic whatever stands in it
      queryCritters(w, f.x, f.y, 26, (c) => {
        if ((c.x - f.x) ** 2 + (c.y - f.y) ** 2 < 26 * 26) {
          c.e -= 2.2;
          turnToward(c, Math.atan2(c.y - f.y, c.x - f.x), 0.6);
        }
      });
      if (w.rand() < 0.3) emitGas(w, f.x, f.y, 'smoke', 0.5);
      if (w.rand() < 0.04) { // scorched earth
        const [ch3, k3] = cellOf(w, f.x, f.y);
        if ((MATS[ch3.terrain[k3]] || MATS[0]).grow && ch3.terrain[k3] !== 16) {
          ch3.terrain[k3] = 16;
          w.dirty.add(chunkKey(ch3.cx, ch3.cy));
        }
      }
    }
    if (f.life > 0) fs[k++] = f;
  }
  fs.length = k;
}

// ---------- explosions ----------
function lightFuse(w, x, y, t) {
  for (const f of w.fuses) if (Math.abs(f.x - x) < 14 && Math.abs(f.y - y) < 14) return;
  w.fuses.push({ x, y, t });
}

function explode(w, x, y, def) {
  const r = def.r;
  w.events.push({ tick: w.tick, kind: 'boom', x, y, r });
  ach(w, 'boom1', 'your first crater');
  // terrain: crater of ash, glass heart for the big ones, fallout for the worst
  const cr = Math.ceil(r / CFG.CS);
  const ccx = Math.floor(x / CFG.CS), ccy = Math.floor(y / CFG.CS);
  for (let gy = ccy - cr; gy <= ccy + cr; gy++) for (let gx = ccx - cr; gx <= ccx + cr; gx++) {
    const d = Math.hypot(gx - ccx, gy - ccy) * CFG.CS;
    if (d > r) continue;
    const wx = gx * CFG.CS + 10, wy = gy * CFG.CS + 10;
    const [ch, k] = cellOf(w, wx, wy);
    const cur = MATS[ch.terrain[k]] || MATS[0];
    if (cur.boom && d > 6) { lightFuse(w, wx, wy, 4 + (d / r) * 14); continue; } // the chain
    if (cur.swim && !def.glass) continue; // small booms don't boil lakes
    if (def.glass && d < r * 0.45) ch.terrain[k] = 40;
    else if (def.fallout && d < r * 0.6 && w.rand() < 0.14) ch.terrain[k] = 39;
    else if (!cur.block || d < r * 0.75) ch.terrain[k] = 16;
    for (let pi = ch.plants.length - 1; pi >= 0; pi--) {
      const p = ch.plants[pi];
      if (Math.floor(p.x / CFG.CS) === gx && Math.floor(p.y / CFG.CS) === gy) removePlant(w, ch, pi);
    }
    ch.decor = ch.decor.filter((dc) => Math.hypot(dc.x - x, dc.y - y) > r * 0.8);
    w.dirty.add(chunkKey(ch.cx, ch.cy));
  }
  // critters: kill zone, wound ring, panic
  queryCritters(w, x, y, r * 1.6, (c) => {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < r * 0.55) { killCritter(w, c, d > r * 0.35); }
    else if (d < r * 1.6) {
      c.e -= (1 - d / (r * 1.6)) * c.maxE * 0.7;
      c.dir = Math.atan2(c.y - y, c.x - x);
      c.target = null; c.mode = 'wander';
    }
  });
  for (let i = 0; i < 5; i++) emitGas(w, x + gauss(w.rand) * r * 0.4, y + gauss(w.rand) * r * 0.4, 'smoke', 1);
  for (let i = 0; i < 3; i++) igniteAt(w, x + gauss(w.rand) * r * 0.8, y + gauss(w.rand) * r * 0.8, false);
  if (def.fallout) ach(w, 'fallout', 'the ground will remember this one');
}

function stepFuses(w) {
  for (let i = w.fuses.length - 1; i >= 0; i--) {
    const f = w.fuses[i];
    if (--f.t > 0) continue;
    w.fuses.splice(i, 1);
    const [ch, k] = cellOf(w, f.x, f.y);
    const def = MATS[ch.terrain[k]] || MATS[0];
    if (def.boom) {
      ch.terrain[k] = 0;
      explode(w, f.x, f.y, def.boom);
    }
  }
}

function detonate(w, x, y, rad) { // the plunger
  const cr = Math.ceil(rad / CFG.CS);
  const ccx = Math.floor(x / CFG.CS), ccy = Math.floor(y / CFG.CS);
  for (let gy = ccy - cr; gy <= ccy + cr; gy++) for (let gx = ccx - cr; gx <= ccx + cr; gx++) {
    if (Math.hypot(gx - ccx, gy - ccy) > cr) continue;
    const wx = gx * CFG.CS + 10, wy = gy * CFG.CS + 10;
    if (matAt(w, wx, wy).boom) lightFuse(w, wx, wy, 6 + ((gx + gy) % 5) * 4);
  }
}

// ---------- weather ----------
function stepWeather(w) {
  const wx = w.weather;
  if (--wx.t <= 0) {
    const r = w.rand();
    const prev = wx.state;
    if (prev === 'clear') wx.state = r < 0.45 ? 'rain' : r < 0.6 ? 'storm' : r < 0.75 ? 'drought' : 'clear';
    else wx.state = r < 0.7 ? 'clear' : r < 0.85 ? 'rain' : 'storm';
    wx.t = wx.state === 'clear' ? 3000 + w.rand() * 5000 :
      wx.state === 'storm' ? 800 + w.rand() * 1400 :
      wx.state === 'drought' ? 3000 + w.rand() * 3000 : 1500 + w.rand() * 2500;
    if (wx.state !== prev)
      w.events.push({ tick: w.tick, kind: 'wx', msg: 'WX: ' + ({ clear: 'SKIES CLEAR', rain: 'RAIN FRONT INBOUND', storm: 'STORM CELL OVERHEAD', drought: 'DROUGHT CONDITIONS' })[wx.state] });
  }
  if (wx.state === 'storm' && w.tick % 90 === 0 && w.rand() < 0.75) {
    const x = w.view.x + (w.rand() - 0.5) * CFG.ACT * 1.8;
    const y = w.view.y + (w.rand() - 0.5) * CFG.ACT * 1.8;
    w.events.push({ tick: w.tick, kind: 'zap', x, y });
    igniteAt(w, x, y, true);
    let hit = null;
    queryCritters(w, x, y, 30, (c) => { if (!hit && Math.hypot(c.x - x, c.y - y) < 30) hit = c; });
    if (hit && !hit.still) {
      if (w.rand() < 0.18) { // it chose one
        hit.g = mutate(w, hit.g, 6);
        derive(hit); hit.e = hit.maxE;
        const newSp = assignSpecies(w, hit.g, hit.sp);
        if (newSp !== hit.sp) { spLose(w, hit.sp); hit.sp = newSp; spGain(w, newSp); }
        ach(w, 'spark', 'lightning refused to kill it');
      } else killCritter(w, hit, true);
    }
  }
}

// ---------- spatial hash ----------
function buildHash(w) {
  w.hash.clear();
  for (const c of w.critters) {
    if (!c.band) continue;
    const k = ((Math.floor(c.x / 100) + 32768) << 16) | ((Math.floor(c.y / 100) + 32768) & 0xffff);
    let cell = w.hash.get(k);
    if (!cell) { cell = []; w.hash.set(k, cell); }
    cell.push(c);
  }
}

function queryCritters(w, x, y, rad, fn) {
  const cx0 = Math.floor((x - rad) / 100), cx1 = Math.floor((x + rad) / 100);
  const cy0 = Math.floor((y - rad) / 100), cy1 = Math.floor((y + rad) / 100);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const cell = w.hash.get(((cx + 32768) << 16) | ((cy + 32768) & 0xffff));
    if (cell) for (const o of cell) fn(o);
  }
}

// ---------- nests ----------
function nestOf(w, c) { return c.nestId ? w.nests.find((n) => n.id === c.nestId && !n.dead) : null; }

function foundNest(w, c) {
  const n = {
    id: w.nestNext++, x: c.x, y: c.y, sp: c.sp, store: 0, dead: false,
    members: 1, nurses: 0,
    guardF: 0.15 + c.g.cst * 0.3, nurseF: 0.12,
  };
  w.nests.push(n);
  c.nestId = n.id; c.role = 'queen';
  const s = w.species.get(c.sp);
  w.events.push({ tick: w.tick, kind: 'new', hue: c.g.hue, msg: `${s ? s.name : '?'} FOUNDED A NEST` });
  ach(w, 'nest', 'a nest was founded');
}

function joinNest(w, c, n) {
  n.members++;
  c.nestId = n.id;
  const roll = w.rand();
  if (roll < n.guardF) c.role = 'guard';
  else if (roll < n.guardF + n.nurseF) { c.role = 'nurse'; n.nurses++; }
  else c.role = 'forager';
}

// ---------- behavior ----------
function decide(w, c) {
  const g = c.g;
  const nest = nestOf(w, c);
  if (c.nestId && !nest) { c.nestId = 0; c.role = null; }

  c.bb = 0;
  for (const a of w.blood) {
    const d2 = (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
    if (d2 < CFG.BLOOD_R * CFG.BLOOD_R) c.bb += a.p * 0.2 * (1 - Math.sqrt(d2) / CFG.BLOOD_R);
  }
  if (c.bb > 1) c.bb = 1;
  const hd = matAt(w, c.x, c.y);
  let rad = (hd.rad || 0) * 2;
  if (!rad) {
    rad = Math.max(
      (matAt(w, c.x + 22, c.y).rad || 0), (matAt(w, c.x - 22, c.y).rad || 0),
      (matAt(w, c.x, c.y + 22).rad || 0), (matAt(w, c.x, c.y - 22).rad || 0));
  }
  c.rad = rad;
  c.tmut = hd.mut || 0;
  for (const a of w.artifacts) { // what they raised still hums
    const d2 = (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
    if (a.kind === 'mono' && d2 < 220 * 220) c.tmut += 1.5;
    if (a.kind === 'idol' && d2 < 260 * 260) { c.bb = Math.min(1, c.bb + 0.3); turnToward(c, Math.atan2(a.y - c.y, a.x - c.x), 0.05); }
  }

  if (c.still) { c.mode = 'bask'; c.target = null; return; } // the Stillfolk only watch

  if (c.rage > 0) { // rage gas: everything is an enemy
    let foe = null, fd = Infinity;
    queryCritters(w, c.x, c.y, c.senEff, (o) => {
      if (o === c || o.dead || o.hideT > 0 || o.effR > c.r * 1.35) return;
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < fd) { fd = d; foe = o; }
    });
    if (foe) { c.mode = 'seek'; c.target = { t: 'prey', o: foe }; return; }
  }

  let threat = null, td = Infinity;
  queryCritters(w, c.x, c.y, c.senEff, (o) => {
    if (o === c || o.dead || o.hideT > 0) return;
    if ((o.g.diet > 0.55 || o.rage > 0) && o.huntR > c.effR && canSee(c, o.x, o.y, 1 - o.g.pat * 0.35)) {
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < td) { td = d; threat = o; }
    }
  });
  if (threat) {
    if (g.bur > 0.45 && openGround(w, c.x, c.y)) {
      c.hideT = (300 + g.bur * 400) | 0; c.mode = 'hide'; c.target = null;
      ach(w, 'burrow', 'a critter escaped underground');
      return;
    }
    c.mode = 'flee'; c.target = { t: 'flee', o: threat }; return;
  }

  if (nest) {
    const nd = Math.hypot(nest.x - c.x, nest.y - c.y);
    if (c.role === 'queen') {
      c.mode = nd > 50 ? 'seek' : 'wander';
      c.target = nd > 50 ? { t: 'spot', o: { x: nest.x, y: nest.y, r: 8 } } : null;
      return;
    }
    if (c.role === 'guard') {
      if (nd > CFG.NEST_LEASH) { c.mode = 'seek'; c.target = { t: 'spot', o: { x: nest.x, y: nest.y, r: 60 } }; return; }
      let intr = null, id2 = Infinity;
      queryCritters(w, nest.x, nest.y, 300, (o) => {
        if (o.dead || o.hideT > 0 || o.sp === nest.sp || o.still) return;
        if (o.effR > c.r * 1.35) return;
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < id2) { id2 = d; intr = o; }
      });
      if (intr) { c.mode = 'seek'; c.target = { t: 'prey', o: intr }; return; }
    }
    if (c.role === 'nurse') {
      if (nd > 70) { c.mode = 'seek'; c.target = { t: 'spot', o: { x: nest.x, y: nest.y, r: 20 } }; return; }
    }
    if (c.role === 'forager' && c.e > c.maxE * 0.82) {
      c.mode = 'seek'; c.target = { t: 'nest', o: nest }; return;
    }
  }

  const ready = c.e > c.maxE * reproAt(c) && c.age > CFG.MATURITY;

  if (g.soc > 0.6 && !c.nestId) {
    let near = null, nd2 = CFG.NEST_ADOPT * CFG.NEST_ADOPT;
    for (const n of w.nests) {
      if (n.dead || n.sp !== c.sp || n.members >= 44) continue;
      const d = (n.x - c.x) ** 2 + (n.y - c.y) ** 2;
      if (d < nd2) { nd2 = d; near = n; }
    }
    if (near) joinNest(w, c, near);
    else if (ready && openGround(w, c.x, c.y) && w.rand() < 0.02) { foundNest(w, c); return; }
  }

  if (ready && g.rep >= 0.5 && !c.nestId) {
    let mate = null, md = Infinity;
    queryCritters(w, c.x, c.y, c.senEff, (o) => {
      if (o === c || o.dead || o.hideT > 0 || o.sp !== c.sp || o.g.rep < 0.5 || o.nestId) return;
      if (o.e > o.maxE * reproAt(o) && o.age > CFG.MATURITY && canSee(c, o.x, o.y)) {
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < md) { md = d; mate = o; }
      }
    });
    if (mate) { c.mode = 'mate'; c.target = { t: 'mate', o: mate }; return; }
  }

  let best = null, bs = 0;
  if (g.diet < 0.9) {
    const hit = nearestPlant(w, c);
    if (hit) {
      const s = (1 - g.diet) / (Math.hypot(hit.p.x - c.x, hit.p.y - c.y) + 25);
      if (s > bs) { bs = s; best = { t: 'plant', o: hit.p, ch: hit.ch }; }
    }
  }
  if (g.diet > 0.25) {
    for (const cp of w.corpses) {
      if (!canSee(c, cp.x, cp.y)) continue;
      const s = g.diet / (Math.hypot(cp.x - c.x, cp.y - c.y) + 25);
      if (s > bs) { bs = s; best = { t: 'corpse', o: cp }; }
    }
  }
  if (g.diet > 0.55 && c.e < c.maxE * 0.8) {
    let prey = null, pd = Infinity;
    queryCritters(w, c.x, c.y, c.senEff, (o) => {
      if (o === c || o.dead || o.hideT > 0 || o.effR > c.huntR || o.still) return;
      if (c.nestId && o.nestId === c.nestId) return;
      if (!canSee(c, o.x, o.y, 1 - o.g.pat * 0.35)) return;
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < pd) { pd = d; prey = o; }
    });
    if (prey) {
      const s = (g.diet * 1.4) / (Math.sqrt(pd) + 25);
      if (s > bs) { bs = s; best = { t: 'prey', o: prey }; }
    }
  }
  if (best) { c.mode = 'seek'; c.target = best; }
  else if (g.pho > 0.35 && c.e < c.maxE * 0.9) { c.mode = 'bask'; c.target = null; }
  else { c.mode = 'wander'; c.target = null; }
}

function makeCorpse(w, c) {
  w.corpses.push({ x: c.x, y: c.y, r: c.r, meat: 12 + c.r * c.r * 1.4, max: 12 + c.r * c.r * 1.4 });
}

function canBreedHere(w, c) {
  return w.activeN < CFG.SOFT_CAP &&
    Math.abs(c.x - w.view.x) < CFG.ACT2 - 120 && Math.abs(c.y - w.view.y) < CFG.ACT2 - 120;
}

function killCritter(w, c, becomeCorpse) {
  c.dead = true;
  spLose(w, c.sp);
  if (c.sp === w.firstSp) ach(w, 'killedfirst', 'you were not supposed to do that');
  if (c.nestId) {
    const n = nestOf(w, c);
    if (n) {
      n.members--;
      if (c.role === 'nurse') n.nurses--;
      if (c.role === 'queen') {
        n.dead = true;
        const s = w.species.get(n.sp);
        w.events.push({ tick: w.tick, kind: 'ext', msg: `A ${s ? s.name.toUpperCase() : '?'} NEST FELL — ITS QUEEN DIED`, hue: c.g.hue });
      }
    }
  }
  if (!becomeCorpse) return null;
  if (matAt(w, c.x, c.y).sac) {
    w.blood.push({ x: c.x, y: c.y, p: Math.min(3, c.r / 5), t0: w.tick });
    if (w.blood.length > 40) w.blood.shift();
    w.sacrifices++;
    ach(w, 'sacrifice', 'the stone drank a life');
    if (w.sacrifices >= 25) ach(w, 'cult', '25 sacrifices accepted');
    return null;
  }
  makeCorpse(w, c);
  return w.corpses[w.corpses.length - 1];
}

function breedSplit(w, c) {
  const g = mutate(w, c.g, mutScale(c));
  if (c.rad) ach(w, 'hotblood', 'a child was born in the glow');
  const sp = assignSpecies(w, g, c.sp);
  const a = c.e;
  c.e = a * 0.42;
  const child = spawnCritter(w, c.x + gauss(w.rand) * 8, c.y + gauss(w.rand) * 8, g, sp, a * 0.42);
  child.dir = w.rand() * Math.PI * 2;
}

function breedMate(w, c, m) {
  const g = mixGenes(w, c.g, m.g, Math.max(mutScale(c), mutScale(m)));
  if (c.rad || m.rad) ach(w, 'hotblood', 'a child was born in the glow');
  const sp = assignSpecies(w, g, c.sp);
  const pot = (c.e + m.e) * 0.3;
  c.e *= 0.75; m.e *= 0.75;
  spawnCritter(w, (c.x + m.x) / 2, (c.y + m.y) / 2, g, sp, pot);
  c.target = null; m.target = null; c.mode = m.mode = 'wander';
}

function queenBreed(w, q, n) {
  const cost = q.maxE * 0.55 * (1 - 0.07 * Math.min(4, n.nurses));
  if (n.store < cost || !canBreedHere(w, q)) return;
  n.store -= cost;
  const g = mutate(w, q.g, mutScale(q));
  if (q.rad) ach(w, 'hotblood', 'a child was born in the glow');
  const sp = assignSpecies(w, g, q.sp);
  const child = spawnCritter(w, n.x + gauss(w.rand) * 14, n.y + gauss(w.rand) * 14, g, sp, cost * 0.8);
  if (sp === n.sp && n.members < 44) joinNest(w, child, n);
}

function stepCritter(w, c) {
  const g = c.g;

  if (c.sleep > 0) { c.sleep--; c.e -= c.upkI * 0.4; c.age++; if (c.e <= 0) killCritter(w, c, true); return; }
  if (c.rage > 0) c.rage--;

  if (c.hideT > 0) {
    c.hideT--;
    c.e -= c.upkI * 0.6;
    c.age++;
    if (c.e <= 0 || c.age > c.maxAge) killCritter(w, c, true);
    else if (c.e < c.maxE * 0.15) c.hideT = 0;
    return;
  }

  if ((c.id + w.tick) % CFG.DECIDE_EVERY === 0) decide(w, c);

  const md = matAt(w, c.x, c.y);
  if (md.kill) {
    if (md.silent) ach(w, 'void', 'the void ate something');
    else { emitGas(w, c.x, c.y, 'smoke', 0.9); ach(w, 'cooked', 'something touched lava'); }
    killCritter(w, c, false);
    return;
  }
  if (md.boom && md.boom.touch && !c.still) { // landmines
    const [ch, k] = cellOf(w, c.x, c.y);
    lightFuse(w, c.x, c.y, md.boom.fuse);
  }
  const vCap = (md.swim ? (c.swimV || c.landV * 0.35) : c.landV) * (md.speed || 1);
  const tc = c.turnCap * (md.turn || 1);
  if (md.swim && c.swimV > 0 && !c.swam) { c.swam = true; ach(w, 'swim', 'something swam'); }

  let v = vCap * 0.55;
  const tg = c.target;
  if (tg && (tg.o.dead || tg.o.hideT > 0 || (tg.t === 'corpse' && tg.o.meat <= 0))) {
    c.target = null; c.mode = 'wander';
  }
  if (c.mode === 'bask') {
    v = 0;
  } else if (c.mode === 'flee' && c.target) {
    const o = c.target.o;
    turnToward(c, Math.atan2(c.y - o.y, c.x - o.x), tc * 1.5);
    v = vCap;
    if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 > c.senEff * c.senEff * 1.7) { c.target = null; c.mode = 'wander'; }
  } else if (c.target) {
    const o = c.target.o;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    turnToward(c, Math.atan2(o.y - c.y, o.x - c.x), d < c.r * 3 ? 1 : tc);
    v = vCap;
    const reach = c.r + (o.r || 3) + 2;
    if (d < reach) {
      if (c.target.t === 'plant') {
        if (!o.dead) {
          const bite = Math.min(o.big ? 3 : 999, o.e);
          o.e -= bite;
          c.e = Math.min(c.maxE, c.e + bite * (1 - g.diet) * (o.big ? 1 : 1));
          if (o.e <= 0) removePlant(w, c.target.ch, c.target.ch.plants.indexOf(o));
          if (o.big) v = 0; else c.target = null;
        } else c.target = null;
      } else if (c.target.t === 'corpse') {
        const bite = Math.min(2.6, o.meat);
        o.meat -= bite;
        c.e = Math.min(c.maxE, c.e + bite * g.diet);
        v = 0;
      } else if (c.target.t === 'prey') {
        c.e -= o.g.spik * o.r * 3;
        const corpse = killCritter(w, o, true);
        c.kills++;
        if (c.kills >= 10) ach(w, 'apex', 'one critter made 10 kills');
        ach(w, 'firstblood', 'something ate something');
        c.target = corpse ? { t: 'corpse', o: corpse } : null;
      } else if (c.target.t === 'mate') {
        if (o.e > o.maxE * reproAt(o) && c.e > c.maxE * reproAt(c) &&
            canBreedHere(w, c)) breedMate(w, c, o);
        else { c.target = null; c.mode = 'wander'; }
      } else if (c.target.t === 'nest') {
        const dep = c.e - c.maxE * 0.55;
        if (dep > 0) { o.store += dep * 0.9; c.e -= dep; }
        c.target = null; c.mode = 'wander';
      } else if (c.target.t === 'spot') {
        c.target = null; c.mode = 'wander';
      }
    }
  } else {
    c.dir += (w.rand() - 0.5) * Math.min(0.7, tc * 2);
  }

  if (v > 0) {
    const nx = c.x + Math.cos(c.dir) * v, ny = c.y + Math.sin(c.dir) * v;
    const free = !passableFor(w, c, c.x, c.y);
    if (free || passableFor(w, c, nx, ny)) { c.x = nx; c.y = ny; }
    else if (passableFor(w, c, nx, c.y)) c.x = nx;
    else if (passableFor(w, c, c.x, ny)) c.y = ny;
    else c.dir += Math.PI * (0.5 + w.rand());
  }

  c.e -= c.upkI + CFG.MOVE_UPK * v * v * c.r + (c.rad || 0) * 0.22 + (md.drain || 0);
  if (c.bb) c.e += c.bb * 0.03;
  if (g.pho > 0.05) c.e += g.pho * c.r * c.r * 0.001 * (v < 0.2 ? 1 : 0.35);
  if (c.e > c.maxE) c.e = c.maxE;
  c.age++;
  if (c.e <= 0 || c.age > c.maxAge) {
    if (c.age > c.maxAge && c.age > 6800) ach(w, 'elder', 'died of proper old age');
    killCritter(w, c, true);
    return;
  }

  if (c.role === 'queen') {
    const n = nestOf(w, c);
    if (n) {
      if (c.e < c.maxE * 0.6 && n.store > 8) { const t = Math.min(2.2, n.store); n.store -= t; c.e += t; }
      queenBreed(w, c, n);
    }
    return;
  }
  if (g.rep < 0.5 && !c.nestId && c.e > c.maxE * reproAt(c) && c.age > CFG.MATURITY &&
      canBreedHere(w, c)) breedSplit(w, c);
}

// ---------- main step ----------
function step(w) {
  w.tick++;
  const ax0 = w.view.x - CFG.ACT2, ax1 = w.view.x + CFG.ACT2;
  const ay0 = w.view.y - CFG.ACT2, ay1 = w.view.y + CFG.ACT2;
  growPlants(w, Math.floor(ax0 / CFG.CHPX), Math.floor(ay0 / CFG.CHPX),
                Math.floor(ax1 / CFG.CHPX), Math.floor(ay1 / CFG.CHPX));
  let act = 0;
  for (const c of w.critters) {
    const dx = Math.abs(c.x - w.view.x), dy = Math.abs(c.y - w.view.y);
    c.band = dx < CFG.ACT && dy < CFG.ACT ? 2 : dx < CFG.ACT2 && dy < CFG.ACT2 ? 1 : 0;
    if (c.band) act++;
  }
  w.activeN = act;
  if (act >= 2000) ach(w, 'fullpetri', '2000 alive at once');
  buildHash(w);
  const cs = w.critters;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.dead || !c.band) continue;
    if (c.band === 2 || (w.tick + c.id) % 4 === 0) stepCritter(w, c); // outer band lives at quarter speed
  }
  let j = 0;
  for (let i = 0; i < cs.length; i++) if (!cs[i].dead) cs[j++] = cs[i];
  cs.length = j;
  const cp = w.corpses; let k = 0;
  for (let i = 0; i < cp.length; i++) {
    if (cp[i].x >= ax0 && cp[i].x <= ax1 && cp[i].y >= ay0 && cp[i].y <= ay1) {
      cp[i].meat -= 0.045;
      if (w.rand() < 0.004) emitGas(w, cp[i].x, cp[i].y, 'mia', 0.35);
    }
    if (cp[i].meat > 1) cp[k++] = cp[i];
  }
  cp.length = k;
  stepGas(w);
  stepFire(w);
  stepFuses(w);
  stepWeather(w);
  if (w.tick % 40 === 0) w.nests = w.nests.filter((n) => !n.dead);
  if (w.tick % 20 === 0 && w.blood.length)
    w.blood = w.blood.filter((a) => w.tick - a.t0 < CFG.BLOOD_LIFE);
  if (w.tick % 600 === 0 && w.critters.length > 12000) { // deep-frozen cull, far offscreen only
    const keep = [];
    for (const c of w.critters) {
      if (c.still || (Math.abs(c.x - w.view.x) < 6000 && Math.abs(c.y - w.view.y) < 6000)) keep.push(c);
      else spLose(w, c.sp);
    }
    w.critters = keep;
  }
}

// ---------- god tools ----------
// kind: material id | 'wall' | 'water' | 'erase' | 'fert+' | 'fert-'
// shape: 'circle' | 'square' | 'ring' | 'spray'
function paint(w, kind, x, y, rad, shape) {
  const r0 = w.rand;
  const cr = Math.ceil(rad / CFG.CS);
  const ccx = Math.floor(x / CFG.CS), ccy = Math.floor(y / CFG.CS);
  for (let gy = ccy - cr; gy <= ccy + cr; gy++) {
    for (let gx = ccx - cr; gx <= ccx + cr; gx++) {
      const d = Math.hypot(gx - ccx, gy - ccy);
      if (shape === 'square') { /* whole box */ }
      else if (shape === 'ring') { if (d > cr || d < cr - 1.6) continue; }
      else if (shape === 'spray') { if (d > cr || r0() > 0.18) continue; }
      else if (d > cr) continue;
      const wx = gx * CFG.CS + 10, wy = gy * CFG.CS + 10;
      const [ch, k] = cellOf(w, wx, wy);
      const mid = typeof kind === 'number' ? kind : ({ wall: 1, water: 2 })[kind];
      if (mid !== undefined) ch.terrain[k] = mid;
      else if (kind === 'erase') {
        if (ch.terrain[k] !== 0) ch.terrain[k] = 0;
        ch.decor = ch.decor.filter((dc) => Math.floor(dc.x / CFG.CS) !== gx || Math.floor(dc.y / CFG.CS) !== gy);
      } else if (kind === 'fert+') ch.fert[k] = Math.min(1.3, ch.fert[k] + 0.06);
      else if (kind === 'fert-') ch.fert[k] = Math.max(0, ch.fert[k] - 0.06);
      if (mid !== undefined && !(MATS[mid] || MATS[0]).grow) {
        for (let i = ch.plants.length - 1; i >= 0; i--) {
          const p = ch.plants[i];
          if (Math.floor(p.x / CFG.CS) === gx && Math.floor(p.y / CFG.CS) === gy) removePlant(w, ch, i);
        }
      }
      w.dirty.add(chunkKey(ch.cx, ch.cy));
    }
  }
  if (kind === 'water' || kind === 2) {
    for (let gy = ccy - cr - 4; gy <= ccy + cr + 4; gy++) for (let gx = ccx - cr - 4; gx <= ccx + cr + 4; gx++) {
      const d = Math.hypot(gx - ccx, gy - ccy);
      if (d <= cr || d > cr + 4) continue;
      const [ch, k] = cellOf(w, gx * CFG.CS + 10, gy * CFG.CS + 10);
      ch.fert[k] = Math.min(1.3, ch.fert[k] + 0.05);
      w.dirty.add(chunkKey(ch.cx, ch.cy));
    }
  }
}

// PLACE mode: drop a single object — cell becomes the material, plus a raised sprite
function placeObject(w, mid, x, y) {
  const gx = Math.floor(x / CFG.CS), gy = Math.floor(y / CFG.CS);
  const wx = gx * CFG.CS + 10, wy = gy * CFG.CS + 10;
  const [ch, k] = cellOf(w, wx, wy);
  ch.terrain[k] = mid;
  const def = MATS[mid] || MATS[0];
  if (def.decor) {
    ch.decor.push({ x: wx, y: wy, m: mid });
    if (ch.decor.length > 60) ch.decor.shift();
  }
  if (def.artifact) w.artifacts.push({ x: wx, y: wy, kind: def.artifact });
  for (let i = ch.plants.length - 1; i >= 0; i--) {
    const p = ch.plants[i];
    if (Math.floor(p.x / CFG.CS) === gx && Math.floor(p.y / CFG.CS) === gy) removePlant(w, ch, i);
  }
  w.dirty.add(chunkKey(ch.cx, ch.cy));
}

function findCritterAt(w, x, y, slack) {
  let best = null, bd = Infinity;
  for (const c of w.critters) {
    if (!c.band || c.hideT > 0) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < c.r + slack && d < bd) { bd = d; best = c; }
  }
  return best;
}

function aliveSpecies(w) {
  let n = 0;
  for (const s of w.species.values()) if (s.count >= 4) n++;
  return n;
}

if (typeof module !== 'undefined') {
  module.exports = { CFG, MATS, GASES, LIFE_PRESETS, makeWorld, step, paint, paintGas, placeObject,
    detonate, summonCritter, igniteAt, findCritterAt, aliveSpecies, geneDist, terrAt, getChunk };
}
