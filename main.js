// critters — main.js: camera, rendering, god tools, inspect panel
'use strict';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const panel = document.getElementById('panel');
const statsEl = document.getElementById('stats');
const toastsEl = document.getElementById('toasts');

const world = makeWorld((Math.random() * 1e9) | 0);

let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();

// open the camera on a living cluster
const cam = { x: CFG.W / 2, y: CFG.H / 2, z: 0.7 };
{
  let sx = 0, sy = 0, n = world.critters.length;
  for (let i = 0; i < n; i++) { sx += world.critters[i].x; sy += world.critters[i].y; }
  if (n) { cam.x = sx / n; cam.y = sy / n; }
  const zq = new URLSearchParams(location.search).get('z');
  if (zq) cam.z = +zq;
  const hw = innerWidth / 2 / cam.z, hh = innerHeight / 2 / cam.z;
  cam.x = Math.min(CFG.W - hw, Math.max(hw, cam.x));
  cam.y = Math.min(CFG.H - hh, Math.max(hh, cam.y));
}

let tool = 'look', speed = 1, selected = null;
const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, panning: false };

function toWorld(sx, sy) {
  return [cam.x + (sx - innerWidth / 2) / cam.z, cam.y + (sy - innerHeight / 2) / cam.z];
}

// ---------- terrain layer ----------
const tcv = document.createElement('canvas');
tcv.width = world.GW; tcv.height = world.GH;
const tctx = tcv.getContext('2d');
const timg = tctx.createImageData(world.GW, world.GH);

