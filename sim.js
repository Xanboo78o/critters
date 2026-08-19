// critters — sim.js
// Pure simulation: world, plants, critters, genes, speciation. No DOM.
// Genes are the body. The environment is the only level designer.

const CFG = {
  W: 3000, H: 2000,
  CS: 20,                 // terrain/fertility cell size (px)
  PCS: 40,                // plant grid cell size (px)
  PLANT_E: 28,            // energy per plant
  PLANT_TRIES: 60,        // growth attempts per tick
  PLANT_CELL_CAP: 5,
  PLANT_MAX: 9000,
  BASE_UPK: 0.0022,       // idle burn  * r*r
  MOVE_UPK: 0.009,        // move burn  * v*v*r
  REPRO_AT: 0.72,         // fraction of maxE to breed
  MATURITY: 260,          // ticks before first breeding
  MUT: 0.04,              // gaussian sigma-ish per gene per birth
  MUT_BIG: 0.03,          // chance of a big jump
  MUT_BIG_S: 0.35,
  SP_DIST: 0.92,          // gene distance from species founder -> new species (scaled for form genes)
  SOFT_CAP: 3500,         // breeding pauses above this population
  DECIDE_EVERY: 6,
};

// ---------- rng ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
// all genes 0..1
// function: siz size · spd speed · sen senses · hue color · diet 0=plants 1=meat · rep <0.5 splitter, >=0.5 mater
// form:     seg body segments · spik back spikes · legs leg pairs · tail tail style · eyes eye count · pat spots/stripes
const FUNC_GENES = ['siz','spd','sen','diet','rep'];
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
  const GW = CFG.W / CFG.CS, GH = CFG.H / CFG.CS;
  const PGW = CFG.W / CFG.PCS, PGH = CFG.H / CFG.PCS;
  const w = {
    tick: 0, rand: mulberry32(seed || 1),
    GW, GH, PGW, PGH,
    terrain: new Uint8Array(GW * GH),   // 0 open, 1 wall, 2 water
    fert: new Float32Array(GW * GH),
    plants: [], pGrid: [], plantCount: 0,
    critters: [], corpses: [],
    species: new Map(), spNext: 1,
    nextId: 1, events: [], dirty: true,
    hash: [], HW: Math.ceil(CFG.W / 100), HH: Math.ceil(CFG.H / 100),
  };
  for (let i = 0; i < PGW * PGH; i++) w.pGrid.push([]);
  for (let i = 0; i < w.HW * w.HH; i++) w.hash.push([]);
  w.fert.fill(0.12);
  seedTerrain(w);
  seedLife(w);
  return w;
}

function ci(w, x, y) {
  const cx = Math.min(w.GW - 1, Math.max(0, (x / CFG.CS) | 0));
  const cy = Math.min(w.GH - 1, Math.max(0, (y / CFG.CS) | 0));
  return cx + cy * w.GW;
}

function passable(w, x, y) {
  if (x < 10 || y < 10 || x > CFG.W - 10 || y > CFG.H - 10) return false;
  return w.terrain[ci(w, x, y)] === 0;
}

function fertBlob(w, cx, cy, rad, amt) {
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    if (x < 0 || y < 0 || x >= w.GW || y >= w.GH) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d > rad) continue;
    const i = x + y * w.GW;
    w.fert[i] = Math.min(1.3, w.fert[i] + amt * (1 - d / rad));
  }
}

function seedTerrain(w) {
  const r = w.rand;
  for (let i = 0; i < 42; i++)
    fertBlob(w, (r() * w.GW) | 0, (r() * w.GH) | 0, 3 + ((r() * 8) | 0), 0.12 + r() * 0.35);
  // two starter ponds — the rest of the world is yours to paint
  for (let p = 0; p < 2; p++) {
    const cx = ((0.28 + p * 0.44 + r() * 0.12) * w.GW) | 0, cy = ((0.3 + r() * 0.4) * w.GH) | 0;
    const rad = 5 + ((r() * 4) | 0);
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 1 || y < 1 || x >= w.GW - 1 || y >= w.GH - 1) continue;
      if (Math.hypot(x - cx, y - cy) <= rad * (0.75 + r() * 0.3)) w.terrain[x + y * w.GW] = 2;
    }
    fertBlob(w, cx, cy, rad + 7, 0.55);
  }
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
  }
}
function spLose(w, id) {
  const s = w.species.get(id);
  if (s && --s.count === 0 && s.announced)
    w.events.push({ tick: w.tick, kind: 'ext', msg: `${s.name} went extinct`, hue: s.founder.hue });
}

