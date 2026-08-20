// critters — main.js: 90s instrument console, pixel render pipeline, god tools
'use strict';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const panel = document.getElementById('panel');
const statsEl = document.getElementById('stats');
const toastsEl = document.getElementById('toasts');
const achPanel = document.getElementById('achievements');

const params = new URLSearchParams(location.search);
const SEED = params.get('seed') ? +params.get('seed') : ((Math.random() * 1e9) | 0);
const world = makeWorld(SEED);

// ---------- mission log ----------
const ACH_DEFS = [
  ['firstblood', 'FIRST BLOOD', 'something ate something'],
  ['speciate', 'DIVERGENCE', 'a species split in two'],
  ['extinct', 'EXTINCTION', 'a species is gone'],
  ['venom', 'VENOMOUS', 'venom evolved'],
  ['burrow', 'BUNKER', 'a critter escaped underground'],
  ['photo', 'GOING GREEN', 'photosynthesis evolved'],
  ['swim', 'DEEP END', 'something swam'],
  ['nest', 'CIVILIZATION', 'a nest was founded'],
  ['spiky', 'MAXIMUM SPIKE', 'born fully armored'],
  ['giant', 'TITAN', 'a true giant was born'],
  ['elder', 'ELDER', 'died of proper old age'],
  ['apex', 'APEX', 'one critter, ten kills'],
  ['fullpetri', 'FULL PETRI', '2000 alive at once'],
  ['creator', 'CREATOR', 'you made something alive'],
  ['clone', 'NOT QUITE RIGHT', 'the copies degrade'],
  ['spark', 'IT CHOSE ONE', 'lightning refused to kill it'],
  ['boom1', 'FIRST CRATER', 'your first explosion'],
  ['plunger', 'BIG RED BUTTON', 'used the detonator'],
  ['fallout', 'THE GROUND REMEMBERS', 'a blast that will not wash out'],
  ['cooked', 'WELL DONE', 'something touched lava'],
  ['painter', 'TERRAFORMER', 'you reshaped the land'],
  ['inspector', 'FIELD BIOLOGIST', 'inspected 15 specimens'],
  ['chemist', 'ALCHEMIST', 'painted 12 different materials'],
  ['hotblood', 'CHILDREN OF THE ATOM', 'born mutated in the glow'],
  ['sacrifice', 'THE STONE DRINKS', 'a death became power'],
  ['cult', 'AND THEY KEPT COMING', '25 sacrifices accepted'],
  // ---- fragments. they line up. ----
  ['seecity', 'THEY BUILT', ''],
  ['seelab', 'THEY DUG', ''],
  ['seealtar', 'THEY FOUND THE STONE', ''],
  ['seescorched', 'IT WORKED', ''],
  ['farlands', 'WHERE IT TORE', ''],
  ['void', 'IT IS STILL HUNGRY', ''],
  ['stillfolk', 'THE STILLFOLK WATCH', ''],
  ['seezero', 'ONE REMAINS', ''],
  ['killedfirst', 'YOU WERE NOT SUPPOSED TO DO THAT', ''],
];
let achSaved = new Set(JSON.parse(localStorage.getItem('crittersAch') || '[]'));
for (const id of achSaved) world.achDone.add(id);
function unlock(id, msg) {
  if (achSaved.has(id)) return;
  achSaved.add(id);
  world.achDone.add(id);
  localStorage.setItem('crittersAch', JSON.stringify([...achSaved]));
  const def = ACH_DEFS.find((d) => d[0] === id);
  showToast(`🏆 ${def ? def[1] : id}${def && def[2] ? ' — ' + def[2] : ''}`, null, true);
  renderAchievements();
}
function renderAchievements() {
  achPanel.innerHTML = '<h2>MISSION LOG</h2>' + ACH_DEFS.map(([id, name, desc]) => {
    const got = achSaved.has(id);
    return `<div class="ach ${got ? 'got' : ''}"><b>${got ? name : '?????'}</b><span>${got ? desc : ''}</span></div>`;
  }).join('');
}
renderAchievements();

// ---------- canvas + pixel pipeline ----------
let dpr = 1;
const PIX = 2; // world renders at half res, doubled up — chunky by design
const wcv = document.createElement('canvas');
const wctx = wcv.getContext('2d');
function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  cv.style.width = innerWidth + 'px';   // the placer lives EXACTLY under the cursor now
  cv.style.height = innerHeight + 'px';
  wcv.width = Math.ceil(innerWidth / PIX);
  wcv.height = Math.ceil(innerHeight / PIX);
}
addEventListener('resize', resize);
resize();

const cam = { x: world.view.x, y: world.view.y, z: 0.7 };
if (params.get('z')) cam.z = +params.get('z');
if (params.get('x')) cam.x = +params.get('x');
if (params.get('y')) cam.y = +params.get('y');

let tool = 'look', speed = 1, selected = null, mode = 'terra', shape = 'circle';
const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, panning: false };
let paintFrames = 0, shakeT = 0, shakeMag = 0;
const inspected = new Set();
const fx = [];

function toWorld(sx, sy) {
  return [cam.x + (sx - innerWidth / 2) / cam.z, cam.y + (sy - innerHeight / 2) / cam.z];
}

// ---------- chunk terrain rendering: 4px per cell, with depth ----------
const chunkCanvases = new Map();
const SPECKLE = { metal: 24, rock: 14, strange: 16, soil: 8, liquid: 6, boom: 14 };
const CPC = 4; // px per cell on the chunk canvas