function redrawTerrain() {
  const d = timg.data, n = world.GW * world.GH;
  for (let i = 0; i < n; i++) {
    const t = world.terrain[i];
    let r, g, b;
    if (t === 1) { r = 146; g = 128; b = 104; }        // wall
    else if (t === 2) { r = 108; g = 167; b = 158; }   // water
    else {                                             // sand -> mossy by fertility
      const f = Math.min(1, world.fert[i]) * 0.55;
      r = 217 + (148 - 217) * f;
      g = 203 + (176 - 203) * f;
      b = 164 + (105 - 164) * f;
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  tctx.putImageData(timg, 0, 0);
}
redrawTerrain();

// ---------- drawing ----------
function drawCritter(c, ox, oy, z) {
  const sx = ox + c.x * z, sy = oy + c.y * z, r = c.r * z;
  const g = c.g, h = (g.hue * 360) | 0;
  if (r < 2.4) {
    ctx.fillStyle = `hsl(${h} 38% 48%)`;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    return;
  }
  const fill = `hsl(${h} 38% 51%)`;
  const line = `hsl(${h} 40% 39%)`; // outline = darker shade of the fill, never black
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

  // body plan from the seg gene: 1 blob / head+abdomen / ant-like 3 segments
  // each segment: [offset along dir (in rx), rx scale, ry scale]
  let segs;
  if (g.seg < 0.33)      segs = [[0, 1, 1]];
  else if (g.seg < 0.66) segs = [[-0.38, 0.78, 1], [0.5, 0.55, 0.75]];
  else                   segs = [[-0.5, 0.62, 0.98], [0.06, 0.44, 0.7], [0.58, 0.42, 0.62]];
  const head = segs[segs.length - 1], rear = segs[0];
  const headX = sx + dx * rx * head[0], headY = sy + dy * rx * head[0];
  const headRx = rx * head[1], headRy = ry * head[2];
  const rearX = sx + dx * rx * rear[0], rearY = sy + dy * rx * rear[0];
  const rearRx = rx * rear[1], rearRy = ry * rear[2];

  // tail — its own gene: none / whip / club at the tip
  if (g.tail > 0.15) {
    const tl = r * g.tail * 2.2;
    const tw = Math.sin(ph) * r * 0.35;
    const tipX = rearX - dx * (rearRx + tl) + px * tw, tipY = rearY - dy * (rearRx + tl) + py * tw;
    ctx.beginPath();
    ctx.moveTo(rearX - dx * rearRx * 0.8, rearY - dy * rearRx * 0.8);
    ctx.quadraticCurveTo(rearX - dx * (rearRx + tl * 0.5), rearY - dy * (rearRx + tl * 0.5), tipX, tipY);
    ctx.stroke();
    if (g.tail > 0.72) { // club tail
      ctx.beginPath(); ctx.arc(tipX, tipY, r * 0.32, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  // legs — their own gene: 0 pairs = slug, up to 4 paddling pairs
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

  // back spikes — thorny flanks on the rear segment
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
  }

  // body segments, rear to front so the head overlaps
  for (const [off, kx, ky] of segs) {
    ctx.beginPath();
    ctx.ellipse(sx + dx * rx * off, sy + dy * rx * off, rx * kx, ry * ky, c.dir, 0, 7);
    ctx.fill(); ctx.stroke();
  }

  // pattern — spots or stripes in the darker shade, on the rear segment
  if (r > 4.5 && g.pat > 0.4) {
    ctx.fillStyle = line;
    ctx.globalAlpha = 0.55;
    if (g.pat > 0.72) { // stripes
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
    } else { // spots
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
    if (g.rep < 0.5) { // splitter — faint division seam
      ctx.beginPath();
      ctx.moveTo(sx + px * ry * 0.75, sy + py * ry * 0.75);
      ctx.lineTo(sx - px * ry * 0.75, sy - py * ry * 0.75);
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else { // mater — little antennae
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
  const nEyes = g.eyes < 0.25 ? 1 : g.eyes < 0.7 ? 2 : 3;
  ctx.fillStyle = dark;
  if (nEyes === 1) { // cyclops
    ctx.beginPath();
    ctx.arc(headX + dx * headRx * 0.45, headY + dy * headRx * 0.45, er * 1.4, 0, 7);
    ctx.fill();
  } else {
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.arc(headX + dx * headRx * 0.4 + px * s * headRy * 0.5, headY + dy * headRx * 0.4 + py * s * headRy * 0.5, er, 0, 7);
      ctx.fill();
    }
    if (nEyes === 3) {
      ctx.beginPath();
      ctx.arc(headX + dx * headRx * 0.75, headY + dy * headRx * 0.75, er * 0.8, 0, 7);
      ctx.fill();
    }
  }
}

function draw() {
  const cw = innerWidth, ch = innerHeight, z = cam.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#a08d6c';
  ctx.fillRect(0, 0, cw, ch);
  const ox = cw / 2 - cam.x * z, oy = ch / 2 - cam.y * z;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tcv, ox, oy, CFG.W * z, CFG.H * z);
  ctx.strokeStyle = '#8d7c60';
  ctx.lineWidth = 3;
  ctx.strokeRect(ox, oy, CFG.W * z, CFG.H * z);

  const vx0 = cam.x - cw / 2 / z - 24, vx1 = cam.x + cw / 2 / z + 24;
  const vy0 = cam.y - ch / 2 / z - 24, vy1 = cam.y + ch / 2 / z + 24;

  // plants
  const ps = Math.max(1.4, 2.7 * z);
  ctx.fillStyle = '#55893f';
  for (const p of world.plants) {
    if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
    ctx.fillRect(ox + p.x * z - ps / 2, oy + p.y * z - ps / 2, ps, ps);
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

  // selection ring + field-of-view wedge (what it can actually see)
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
function drainEvents() {
  for (const e of world.events) {
    if (toastQ.length < 5) toastQ.push(e);
  }
  world.events.length = 0;
  if (toastCooldown > 0) { toastCooldown--; return; }
  const e = toastQ.shift();
  if (!e) return;
  toastCooldown = 50;
  const div = document.createElement('div');
  div.className = 'toast';
  const chip = e.hue != null ? `<span class="chip" style="background:hsl(${(e.hue * 360) | 0} 58% 53%)"></span>` : '';
  div.innerHTML = `${chip}<span>${e.kind === 'ext' ? '✝' : '✦'} ${e.msg}</span>`;
  toastsEl.appendChild(div);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  setTimeout(() => { div.style.transition = 'opacity .6s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 650); }, 4200);
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
  panel.innerHTML =
    `<h2 style="color:hsl(${h} 65% 68%)">${s ? s.name : '?'}</h2>` +
    `<div class="sub">${g.rep < 0.5 ? 'splitter' : 'mater'} · ${s ? s.count : '?'} alive · ` +
    `${c.swimV > 0 ? (g.legs < 0.1 ? 'swimmer' : 'amphibious') : 'land only'}</div>` +
    barRow('energy', c.e / c.maxE, '#8a9a56') +
    barRow('age', c.age / c.maxAge, '#b8a26b') +
    barRow('size', g.siz, '#d9cba4') +
    barRow('speed', g.spd, '#d9cba4', g.seg < 0.33 ? 'wide turns' : g.seg > 0.66 ? 'agile' : '') +
    barRow('vision', g.sen, '#d9cba4', `${c.arc}° · ${c.nEyes} eye${c.nEyes > 1 ? 's' : ''}`) +
    barRow('diet', g.diet, dietCol, g.diet < 0.35 ? '🌿' : g.diet > 0.65 ? '🍖' : '🌿+🍖') +
    barRow('spikes', g.spik, '#d9cba4', g.spik > 0.25 ? 'armored' : '') +
    barRow('camo', g.pat, '#d9cba4', g.pat > 0.72 ? 'stripes' : g.pat > 0.4 ? 'spots' : '') +
    barRow('legs', g.legs, '#d9cba4', c.swimV > 0 ? `swims ${g.tail > 0.5 ? 'fast' : 'slow'}` : '');
}

// ---------- stats ----------
let statTimer = 0;
function updateStats() {
  if (statTimer++ % 20 !== 0) return;
  statsEl.textContent =
    `critters ${world.critters.length} · species ${aliveSpecies(world)} · food ${world.plantCount}`;
}

// ---------- input ----------
function brushR() { return tool === 'fert+' || tool === 'fert-' ? 95 : 55; }

function pick(wx, wy) {
  let best = null, bd = Infinity;
  const slack = Math.max(6, 12 / cam.z);
  for (const c of world.critters) {
    const d = Math.hypot(c.x - wx, c.y - wy);
    if (d < c.r + slack && d < bd) { bd = d; best = c; }
  }
  return best;
}

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  mouse.down = true;
  mouse.x = e.clientX; mouse.y = e.clientY;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
  mouse.panning = e.button === 1 || e.button === 2;
  if (!mouse.panning && tool === 'look') {
    const hit = pick(mouse.wx, mouse.wy);
    if (hit) selected = hit;
    else { selected = null; mouse.panning = true; }
  }
});

cv.addEventListener('pointermove', (e) => {
  if (mouse.down && mouse.panning) {
    cam.x -= (e.clientX - mouse.x) / cam.z;
    cam.y -= (e.clientY - mouse.y) / cam.z;
    cam.x = Math.min(CFG.W + 100, Math.max(-100, cam.x));
    cam.y = Math.min(CFG.H + 100, Math.max(-100, cam.y));
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

// toolbar
const toolBtns = document.querySelectorAll('#tools button');
function setTool(t) {
  tool = t;
  toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  cv.style.cursor = t === 'look' ? 'default' : 'crosshair';
}
toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

const spdBtns = document.querySelectorAll('#speed button');
function setSpeed(s) {
  speed = s;
  spdBtns.forEach((b) => b.classList.toggle('on', +b.dataset.spd === s));
}
spdBtns.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.spd)));

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
  if (mouse.down && !mouse.panning && tool !== 'look')
    paint(world, tool, mouse.wx, mouse.wy, brushR());
  for (let i = 0; i < speed; i++) step(world);
  if (world.dirty) { redrawTerrain(); world.dirty = false; }
  drainEvents();
  draw();
  updateStats();
  updatePanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