// ---------- critters ----------
function derive(c) {
  const g = c.g;
  c.r = 3 + g.siz * 11;
  c.maxE = c.r * c.r * 3;
  c.vmax = 0.4 + g.spd * 1.8;
  c.senR = 30 + g.sen * 130;
  c.upkI = CFG.BASE_UPK * c.r * c.r;
}

function spawnCritter(w, x, y, g, sp, e) {
  const c = {
    id: w.nextId++, x, y, dir: w.rand() * Math.PI * 2,
    g, sp, e, age: 0, mode: 'wander', target: null,
    maxAge: 2600 + g.siz * 3600 + w.rand() * 900,
  };
  derive(c);
  c.e = Math.min(e, c.maxE);
  w.critters.push(c);
  spGain(w, sp);
  return c;
}

function seedLife(w) {
  const r = w.rand;
  const seeds = [
    // small round grazers: 2 leg pairs, plain
    { siz: 0.22, spd: 0.55, sen: 0.5,  hue: 0.30, diet: 0.05, rep: 0.2,
      seg: 0.1, spik: 0.0, legs: 0.5, tail: 0.3, eyes: 0.5, pat: 0.15 },
    // mid omnivore maters: ant-like 3 segments, spotted, 3 eyes, spiky
    { siz: 0.5,  spd: 0.4,  sen: 0.45, hue: 0.09, diet: 0.4,  rep: 0.55,
      seg: 0.9, spik: 0.35, legs: 0.8, tail: 0.1, eyes: 0.85, pat: 0.55 },
    // quick foragers: striped legless tadpoles with a club tail and one big eye
    { siz: 0.35, spd: 0.7,  sen: 0.6,  hue: 0.55, diet: 0.15, rep: 0.3,
      seg: 0.5, spik: 0.0, legs: 0.05, tail: 0.9, eyes: 0.1, pat: 0.85 },
    // spiky tanks: big, slow, bristling
    { siz: 0.68, spd: 0.25, sen: 0.35, hue: 0.42, diet: 0.1,  rep: 0.2,
      seg: 0.15, spik: 0.9, legs: 0.6, tail: 0.05, eyes: 0.5, pat: 0.3 },
    // spotted slugs: legless, sharp-eyed
    { siz: 0.4,  spd: 0.3,  sen: 0.7,  hue: 0.75, diet: 0.2,  rep: 0.25,
      seg: 0.35, spik: 0.0, legs: 0.0, tail: 0.4, eyes: 0.6, pat: 0.6 },
    // rust darters: 4 leg pairs, 3 eyes, half-meat maters
    { siz: 0.3,  spd: 0.85, sen: 0.55, hue: 0.02, diet: 0.5,  rep: 0.6,
      seg: 0.6, spik: 0.15, legs: 0.9, tail: 0.6, eyes: 0.9, pat: 0.15 },
  ];
  // clusters on a ring around one shared spot, so the opening view is a mixed neighborhood
  const ax = 900 + r() * (CFG.W - 1800), ay = 700 + r() * (CFG.H - 1400);
  for (let s = 0; s < seeds.length; s++) {
    const base = seeds[s];
    const sp = newSpecies(w, base, null);
    const ang = (s / seeds.length) * Math.PI * 2 + r();
    const cx = ax + Math.cos(ang) * 450, cy = ay + Math.sin(ang) * 450;
    for (let i = 0; i < 32; i++) {
      const g = mutate(w, base);
      let x = cx + gauss(r) * 260, y = cy + gauss(r) * 260;
      x = Math.min(CFG.W - 30, Math.max(30, x)); y = Math.min(CFG.H - 30, Math.max(30, y));
      const c = spawnCritter(w, x, y, g, sp, 999);
      c.e = c.maxE * (0.5 + r() * 0.3);
      c.age = (r() * CFG.MATURITY) | 0;
    }
  }
  for (let i = 0; i < 900; i++) growPlants(w); // pre-grow so the dish opens alive
}