function chunkCanvas(cx, cy) {
  const key = cx + ',' + cy;
  let c = chunkCanvases.get(key);
  if (c) return c;
  const ch = getChunk(world, cx, cy);
  c = document.createElement('canvas');
  c.width = CFG.CH * CPC; c.height = CFG.CH * CPC;
  const cc = c.getContext('2d');
  const img = cc.createImageData(CFG.CH * CPC, CFG.CH * CPC);
  const d = img.data;
  const colAt = (i, j) => {
    const t = ch.terrain[i + j * CFG.CH];
    const sh = ch.shade ? ch.shade[i + j * CFG.CH] : 0;
    if (t === 0) {
      const f = Math.min(1, ch.fert[i + j * CFG.CH]) * 0.7;
      return [210 + (109 - 210) * f + sh, 192 + (162 - 192) * f + sh, 130 + (78 - 130) * f + sh, MATS[0]];
    }
    const m = MATS[t] || MATS[0];
    const amp = SPECKLE[m.cat] || 10;
    const v = ((Math.imul(i * 31 + j * 517 + 7, 2654435761) >>> 8) % (amp * 2)) - amp + (m.block ? (sh / 2) | 0 : sh);
    return [m.col[0] + v, m.col[1] + v, m.col[2] + v, m];
  };
  for (let j = 0; j < CFG.CH; j++) for (let i = 0; i < CFG.CH; i++) {
    const [r, g, b, m] = colAt(i, j);
    const north = j > 0 ? (MATS[ch.terrain[i + (j - 1) * CFG.CH]] || MATS[0]) : m;
    const shadowed = !m.block && j > 0 && north.block; // things stand ABOVE the ground
    for (let pj = 0; pj < CPC; pj++) for (let pi = 0; pi < CPC; pi++) {
      let rr = r, gg = g, bb = b;
      if (m.block) { // raised: lit top edge, dark bottom edge
        if (pj === 0) { rr += 26; gg += 26; bb += 26; }
        else if (pj === CPC - 1) { rr -= 30; gg -= 30; bb -= 30; }
        else if (pi === 0) { rr += 10; gg += 10; bb += 10; }
        else if (pi === CPC - 1) { rr -= 12; gg -= 12; bb -= 12; }
      } else if (m.swim) { // sunken: dark upper lip
        if (pj === 0) { rr -= 24; gg -= 24; bb -= 24; }
        if (pj === 1) { rr -= 10; gg -= 10; bb -= 10; }
      }
      if (shadowed && pj < 2) { rr -= 34; gg -= 34; bb -= 30; }
      const idx = ((j * CPC + pj) * CFG.CH * CPC + i * CPC + pi) * 4;
      d[idx] = rr; d[idx + 1] = gg; d[idx + 2] = bb; d[idx + 3] = 255;
    }
  }
  cc.putImageData(img, 0, 0);
  if (chunkCanvases.size > 1600) chunkCanvases.clear();
  chunkCanvases.set(key, c);
  return c;
}

