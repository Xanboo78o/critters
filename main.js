// critters — main.js: camera, chunk rendering, god tools, inspect panel, achievements
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

// ---------- achievements ----------
const ACH_DEFS = [
  ['firstblood', 'First Blood', 'something ate something'],
  ['speciate', 'Divergence', 'a species split in two'],
  ['extinct', 'The End', 'a species went extinct'],
  ['venom', 'Venomous', 'venom evolved'],
  ['burrow', 'Bunker', 'a critter escaped underground'],
  ['photo', 'Going Green', 'photosynthesis evolved'],
  ['swim', 'Deep End', 'something swam'],
  ['nest', 'Civilization', 'a nest was founded'],
  ['spiky', 'Maximum Spike', 'born with extreme armor'],
  ['giant', 'Titan', 'a true giant was born'],
  ['elder', 'Elder', 'died of proper old age'],
  ['apex', 'Apex', 'one critter made 10 kills'],
  ['boom', 'Boom', '2000 alive at once'],
  ['farlands', 'The Farlands', 'you found where the world breaks'],
  ['painter', 'Terraformer', 'you reshaped the land'],
  ['inspector', 'Field Biologist', 'inspected 15 different critters'],
];
let achSaved = new Set(JSON.parse(localStorage.getItem('crittersAch') || '[]'));
for (const id of achSaved) world.achDone.add(id);
function unlock(id, msg) {
  if (achSaved.has(id)) return;
  achSaved.add(id);
  world.achDone.add(id);
  localStorage.setItem('crittersAch', JSON.stringify([...achSaved]));
  const def = ACH_DEFS.find((d) => d[0] === id);
  showToast(`🏆 ${def ? def[1] : id} — ${msg || (def ? def[2] : '')}`, null, true);
  renderAchievements();
}
function renderAchievements() {
  achPanel.innerHTML = '<h2>🏆 achievements</h2>' + ACH_DEFS.map(([id, name, desc]) =>
    `<div class="ach ${achSaved.has(id) ? 'got' : ''}"><b>${name}</b><span>${desc}</span></div>`).join('');
}
renderAchievements();

let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();

const cam = { x: world.view.x, y: world.view.y, z: 0.7 };
if (params.get('z')) cam.z = +params.get('z');
if (params.get('x')) cam.x = +params.get('x');
if (params.get('y')) cam.y = +params.get('y');

let tool = 'look', speed = 1, selected = null;
const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, panning: false };
let paintFrames = 0;
const inspected = new Set();

function toWorld(sx, sy) {
  return [cam.x + (sx - innerWidth / 2) / cam.z, cam.y + (sy - innerHeight / 2) / cam.z];
}