// ---------- plants ----------
function pci(w, x, y) {
  const cx = Math.min(w.PGW - 1, Math.max(0, (x / CFG.PCS) | 0));
  const cy = Math.min(w.PGH - 1, Math.max(0, (y / CFG.PCS) | 0));
  return cx + cy * w.PGW;
}

function addPlant(w, x, y) {
  const cell = pci(w, x, y);
  const p = { x, y, cell, idx: w.pGrid[cell].length };
  w.pGrid[cell].push(p);
  w.plants.push(p);
  p.gIdx = w.plants.length - 1;
  w.plantCount++;
}

function removePlant(w, p) {
  if (p.dead) return;
  p.dead = true;
  const cl = w.pGrid[p.cell], last = cl.pop();
  if (last !== p) { cl[p.idx] = last; last.idx = p.idx; }
  const gl = w.plants, gLast = gl.pop();
  if (gLast !== p) { gl[p.gIdx] = gLast; gLast.gIdx = p.gIdx; }
  w.plantCount--;
}

function growPlants(w) {
  const r = w.rand;
  for (let t = 0; t < CFG.PLANT_TRIES; t++) {
    if (w.plantCount >= CFG.PLANT_MAX) return;
    const x = r() * CFG.W, y = r() * CFG.H;
    const f = w.fert[ci(w, x, y)];
    if (r() > f * 0.55) continue;
    if (!passable(w, x, y)) continue;
    if (w.pGrid[pci(w, x, y)].length >= CFG.PLANT_CELL_CAP) continue;
    addPlant(w, x, y);
  }
}

function nearestPlant(w, x, y, rad) {
  const cr = Math.ceil(rad / CFG.PCS);
  const cx = (x / CFG.PCS) | 0, cy = (y / CFG.PCS) | 0;
  let best = null, bd = rad * rad;
  for (let gy = cy - cr; gy <= cy + cr; gy++) {
    if (gy < 0 || gy >= w.PGH) continue;
    for (let gx = cx - cr; gx <= cx + cr; gx++) {
      if (gx < 0 || gx >= w.PGW) continue;
      for (const p of w.pGrid[gx + gy * w.PGW]) {
        const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < bd) { bd = d; best = p; }
      }
    }
  }
  return best;
}

// ---------- spatial hash (critters) ----------
function buildHash(w) {
  for (const cell of w.hash) cell.length = 0;
  for (const c of w.critters) {
    const hx = Math.min(w.HW - 1, (c.x / 100) | 0), hy = Math.min(w.HH - 1, (c.y / 100) | 0);
    w.hash[hx + hy * w.HW].push(c);
  }
}

function queryCritters(w, x, y, rad, fn) {
  const cr = Math.ceil(rad / 100);
  const cx = (x / 100) | 0, cy = (y / 100) | 0;
  for (let gy = cy - cr; gy <= cy + cr; gy++) {
    if (gy < 0 || gy >= w.HH) continue;
    for (let gx = cx - cr; gx <= cx + cr; gx++) {
      if (gx < 0 || gx >= w.HW) continue;
      for (const o of w.hash[gx + gy * w.HW]) fn(o);
    }
  }
}