// ---------- world drawing (into the low-res buffer) ----------
function drawCritter(c, ox, oy, z) {
  const sx = ox + c.x * z, sy = oy + c.y * z, r = c.r * z;
  const g = c.g, h = (Math.round(g.hue * 16) / 16 * 360) | 0; // 16 palette hues, like the old machines
  const line = `hsl(${h} 46% 36%)`;

  if (c.hideT > 0) {
    wctx.fillStyle = '#b3a075';
    wctx.strokeStyle = '#98875f';
    wctx.lineWidth = Math.max(1, r * 0.14);
    wctx.beginPath();
    wctx.ellipse(sx, sy, Math.max(2, r * 0.8), Math.max(1.4, r * 0.55), 0, Math.PI, 0);
    wctx.closePath();
    wctx.fill(); wctx.stroke();
    return;
  }

  // grounded — every living thing casts a shadow
  if (r > 1.6) {
    wctx.globalAlpha = 0.16;
    wctx.fillStyle = '#241f14';
    wctx.beginPath();
    wctx.ellipse(sx + r * 0.18, sy + r * 0.42, r * 1.05, r * 0.5, 0, 0, 7);
    wctx.fill();
    wctx.globalAlpha = 1;
  }

  if (r < 2.4) {
    wctx.fillStyle = `hsl(${h} 44% 48%)`;
    wctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    return;
  }
  const fill = `hsl(${h} 44% 52%)`;
  const dark = `hsl(${h} 34% 19%)`;
  const dx = Math.cos(c.dir), dy = Math.sin(c.dir);
  const px = -dy, py = dx;
  const rx = r * (1 + g.spd * 0.4);
  const ry = r * (1 - g.spd * 0.18);
  const ph = c.id * 1.7 + world.tick * 0.22;
  const lw = Math.max(1, r * 0.16);
  wctx.fillStyle = fill;
  wctx.strokeStyle = line;
  wctx.lineWidth = lw;

  let segs;
  if (g.seg < 0.33)      segs = [[0, 1, 1]];
  else if (g.seg < 0.66) segs = [[-0.38, 0.78, 1], [0.5, 0.55, 0.75]];
  else                   segs = [[-0.5, 0.62, 0.98], [0.06, 0.44, 0.7], [0.58, 0.42, 0.62]];
  const head = segs[segs.length - 1], rear = segs[0];
  const headX = sx + dx * rx * head[0], headY = sy + dy * rx * head[0];
  const headRx = rx * head[1], headRy = ry * head[2];
  const rearX = sx + dx * rx * rear[0], rearY = sy + dy * rx * rear[0];
  const rearRx = rx * rear[1], rearRy = ry * rear[2];

  if (g.tail > 0.15) {
    const tl = r * g.tail * 2.2;
    const tw = Math.sin(ph) * r * 0.35;
    const tipX = rearX - dx * (rearRx + tl) + px * tw, tipY = rearY - dy * (rearRx + tl) + py * tw;
    wctx.beginPath();
    wctx.moveTo(rearX - dx * rearRx * 0.8, rearY - dy * rearRx * 0.8);
    wctx.quadraticCurveTo(rearX - dx * (rearRx + tl * 0.5), rearY - dy * (rearRx + tl * 0.5), tipX, tipY);
    wctx.stroke();
    if (g.tail > 0.72) { wctx.beginPath(); wctx.arc(tipX, tipY, r * 0.32, 0, 7); wctx.fill(); wctx.stroke(); }
  }

  const pairs = Math.round(g.legs * 4);
  if (r > 4 && pairs > 0) {
    const ll = r * (0.3 + g.legs * 0.4);
    wctx.lineWidth = Math.max(1, r * 0.14);
    for (let i = 0; i < pairs; i++) {
      const along = (pairs === 1 ? 0 : (i / (pairs - 1) - 0.5)) * rx * 1.05;
      const swing = Math.sin(ph + i * 2.1) * 0.55;
      for (const s of [1, -1]) {
        const ax = sx + dx * along + px * s * ry * 0.8;
        const ay = sy + dy * along + py * s * ry * 0.8;
        wctx.beginPath();
        wctx.moveTo(ax, ay);
        wctx.lineTo(ax + (px * s + dx * swing) * ll, ay + (py * s + dy * swing) * ll);
        wctx.stroke();
      }
    }
    wctx.lineWidth = lw;
  }

  if (r > 4 && g.spik > 0.25) {
    const n = 2 + Math.round(g.spik * 3);
    const sl = r * (0.25 + g.spik * 0.5);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 1.3;
      const bx = rearX + dx * rearRx * t * 0.8, by = rearY + dy * rearRx * t * 0.8;
      const wHere = rearRy * Math.sqrt(Math.max(0.05, 1 - t * t)) * 0.9;
      for (const s of [1, -1]) {
        const ax = bx + px * s * wHere, ay = by + py * s * wHere;
        wctx.beginPath();
        wctx.moveTo(ax + dx * r * 0.14, ay + dy * r * 0.14);
        wctx.lineTo(ax + (px * s - dx * 0.5) * sl, ay + (py * s - dy * 0.5) * sl);
        wctx.lineTo(ax - dx * r * 0.14, ay - dy * r * 0.14);
        wctx.closePath();
        wctx.fill(); wctx.stroke();
      }
    }
  }

  if (g.diet > 0.55) {
    wctx.beginPath();
    wctx.moveTo(headX + dx * headRx * 1.7, headY + dy * headRx * 1.7);
    wctx.lineTo(headX + dx * headRx * 0.3 + px * headRy * 0.6, headY + dy * headRx * 0.3 + py * headRy * 0.6);
    wctx.lineTo(headX + dx * headRx * 0.3 - px * headRy * 0.6, headY + dy * headRx * 0.3 - py * headRy * 0.6);
    wctx.closePath();
    wctx.fill(); wctx.stroke();
    if (g.ven > 0.3) {
      wctx.fillStyle = dark;
      wctx.beginPath();
      wctx.arc(headX + dx * headRx * 1.55, headY + dy * headRx * 1.55, Math.max(1, r * 0.14), 0, 7);
      wctx.fill();
      wctx.fillStyle = fill;
    }
  }

  for (const [off, kx, ky] of segs) {
    wctx.beginPath();
    wctx.ellipse(sx + dx * rx * off, sy + dy * rx * off, rx * kx, ry * ky, c.dir, 0, 7);
    wctx.fill(); wctx.stroke();
  }

  if (r > 4 && g.pho > 0.35) {
    wctx.fillStyle = line;
    wctx.globalAlpha = 0.65;
    const n = 2 + Math.round(g.pho * 2);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 1.2;
      const bx = rearX + dx * rearRx * t * 0.7, by = rearY + dy * rearRx * t * 0.7;
      wctx.beginPath();
      wctx.ellipse(bx, by, r * 0.28, r * 0.14, c.dir + t, 0, 7);
      wctx.fill();
    }
    wctx.globalAlpha = 1;
    wctx.fillStyle = fill;
  }

  if (r > 4.5 && g.pat > 0.4) {
    wctx.fillStyle = line;
    wctx.globalAlpha = 0.55;
    if (g.pat > 0.72) {
      const n = 2 + (g.pat > 0.88 ? 1 : 0);
      wctx.lineWidth = Math.max(1, r * 0.16);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 1.1;
        const wHere = rearRy * Math.sqrt(Math.max(0.05, 1 - t * t)) * 0.8;
        const bx = rearX + dx * rearRx * t * 0.8, by = rearY + dy * rearRx * t * 0.8;
        wctx.beginPath();
        wctx.moveTo(bx + px * wHere, by + py * wHere);
        wctx.lineTo(bx - px * wHere, by - py * wHere);
        wctx.stroke();
      }
      wctx.lineWidth = lw;
    } else {
      const n = 3 + Math.round(g.pat * 3);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + c.id, rr = Math.sqrt((i + 0.5) / n);
        wctx.beginPath();
        wctx.arc(rearX + Math.cos(a) * rearRx * 0.55 * rr, rearY + Math.sin(a) * rearRy * 0.55 * rr, r * 0.14, 0, 7);
        wctx.fill();
      }
    }
    wctx.globalAlpha = 1;
    wctx.fillStyle = fill;
  }

  if (r > 4) {
    if (g.rep < 0.5) {
      wctx.beginPath();
      wctx.moveTo(sx + px * ry * 0.75, sy + py * ry * 0.75);
      wctx.lineTo(sx - px * ry * 0.75, sy - py * ry * 0.75);
      wctx.globalAlpha = 0.4;
      wctx.stroke();
      wctx.globalAlpha = 1;
    } else {
      const bx = headX + dx * headRx * 0.6, by = headY + dy * headRx * 0.6;
      wctx.lineWidth = Math.max(1, r * 0.1);
      wctx.fillStyle = line;
      for (const s of [1, -1]) {
        const tx = bx + (dx + px * s * 0.9) * r * 0.5;
        const ty = by + (dy + py * s * 0.9) * r * 0.5;
        wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(tx, ty); wctx.stroke();
        wctx.beginPath(); wctx.arc(tx, ty, r * 0.1 + 0.8, 0, 7); wctx.fill();
      }
      wctx.fillStyle = fill;
      wctx.lineWidth = lw;
    }
  }

  const er = Math.max(1, r * (0.13 + g.sen * 0.2));
  const sleeping = c.sleep > 0;
  wctx.fillStyle = dark;
  if (c.nEyes === 1) {
    wctx.beginPath();
    wctx.arc(headX + dx * headRx * 0.45, headY + dy * headRx * 0.45, er * (sleeping ? 0.5 : 1.4), 0, 7);
    wctx.fill();
  } else {
    for (const s of [1, -1]) {
      wctx.beginPath();
      wctx.arc(headX + dx * headRx * 0.4 + px * s * headRy * 0.5, headY + dy * headRx * 0.4 + py * s * headRy * 0.5, er * (sleeping ? 0.5 : 1), 0, 7);
      wctx.fill();
    }
    if (c.nEyes === 3) {
      wctx.beginPath();
      wctx.arc(headX + dx * headRx * 0.75, headY + dy * headRx * 0.75, er * 0.8, 0, 7);
      wctx.fill();
    }
  }
  if (c.rage > 0) { // seeing red
    wctx.strokeStyle = 'hsl(4 60% 45%)';
    wctx.lineWidth = 1;
    wctx.beginPath(); wctx.arc(sx, sy, r + 2, 0, 7); wctx.stroke();
  }
}

