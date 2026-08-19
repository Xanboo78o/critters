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
  let sx = 0, sy = 0, n = Math.min(40, world.critters.length);
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
  const dx = Math.cos(c.dir), dy = Math.sin(c.dir);
  const px = -dy, py = dx;
  const rx = r * (1 + g.spd * 0.4);  // fast = sleek
  const ry = r * (1 - g.spd * 0.18);
  const ph = c.id * 1.7 + world.tick * 0.22;
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(1, r * 0.16);

  // tail — longer on fast critters, swishes as they go
  const tl = r * (0.5 + g.spd * 1.3);
  const tw = Math.sin(ph) * r * 0.35;
  ctx.beginPath();
  ctx.moveTo(sx - dx * rx * 0.8, sy - dy * rx * 0.8);
  ctx.quadraticCurveTo(
    sx - dx * (rx + tl * 0.5), sy - dy * (rx + tl * 0.5),
    sx - dx * (rx + tl) + px * tw, sy - dy * (rx + tl) + py * tw);
  ctx.stroke();

  // legs — stubby paddlers, extra pair on fast critters
  if (r > 4) {
    const pairs = g.spd > 0.55 ? 3 : 2;
    const ll = r * (0.35 + g.spd * 0.3);
    ctx.lineWidth = Math.max(1, r * 0.14);
    for (let i = 0; i < pairs; i++) {
      const along = (i / (pairs - 1) - 0.5) * rx * 1.05;
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
    ctx.lineWidth = Math.max(1, r * 0.16);
  }

  if (g.diet > 0.55) { // hunter snout
    ctx.beginPath();
    ctx.moveTo(sx + dx * rx * 1.5, sy + dy * rx * 1.5);
    ctx.lineTo(sx + dx * rx * 0.35 + px * ry * 0.5, sy + dy * rx * 0.35 + py * ry * 0.5);
    ctx.lineTo(sx + dx * rx * 0.35 - px * ry * 0.5, sy + dy * rx * 0.35 - py * ry * 0.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // body
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, c.dir, 0, 7);
  ctx.fill(); ctx.stroke();

  if (r > 4) {
    if (g.rep < 0.5) { // splitter — faint division seam
      ctx.beginPath();
      ctx.moveTo(sx + px * ry * 0.75, sy + py * ry * 0.75);
      ctx.lineTo(sx - px * ry * 0.75, sy - py * ry * 0.75);
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else { // mater — little antennae
      const bx = sx + dx * rx * 0.72, by = sy + dy * rx * 0.72;
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.fillStyle = line;
      for (const s of [1, -1]) {
        const tx = bx + (dx + px * s * 0.9) * r * 0.5;
        const ty = by + (dy + py * s * 0.9) * r * 0.5;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, ty, r * 0.1 + 0.8, 0, 7); ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.lineWidth = Math.max(1, r * 0.16);
    }
  }

  // eyes — bigger with better senses
  const er = r * (0.13 + g.sen * 0.2);
  ctx.fillStyle = `hsl(${h} 30% 21%)`;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(sx + dx * rx * 0.5 + px * s * ry * 0.45, sy + dy * rx * 0.5 + py * s * ry * 0.45, er, 0, 7);
    ctx.fill();
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

  // selection ring + sense circle
  if (selected && !selected.dead) {
    const c = selected;
    ctx.strokeStyle = '#efe6cf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + c.x * z, oy + c.y * z, c.r * z + 4, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(ox + c.x * z, oy + c.y * z, c.senR * z, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
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
  const dietCol = `hsl(${(110 - g.diet * 110) | 0} 55% 48%)`;
  panel.innerHTML =
    `<h2 style="color:hsl(${h} 65% 68%)">${s ? s.name : '?'}</h2>` +
    `<div class="sub">${g.rep < 0.5 ? 'splitter' : 'mater'} · ${s ? s.count : '?'} alive</div>` +
    barRow('energy', c.e / c.maxE, '#8a9a56') +
    barRow('age', c.age / c.maxAge, '#b8a26b') +
    barRow('size', g.siz, '#d9cba4') +
    barRow('speed', g.spd, '#d9cba4') +
    barRow('senses', g.sen, '#d9cba4') +
    barRow('diet', g.diet, dietCol, g.diet < 0.35 ? '🌿' : g.diet > 0.65 ? '🍖' : '🌿+🍖');
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