// ---------- behavior ----------
function decide(w, c) {
  const g = c.g;
  // threats first
  let threat = null, td = c.senR * c.senR;
  queryCritters(w, c.x, c.y, c.senR, (o) => {
    if (o === c || o.dead) return;
    if (o.g.diet > 0.55 && o.r > c.r * 1.15) {
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < td) { td = d; threat = o; }
    }
  });
  if (threat) { c.mode = 'flee'; c.target = { t: 'flee', o: threat }; return; }

  const ready = c.e > c.maxE * CFG.REPRO_AT && c.age > CFG.MATURITY;

  // maters go courting when full
  if (ready && g.rep >= 0.5) {
    let mate = null, md = c.senR * c.senR;
    queryCritters(w, c.x, c.y, c.senR, (o) => {
      if (o === c || o.dead || o.sp !== c.sp || o.g.rep < 0.5) return;
      if (o.e > o.maxE * CFG.REPRO_AT && o.age > CFG.MATURITY) {
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < md) { md = d; mate = o; }
      }
    });
    if (mate) { c.mode = 'mate'; c.target = { t: 'mate', o: mate }; return; }
  }

  // forage — pick the best bite for MY diet
  let best = null, bs = 0;
  if (g.diet < 0.9) {
    const p = nearestPlant(w, c.x, c.y, c.senR);
    if (p) {
      const s = (1 - g.diet) / (Math.hypot(p.x - c.x, p.y - c.y) + 25);
      if (s > bs) { bs = s; best = { t: 'plant', o: p }; }
    }
  }
  if (g.diet > 0.25) {
    for (const cp of w.corpses) {
      const d = Math.hypot(cp.x - c.x, cp.y - c.y);
      if (d < c.senR) {
        const s = g.diet / (d + 25);
        if (s > bs) { bs = s; best = { t: 'corpse', o: cp }; }
      }
    }
  }
  if (g.diet > 0.55 && c.e < c.maxE * 0.8) {
    let prey = null, pd = c.senR * c.senR;
    queryCritters(w, c.x, c.y, c.senR, (o) => {
      if (o === c || o.dead || o.r > c.r * 0.85) return;
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < pd) { pd = d; prey = o; }
    });
    if (prey) {
      const s = (g.diet * 1.4) / (Math.sqrt(pd) + 25);
      if (s > bs) { bs = s; best = { t: 'prey', o: prey }; }
    }
  }
  if (best) { c.mode = 'seek'; c.target = best; }
  else { c.mode = 'wander'; c.target = null; }
}

function makeCorpse(w, c) {
  w.corpses.push({ x: c.x, y: c.y, r: c.r, meat: 12 + c.r * c.r * 1.4, max: 12 + c.r * c.r * 1.4 });
}

function killCritter(w, c, becomeCorpse) {
  c.dead = true;
  spLose(w, c.sp);
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

function stepCritter(w, c) {
  const g = c.g;
  if ((c.id + w.tick) % CFG.DECIDE_EVERY === 0) decide(w, c);

  // steer
  let v = c.vmax * 0.55;
  const tg = c.target;
  if (tg && (tg.o.dead || (tg.t === 'corpse' && tg.o.meat <= 0))) {
    c.target = null; c.mode = 'wander';
  }
  if (c.mode === 'flee' && c.target) {
    const o = c.target.o;
    c.dir = Math.atan2(c.y - o.y, c.x - o.x);
    v = c.vmax;
    if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 > c.senR * c.senR * 1.7) { c.target = null; c.mode = 'wander'; }
  } else if (c.target) {
    const o = c.target.o;
    c.dir = Math.atan2(o.y - c.y, o.x - c.x);
    v = c.vmax;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    const reach = c.r + (o.r || 3) + 2;
    if (d < reach) {
      if (c.target.t === 'plant') {
        c.e = Math.min(c.maxE, c.e + CFG.PLANT_E * (1 - g.diet));
        removePlant(w, o); c.target = null;
      } else if (c.target.t === 'corpse') {
        const bite = Math.min(2.6, o.meat);
        o.meat -= bite;
        c.e = Math.min(c.maxE, c.e + bite * g.diet);
        v = 0;
      } else if (c.target.t === 'prey') {
        killCritter(w, o, true);
        c.target = { t: 'corpse', o: w.corpses[w.corpses.length - 1] };
      } else if (c.target.t === 'mate') {
        if (o.e > o.maxE * CFG.REPRO_AT && c.e > c.maxE * CFG.REPRO_AT &&
            w.critters.length < CFG.SOFT_CAP) breedMate(w, c, o);
        else { c.target = null; c.mode = 'wander'; }
      }
    }
  } else {
    c.dir += (w.rand() - 0.5) * 0.35;
  }

  // move (terrain blocks; if stuck inside painted wall, wiggle free)
  if (v > 0) {
    const nx = c.x + Math.cos(c.dir) * v, ny = c.y + Math.sin(c.dir) * v;
    const free = !passable(w, c.x, c.y);
    if (free || passable(w, nx, ny)) { c.x = Math.min(CFG.W - 10, Math.max(10, nx)); c.y = Math.min(CFG.H - 10, Math.max(10, ny)); }
    else if (passable(w, nx, c.y)) c.x = nx;
    else if (passable(w, c.x, ny)) c.y = ny;
    else c.dir += Math.PI * (0.5 + w.rand());
  }

  // burn + age
  c.e -= c.upkI + CFG.MOVE_UPK * v * v * c.r;
  c.age++;
  if (c.e <= 0 || c.age > c.maxAge) { killCritter(w, c, true); return; }

  // splitters split
  if (g.rep < 0.5 && c.e > c.maxE * CFG.REPRO_AT && c.age > CFG.MATURITY &&
      w.critters.length < CFG.SOFT_CAP) breedSplit(w, c);
}