function drawDecor(dc, ox, oy, z) {
  const m = MATS[dc.m] || MATS[4];
  const sx = ox + dc.x * z, sy = oy + dc.y * z, r = 11 * z;
  const [cr, cg, cb] = m.col;
  wctx.globalAlpha = 0.22;
  wctx.fillStyle = '#241f14';
  wctx.beginPath(); wctx.ellipse(sx + r * 0.3, sy + r * 0.45, r * 1.1, r * 0.5, 0, 0, 7); wctx.fill();
  wctx.globalAlpha = 1;
  if (m.artifact === 'mono') { // it stands taller than it should
    wctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    wctx.fillRect(sx - r * 0.4, sy - r * 2.6, r * 0.8, r * 2.9);
    wctx.fillStyle = `rgb(${cr + 24},${cg + 24},${cb + 30})`;
    wctx.fillRect(sx - r * 0.4, sy - r * 2.6, r * 0.25, r * 2.9);
    return;
  }
  if (m.artifact === 'idol') {
    wctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    wctx.fillRect(sx - r * 0.55, sy - r * 1.1, r * 1.1, r * 1.3);
    wctx.beginPath(); wctx.arc(sx, sy - r * 1.5, r * 0.55, 0, 7); wctx.fill();
    wctx.fillStyle = '#241f14';
    wctx.fillRect(sx - r * 0.34, sy - r * 1.62, r * 0.2, r * 0.2);
    wctx.fillRect(sx + r * 0.14, sy - r * 1.62, r * 0.2, r * 0.2);
    return;
  }
  // boulder
  wctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  wctx.strokeStyle = `rgb(${cr - 34},${cg - 34},${cb - 34})`;
  wctx.lineWidth = Math.max(1, r * 0.18);
  wctx.beginPath(); wctx.ellipse(sx, sy - r * 0.25, r, r * 0.8, 0, 0, 7);
  wctx.fill(); wctx.stroke();
  wctx.fillStyle = `rgb(${cr + 22},${cg + 22},${cb + 22})`;
  wctx.beginPath(); wctx.ellipse(sx - r * 0.3, sy - r * 0.55, r * 0.34, r * 0.2, -0.5, 0, 7); wctx.fill();
}

function drawPlant(p, ox, oy, z) {
  const sx = ox + p.x * z, sy = oy + p.y * z;
  if (p.big) { // a tree stands up out of the ground
    const th = 13 * z * (0.6 + 0.4 * Math.min(1, p.e / CFG.TREE_E));
    wctx.globalAlpha = 0.2;
    wctx.fillStyle = '#241f14';
    wctx.beginPath(); wctx.ellipse(sx + th * 0.15, sy + th * 0.1, th * 0.7, th * 0.3, 0, 0, 7); wctx.fill();
    wctx.globalAlpha = 1;
    wctx.fillStyle = '#7a5432';
    wctx.fillRect(sx - Math.max(1, th * 0.12), sy - th, Math.max(2, th * 0.24), th);
    wctx.fillStyle = '#3f7a34';
    wctx.beginPath(); wctx.arc(sx, sy - th, th * 0.72, 0, 7); wctx.fill();
    wctx.fillStyle = '#57a03e';
    wctx.beginPath(); wctx.arc(sx - th * 0.2, sy - th * 1.15, th * 0.45, 0, 7); wctx.fill();
    return;
  }
  const ps = Math.max(1.2, 2.7 * z);
  wctx.fillStyle = '#4e8c3a';
  wctx.fillRect(sx - ps / 2, sy - ps / 2, ps, ps);
}