// ---------- chunk terrain rendering ----------
const chunkCanvases = new Map();
const T_COLORS = {
  1: [146, 128, 104],  // painted wall
  2: [108, 167, 158],  // water
  4: [126, 116, 104],  // rock
  5: [151, 130, 99],   // mud
  6: [168, 196, 122],  // glowmoss (farlands)
};
function chunkCanvas(cx, cy) {
  const key = cx + ',' + cy;
  let c = chunkCanvases.get(key);
  if (c) return c;
  const ch = getChunk(world, cx, cy);
  c = document.createElement('canvas');
  c.width = CFG.CH; c.height = CFG.CH;
  const cc = c.getContext('2d');
  const img = cc.createImageData(CFG.CH, CFG.CH);
  const d = img.data;
  for (let i = 0; i < CFG.CH * CFG.CH; i++) {
    const t = ch.terrain[i];
    let r, g, b;
    if (t !== 0) { [r, g, b] = T_COLORS[t]; }
    else {
      const f = Math.min(1, ch.fert[i]) * 0.55;
      r = 217 + (148 - 217) * f;
      g = 203 + (176 - 203) * f;
      b = 164 + (105 - 164) * f;
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  if (chunkCanvases.size > 2400) chunkCanvases.clear(); // cheap eviction; visibles rebuild next frame
  chunkCanvases.set(key, c);
  return c;
}

// ---------- drawing ----------
function drawCritter(c, ox, oy, z) {
  const sx = ox + c.x * z, sy = oy + c.y * z, r = c.r * z;
  const g = c.g, h = (g.hue * 360) | 0;
  const line = `hsl(${h} 40% 39%)`; // outline = darker shade of the fill, never black

  if (c.hideT > 0) { // burrowed: just a fresh dirt mound
    ctx.fillStyle = '#b3a075';
    ctx.strokeStyle = '#98875f';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(2, r * 0.8), Math.max(1.4, r * 0.55), 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return;
  }

  if (r < 2.4) {
    ctx.fillStyle = `hsl(${h} 38% 48%)`;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    return;
  }
  const fill = `hsl(${h} 38% 51%)`;
  const dark = `hsl(${h} 30% 21%)`;
  const dx = Math.cos(c.dir), dy = Math.sin(c.dir);
  const px = -dy, py = dx;
  const rx = r * (1 + g.spd * 0.4);  // fast = sleek
  const ry = r * (1 - g.spd * 0.18);
  const ph = c.id * 1.7 + world.tick * 0.22;
  const lw = Math.max(1, r * 0.16);
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = lw;

  let segs;
  if (g.seg < 0.33)      segs = [[0, 1, 1]];
  else if (g.seg < 0.66) segs = [[-0.38, 0.78, 1], [0.5, 0.55, 0.75]];
  else                   segs = [[-0.5, 0.62, 0.98], [0.06, 0.44, 0.7], [0.58, 0.42, 0.62]];
  const head = segs[segs.length - 1], rear = segs[0];
  const headX = sx + dx * rx * head[0], headY = sy + dy * rx * head[0];
  const headRx = rx * head[1], headRy = ry * head[2];
  const rearX = sx + dx * rx * rear[0], rearY = sy + dy * rx * rear[0];
  const rearRx = rx * rear[1], rearRy = ry * rear[2];

  // tail — none / whip / club
  if (g.tail > 0.15) {
    const tl = r * g.tail * 2.2;
    const tw = Math.sin(ph) * r * 0.35;
    const tipX = rearX - dx * (rearRx + tl) + px * tw, tipY = rearY - dy * (rearRx + tl) + py * tw;
    ctx.beginPath();
    ctx.moveTo(rearX - dx * rearRx * 0.8, rearY - dy * rearRx * 0.8);
    ctx.quadraticCurveTo(rearX - dx * (rearRx + tl * 0.5), rearY - dy * (rearRx + tl * 0.5), tipX, tipY);
    ctx.stroke();
    if (g.tail > 0.72) { ctx.beginPath(); ctx.arc(tipX, tipY, r * 0.32, 0, 7); ctx.fill(); ctx.stroke(); }
  }

  // legs — 0 pairs = slug, up to 4 paddling pairs
  const pairs = Math.round(g.legs * 4);
  if (r > 4 && pairs > 0) {
    const ll = r * (0.3 + g.legs * 0.4);
    ctx.lineWidth = Math.max(1, r * 0.14);
    for (let i = 0; i < pairs; i++) {
      const along = (pairs === 1 ? 0 : (i / (pairs - 1) - 0.5)) * rx * 1.05;
      const swing = Math.sin(ph + i * 2.1) * 0.55;
      for (const s of [1, -1]) {
        const ax = sx + dx * along + px * s * ry * 0.8;
        const ay = sy + dy * along + py * s * ry * 0.8;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + (px * s + dx * swing) * ll, ay + (py * s + dy * swing) * ll);
        ctx.stroke();
      }
    }
    ctx.lineWidth = lw;
  }

  // back spikes
  if (r > 4 && g.spik > 0.25) {
    const n = 2 + Math.round(g.spik * 3);
    const sl = r * (0.25 + g.spik * 0.5);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 1.3;
      const bx = rearX + dx * rearRx * t * 0.8, by = rearY + dy * rearRx * t * 0.8;
      const wHere = rearRy * Math.sqrt(Math.max(0.05, 1 - t * t)) * 0.9;
      for (const s of [1, -1]) {
        const ax = bx + px * s * wHere, ay = by + py * s * wHere;
        ctx.beginPath();
        ctx.moveTo(ax + dx * r * 0.14, ay + dy * r * 0.14);
        ctx.lineTo(ax + (px * s - dx * 0.5) * sl, ay + (py * s - dy * 0.5) * sl);
        ctx.lineTo(ax - dx * r * 0.14, ay - dy * r * 0.14);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }
  }

  if (g.diet > 0.55) { // hunter snout
    ctx.beginPath();
    ctx.moveTo(headX + dx * headRx * 1.7, headY + dy * headRx * 1.7);
    ctx.lineTo(headX + dx * headRx * 0.3 + px * headRy * 0.6, headY + dy * headRx * 0.3 + py * headRy * 0.6);
    ctx.lineTo(headX + dx * headRx * 0.3 - px * headRy * 0.6, headY + dy * headRx * 0.3 - py * headRy * 0.6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (g.ven > 0.3) { // venom fang tip
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(headX + dx * headRx * 1.55, headY + dy * headRx * 1.55, Math.max(1, r * 0.14), 0, 7);
      ctx.fill();
      ctx.fillStyle = fill;
    }
  }

  // body segments, rear to front
  for (const [off, kx, ky] of segs) {
    ctx.beginPath();
    ctx.ellipse(sx + dx * rx * off, sy + dy * rx * off, rx * kx, ry * ky, c.dir, 0, 7);
    ctx.fill(); ctx.stroke();
  }

  // photosynthesis — leafy frills along the back
  if (r > 4 && g.pho > 0.35) {
    ctx.fillStyle = line;
    ctx.globalAlpha = 0.65;
    const n = 2 + Math.round(g.pho * 2);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 1.2;
      const bx = rearX + dx * rearRx * t * 0.7, by = rearY + dy * rearRx * t * 0.7;
      ctx.beginPath();
      ctx.ellipse(bx, by, r * 0.28, r * 0.14, c.dir + t, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
  }

  // pattern — spots or stripes in the darker shade
  if (r > 4.5 && g.pat > 0.4) {
    ctx.fillStyle = line;
    ctx.globalAlpha = 0.55;
    if (g.pat > 0.72) {
      const n = 2 + (g.pat > 0.88 ? 1 : 0);
      ctx.lineWidth = Math.max(1, r * 0.16);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 1.1;
        const wHere = rearRy * Math.sqrt(Math.max(0.05, 1 - t * t)) * 0.8;
        const bx = rearX + dx * rearRx * t * 0.8, by = rearY + dy * rearRx * t * 0.8;
        ctx.beginPath();
        ctx.moveTo(bx + px * wHere, by + py * wHere);
        ctx.lineTo(bx - px * wHere, by - py * wHere);
        ctx.stroke();
      }
      ctx.lineWidth = lw;
    } else {
      const n = 3 + Math.round(g.pat * 3);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + c.id, rr = Math.sqrt((i + 0.5) / n);
        ctx.beginPath();
        ctx.arc(rearX + Math.cos(a) * rearRx * 0.55 * rr, rearY + Math.sin(a) * rearRy * 0.55 * rr, r * 0.14, 0, 7);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
  }

  if (r > 4) {
    if (g.rep < 0.5) { // splitter seam
      ctx.beginPath();
      ctx.moveTo(sx + px * ry * 0.75, sy + py * ry * 0.75);
      ctx.lineTo(sx - px * ry * 0.75, sy - py * ry * 0.75);
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else { // mater antennae
      const bx = headX + dx * headRx * 0.6, by = headY + dy * headRx * 0.6;
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.fillStyle = line;
      for (const s of [1, -1]) {
        const tx = bx + (dx + px * s * 0.9) * r * 0.5;
        const ty = by + (dy + py * s * 0.9) * r * 0.5;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, ty, r * 0.1 + 0.8, 0, 7); ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.lineWidth = lw;
    }
  }

  // eyes — count is a gene, size grows with senses
  const er = Math.max(1, r * (0.13 + g.sen * 0.2));
  ctx.fillStyle = dark;
  if (c.nEyes === 1) {
    ctx.beginPath();
    ctx.arc(headX + dx * headRx * 0.45, headY + dy * headRx * 0.45, er * 1.4, 0, 7);
    ctx.fill();
  } else {
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.arc(headX + dx * headRx * 0.4 + px * s * headRy * 0.5, headY + dy * headRx * 0.4 + py * s * headRy * 0.5, er, 0, 7);
      ctx.fill();
    }
    if (c.nEyes === 3) {
      ctx.beginPath();
      ctx.arc(headX + dx * headRx * 0.75, headY + dy * headRx * 0.75, er * 0.8, 0, 7);
      ctx.fill();
    }
  }
}

function drawNest(n, ox, oy, z) {
  const sx = ox + n.x * z, sy = oy + n.y * z, r = CFG.NEST_R * z;
  const s = world.species.get(n.sp);
  const h = s ? (s.founder.hue * 360) | 0 : 30;
  ctx.fillStyle = '#ab9770';
  ctx.strokeStyle = '#8f7d58';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, 7);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = `hsl(${h} 30% 25%)`;
  ctx.beginPath();
  ctx.arc(sx, sy - r * 0.15, r * 0.3, 0, 7); // the entrance
  ctx.fill();
}

function draw() {
  const cw = innerWidth, ch = innerHeight, z = cam.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ox = cw / 2 - cam.x * z, oy = ch / 2 - cam.y * z;

  // terrain chunks
  ctx.imageSmoothingEnabled = true;
  const cx0 = Math.floor((cam.x - cw / 2 / z) / CFG.CHPX), cx1 = Math.floor((cam.x + cw / 2 / z) / CFG.CHPX);
  const cy0 = Math.floor((cam.y - ch / 2 / z) / CFG.CHPX), cy1 = Math.floor((cam.y + ch / 2 / z) / CFG.CHPX);
  const cpx = CFG.CHPX * z;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    ctx.drawImage(chunkCanvas(cx, cy), ox + cx * CFG.CHPX * z, oy + cy * CFG.CHPX * z, cpx + 0.5, cpx + 0.5);
  }

  const vx0 = cam.x - cw / 2 / z - 24, vx1 = cam.x + cw / 2 / z + 24;
  const vy0 = cam.y - ch / 2 / z - 24, vy1 = cam.y + ch / 2 / z + 24;

  // plants (from visible chunks)
  const ps = Math.max(1.4, 2.7 * z);
  ctx.fillStyle = '#55893f';
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const chk = world.chunks.get(cx + ',' + cy);
    if (!chk) continue;
    for (const p of chk.plants) ctx.fillRect(ox + p.x * z - ps / 2, oy + p.y * z - ps / 2, ps, ps);
  }

  // nests
  for (const n of world.nests) {
    if (n.dead || n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
    drawNest(n, ox, oy, z);
  }

  // corpses
  for (const cp of world.corpses) {
    if (cp.x < vx0 || cp.x > vx1 || cp.y < vy0 || cp.y > vy1) continue;
    const r = cp.r * z;
    ctx.globalAlpha = 0.25 + 0.6 * (cp.meat / cp.max);
    ctx.fillStyle = '#cfc3a0';
    ctx.strokeStyle = '#afa382';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.arc(ox + cp.x * z, oy + cp.y * z, Math.max(1.5, r), 0, 7);
    ctx.fill();
    if (r > 2.5) ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // critters
  for (const c of world.critters) {
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    drawCritter(c, ox, oy, z);
  }

  // selection ring + field-of-view wedge
  if (selected && !selected.dead) {
    const c = selected;
    const bx = ox + c.x * z, by = oy + c.y * z;
    const half = (c.arc / 2) * Math.PI / 180;
    ctx.fillStyle = '#efe6cf';
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.arc(bx, by, c.senEff * z, c.dir - half, c.dir + half);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#efe6cf';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, c.r * z + 4, 0, 7);
    ctx.stroke();
  }

  // brush preview
  if (tool !== 'look') {
    ctx.strokeStyle = '#efe6cfbb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, brushR() * z, 0, 7);
    ctx.stroke();
  }
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
    if (toastQ.length < 5) toastQ.push(e);
  }
  world.events.length = 0;
  if (toastCooldown > 0) { toastCooldown--; return; }
  const e = toastQ.shift();
  if (!e) return;
  toastCooldown = 50;
  showToast(`${e.kind === 'ext' ? '✝' : '✦'} ${e.msg}`, e.hue);
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
    barRow('energy', c.e / c.maxE, '#8a9a56') +
    barRow('age', c.age / c.maxAge, '#b8a26b') +
    barRow('size', g.siz, '#d9cba4') +
    barRow('speed', g.spd, '#d9cba4', g.seg < 0.33 ? 'wide turns' : g.seg > 0.66 ? 'agile' : '') +
    barRow('vision', g.sen, '#d9cba4', `${c.arc}° · ${c.nEyes} eye${c.nEyes > 1 ? 's' : ''}`) +
    barRow('diet', g.diet, dietCol, g.diet < 0.35 ? '🌿' : g.diet > 0.65 ? '🍖' : '🌿+🍖') +
    barRow('spikes', g.spik, '#d9cba4', g.spik > 0.25 ? 'armored' : '') +
    barRow('camo', g.pat, '#d9cba4', g.pat > 0.72 ? 'stripes' : g.pat > 0.4 ? 'spots' : '') +
    barRow('legs', g.legs, '#d9cba4', c.swimV > 0 ? `swims ${g.tail > 0.5 ? 'fast' : 'slow'}` : '');
  if (g.ven > 0.12) rows += barRow('venom', g.ven, '#a06a52', 'hunts big');
  if (g.bur > 0.12) rows += barRow('burrow', g.bur, '#a08d5f', g.bur > 0.45 ? 'digger' : '');
  if (g.pho > 0.12) rows += barRow('photo', g.pho, '#7f9a56', g.pho > 0.35 ? 'basks' : '');
  if (g.soc > 0.12) rows += barRow('social', g.soc, '#c9a94f', c.nestId ? 'in a nest' : '');
  panel.innerHTML =
    `<h2 style="color:hsl(${h} 65% 68%)">${s ? s.name : '?'}</h2>` +
    `<div class="sub">${life} · ${s ? s.count : '?'} alive · ` +
    `${c.swimV > 0 ? (g.legs < 0.1 ? 'swimmer' : 'amphibious') : 'land only'}</div>` + rows;
}

// ---------- stats ----------
let statTimer = 0;
function updateStats() {
  if (statTimer++ % 20 !== 0) return;
  statsEl.textContent =
    `critters ${world.activeN} · species ${aliveSpecies(world)} · food ${world.plantCount}` +
    ` · seed ${SEED} · ${Math.round(cam.x)}, ${Math.round(cam.y)}`;
}

// ---------- input ----------
function brushR() { return tool === 'fert+' || tool === 'fert-' ? 95 : 55; }

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  mouse.down = true;
  mouse.x = e.clientX; mouse.y = e.clientY;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
  mouse.panning = e.button === 1 || e.button === 2;
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
  mouse.x = e.clientX; mouse.y = e.clientY;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
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

const toolBtns = document.querySelectorAll('#tools button');
function setTool(t) {
  tool = t;
  toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  cv.style.cursor = t === 'look' ? 'default' : 'crosshair';
}
toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

const spdBtns = document.querySelectorAll('#speed button[data-spd]');
function setSpeed(s) {
  speed = s;
  spdBtns.forEach((b) => b.classList.toggle('on', +b.dataset.spd === s));
}
spdBtns.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.spd)));

document.getElementById('achBtn').addEventListener('click', () => {
  achPanel.style.display = achPanel.style.display === 'block' ? 'none' : 'block';
});

let prevSpeed = 1;
addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (speed === 0) setSpeed(prevSpeed || 1);
    else { prevSpeed = speed; setSpeed(0); }
  }
  const tools = { Digit1: 'look', Digit2: 'wall', Digit3: 'water', Digit4: 'fert+', Digit5: 'fert-', Digit6: 'erase' };
  if (tools[e.code]) setTool(tools[e.code]);
});

// ---------- loop ----------
function frame() {
  world.view.x = cam.x; world.view.y = cam.y;
  if (mouse.down && !mouse.panning && tool !== 'look') {
    paint(world, tool, mouse.wx, mouse.wy, brushR());
    if (++paintFrames === 400) unlock('painter');
  }
  for (let i = 0; i < speed; i++) step(world);
  if (world.dirty.size) {
    for (const key of world.dirty) chunkCanvases.delete(key);
    world.dirty.clear();
  }
  if (Math.abs(cam.x) > CFG.FAR || Math.abs(cam.y) > CFG.FAR) unlock('farlands');
  drainEvents();
  draw();
  updateStats();
  updatePanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