// ---------- main step ----------
function step(w) {
  w.tick++;
  growPlants(w);
  buildHash(w);
  const cs = w.critters;
  for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (!c.dead) stepCritter(w, c); }
  // compact dead
  let j = 0;
  for (let i = 0; i < cs.length; i++) if (!cs[i].dead) cs[j++] = cs[i];
  cs.length = j;
  // corpses rot
  const cp = w.corpses; let k = 0;
  for (let i = 0; i < cp.length; i++) {
    cp[i].meat -= 0.045;
    if (cp[i].meat > 1) cp[k++] = cp[i];
  }
  cp.length = k;
}

// ---------- god tools ----------
// kind: 'wall' | 'water' | 'erase' | 'fert+' | 'fert-'
function paint(w, kind, x, y, rad) {
  const cr = Math.ceil(rad / CFG.CS);
  const cx = (x / CFG.CS) | 0, cy = (y / CFG.CS) | 0;
  for (let gy = cy - cr; gy <= cy + cr; gy++) {
    if (gy < 1 || gy >= w.GH - 1) continue;
    for (let gx = cx - cr; gx <= cx + cr; gx++) {
      if (gx < 1 || gx >= w.GW - 1) continue;
      if (Math.hypot(gx - cx, gy - cy) > cr) continue;
      const i = gx + gy * w.GW;
      if (kind === 'wall') w.terrain[i] = 1;
      else if (kind === 'water') w.terrain[i] = 2;
      else if (kind === 'erase') w.terrain[i] = 0;
      else if (kind === 'fert+') w.fert[i] = Math.min(1.3, w.fert[i] + 0.06);
      else if (kind === 'fert-') w.fert[i] = Math.max(0, w.fert[i] - 0.06);
    }
  }
  if (kind === 'water') fertBlob(w, cx, cy, cr + 6, 0.05); // shores go green
  if (kind === 'wall' || kind === 'water') {
    // clear plants under new terrain
    for (let i = w.plants.length - 1; i >= 0; i--) {
      const p = w.plants[i];
      if (Math.hypot(p.x - x, p.y - y) < rad + CFG.CS && !passable(w, p.x, p.y)) removePlant(w, p);
    }
  }
  w.dirty = true;
}

function findCritterAt(w, x, y) {
  let best = null, bd = 24 * 24;
  for (const c of w.critters) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd + c.r * c.r) { bd = d; best = c; }
  }
  return best;
}

function aliveSpecies(w) {
  let n = 0;
  for (const s of w.species.values()) if (s.count >= 4) n++;
  return n;
}

if (typeof module !== 'undefined') {
  module.exports = { CFG, makeWorld, step, paint, findCritterAt, aliveSpecies, geneDist };
}