function draw() {
  const wcw = wcv.width, wch = wcv.height, z = cam.z / PIX;
  let camX = cam.x, camY = cam.y;
  if (shakeT > 0) {
    camX += (Math.random() - 0.5) * shakeMag / cam.z;
    camY += (Math.random() - 0.5) * shakeMag / cam.z;
  }
  const ox = wcw / 2 - camX * z, oy = wch / 2 - camY * z;

  wctx.imageSmoothingEnabled = false;
  const cx0 = Math.floor((camX - wcw / 2 / z) / CFG.CHPX), cx1 = Math.floor((camX + wcw / 2 / z) / CFG.CHPX);
  const cy0 = Math.floor((camY - wch / 2 / z) / CFG.CHPX), cy1 = Math.floor((camY + wch / 2 / z) / CFG.CHPX);
  const cpx = CFG.CHPX * z;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    wctx.drawImage(chunkCanvas(cx, cy), ox + cx * CFG.CHPX * z, oy + cy * CFG.CHPX * z, cpx + 0.5, cpx + 0.5);
  }

  const vx0 = camX - wcw / 2 / z - 40, vx1 = camX + wcw / 2 / z + 40;
  const vy0 = camY - wch / 2 / z - 40, vy1 = camY + wch / 2 / z + 40;

  // blood auras
  for (const a of world.blood) {
    if (a.x < vx0 - 260 || a.x > vx1 + 260 || a.y < vy0 - 260 || a.y > vy1 + 260) continue;
    const life = 1 - (world.tick - a.t0) / CFG.BLOOD_LIFE;
    const pulse = 0.75 + 0.25 * Math.sin(world.tick * 0.08 + a.t0);
    wctx.globalAlpha = 0.16 * life * pulse;
    wctx.fillStyle = '#7c3e3a';
    wctx.beginPath();
    wctx.arc(ox + a.x * z, oy + a.y * z, CFG.BLOOD_R * z * pulse, 0, 7);
    wctx.fill();
    wctx.globalAlpha = 1;
  }

  // plants + decor per visible chunk
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const chk = world.chunks.get(cx + ',' + cy);
    if (!chk) continue;
    for (const p of chk.plants) if (!p.big) drawPlant(p, ox, oy, z);
    for (const p of chk.plants) if (p.big) drawPlant(p, ox, oy, z);
    for (const dc of chk.decor) drawDecor(dc, ox, oy, z);
  }

  // nests
  for (const n of world.nests) {
    if (n.dead || n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
    const sx = ox + n.x * z, sy = oy + n.y * z, r = CFG.NEST_R * z;
    const s = world.species.get(n.sp);
    const h = s ? (s.founder.hue * 360) | 0 : 30;
    wctx.globalAlpha = 0.22;
    wctx.fillStyle = '#241f14';
    wctx.beginPath(); wctx.ellipse(sx + r * 0.15, sy + r * 0.3, r * 1.1, r * 0.6, 0, 0, 7); wctx.fill();
    wctx.globalAlpha = 1;
    wctx.fillStyle = '#ab9770';
    wctx.strokeStyle = '#8f7d58';
    wctx.lineWidth = Math.max(1, r * 0.1);
    wctx.beginPath();
    wctx.ellipse(sx, sy - r * 0.2, r, r * 0.8, 0, 0, 7);
    wctx.fill(); wctx.stroke();
    wctx.fillStyle = `hsl(${h} 30% 25%)`;
    wctx.beginPath();
    wctx.arc(sx, sy - r * 0.35, r * 0.3, 0, 7);
    wctx.fill();
  }

  // corpses
  for (const cp of world.corpses) {
    if (cp.x < vx0 || cp.x > vx1 || cp.y < vy0 || cp.y > vy1) continue;
    const r = cp.r * z;
    wctx.globalAlpha = 0.25 + 0.6 * (cp.meat / cp.max);
    wctx.fillStyle = '#cfc3a0';
    wctx.strokeStyle = '#afa382';
    wctx.lineWidth = Math.max(1, r * 0.14);
    wctx.beginPath();
    wctx.arc(ox + cp.x * z, oy + cp.y * z, Math.max(1.5, r), 0, 7);
    wctx.fill();
    if (r > 2.5) wctx.stroke();
    wctx.globalAlpha = 1;
  }

  // critters
  for (const c of world.critters) {
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    drawCritter(c, ox, oy, z);
  }

  // fires
  for (const f of world.fires) {
    if (f.x < vx0 || f.x > vx1 || f.y < vy0 || f.y > vy1) continue;
    const fr = (5 + Math.sin(world.tick * 0.4 + f.x) * 2) * z;
    wctx.fillStyle = 'rgb(206,120,52)';
    wctx.beginPath(); wctx.arc(ox + f.x * z, oy + f.y * z, fr, 0, 7); wctx.fill();
    wctx.fillStyle = 'rgb(226,178,84)';
    wctx.beginPath(); wctx.arc(ox + f.x * z, oy + f.y * z - fr * 0.4, fr * 0.55, 0, 7); wctx.fill();
  }

  // gas layer
  for (const p of world.gas) {
    if (p.x < vx0 - 60 || p.x > vx1 + 60 || p.y < vy0 - 60 || p.y > vy1 + 60) continue;
    wctx.globalAlpha = Math.min(0.3, p.amt * 0.28);
    wctx.fillStyle = `rgb(${(GASES[p.type] || GASES.smoke).col})`;
    wctx.beginPath();
    wctx.arc(ox + p.x * z, oy + p.y * z, (30 + (1 - p.amt) * 34) * z, 0, 7);
    wctx.fill();
  }
  wctx.globalAlpha = 1;

  // ---- blit the world, chunky ----
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#141612';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.drawImage(wcv, 0, 0, wcv.width * PIX, wcv.height * PIX);

  // CRT scanlines — it's a 90s instrument, after all
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#000';
  for (let sy = 0; sy < innerHeight; sy += 3) ctx.fillRect(0, sy, innerWidth, 1);
  ctx.globalAlpha = 1;

  // ---- full-res instrument overlays ----
  const oxF = innerWidth / 2 - camX * cam.z, oyF = innerHeight / 2 - camY * cam.z;

  if (selected && !selected.dead) {
    const c = selected;
    const bx = oxF + c.x * cam.z, by = oyF + c.y * cam.z;
    const half = (c.arc / 2) * Math.PI / 180;
    ctx.fillStyle = '#9fd47a';
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.arc(bx, by, c.senEff * cam.z, c.dir - half, c.dir + half);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#9fd47a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx - c.r * cam.z - 5, by - c.r * cam.z - 5, c.r * cam.z * 2 + 10, c.r * cam.z * 2 + 10);
  }

  // FX: booms + lightning
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    e.ttl--;
    if (e.kind === 'boom') {
      ctx.globalAlpha = e.ttl / 14;
      ctx.strokeStyle = '#e8d79a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(oxF + e.x * cam.z, oyF + e.y * cam.z, e.r * cam.z * (1.4 - e.ttl / 14), 0, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'zap') {
      ctx.globalAlpha = Math.min(1, e.ttl / 5);
      ctx.strokeStyle = '#e8f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let zx = oxF + e.x * cam.z, zy = oyF + e.y * cam.z;
      ctx.moveTo(zx, zy);
      for (let s = 1; s <= 6; s++) {
        zx += (Math.random() - 0.5) * 30;
        ctx.lineTo(zx, zy - s * 60);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (e.ttl <= 0) fx.splice(i, 1);
  }

  // weather overlay
  const wx = world.weather.state;
  if (wx === 'rain' || wx === 'storm') {
    ctx.strokeStyle = wx === 'storm' ? 'rgba(160,180,200,0.28)' : 'rgba(160,180,200,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = wx === 'storm' ? 160 : 90;
    for (let i = 0; i < n; i++) {
      const rx = ((i * 761 + world.tick * 11) % (innerWidth + 40)) - 20;
      const ry = ((i * 397 + world.tick * 23) % (innerHeight + 40)) - 20;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 4, ry + 12);
    }
    ctx.stroke();
    if (wx === 'storm') {
      ctx.fillStyle = 'rgba(20,26,40,0.14)';
      ctx.fillRect(0, 0, innerWidth, innerHeight);
    }
  } else if (wx === 'drought') {
    ctx.fillStyle = 'rgba(200,160,80,0.05)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  // brush preview — snapped, glued to the cursor
  if (tool !== 'look' && !overUI) {
    const gx = Math.floor(mouse.wx / CFG.CS) * CFG.CS + 10, gy = Math.floor(mouse.wy / CFG.CS) * CFG.CS + 10;
    const bx = oxF + gx * cam.z, by = oyF + gy * cam.z;
    const br = brushR() * cam.z;
    ctx.strokeStyle = '#e8e4d0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (mode === 'place' && (tool === 'mat' || tool === 'life')) {
      const cs = CFG.CS * cam.z;
      ctx.strokeRect(bx - cs / 2, by - cs / 2, cs, cs);
    } else if (shape === 'square') ctx.strokeRect(bx - br, by - br, br * 2, br * 2);
    else { ctx.arc(bx, by, br, 0, 7); ctx.stroke(); }
    if (shape === 'ring' && mode === 'terra') { ctx.beginPath(); ctx.arc(bx, by, Math.max(2, br - 1.6 * CFG.CS * cam.z), 0, 7); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (shakeT > 0) shakeT--;
}

// ---------- toasts ----------
const toastQ = [];
let toastCooldown = 0;
function showToast(msg, hue, gold) {
  const div = document.createElement('div');
  div.className = 'toast' + (gold ? ' gold' : '');
  const chip = hue != null ? `<span class="chip" style="background:hsl(${(hue * 360) | 0} 38% 51%)"></span>` : '';
  div.innerHTML = `${chip}<span>${msg}</span>`;
  toastsEl.appendChild(div);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  setTimeout(() => { div.style.transition = 'opacity .6s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 650); }, gold ? 6000 : 4200);
}
function drainEvents() {
  for (const e of world.events) {
    if (e.kind === 'ach') { unlock(e.id, e.msg); continue; }
    if (e.kind === 'boom') { fx.push({ kind: 'boom', x: e.x, y: e.y, r: e.r, ttl: 14 }); shakeT = 16; shakeMag = Math.min(26, e.r * 0.12); continue; }
    if (e.kind === 'zap') { fx.push({ kind: 'zap', x: e.x, y: e.y, ttl: 7 }); continue; }
    if (toastQ.length < 5) toastQ.push(e);
  }
  world.events.length = 0;
  if (toastCooldown > 0) { toastCooldown--; return; }
  const e = toastQ.shift();
  if (!e) return;
  toastCooldown = 50;
  showToast(`${e.kind === 'ext' ? '✝' : e.kind === 'wx' ? '☁' : '✦'} ${e.msg}`, e.hue);
}

// ---------- inspect panel ----------
const barRow = (lbl, frac, color, right = '') =>
  `<div class="bar-row"><div class="lbl"><span>${lbl}</span><span>${right}</span></div>` +
  `<div class="tr"><div class="fl" style="width:${Math.min(100, frac * 100) | 0}%;background:${color}"></div></div></div>`;

let panelTimer = 0;
function updatePanel() {
  if (selected && selected.dead) selected = null;
  panel.style.display = selected ? 'block' : 'none';
  if (!selected || panelTimer++ % 8 !== 0) return;
  const c = selected, g = c.g, s = world.species.get(c.sp);
  const h = (g.hue * 360) | 0;
  const dietCol = `hsl(${(110 - g.diet * 110) | 0} 45% 45%)`;
  const life = c.role ? c.role : (g.rep < 0.5 ? 'splitter' : 'mater');
  let rows =
    barRow('energy', c.e / c.maxE, '#8fb862') +
    barRow('age', c.age / c.maxAge, '#b8a26b') +
    barRow('size', g.siz, '#d9cba4') +
    barRow('speed', g.spd, '#d9cba4', g.seg < 0.33 ? 'wide turns' : g.seg > 0.66 ? 'agile' : '') +
    barRow('vision', g.sen, '#d9cba4', `${c.arc}° · ${c.nEyes} eye${c.nEyes > 1 ? 's' : ''}`) +
    barRow('diet', g.diet, dietCol, g.diet < 0.35 ? 'herb' : g.diet > 0.65 ? 'meat' : 'omni') +
    barRow('spikes', g.spik, '#d9cba4', g.spik > 0.25 ? 'armored' : '') +
    barRow('camo', g.pat, '#d9cba4', g.pat > 0.72 ? 'stripes' : g.pat > 0.4 ? 'spots' : '') +
    barRow('legs', g.legs, '#d9cba4', c.swimV > 0 ? `swims ${g.tail > 0.5 ? 'fast' : 'slow'}` : '');
  if (g.ven > 0.12) rows += barRow('venom', g.ven, '#a06a52', 'hunts big');
  if (g.bur > 0.12) rows += barRow('burrow', g.bur, '#a08d5f', g.bur > 0.45 ? 'digger' : '');
  if (g.pho > 0.12) rows += barRow('photo', g.pho, '#7f9a56', g.pho > 0.35 ? 'basks' : '');
  if (g.soc > 0.12) rows += barRow('social', g.soc, '#c9a94f', c.nestId ? 'in a nest' : '');
  const state = (c.rad ? ' · ☢' : '') + (c.bb > 0.15 ? ' · 🩸' : '') + (c.sleep > 0 ? ' · Zz' : '') + (c.rage > 0 ? ' · RAGE' : '') + (c.cgen ? ` · COPY×${c.cgen}` : '');
  panel.innerHTML =
    `<h2 style="color:hsl(${h} 65% 68%)">${s ? s.name : '?'}</h2>` +
    `<div class="sub">${life} · ${s ? s.count : '?'} alive · ` +
    `${c.swimV > 0 ? (g.legs < 0.1 ? 'swimmer' : 'amphibious') : 'land only'}${state}</div>` + rows;
}

// ---------- stats ----------
let statTimer = 0;
function updateStats() {
  if (statTimer++ % 20 !== 0) return;
  const wxN = { clear: 'CLEAR', rain: 'RAIN', storm: 'STORM', drought: 'DROUGHT' }[world.weather.state];
  statsEl.textContent =
    `SITE ${SEED} · SOL ${Math.floor(world.tick / 1800)} · POP ${world.activeN} · TAXA ${aliveSpecies(world)}` +
    ` · FLORA ${world.plantCount} · WX ${wxN} · E${Math.round(cam.x)} N${Math.round(-cam.y)}`;
}

// ---------- hotbar + material menu + designer ----------
let curMat = 10, curGas = 'tox', curLife = { ...LIFE_PRESETS.proto.g };
let hotbar = JSON.parse(localStorage.getItem('crittersHotbar') || 'null') || [
  { t: 'mat', id: 1 }, { t: 'mat', id: 2 }, { t: 'mat', id: 10 }, { t: 'mat', id: 41 },
  { t: 'gas', id: 'tox' }, { t: 'life', id: 'proto' }, { t: 'mat', id: 7 }, { t: 'mat', id: 9 }, { t: 'mat', id: 36 },
];
let slotSel = 0;
const hotbarEl = document.getElementById('hotbar');

function slotChip(s) {
  if (!s) return '';
  if (s.t === 'mat') {
    if (s.id === 'fire') return `<span class="chip" style="background:rgb(206,120,52);border-radius:50% 50% 0 50%" title="fire"></span>`;
    const m = MATS[s.id];
    return m ? `<span class="chip" style="background:rgb(${m.col.join(',')})" title="${m.name}"></span>` : '';
  }
  if (s.t === 'gas') { const g = GASES[s.id]; return g ? `<span class="chip" style="background:rgb(${g.col});border-radius:50%" title="${g.name}"></span>` : ''; }
  if (s.t === 'life') { const p = LIFE_PRESETS[s.id]; return `<span class="chip" style="background:#5a8a52;border-radius:50% 50% 30% 30%" title="${p ? p.name : 'custom specimen'}"></span>`; }
  return '';
}
function renderHotbar() {
  hotbarEl.innerHTML = hotbar.map((s, i) =>
    `<div class="slot ${i === slotSel && (tool === 'mat' || tool === 'gas' || tool === 'life') ? 'sel' : ''}" data-i="${i}">` +
    `<span class="num">${i + 1}</span>${slotChip(s)}</div>`).join('') +
    `<button id="matBtn" title="MATERIAL TABLE (M)" style="height:38px">🧪</button>`;
  document.getElementById('matBtn').addEventListener('click', toggleMenu);
}
function useSlot(i) {
  slotSel = i;
  const s = hotbar[i];
  if (!s) { renderHotbar(); return; }
  if (s.t === 'mat') { curMat = s.id; setTool('mat'); }
  else if (s.t === 'gas') { curGas = s.id; setTool('gas'); }
  else { curLife = s.id === 'custom' ? curLife : { ...LIFE_PRESETS[s.id].g }; setTool('life'); }
}
hotbarEl.addEventListener('click', (e) => {
  const sl = e.target.closest('.slot');
  if (sl) useSlot(+sl.dataset.i);
});

const matMenu = document.getElementById('matMenu');
const matTabs = document.getElementById('matTabs');
const matGrid = document.getElementById('matGrid');
const designer = document.getElementById('designer');
const MAT_CATS = ['soil', 'rock', 'metal', 'liquid', 'strange', 'boom', 'gas', 'life'];
let curCat = 'boom';

function toggleMenu() {
  matMenu.style.display = matMenu.style.display === 'block' ? 'none' : 'block';
  designer.style.display = 'none';
  renderMatGrid();
}

function renderMatGrid() {
  matTabs.innerHTML = MAT_CATS.map((c) =>
    `<button data-cat="${c}" class="${c === curCat ? 'on' : ''}">${c}</button>`).join('');
  let html = '';
  if (curCat === 'gas') {
    for (const [id, g] of Object.entries(GASES)) {
      if (id === 'mia' || id === 'smoke') continue;
      html += `<button class="mat" data-gas="${id}"><span class="chip" style="background:rgb(${g.col})"></span>${g.name}</button>`;
    }
  } else if (curCat === 'life') {
    for (const [id, p] of Object.entries(LIFE_PRESETS))
      html += `<button class="mat" data-life="${id}"><span class="chip" style="background:#5a8a52"></span>${p.name}</button>`;
    html += `<button class="mat" data-designer="1"><span class="chip" style="background:#9fd47a"></span>DESIGNER...</button>`;
  } else {
    for (const [id, m] of Object.entries(MATS)) {
      if (m.cat !== curCat || +id === 0) continue;
      html += `<button class="mat" data-mat="${id}"><span class="chip" style="background:rgb(${m.col.join(',')})"></span>${m.name}</button>`;
    }
    if (curCat === 'boom')
      html += `<button class="mat" data-fire="1"><span class="chip" style="background:rgb(206,120,52)"></span>fire</button>`;
  }
  matGrid.innerHTML = html;
}

matTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cat]');
  if (b) { curCat = b.dataset.cat; renderMatGrid(); }
});
matGrid.addEventListener('click', (e) => {
  const b = e.target.closest('button.mat');
  if (!b) return;
  if (b.dataset.designer) { designer.style.display = 'block'; matMenu.style.display = 'none'; renderDesigner(); return; }
  if (b.dataset.gas) hotbar[slotSel] = { t: 'gas', id: b.dataset.gas };
  else if (b.dataset.life) hotbar[slotSel] = { t: 'life', id: b.dataset.life };
  else if (b.dataset.fire) hotbar[slotSel] = { t: 'mat', id: 'fire' };
  else hotbar[slotSel] = { t: 'mat', id: +b.dataset.mat };
  localStorage.setItem('crittersHotbar', JSON.stringify(hotbar));
  useSlot(slotSel);
});

// specimen designer
const DG_GENES = [['siz','size'],['spd','speed'],['sen','senses'],['hue','color'],['diet','diet'],['rep','repro'],
  ['seg','segments'],['spik','spikes'],['legs','legs'],['tail','tail'],['eyes','eyes'],['pat','pattern'],
  ['ven','venom'],['bur','burrow'],['pho','photo'],['soc','social'],['cst','castes']];
function renderDesigner() {
  document.getElementById('dgSliders').innerHTML = DG_GENES.map(([k, lbl]) =>
    `<div class="dg"><label>${lbl}</label><input type="range" min="0" max="100" value="${(curLife[k] * 100) | 0}" data-g="${k}"></div>`).join('');
}
document.getElementById('dgSliders').addEventListener('input', (e) => {
  if (e.target.dataset.g) curLife[e.target.dataset.g] = +e.target.value / 100;
});
document.getElementById('dgSummon').addEventListener('click', () => {
  hotbar[slotSel] = { t: 'life', id: 'custom' };
  localStorage.setItem('crittersHotbar', JSON.stringify(hotbar));
  designer.style.display = 'none';
  setTool('life');
  renderHotbar();
});

// ---------- painting ----------
let brushSize = 55;
const brushSlider = document.getElementById('brushSlider');
brushSlider.addEventListener('input', () => { brushSize = +brushSlider.value; });
function setBrush(v) { brushSize = Math.min(280, Math.max(20, v)); brushSlider.value = brushSize; }
function brushR() { return brushSize; }

const usedTools = new Set(JSON.parse(localStorage.getItem('crittersTools') || '[]'));
let lastPlace = { x: 1e9, y: 1e9 }, lifeCool = 0, detDone = false;

function applyPaint(wx, wy) {
  let key = tool;
  if (tool === 'gas') { paintGas(world, wx, wy, brushR(), curGas); key = 'gas:' + curGas; }
  else if (tool === 'mat') {
    if (curMat === 'fire') { igniteAt(world, wx + (Math.random() - 0.5) * brushR(), wy + (Math.random() - 0.5) * brushR(), true); key = 'fire'; }
    else if (mode === 'place') {
      if (Math.hypot(wx - lastPlace.x, wy - lastPlace.y) > 26) {
        placeObject(world, curMat, wx, wy);
        lastPlace = { x: wx, y: wy };
      }
      key = 'mat:' + curMat;
    } else { paint(world, curMat, wx, wy, brushR(), shape); key = 'mat:' + curMat; }
  }
  else if (tool === 'life') {
    if (lifeCool <= 0 && world.activeN < CFG.SOFT_CAP) {
      summonCritter(world, wx, wy, { ...curLife });
      lifeCool = 14;
    }
    key = 'life';
  }
  else if (tool === 'det') {
    if (!detDone) { detonate(world, wx, wy, brushR()); unlock('plunger'); detDone = true; }
    return;
  }
  else paint(world, tool, wx, wy, brushR(), shape);
  if (!usedTools.has(key)) {
    usedTools.add(key);
    localStorage.setItem('crittersTools', JSON.stringify([...usedTools]));
    if (usedTools.size >= 12) unlock('chemist');
  }
  if (++paintFrames === 400) unlock('painter');
}

// ---------- input ----------
let overUI = false;
document.addEventListener('pointermove', (e) => { overUI = e.target !== cv; });

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  mouse.down = true;
  mouse.x = e.clientX; mouse.y = e.clientY;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
  mouse.panning = e.button === 1 || e.button === 2;
  detDone = false;
  lastPlace = { x: 1e9, y: 1e9 };
  if (!mouse.panning && tool === 'look') {
    const hit = findCritterAt(world, mouse.wx, mouse.wy, Math.max(6, 12 / cam.z));
    if (hit) {
      selected = hit;
      inspected.add(hit.id);
      if (inspected.size >= 15) unlock('inspector');
    } else { selected = null; mouse.panning = true; }
  }
});

