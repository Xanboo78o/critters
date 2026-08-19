// critters — sim.js
// Pure simulation: infinite chunked world, plants, critters, genes, speciation, nests.
// No DOM; loadable in node for the balance harness.
// Genes are the body. The environment is the only level designer.

const CFG = {
  CS: 20,                 // terrain cell size (px)
  CH: 16,                 // cells per chunk side
  CHPX: 320,              // chunk size in px
  ACT: 1600,              // half-size of the active (simulated) window around the camera
  FAR: 120000,            // |x| or |y| beyond this = the farlands
  PLANT_E: 28,            // energy per plant
  PLANT_CHUNK_CAP: 80,
  BASE_UPK: 0.0022,       // idle burn  * r*r
  MOVE_UPK: 0.009,        // move burn  * v*v*r
  REPRO_AT: 0.72,         // fraction of maxE to breed
  MATURITY: 260,          // ticks before first breeding
  MUT: 0.04,              // gaussian sigma-ish per gene per birth
  MUT_BIG: 0.03,          // chance of a big jump
  MUT_BIG_S: 0.35,
  SP_DIST: 1.35,          // gene distance from species founder -> new species (17 genes)
  SOFT_CAP: 2200,         // breeding pauses above this ACTIVE population
  DECIDE_EVERY: 8,
  NEST_R: 30,             // nest mound radius
  NEST_ADOPT: 1400,       // social critters join a same-species nest within this range
  NEST_LEASH: 340,        // guards patrol this far out
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

function h2(ix, iy, s) { // deterministic hash of a lattice point -> [0,1)
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 974634721)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, scale, s) { // smooth value noise
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
// all genes 0..1 — EVERY gene means something:
// function: siz size · spd speed · sen senses · diet 0=plants 1=meat · rep <0.5 splitter, >=0.5 mater
//           ven venom (hunt above your weight, costly) · bur burrow (hide underground when hunted)
//           pho photosynthesis (bask for energy while still) · soc social (nest life) · cst caste mix (guard share)
// form:     seg segments=agility · spik armor spikes · legs land speed / <0.3 swims · tail swim power
//           eyes field of view · pat camouflage
const FUNC_GENES = ['siz','spd','sen','diet','rep','ven','bur','pho','soc','cst'];
const FORM_GENES = ['seg','spik','legs','tail','eyes','pat'];
const GENES = [...FUNC_GENES, 'hue', ...FORM_GENES];
function gauss(r) { return r() + r() + r() - 1.5; } // ~N(0, 0.5)

function mutate(w, g) {
  const r = w.rand, m = { ...g };
  for (const k of GENES) {
    m[k] += gauss(r) * CFG.MUT * 2;
    if (r() < CFG.MUT_BIG) m[k] += gauss(r) * CFG.MUT_BIG_S * 2;
    if (k === 'hue') { m[k] = ((m[k] % 1) + 1) % 1; }
    else m[k] = Math.min(1, Math.max(0, m[k]));
  }
  return m;
}

function mixGenes(w, a, b) {
  const r = w.rand, g = {};
  for (const k of GENES) g[k] = r() < 0.5 ? a[k] : b[k];
  return mutate(w, g);
}

function hueDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 1 - d); }
function geneDist(a, b) {
  let s = 0;
  for (const k of FUNC_GENES) { const d = a[k] - b[k]; s += d * d; }
  for (const k of FORM_GENES) { const d = (a[k] - b[k]) * 0.8; s += d * d; }
  const hd = hueDist(a.hue, b.hue); s += hd * hd * 0.5;
  return Math.sqrt(s);
}

// ---------- world ----------
function makeWorld(seed) {
  const w = {
    seed: seed || 1, tick: 0, rand: mulberry32(seed || 1),
    view: { x: 0, y: 0 },
    chunks: new Map(),
    plantCount: 0,          // active-ish running count (plants live in chunks)
    critters: [], corpses: [], nests: [],
    species: new Map(), spNext: 1, nestNext: 1,
    nextId: 1, events: [], dirty: new Set(),
    hash: new Map(), activeN: 0,
    achDone: new Set(),
  };
  const [sx, sy] = findSpawn(w);
  w.view.x = sx; w.view.y = sy;
  seedLife(w, sx, sy);
  return w;
}