cv.addEventListener('pointermove', (e) => {
  if (mouse.down && mouse.panning) {
    cam.x -= (e.clientX - mouse.x) / cam.z;
    cam.y -= (e.clientY - mouse.y) / cam.z;
  }
  const [nwx, nwy] = toWorld(e.clientX, e.clientY);
  if (mouse.down && !mouse.panning && tool !== 'look' && tool !== 'det') {
    const d = Math.hypot(nwx - mouse.wx, nwy - mouse.wy), stepLen = brushR() * 0.5;
    for (let s = stepLen; s < d; s += stepLen)
      applyPaint(mouse.wx + (nwx - mouse.wx) * (s / d), mouse.wy + (nwy - mouse.wy) * (s / d));
  }
  mouse.x = e.clientX; mouse.y = e.clientY;
  mouse.wx = nwx; mouse.wy = nwy;
});

addEventListener('pointerup', () => { mouse.down = false; mouse.panning = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  cam.z = Math.min(8, Math.max(0.12, cam.z * f));
  const [wx2, wy2] = toWorld(e.clientX, e.clientY);
  cam.x += wx - wx2; cam.y += wy - wy2;
}, { passive: false });

const toolBtns = document.querySelectorAll('#tools button[data-tool]');
function setTool(t) {
  tool = t;
  toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  cv.style.cursor = t === 'look' ? 'default' : 'crosshair';
  renderHotbar();
}
toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

document.getElementById('modeBtn').addEventListener('click', toggleMode);
function toggleMode() {
  mode = mode === 'terra' ? 'place' : 'terra';
  document.getElementById('modeBtn').textContent = mode === 'terra' ? 'TERRA' : 'PLACE';
}

document.querySelectorAll('.shp').forEach((b) => b.addEventListener('click', () => {
  shape = b.dataset.shape;
  document.querySelectorAll('.shp').forEach((x) => x.classList.toggle('on', x === b));
}));

const spdBtns = document.querySelectorAll('#speed button[data-spd]');
function setSpeed(s) {
  speed = s;
  spdBtns.forEach((b) => b.classList.toggle('on', +b.dataset.spd === s));
}
spdBtns.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.spd)));

document.getElementById('achBtn').addEventListener('click', () => {
  achPanel.style.display = achPanel.style.display === 'block' ? 'none' : 'block';
  panel.style.display = 'none';
});

let prevSpeed = 1;
addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (speed === 0) setSpeed(prevSpeed || 1);
    else { prevSpeed = speed; setSpeed(0); }
  }
  if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= 9) useSlot(n - 1);
  }
  if (e.code === 'KeyL' || e.code === 'Escape') setTool('look');
  if (e.code === 'KeyX') setTool('erase');
  if (e.code === 'KeyT') toggleMode();
  if (e.code === 'BracketLeft') setBrush(brushSize - 15);
  if (e.code === 'BracketRight') setBrush(brushSize + 15);
  if (e.code === 'KeyM') toggleMenu();
});