// terrain codes: 0 open ground · 1 painted wall · 2 water · 4 rock (natural wall) · 5 mud (slow) · 6 glowmoss (farlands)
function chunkKey(cx, cy) { return cx + ',' + cy; }

function genChunk(w, cx, cy) {
  const terrain = new Uint8Array(CFG.CH * CFG.CH);
  const fert = new Float32Array(CFG.CH * CFG.CH);
  const s = w.seed | 0;
  const far = Math.abs(cx * CFG.CHPX) > CFG.FAR || Math.abs(cy * CFG.CHPX) > CFG.FAR;
  for (let j = 0; j < CFG.CH; j++) for (let i = 0; i < CFG.CH; i++) {
    const wx = cx * CFG.CHPX + i * CFG.CS + 10, wy = cy * CFG.CHPX + j * CFG.CS + 10;
    const k = i + j * CFG.CH;
    if (far) {
      // the farlands — worldgen comes apart at the seams
      const g = vnoise(wx, wy, 60, s + 99);
      const stripe = ((Math.floor(wx / 160) ^ Math.floor(wy / 160)) & 7) === 0;
      if (stripe) { terrain[k] = 4; fert[k] = 0; }
      else if (g > 0.72) { terrain[k] = 6; fert[k] = 1.3; }
      else if (g < 0.18) { terrain[k] = 2; fert[k] = 0; }
      else { terrain[k] = 0; fert[k] = g * 0.8; }
      continue;
    }
    const H = vnoise(wx, wy, 1500, s) * 0.65 + vnoise(wx, wy, 430, s + 7) * 0.35;
    const M = vnoise(wx, wy, 1100, s + 13);
    if (H < 0.34) { terrain[k] = 2; fert[k] = 0; }
    else if (H < 0.375) { terrain[k] = 5; fert[k] = 0.85; }       // mud shores
    else if (H > 0.8) { terrain[k] = 4; fert[k] = 0; }            // rock cliffs
    else {
      terrain[k] = 0;
      fert[k] = Math.min(1.1, Math.max(0.03, M * 0.75 + (H < 0.45 ? 0.3 : 0) - 0.08));
    }
  }
  const ch = { cx, cy, terrain, fert, plants: [] };
  // new land comes pre-vegetated
  const r = w.rand;
  for (let t = 0; t < 26; t++) {
    const k = (r() * CFG.CH * CFG.CH) | 0;
    if (terrain[k] === 0 && r() < fert[k] * 0.8) {
      addPlant(w, ch, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + r() * CFG.CS,
                      cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + r() * CFG.CS);
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

function passableFor(w, c, x, y) {
  const t = terrAt(w, x, y);
  if (t === 1 || t === 4) return false;
  if (t === 2) return c.swimV > 0;
  return true;
}

function openGround(w, x, y) { const t = terrAt(w, x, y); return t === 0 || t === 5 || t === 6; }

function findSpawn(w) {
  for (let rad = 0; rad < 40; rad++) {
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
function newSpecies(w, genome, parentSp) {
  const id = w.spNext++;
  const rec = { id, name: spName(w), founder: { ...genome }, count: 0, born: w.tick, parent: parentSp, peak: 0, announced: false };
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
  if (!s.announced && s.count >= 6) { // a lineage becomes a species when it establishes
    s.announced = true;
    const p = s.parent != null ? w.species.get(s.parent) : null;
    w.events.push({ tick: w.tick, kind: 'new', hue: s.founder.hue,
      msg: p ? `new species: ${s.name} (split from ${p.name})` : `species established: ${s.name}` });
    if (p) ach(w, 'speciate', 'Divergence — a new species split off');
  }
}
function spLose(w, id) {
  const s = w.species.get(id);
  if (s && --s.count === 0 && s.announced) {
    w.events.push({ tick: w.tick, kind: 'ext', msg: `${s.name} went extinct`, hue: s.founder.hue });
    ach(w, 'extinct', 'The End — a species went extinct');
  }
}

// ---------- critters ----------
// eyes -> field of view · spik -> armor · legs/tail -> land/water · pat -> camo · seg -> agility
// ven -> hunt bigger prey · bur -> hide underground · pho -> bask for energy · soc/cst -> nest life
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
  c.effR = c.r * (1 + g.spik * 0.6); // how big you look to a hunter
  c.upkI = CFG.BASE_UPK * c.r * c.r * (1 + g.spik * 0.5 + g.pat * 0.25 + g.ven * 0.3);
  c.huntR = c.r * (0.85 + g.ven * 0.55); // venom lets you take bigger prey
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
    maxAge: 2600 + g.siz * 3600 + w.rand() * 900,
  };
  derive(c);
  c.e = Math.min(e, c.maxE);
  w.critters.push(c);
  spGain(w, sp);
  if (g.ven > 0.5) ach(w, 'venom', 'Venom evolved');
  if (g.pho > 0.5) ach(w, 'photo', 'Photosynthesis — a critter is going plant');
  if (g.spik > 0.85) ach(w, 'spiky', 'Maximum spike');
  if (c.r > 13.5) ach(w, 'giant', 'A true giant was born');
  return c;
}

function seedLife(w, ax, ay) {
  const r = w.rand;
  const ext = { ven: 0.03, bur: 0.05, pho: 0.03, soc: 0.08, cst: 0.5 };
  const seeds = [
    // small round grazers: 2 leg pairs, plain
    { siz: 0.22, spd: 0.55, sen: 0.5,  hue: 0.30, diet: 0.05, rep: 0.2,
      seg: 0.1, spik: 0.0, legs: 0.5, tail: 0.3, eyes: 0.5, pat: 0.15, ...ext },
    // ant-like spotted maters — SOCIAL: they found nests
    { siz: 0.5,  spd: 0.4,  sen: 0.45, hue: 0.09, diet: 0.4,  rep: 0.55,
      seg: 0.9, spik: 0.35, legs: 0.8, tail: 0.1, eyes: 0.85, pat: 0.55, ...ext, soc: 0.75 },
    // quick foragers: striped legless tadpoles with a club tail and one big eye
    { siz: 0.35, spd: 0.7,  sen: 0.6,  hue: 0.55, diet: 0.15, rep: 0.3,
      seg: 0.5, spik: 0.0, legs: 0.05, tail: 0.9, eyes: 0.1, pat: 0.85, ...ext },
    // spiky tanks: big, slow, bristling
    { siz: 0.68, spd: 0.25, sen: 0.35, hue: 0.42, diet: 0.1,  rep: 0.2,
      seg: 0.15, spik: 0.9, legs: 0.6, tail: 0.05, eyes: 0.5, pat: 0.3, ...ext },
    // spotted slugs: legless, sharp-eyed
    { siz: 0.4,  spd: 0.3,  sen: 0.7,  hue: 0.75, diet: 0.2,  rep: 0.25,
      seg: 0.35, spik: 0.0, legs: 0.0, tail: 0.4, eyes: 0.6, pat: 0.6, ...ext },
    // rust darters: 4 leg pairs, 3 eyes, half-meat maters
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

// ---------- plants (live inside chunks) ----------
function addPlant(w, ch, x, y) {
  if (ch.plants.length >= CFG.PLANT_CHUNK_CAP) return;
  ch.plants.push({ x, y, dead: false });
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
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ch = getChunk(w, cx, cy);
    if (ch.plants.length >= CFG.PLANT_CHUNK_CAP) continue;
    const k = (r() * CFG.CH * CFG.CH) | 0;
    const t = ch.terrain[k];
    if (t !== 0 && t !== 6) continue;
    const f = t === 6 ? 1.3 : ch.fert[k];
    if (r() > f * 0.55) continue;
    addPlant(w, ch, cx * CFG.CHPX + (k % CFG.CH) * CFG.CS + r() * CFG.CS,
                    cy * CFG.CHPX + ((k / CFG.CH) | 0) * CFG.CS + r() * CFG.CS);
  }
}

function nearestPlant(w, c) {
  const rad = c.senEff;
  const cx0 = Math.floor((c.x - rad) / CFG.CHPX), cx1 = Math.floor((c.x + rad) / CFG.CHPX);
  const cy0 = Math.floor((c.y - rad) / CFG.CHPX), cy1 = Math.floor((c.y + rad) / CFG.CHPX);
  let best = null, bch = null, bi = -1, bd = rad * rad;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ch = w.chunks.get(chunkKey(cx, cy));
    if (!ch) continue;
    for (let i = 0; i < ch.plants.length; i++) {
      const p = ch.plants[i];
      const dx = p.x - c.x;
      if (dx * dx >= bd) continue;
      const d = dx * dx + (p.y - c.y) * (p.y - c.y);
      if (d < bd && canSee(c, p.x, p.y)) { bd = d; best = p; bch = ch; bi = i; }
    }
  }
  return best ? { p: best, ch: bch } : null;
}

// ---------- spatial hash (active critters only) ----------
function hkey(x, y) { return ((Math.floor(x / 100) + 32768) << 16) | ((Math.floor(y / 100) + 32768) & 0xffff); }

function buildHash(w) {
  w.hash.clear();
  for (const c of w.critters) {
    if (!c.active) continue;
    const k = hkey(c.x, c.y);
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
  w.events.push({ tick: w.tick, kind: 'new', hue: c.g.hue, msg: `${s ? s.name : '?'} founded a nest` });
  ach(w, 'nest', 'Civilization — a nest was founded');
}

function joinNest(w, c, n) {
  n.members++;
  c.nestId = n.id;
  const roll = w.rand();
  if (roll < n.guardF) c.role = 'guard';
  else if (roll < n.guardF + n.nurseF) { c.role = 'nurse'; n.nurses++; }
  else c.role = 'forager';
}

function leaveNest(w, c) {
  const n = nestOf(w, c);
  if (n) { n.members--; if (c.role === 'nurse') n.nurses--; }
  c.nestId = 0; c.role = null;
}

// ---------- behavior ----------
function decide(w, c) {
  const g = c.g;
  const nest = nestOf(w, c);
  if (c.nestId && !nest) { c.nestId = 0; c.role = null; } // nest died

  // threats first — only ones I can actually SEE, big enough to beat my spikes
  let threat = null, td = Infinity;
  queryCritters(w, c.x, c.y, c.senEff, (o) => {
    if (o === c || o.dead || o.hideT > 0) return;
    if (o.g.diet > 0.55 && o.huntR > c.effR && canSee(c, o.x, o.y, 1 - o.g.pat * 0.35)) {
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < td) { td = d; threat = o; }
    }
  });
  if (threat) {
    // burrowers dive underground instead of running
    if (g.bur > 0.45 && openGround(w, c.x, c.y)) {
      c.hideT = (300 + g.bur * 400) | 0; c.mode = 'hide'; c.target = null;
      ach(w, 'burrow', 'Gone — a critter escaped underground');
      return;
    }
    c.mode = 'flee'; c.target = { t: 'flee', o: threat }; return;
  }

  // ---- nest roles override normal life ----
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
        if (o.dead || o.hideT > 0 || o.sp === nest.sp) return;
        if (o.effR > c.r * 1.35) return; // even guards have limits
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

  const ready = c.e > c.maxE * CFG.REPRO_AT && c.age > CFG.MATURITY;

  // social critters without a nest look for one, or found their own
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

  // maters go courting when full (nest members leave breeding to the queen)
  if (ready && g.rep >= 0.5 && !c.nestId) {
    let mate = null, md = Infinity;
    queryCritters(w, c.x, c.y, c.senEff, (o) => {
      if (o === c || o.dead || o.hideT > 0 || o.sp !== c.sp || o.g.rep < 0.5 || o.nestId) return;
      if (o.e > o.maxE * CFG.REPRO_AT && o.age > CFG.MATURITY && canSee(c, o.x, o.y)) {
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < md) { md = d; mate = o; }
      }
    });
    if (mate) { c.mode = 'mate'; c.target = { t: 'mate', o: mate }; return; }
  }

  // forage — pick the best bite for MY diet
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
      // spiky prey "counts as bigger"; venom raises what you dare take; camo hides
      if (o === c || o.dead || o.hideT > 0 || o.effR > c.huntR) return;
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

// births only land well inside the active window, so life doesn't pile up frozen at its edge
function canBreedHere(w, c) {
  return w.activeN < CFG.SOFT_CAP &&
    Math.abs(c.x - w.view.x) < CFG.ACT - 120 && Math.abs(c.y - w.view.y) < CFG.ACT - 120;
}

function makeCorpse(w, c) {
  w.corpses.push({ x: c.x, y: c.y, r: c.r, meat: 12 + c.r * c.r * 1.4, max: 12 + c.r * c.r * 1.4 });
}

function killCritter(w, c, becomeCorpse) {
  c.dead = true;
  spLose(w, c.sp);
  if (c.nestId) {
    const n = nestOf(w, c);
    if (n) {
      n.members--;
      if (c.role === 'nurse') n.nurses--;
      if (c.role === 'queen') {
        n.dead = true;
        const s = w.species.get(n.sp);
        w.events.push({ tick: w.tick, kind: 'ext', msg: `a ${s ? s.name : '?'} nest fell — its queen died`, hue: c.g.hue });
      }
    }
  }
  if (becomeCorpse) makeCorpse(w, c);
}

function breedSplit(w, c) {
  const g = mutate(w, c.g);
  const sp = assignSpecies(w, g, c.sp);
  const a = c.e;
  c.e = a * 0.42;
  const child = spawnCritter(w, c.x + gauss(w.rand) * 8, c.y + gauss(w.rand) * 8, g, sp, a * 0.42);
  child.dir = w.rand() * Math.PI * 2;
}

function breedMate(w, c, m) {
  const g = mixGenes(w, c.g, m.g);
  const sp = assignSpecies(w, g, c.sp);
  const pot = (c.e + m.e) * 0.3; // two providers = well-fed kids, the mater's edge
  c.e *= 0.75; m.e *= 0.75;
  spawnCritter(w, (c.x + m.x) / 2, (c.y + m.y) / 2, g, sp, pot);
  c.target = null; m.target = null; c.mode = m.mode = 'wander';
}

function queenBreed(w, q, n) {
  const cost = q.maxE * 0.55 * (1 - 0.07 * Math.min(4, n.nurses)); // nurses make brood cheaper
  if (n.store < cost || !canBreedHere(w, q)) return;
  n.store -= cost;
  const g = mutate(w, q.g);
  const sp = assignSpecies(w, g, q.sp);
  const child = spawnCritter(w, n.x + gauss(w.rand) * 14, n.y + gauss(w.rand) * 14, g, sp, cost * 0.8);
  if (sp === n.sp && n.members < 44) joinNest(w, child, n); // gene-drifted kids are outcasts
}

function stepCritter(w, c) {
  const g = c.g;

  // underground: invisible, safe, slow burn
  if (c.hideT > 0) {
    c.hideT--;
    c.e -= c.upkI * 0.6;
    c.age++;
    if (c.e <= 0 || c.age > c.maxAge) killCritter(w, c, true);
    else if (c.e < c.maxE * 0.15) c.hideT = 0; // hunger forces you up
    return;
  }

  if ((c.id + w.tick) % CFG.DECIDE_EVERY === 0) decide(w, c);

  // medium decides your speed: legs on land, tail in water, mud slows everyone
  const tHere = terrAt(w, c.x, c.y);
  const vCap = tHere === 2 ? (c.swimV || c.landV * 0.35) : tHere === 5 ? c.landV * 0.55 : c.landV;
  if (tHere === 2 && c.swimV > 0 && !c.swam) { c.swam = true; ach(w, 'swim', 'Landfall in reverse — something swam'); }

  // steer
  let v = vCap * 0.55;
  const tg = c.target;
  if (tg && (tg.o.dead || tg.o.hideT > 0 || (tg.t === 'corpse' && tg.o.meat <= 0))) {
    c.target = null; c.mode = 'wander';
  }
  if (c.mode === 'bask') {
    v = 0;
  } else if (c.mode === 'flee' && c.target) {
    const o = c.target.o;
    turnToward(c, Math.atan2(c.y - o.y, c.x - o.x), c.turnCap * 1.5); // panic turns
    v = vCap;
    if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 > c.senEff * c.senEff * 1.7) { c.target = null; c.mode = 'wander'; }
  } else if (c.target) {
    const o = c.target.o;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    turnToward(c, Math.atan2(o.y - c.y, o.x - c.x), d < c.r * 3 ? 1 : c.turnCap);
    v = vCap;
    const reach = c.r + (o.r || 3) + 2;
    if (d < reach) {
      if (c.target.t === 'plant') {
        if (!o.dead) {
          c.e = Math.min(c.maxE, c.e + CFG.PLANT_E * (1 - g.diet));
          removePlant(w, c.target.ch, c.target.ch.plants.indexOf(o));
        }
        c.target = null;
      } else if (c.target.t === 'corpse') {
        const bite = Math.min(2.6, o.meat);
        o.meat -= bite;
        c.e = Math.min(c.maxE, c.e + bite * g.diet);
        v = 0;
      } else if (c.target.t === 'prey') {
        c.e -= o.g.spik * o.r * 3; // spiky prey wounds its killer
        killCritter(w, o, true);
        c.kills++;
        if (c.kills >= 10) ach(w, 'apex', 'Apex — one critter made 10 kills');
        ach(w, 'firstblood', 'First blood');
        c.target = { t: 'corpse', o: w.corpses[w.corpses.length - 1] };
      } else if (c.target.t === 'mate') {
        if (o.e > o.maxE * CFG.REPRO_AT && c.e > c.maxE * CFG.REPRO_AT &&
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
    c.dir += (w.rand() - 0.5) * Math.min(0.7, c.turnCap * 2);
    // idle wanderers drift back toward the living world instead of freezing at its rim
    if (Math.abs(c.x - w.view.x) > CFG.ACT - 150 || Math.abs(c.y - w.view.y) > CFG.ACT - 150)
      turnToward(c, Math.atan2(w.view.y - c.y, w.view.x - c.x), c.turnCap);
  }

  // move (walls/rock block; water blocks non-swimmers; if stuck in painted terrain, wiggle free)
  if (v > 0) {
    const nx = c.x + Math.cos(c.dir) * v, ny = c.y + Math.sin(c.dir) * v;
    const free = !passableFor(w, c, c.x, c.y);
    if (free || passableFor(w, c, nx, ny)) { c.x = nx; c.y = ny; }
    else if (passableFor(w, c, nx, c.y)) c.x = nx;
    else if (passableFor(w, c, c.x, ny)) c.y = ny;
    else c.dir += Math.PI * (0.5 + w.rand());
  }

  // burn, bask, age
  c.e -= c.upkI + CFG.MOVE_UPK * v * v * c.r;
  if (g.pho > 0.05) c.e = Math.min(c.maxE, c.e + g.pho * c.r * c.r * 0.001 * (v < 0.2 ? 1 : 0.35));
  c.age++;
  if (c.e <= 0 || c.age > c.maxAge) {
    if (c.age > c.maxAge && c.age > 6800) ach(w, 'elder', 'Died of old age, properly old');
    killCritter(w, c, true);
    return;
  }

  // queens brood from the nest store; splitters split
  if (c.role === 'queen') {
    const n = nestOf(w, c);
    if (n) {
      if (c.e < c.maxE * 0.6 && n.store > 8) { const t = Math.min(2.2, n.store); n.store -= t; c.e += t; }
      queenBreed(w, c, n);
    }
    return;
  }
  if (g.rep < 0.5 && !c.nestId && c.e > c.maxE * CFG.REPRO_AT && c.age > CFG.MATURITY &&
      canBreedHere(w, c)) breedSplit(w, c);
}

// ---------- main step ----------
function step(w) {
  w.tick++;
  const ax0 = w.view.x - CFG.ACT, ax1 = w.view.x + CFG.ACT;
  const ay0 = w.view.y - CFG.ACT, ay1 = w.view.y + CFG.ACT;
  growPlants(w, Math.floor(ax0 / CFG.CHPX), Math.floor(ay0 / CFG.CHPX),
                Math.floor(ax1 / CFG.CHPX), Math.floor(ay1 / CFG.CHPX));
  let act = 0;
  for (const c of w.critters) {
    c.active = c.x >= ax0 && c.x <= ax1 && c.y >= ay0 && c.y <= ay1;
    if (c.active) act++;
  }
  w.activeN = act;
  if (act >= 2000) ach(w, 'boom', 'Population boom — 2000 alive at once');
  buildHash(w);
  const cs = w.critters;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c.dead && c.active) stepCritter(w, c);
  }
  let j = 0;
  for (let i = 0; i < cs.length; i++) if (!cs[i].dead) cs[j++] = cs[i];
  cs.length = j;
  const cp = w.corpses; let k = 0;
  for (let i = 0; i < cp.length; i++) {
    if (cp[i].x >= ax0 && cp[i].x <= ax1 && cp[i].y >= ay0 && cp[i].y <= ay1) cp[i].meat -= 0.045;
    if (cp[i].meat > 1) cp[k++] = cp[i];
  }
  cp.length = k;
  if (w.tick % 40 === 0) w.nests = w.nests.filter((n) => !n.dead);
}

// ---------- god tools ----------
// kind: 'wall' | 'water' | 'erase' | 'fert+' | 'fert-'
function paint(w, kind, x, y, rad) {
  const cr = Math.ceil(rad / CFG.CS);
  const ccx = Math.floor(x / CFG.CS), ccy = Math.floor(y / CFG.CS);
  for (let gy = ccy - cr; gy <= ccy + cr; gy++) {
    for (let gx = ccx - cr; gx <= ccx + cr; gx++) {
      if (Math.hypot(gx - ccx, gy - ccy) > cr) continue;
      const wx = gx * CFG.CS + 10, wy = gy * CFG.CS + 10;
      const [ch, k] = cellOf(w, wx, wy);
      if (kind === 'wall') ch.terrain[k] = 1;
      else if (kind === 'water') { ch.terrain[k] = 2; }
      else if (kind === 'erase') { if (ch.terrain[k] !== 0) ch.terrain[k] = 0; }
      else if (kind === 'fert+') ch.fert[k] = Math.min(1.3, ch.fert[k] + 0.06);
      else if (kind === 'fert-') ch.fert[k] = Math.max(0, ch.fert[k] - 0.06);
      if (kind === 'wall' || kind === 'water') {
        for (let i = ch.plants.length - 1; i >= 0; i--) {
          const p = ch.plants[i];
          if (Math.floor(p.x / CFG.CS) === gx && Math.floor(p.y / CFG.CS) === gy) removePlant(w, ch, i);
        }
      }
      w.dirty.add(chunkKey(ch.cx, ch.cy));
    }
  }
  if (kind === 'water') { // shores go green
    for (let gy = ccy - cr - 4; gy <= ccy + cr + 4; gy++) for (let gx = ccx - cr - 4; gx <= ccx + cr + 4; gx++) {
      const d = Math.hypot(gx - ccx, gy - ccy);
      if (d <= cr || d > cr + 4) continue;
      const [ch, k] = cellOf(w, gx * CFG.CS + 10, gy * CFG.CS + 10);
      ch.fert[k] = Math.min(1.3, ch.fert[k] + 0.05);
      w.dirty.add(chunkKey(ch.cx, ch.cy));
    }
  }
}

function findCritterAt(w, x, y, slack) {
  let best = null, bd = Infinity;
  for (const c of w.critters) {
    if (!c.active || c.hideT > 0) continue;
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
  module.exports = { CFG, makeWorld, step, paint, findCritterAt, aliveSpecies, geneDist, terrAt, getChunk };
}