// ---------- discovery ----------
let discTimer = 0;
function checkDiscovery() {
  if (discTimer++ % 30 !== 0) return;
  for (const s of world.sites) {
    if (Math.abs(s.x - cam.x) < 640 && Math.abs(s.y - cam.y) < 640) {
      unlock({ city: 'seecity', lab: 'seelab', altar: 'seealtar', scorched: 'seescorched', zero: 'seezero' }[s.kind]);
    }
  }
  if (!achSaved.has('stillfolk') && world.stillSp) {
    for (const c of world.critters) {
      if (c.still && c.sp === world.stillSp && Math.abs(c.x - cam.x) < 500 && Math.abs(c.y - cam.y) < 500) {
        unlock('stillfolk');
        break;
      }
    }
  }
  if (Math.abs(cam.x) > CFG.FAR || Math.abs(cam.y) > CFG.FAR) unlock('farlands');
}

// ---------- boot sequence ----------
const bootEl = document.getElementById('boot');
const bootText = document.getElementById('bootText');
const BOOT_LINES = [
  'DEPT. OF EXOBIOLOGY — DIVISION 9',
  'REMOTE BIOSPHERE OBSERVATION CONSOLE v2.6',
  'EST. 1994 — CLEARANCE: PROVISIONAL',
  '',
  `CONNECTING TO SURVEY SITE #${SEED} ....... OK`,
  'BIOSIGN TELEMETRY ..................... OK',
  'TERRAFORM ACTUATORS ................... OK',
  'PRIOR SURVEY DATA ............ [CORRUPTED]',
  '',
  'OBSERVER ON DUTY.',
];
let bootDone = false;
function endBoot() {
  if (bootDone) return;
  bootDone = true;
  bootEl.style.opacity = '0';
  setTimeout(() => bootEl.remove(), 550);
}
{
  let li = 0, chi = 0, out = '';
  const typeTick = () => {
    if (bootDone) return;
    if (li >= BOOT_LINES.length) { setTimeout(endBoot, 700); return; }
    const line = BOOT_LINES[li];
    chi += 3;
    if (chi >= line.length) { out += line + '\n'; li++; chi = 0; setTimeout(typeTick, line ? 90 : 30); }
    else setTimeout(typeTick, 12);
    bootText.textContent = out + line.slice(0, chi);
  };
  typeTick();
  bootEl.addEventListener('pointerdown', endBoot);
  addEventListener('keydown', endBoot, { once: true });
}

// ---------- loop ----------
renderHotbar();
renderMatGrid();
function frame() {
  world.view.x = cam.x; world.view.y = cam.y;
  [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y);
  if (lifeCool > 0) lifeCool--;
  if (mouse.down && !mouse.panning && tool !== 'look' && !overUI) applyPaint(mouse.wx, mouse.wy);
  for (let i = 0; i < speed; i++) step(world);
  if (world.dirty.size) {
    for (const key of world.dirty) chunkCanvases.delete(key);
    world.dirty.clear();
  }
  checkDiscovery();
  drainEvents();
  draw();
  updateStats();
  updatePanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
