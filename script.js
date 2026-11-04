(() => {

const PAGE_W = 1000;              // every page is laid out 1000 units wide
const MARGIN_X = 137;             // left/right text margin (page units)
const MARGIN_TOP = 110, MARGIN_BOTTOM = 110;
const LEADING = 1.3;              // line height as a multiple of text size
const GEN_H = 1055;               // page height for texts from texts.js (sketch proportions)
const CAM = 2600;                 // camera distance (page units)
const TILT = 0.32;                // radians; we look slightly down at the house
const SPIN = 0.32;                // radians per second
const GRAV = 2200;                // page units per second²
const TEXT_PX = 32;               // reference size flat words are drawn at before scaling

//reverting
const REVERT_GONE = 0.3;          // words return to the page once 30% has scrolled away
const BUILD_GONE = 0.2;           // the house builds once no more than 20% is out of view
const FONT = '"Courier Prime", "Courier New", Courier, monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const S = { cw: 0.6, gen: 0, pages: [], size: 19, weight: 0, building: true, dragging: false, lowRes: false,
            colors: { ink: '#111111', blue: '#3172c1', line: '#d6d6d6' } };
const $ = id => document.getElementById(id);


const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = a => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const randUnit = () => norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = t => Math.max(0, Math.min(1, t));
const TC = Math.cos(TILT), TS = Math.sin(TILT);
const pick = a => a[Math.floor(Math.random() * a.length)];
const isHouse = t => /house/i.test(t);

/* =========================================================================
   TEXT WEIGHT
   ========================================================================= */
function inkText(ctx, text, x, y, color, em) {
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const v = S.weight;
  if (Math.abs(v) < 0.02) return;
  ctx.lineJoin = 'round';
  if (v > 0) {
    ctx.lineWidth = v * em * 0.075;
    ctx.strokeStyle = color;
    ctx.strokeText(text, x, y);
  } else {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = -v * em * 0.05;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
}

/* =========================================================================
   HOUSE MODELS
   Each house is a list of flat faces. A face has an origin point O, a
   left-to-right axis u and a top-to-bottom axis v (both unit vectors), and an
   outline in (u, v) units. Holes are door/window rectangles [u0, v0, u1, v1]
   that text flows around. House coordinates: x right, y up, z toward viewer,
   origin on the ground at the center of the footprint.
   ========================================================================= */
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
function face(O, u, v, poly, holes = []) { return { O, u, v, poly, holes, vmax: Math.max(...poly.map(p => p[1])) }; }

function gable(W, D, Hw, Hr, name) {
  const H2 = Hw + Hr, L = Math.hypot(W / 2, Hr);
  const pent = [[W / 2, 0], [W, Hr], [W, H2], [0, H2], [0, Hr]];
  const front = [], back = [], side = [];
  if (Hw >= 160) {
    front.push([W / 2 - 36, H2 - 125, W / 2 + 36, H2], [W * 0.1, Hr + 45, W * 0.1 + 64, Hr + 115], [W * 0.9 - 64, Hr + 45, W * 0.9, Hr + 115]);
    back.push([W / 2 - 40, Hr + 45, W / 2 + 40, Hr + 115]);
    side.push([D / 2 - 45, 55, D / 2 + 45, 135]);
  } else if (Hw === 0) {
    front.push([W / 2 - 34, H2 - 120, W / 2 + 34, H2]);
  }
  const faces = [face([-W / 2, H2, D / 2], [1, 0, 0], [0, -1, 0], pent, front)];
  if (Hw > 0) faces.push(face([W / 2, Hw, D / 2], [0, 0, -1], [0, -1, 0], rect(D, Hw), side));
  faces.push(face([W / 2, H2, -D / 2], [-1, 0, 0], [0, -1, 0], pent, back));
  if (Hw > 0) faces.push(face([-W / 2, Hw, -D / 2], [0, 0, 1], [0, -1, 0], rect(D, Hw), side));
  faces.push(face([0, H2, D / 2], [0, 0, -1], norm([W / 2, -Hr, 0]), rect(D, L)));
  faces.push(face([0, H2, -D / 2], [0, 0, 1], norm([-W / 2, -Hr, 0]), rect(D, L)));
  return { name, W, D, faces };
}

function hip(W, D, Hw, Hr, name) {
  const H2 = Hw + Hr, Lf = Math.hypot(Hr, D / 2), Ls = Math.hypot(Hr, W / 2);
  return { name, W, D, faces: [
    face([-W / 2, Hw, D / 2], [1, 0, 0], [0, -1, 0], rect(W, Hw), [[W / 2 - 36, Hw - 125, W / 2 + 36, Hw], [W * 0.1, 45, W * 0.1 + 64, 115], [W * 0.9 - 64, 45, W * 0.9, 115]]),
    face([W / 2, Hw, D / 2], [0, 0, -1], [0, -1, 0], rect(D, Hw), [[D / 2 - 45, 45, D / 2 + 45, 115]]),
    face([W / 2, Hw, -D / 2], [-1, 0, 0], [0, -1, 0], rect(W, Hw)),
    face([-W / 2, Hw, -D / 2], [0, 0, 1], [0, -1, 0], rect(D, Hw), [[D / 2 - 45, 45, D / 2 + 45, 115]]),
    face([-W / 2, H2, 0], [1, 0, 0], norm([0, -Hr, D / 2]), [[W / 2, 0], [W, Lf], [0, Lf]]),
    face([0, H2, D / 2], [0, 0, -1], norm([W / 2, -Hr, 0]), [[D / 2, 0], [D, Ls], [0, Ls]]),
    face([W / 2, H2, 0], [-1, 0, 0], norm([0, -Hr, -D / 2]), [[W / 2, 0], [W, Lf], [0, Lf]]),
    face([0, H2, -D / 2], [0, 0, 1], norm([-W / 2, -Hr, 0]), [[D / 2, 0], [D, Ls], [0, Ls]]),
  ] };
}

function box(W, D, H, name) {
  return { name, W, D, faces: [
    face([-W / 2, H, D / 2], [1, 0, 0], [0, -1, 0], rect(W, H), [[30, 60, W - 30, 110], [W - 110, H - 140, W - 40, H]]),
    face([W / 2, H, D / 2], [0, 0, -1], [0, -1, 0], rect(D, H), [[40, 60, D - 40, 110]]),
    face([W / 2, H, -D / 2], [-1, 0, 0], [0, -1, 0], rect(W, H), [[30, 60, W - 30, 110]]),
    face([-W / 2, H, -D / 2], [0, 0, 1], [0, -1, 0], rect(D, H)),
    face([-W / 2, H, -D / 2], [1, 0, 0], [0, 0, 1], rect(W, D)),          // flat roof
  ] };
}

function shed(W, D, Hlo, Hhi, name) {
  const dh = Hhi - Hlo, L = Math.hypot(W, dh);
  return { name, W, D, faces: [
    face([-W / 2, Hhi, D / 2], [1, 0, 0], [0, -1, 0], [[0, 0], [W, dh], [W, Hhi], [0, Hhi]], [[W * 0.55, Hhi - 125, W * 0.55 + 72, Hhi], [30, 70, 150, 150]]),
    face([W / 2, Hlo, D / 2], [0, 0, -1], [0, -1, 0], rect(D, Hlo)),
    face([W / 2, Hhi, -D / 2], [-1, 0, 0], [0, -1, 0], [[0, dh], [W, 0], [W, Hhi], [0, Hhi]]),
    face([-W / 2, Hhi, -D / 2], [0, 0, 1], [0, -1, 0], rect(D, Hhi), [[D / 2 - 45, 60, D / 2 + 45, 140]]),
    face([-W / 2, Hhi, D / 2], [0, 0, -1], norm([W, -dh, 0]), rect(D, L)),
  ] };
}

const MODELS = [
  () => gable(380, 300, 230, 170, 'Gable house'),
  () => gable(420, 360, 0, 440, 'A-frame'),
  () => hip(430, 340, 210, 150, 'Hip-roof bungalow'),
  () => box(380, 320, 320, 'Flat-roof box'),
  () => shed(420, 300, 210, 350, 'Shed-roof studio'),
  () => gable(240, 240, 390, 150, 'Tall gable'),
];

function scaleModel(m, k) {
  if (k === 1) return m;
  return { ...m, W: m.W * k, D: m.D * k, faces: m.faces.map(f => ({
    ...f, O: mul(f.O, k), poly: f.poly.map(p => [p[0] * k, p[1] * k]), holes: f.holes.map(h => h.map(x => x * k)), vmax: f.vmax * k,
  })) };
}

/* ---------- flowing words onto faces ---------- */
function faceRuns(f, y, lh) {
  let a = -Infinity, b = Infinity;
  for (const yy of [y + 0.5, y + lh / 2, y + lh - 0.5]) {
    const xs = [], P = f.poly;
    for (let k = 0; k < P.length; k++) {
      const p = P[k], q = P[(k + 1) % P.length];
      if (p[1] === q[1]) continue;
      if (yy < Math.min(p[1], q[1]) || yy > Math.max(p[1], q[1])) continue;
      xs.push(p[0] + (yy - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
    }
    if (xs.length < 2) return [];
    a = Math.max(a, Math.min(...xs)); b = Math.min(b, Math.max(...xs));
  }
  if (b <= a) return [];
  let runs = [[a, b]];
  for (const h of f.holes) {
    if (h[1] >= y + lh || h[3] <= y) continue;
    runs = runs.flatMap(([s, e]) => {
      if (h[2] <= s || h[0] >= e) return [[s, e]];
      const r = []; if (h[0] > s) r.push([s, h[0]]); if (h[2] < e) r.push([h[2], e]); return r;
    });
  }
  return runs;
}

function place3d(words, size, faces) {
  const lh = size * 1.12, sp = S.cw * size, pad = 8, out = new Array(words.length);
  let i = 0;
  for (let fi = 0; fi < faces.length && i < words.length; fi++) {
    const f = faces[fi];
    for (let y = pad; y + lh <= f.vmax - pad && i < words.length; y += lh) {
      for (let [a, b] of faceRuns(f, y, lh)) {
        a += pad / 2; b -= pad / 2;
        if (b - a < sp * 2) continue;
        let x = a; const row = [];
        while (i < words.length) {
          const w = words[i].len * sp;
          if (x + w <= b) { out[i] = { fi, u: x, v: y }; row.push(i); x += w + sp; i++; } else break;
        }
        if (row.length > 1) {                      // justify so edges stay crisp
          const extra = b - (x - sp);
          if (extra < (b - a) * 0.35) row.forEach((k, j) => out[k].u += extra * j / (row.length - 1));
        }
        if (i >= words.length) break;
      }
    }
  }
  return { out, count: i };
}

function faceArea(f) {
  const P = f.poly; let a = 0;
  for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
  a = Math.abs(a) / 2;
  for (const h of f.holes) a -= (h[2] - h[0]) * (h[3] - h[1]);
  return Math.max(0, a);
}

// Largest type size at which a run of words fits on one face.
function fitFace(words, f) {
  let lo = 3, hi = 140, best = null;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2, r = place3d(words, mid, [f]);
    if (r.count === words.length) { best = { ...r, size: mid }; lo = mid; } else hi = mid;
  }
  return best || { ...place3d(words, lo, [f]), size: lo };
}

// Share the page's words across every face by area (reading order kept),
// so walls and roof all get covered. With `size`, every face uses that text
// size and `ok` says whether all the words fit; without it, each face gets
// the largest size that fits.
function fit3d(words, faces, size) {
  const n = words.length, areas = faces.map(faceArea);
  const totalA = areas.reduce((s, a) => s + a, 0) || 1;
  const totalC = words.reduce((s, w) => s + w.len + 1, 0);
  const out = new Array(n), sizes = new Array(n);
  let i = 0, accC = 0, accA = 0, ok = true;
  faces.forEach((f, fi) => {
    accA += areas[fi];
    const goal = totalC * accA / totalA, start = i;
    while (i < n && (fi === faces.length - 1 || accC + (words[i].len + 1) / 2 <= goal)) { accC += words[i].len + 1; i++; }
    const slice = words.slice(start, i);
    if (!slice.length) return;
    const r = size ? { ...place3d(slice, size, [f]), size } : fitFace(slice, f);
    if (r.count < slice.length) ok = false;
    for (let j = 0; j < r.count; j++) { out[start + j] = { ...r.out[j], fi }; sizes[start + j] = r.size; }
  });
  return { out, sizes, ok };
}

// Build the house at the reader's Text Size: find the smallest scale of the
// model that holds every word at that size. If even the largest house that
// fits on the page can't hold them, use that house with the biggest text it takes.
function sizeHouse(raw, words, H) {
  const top = Math.max(...raw.faces.map(f => f.O[1]));
  const maxK = Math.min((H * 0.7 - 40) / top, 880 / Math.hypot(raw.W, raw.D));
  let fit = fit3d(words, scaleModel(raw, maxK).faces, S.size);
  if (!fit.ok) { const model = scaleModel(raw, maxK); return { model, fit: fit3d(words, model.faces) }; }
  let lo = 0.05, hi = maxK, best = { k: maxK, fit };
  for (let it = 0; it < 14; it++) {
    const k = (lo + hi) / 2, r = fit3d(words, scaleModel(raw, k).faces, S.size);
    if (r.ok) { best = { k, fit: r }; hi = k; } else lo = k;
  }
  return { model: scaleModel(raw, best.k), fit: best.fit };
}

/* =========================================================================
   PAGE LAYOUT
   Each page keeps its paragraphs; words are re-set at the current Text Size.
   A page is as tall as its source (PDF proportions) or taller if the text
   needs the room.
   ========================================================================= */
function layoutPage(pg) {
  const f = S.size, lh = f * LEADING, sp = S.cw * f;
  const left = MARGIN_X, right = PAGE_W - MARGIN_X;
  const words = [];
  let y = MARGIN_TOP;
  for (const para of pg.paras) {
    let x = left;
    for (const t of para) {
      const w = t.length * sp;
      if (x > left && x + w > right) { x = left; y += lh; }
      words.push({ t, x, y, f, len: t.length, hw: isHouse(t) });
      x += w + sp;
    }
    y += lh;
  }
  pg.words = words;
  pg.n = words.length;
  pg.H = Math.max(pg.H0, Math.ceil(y + MARGIN_BOTTOM));
  pg.wrap.style.aspectRatio = `${PAGE_W} / ${pg.H}`;
}

/* =========================================================================
   PAGE STATE
   Every word is drawn as a quad given by three points: O (top-left),
   U (top-right), V (bottom-left). Points live in flat number buffers
   (9 numbers per word) that are reused every frame.
   ========================================================================= */
const groundOf = H => -H / 2 + H * 0.25;
const TMP = new Float64Array(9);

/* ---------- falling words ---------- */
function newBody(pts, vx, vy, vz) {          // pts: 9 numbers, world space
  const b = { c: new Float64Array(3), r: new Float64Array(9), vel: new Float64Array([vx, vy, vz]),
              ax: randUnit(), om: (Math.random() - 0.5) * 10, bounces: 0, state: 1, settle: 0,
              r0: new Float64Array(9), rf: new Float64Array(9), c0y: 0, cf: 0 };
  for (let a = 0; a < 3; a++) b.c[a] = (pts[3 + a] + pts[6 + a]) / 2;
  for (let k = 0; k < 9; k++) b.r[k] = pts[k] - b.c[k % 3];
  return b;
}

function beginSettle(b, ground) {
  const r = b.r;
  const ux = r[3] - r[0], uy = r[4] - r[1], uz = r[5] - r[2];
  const L = Math.hypot(ux, uy, uz), h = Math.hypot(r[6] - r[0], r[7] - r[1], r[8] - r[2]);
  const hl = Math.hypot(ux, uz);
  const dx = hl < 1e-3 ? 1 : ux / hl, dz = hl < 1e-3 ? 0 : uz / hl;   // along the floor
  const ex = -dz, ez = dx;                                             // lying face-up
  const ox = -dx * L / 2 - ex * h / 2, oz = -dz * L / 2 - ez * h / 2;
  b.rf.set([ox, 0, oz, ox + dx * L, 0, oz + dz * L, ox + ex * h, 0, oz + ez * h]);
  b.r0.set(r); b.c0y = b.c[1]; b.cf = ground + 0.5; b.settle = 0; b.state = 2;
}

function stepBody(b, dt, ground) {
  if (b.state === 3) return;
  const c = b.c, r = b.r, v = b.vel;
  if (b.state === 2) {
    b.settle = Math.min(1, b.settle + dt / 0.35);
    const s = ease(b.settle);
    for (let k = 0; k < 9; k++) r[k] = b.r0[k] + (b.rf[k] - b.r0[k]) * s;
    c[0] += v[0] * dt * (1 - s); c[2] += v[2] * dt * (1 - s); c[1] = b.c0y + (b.cf - b.c0y) * s;
    if (b.settle >= 1) b.state = 3;
    return;
  }
  v[1] -= GRAV * dt;
  c[0] += v[0] * dt; c[1] += v[1] * dt; c[2] += v[2] * dt;
  if (b.om) {
    const a = b.om * dt, co = Math.cos(a), si = Math.sin(a), [kx, ky, kz] = b.ax;
    for (let p = 0; p < 9; p += 3) {
      const px = r[p], py = r[p + 1], pz = r[p + 2], d = px * kx + py * ky + pz * kz;
      r[p]     = px * co + (ky * pz - kz * py) * si + kx * d * (1 - co);
      r[p + 1] = py * co + (kz * px - kx * pz) * si + ky * d * (1 - co);
      r[p + 2] = pz * co + (kx * py - ky * px) * si + kz * d * (1 - co);
    }
  }
  if ((c[0] < -460 && v[0] < 0) || (c[0] > 460 && v[0] > 0)) v[0] *= -0.5;
  if ((c[2] < -300 && v[2] < 0) || (c[2] > 280 && v[2] > 0)) v[2] *= -0.5;
  const oy = r[1], uy = r[4], vy = r[7];
  const minY = c[1] + Math.min(oy, uy, vy, uy + vy - oy);
  if (minY < ground) {
    c[1] += ground - minY;
    if (v[1] < 0) { v[1] = -v[1] * 0.3; v[0] *= 0.7; v[2] *= 0.7; b.om *= 0.55; b.bounces++; }
    if (b.bounces >= 2 || Math.abs(v[1]) < 160) beginSettle(b, ground);
  }
}

/* ---------- per-frame positions ---------- */
function compute(pg, now) {
  const n = pg.n, cur = pg.cur, F = pg.from, L = pg.loc, T = pg.trans, tw = pg.tw;
  const house = pg.base === 'house', g = pg.ground;
  const ca = Math.cos(pg.angle), sa = Math.sin(pg.angle);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    if (!house) {
      for (let k = 0; k < 9; k++) TMP[k] = pg.flat[o + k];
    } else {
      const b = pg.bodies[i];
      if (b) {
        for (let p = 0; p < 9; p += 3) {
          const x = b.c[0] + b.r[p], y = b.c[1] + b.r[p + 1], z = b.c[2] + b.r[p + 2];
          TMP[p] = x; TMP[p + 1] = y * TC - z * TS; TMP[p + 2] = y * TS + z * TC;
        }
      } else {
        for (let p = 0; p < 9; p += 3) {
          const x = L[o + p], z = L[o + p + 2];
          const xr = x * ca + z * sa, zr = -x * sa + z * ca, yr = L[o + p + 1] + g;
          TMP[p] = xr; TMP[p + 1] = yr * TC - zr * TS; TMP[p + 2] = yr * TS + zr * TC;
        }
      }
    }
    let e = 1;
    if (T) { const q = (now - T.start - pg.delay[i]) / T.dur; e = q >= 1 ? 1 : q <= 0 ? 0 : ease(q); }
    if (e >= 1) { for (let k = 0; k < 9; k++) cur[o + k] = TMP[k]; continue; }
    if (e <= 0) { for (let k = 0; k < 9; k++) cur[o + k] = F[o + k]; continue; }
    for (let k = 0; k < 9; k++) cur[o + k] = F[o + k] + (TMP[k] - F[o + k]) * e;
    const s = Math.sin(Math.PI * e);
    if (s < 0.001) continue;
    const t = i * 7, a = tw[t] * s, kx = tw[t + 1], ky = tw[t + 2], kz = tw[t + 3];
    const co = Math.cos(a), si = Math.sin(a);
    const cx = (cur[o + 3] + cur[o + 6]) / 2, cy = (cur[o + 4] + cur[o + 7]) / 2, cz = (cur[o + 5] + cur[o + 8]) / 2;
    for (let p = 0; p < 9; p += 3) {                   // the twist on the way
      const px = cur[o + p] - cx, py = cur[o + p + 1] - cy, pz = cur[o + p + 2] - cz;
      const d = px * kx + py * ky + pz * kz;
      cur[o + p]     = cx + px * co + (ky * pz - kz * py) * si + kx * d * (1 - co) + tw[t + 4] * s;
      cur[o + p + 1] = cy + py * co + (kz * px - kx * pz) * si + ky * d * (1 - co) + tw[t + 5] * s;
      cur[o + p + 2] = cz + pz * co + (kx * py - ky * px) * si + kz * d * (1 - co) + tw[t + 6] * s;
    }
  }
}

function snapshot(pg, now) { compute(pg, now); pg.from.set(pg.cur); }

function beginTrans(pg, now, quick) {
  const rm = reduceMotion.matches, n = pg.n;
  const spread = quick ? 180 : 560, jitter = quick ? 60 : 140;
  let max = 0;
  for (let i = 0; i < n; i++) { const d = rm ? 0 : (i / n) * spread + Math.random() * jitter; pg.delay[i] = d; if (d > max) max = d; }
  const dur = rm ? 1 : quick ? 650 : 1400;
  pg.trans = { start: now, dur, end: now + max + dur };
}

/* ---------- word atlas: each page's words rendered once, then stamped ---------- */
function buildAtlas(pg) {
  const key = S.weight.toFixed(2);
  if (pg.atlas && pg.atlasKey === key) return;
  const W = 2048;
  // Smaller sprites for very long pages so the atlas stays a safe size.
  let spr = 40, pad, rowH, pos, height;
  for (const tryS of [40, 30, 22, 16]) {
    spr = tryS; pad = Math.ceil(spr * 0.15); rowH = Math.ceil(spr * 1.25) + pad * 2;
    pos = new Float32Array(pg.n * 3);
    let x = 0, y = 0;
    pg.words.forEach((w, i) => {
      const sw = Math.ceil(w.len * S.cw * spr) + pad * 2;
      if (x + sw > W) { x = 0; y += rowH; }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = sw;
      x += sw;
    });
    height = y + rowH;
    if (height <= 7000) break;
  }
  const cv = pg.atlas && pg.atlas.width === W ? pg.atlas : document.createElement('canvas');
  cv.width = W; cv.height = Math.max(1, height);
  const c = cv.getContext('2d');
  c.font = `${spr}px ${FONT}`; c.textBaseline = 'top';
  pg.words.forEach((w, i) => inkText(c, w.t, pos[i * 3] + pad, pos[i * 3 + 1] + pad, w.hw ? S.colors.blue : S.colors.ink, spr));
  Object.assign(pg, { atlas: cv, atlasPos: pos, atlasRowH: rowH, atlasSpr: spr, atlasPad: pad, atlasKey: key });
}

/* ---------- state changes ---------- */
function toHouse(pg, now) {
  snapshot(pg, now);
  let make;
  do make = pick(MODELS); while (MODELS.length > 1 && make === pg.lastMake);
  pg.lastMake = make;
  const { model, fit } = sizeHouse(make(), pg.words, pg.H);
  if (pg.base === 'flat') pg.angle = -0.75 + Math.random() * 0.5;
  pg.model = model; pg.ground = groundOf(pg.H); pg.base = 'house';
  pg.detachAt.fill(0);
  pg.words.forEach((w, i) => {
    pg.bodies[i] = null;
    const p = fit.out[i], o = i * 9;
    if (p) {
      const f = model.faces[p.fi], size = fit.sizes[i], ww = w.len * S.cw * size;
      const Ox = f.O[0] + f.u[0] * p.u + f.v[0] * p.v, Oy = f.O[1] + f.u[1] * p.u + f.v[1] * p.v, Oz = f.O[2] + f.u[2] * p.u + f.v[2] * p.v;
      pg.loc.set([Ox, Oy, Oz, Ox + f.u[0] * ww, Oy + f.u[1] * ww, Oz + f.u[2] * ww, Ox + f.v[0] * size, Oy + f.v[1] * size, Oz + f.v[2] * size], o);
    } else {                                            // didn't fit: it just falls
      pg.bodies[i] = newBody(pg.flat.subarray(o, o + 9), (Math.random() - 0.5) * 120, 0, 0);
    }
  });
  pg.allDown = false; pg.collapsing = false;
  buildAtlas(pg);
  beginTrans(pg, now);
  caption(pg); kick(pg);
}

function toFlat(pg, now) {
  snapshot(pg, now);
  pg.base = 'flat';
  beginTrans(pg, now, true);                            // unbuilding is quicker than building
  caption(pg); kick(pg);
}

function collapse(pg, now) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pg.n; i++) if (!pg.bodies[i]) { const y = pg.loc[i * 9 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  for (let i = 0; i < pg.n; i++) if (!pg.bodies[i]) {
    const hN = (pg.loc[i * 9 + 1] - lo) / ((hi - lo) || 1);
    pg.detachAt[i] = now + (1 - hN) * 500 + Math.random() * 500;   // roof goes first
  }
  pg.collapsing = true; caption(pg); kick(pg);
}

function detach(pg, i) {
  const o = i * 9, L = pg.loc, ca = Math.cos(pg.angle), sa = Math.sin(pg.angle);
  const pts = new Float64Array(9);
  for (let p = 0; p < 9; p += 3) {
    const x = L[o + p], z = L[o + p + 2];
    pts[p] = x * ca + z * sa; pts[p + 1] = L[o + p + 1] + pg.ground; pts[p + 2] = -x * sa + z * ca;
  }
  const cx = (pts[3] + pts[6]) / 2, cz = (pts[5] + pts[8]) / 2, rl = Math.hypot(cx, cz) || 1;
  const spin = reduceMotion.matches ? 0 : SPIN, out = 80 + Math.random() * 220;
  pg.bodies[i] = newBody(pts, cx / rl * out + cz * spin, Math.random() * 250, cz / rl * out - cx * spin);
}

function step(pg, now, dt) {
  if (pg.base === 'house') {
    if (!reduceMotion.matches) pg.angle += SPIN * dt;
    let down = true;
    for (let i = 0; i < pg.n; i++) {
      let b = pg.bodies[i];
      if (!b && pg.detachAt[i] && now >= pg.detachAt[i]) { detach(pg, i); b = pg.bodies[i]; }
      if (b) stepBody(b, dt, pg.ground); else down = false;
    }
    if (down !== pg.allDown) { pg.allDown = down; if (down) pg.collapsing = false; caption(pg); }
  }
  if (pg.trans && now >= pg.trans.end) {
    pg.trans = null;
    if (pg.base === 'flat') {
      pg.bodies.fill(null); pg.detachAt.fill(0);
      pg.allDown = false; pg.collapsing = false; pg.idle = true;
      pg.atlas = null; pg.atlasPos = null;                // free memory until next time
      caption(pg);
    }
  }
}

/* ---------- drawing ---------- */
function drawFlat(pg) {                                   // crisp, still page
  const { ctx, k } = pg;
  ctx.font = `${TEXT_PX}px ${FONT}`; ctx.textBaseline = 'top'; ctx.globalAlpha = 1;
  for (const w of pg.words) {
    const s = w.f / TEXT_PX;
    ctx.setTransform(k * s, 0, 0, k * s, k * w.x, k * w.y);
    inkText(ctx, w.t, 0, 0, w.hw ? S.colors.blue : S.colors.ink, TEXT_PX);
  }
}

function draw(pg, now) {
  const { ctx, k } = pg;
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pg.canvas.width, pg.canvas.height);
  if ((pg.base === 'flat' && !pg.trans) || !pg.atlas) { drawFlat(pg); return; }

  compute(pg, now);
  let cue = pg.base === 'house' ? 1 : 0;                 // 0 = flat page, 1 = full 3D
  if (pg.trans) {
    const p = ease(clamp01((now - pg.trans.start) / (pg.trans.end - pg.trans.start)));
    cue = pg.base === 'house' ? p : 1 - p;
  }
  const cx = PAGE_W / 2, cy = pg.H / 2;

  const n = pg.n, cur = pg.cur, zs = pg.zs, order = pg.order;
  for (let i = 0; i < n; i++) { zs[i] = (cur[i * 9 + 5] + cur[i * 9 + 8]) / 2; order[i] = i; }
  if (cue > 0.01) order.sort((a, b) => zs[a] - zs[b]); // far words first

  const A = pg.atlas, P = pg.atlasPos, rowH = pg.atlasRowH, spr = pg.atlasSpr, pad = pg.atlasPad;
  for (let j = 0; j < n; j++) {
    const i = order[j], o = i * 9, w = pg.words[i];
    const so = CAM / (CAM - cur[o + 2]), su = CAM / (CAM - cur[o + 5]), sv = CAM / (CAM - cur[o + 8]);
    const ox = cx + cur[o] * so, oy = cy - cur[o + 1] * so;
    const ux = cx + cur[o + 3] * su, uy = cy - cur[o + 4] * su;
    const vx = cx + cur[o + 6] * sv, vy = cy - cur[o + 7] * sv;
    const wt = w.len * S.cw * spr;
    ctx.setTransform(k * (ux - ox) / wt, k * (uy - oy) / wt, k * (vx - ox) / spr, k * (vy - oy) / spr, k * ox, k * oy);
    ctx.globalAlpha = 1 - cue * (1 - (0.28 + 0.72 * clamp01((zs[i] + 380) / 760)));
    ctx.drawImage(A, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], rowH, -pad, -pad, P[i * 3 + 2], rowH);
  }
  ctx.globalAlpha = 1;
}

/* ---------- animation loop ---------- */
const active = new Set();
let raf = 0, last = 0, slow = 0;
function kick(pg) {
  pg.idle = false; active.add(pg);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}
function loop(now) {
  const ft = now - last, dt = Math.min(0.05, ft / 1000); last = now;
  // If frames keep running long, drop canvas resolution to keep motion smooth.
  slow = slow * 0.95 + (ft > 24 ? 0.05 : 0);
  if (slow > 0.5 && !S.lowRes) { S.lowRes = true; S.pages.forEach(sizeCanvas); }
  for (const pg of active) {
    step(pg, now, dt);
    if (pg.vis > 0 || pg.idle) draw(pg, now);         // skip pages that are off screen
    if (pg.idle) active.delete(pg);
  }
  raf = active.size ? requestAnimationFrame(loop) : 0;
}

/* ---------- pages ---------- */
const nearIO = new IntersectionObserver(es => es.forEach(e => {
  const pg = e.target._pg; if (!pg) return;
  e.isIntersecting ? mount(pg) : unmount(pg);
}), { rootMargin: '1000px 0px' });

// On every scroll, measure how much of each nearby page has gone out of view.
// Measured against the page's own height, so tall pages behave the same as short ones.
let hdrH = 0, viewRaf = 0;
function measure(pg) {
  const r = pg.wrap.getBoundingClientRect(), top = hdrH, bottom = window.innerHeight;
  const shown = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top));
  pg.vis = r.height > 0 ? shown / r.height : 0;
  pg.gone = r.height > 0 ? Math.max(0, (top - r.top) / r.height, (r.bottom - bottom) / r.height) : 1;
}
function checkViews() {
  viewRaf = 0;
  for (const pg of S.pages) {
    if (!pg.mounted) continue;
    measure(pg);
    if (pg.gone >= REVERT_GONE) houseDown(pg);
    else if (pg.gone <= BUILD_GONE) houseUp(pg);
  }
}
const queueViews = () => { if (!viewRaf) viewRaf = requestAnimationFrame(checkViews); };
addEventListener('scroll', queueViews, { passive: true });
addEventListener('resize', queueViews);

const ro = new ResizeObserver(es => es.forEach(e => sizeCanvas(e.target._pg)));

function addPage({ H0, paras }) {
  const num = S.pages.length + 1;
  const wrap = document.createElement('div'); wrap.className = 'pg';
  const mentions = paras.reduce((s, p) => s + p.filter(isHouse).length, 0);
  const pg = { num, H0, paras, wrap, mentions, base: 'flat', trans: null, angle: 0, vis: 0, gone: 1,
               mounted: false, idle: true, allDown: false, collapsing: false, model: null, lastMake: null };
  layoutPage(pg);
  pg.ground = groundOf(pg.H);
  if (!pg.n) { const n = document.createElement('div'); n.className = 'empty-note'; n.textContent = 'No text on this page'; wrap.append(n); }
  wrap._pg = pg; S.pages.push(pg);
  $('pages').append(wrap);

  if (mentions) {
    wrap.tabIndex = 0;
    const act = () => {
      if (!S.building || pg.base !== 'house' || pg.trans || pg.collapsing) return;
      const now = performance.now();
      if (pg.allDown) toHouse(pg, now); else collapse(pg, now);
    };
    wrap.addEventListener('click', act);
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  }
  caption(pg);
  ro.observe(wrap); nearIO.observe(wrap);
  return pg;
}

function clearPages() {
  for (const pg of S.pages) { nearIO.unobserve(pg.wrap); ro.unobserve(pg.wrap); active.delete(pg); }
  S.pages = []; $('pages').textContent = '';
}

function sizeCanvas(pg) {
  if (!pg || !pg.canvas) return;
  const w = pg.wrap.clientWidth, dpr = Math.min(S.lowRes ? 1 : 1.5, window.devicePixelRatio || 1);
  pg.canvas.width = Math.max(1, Math.round(w * dpr));
  pg.canvas.height = Math.max(1, Math.round(w * pg.H / PAGE_W * dpr));
  pg.k = pg.canvas.width / PAGE_W;
  draw(pg, performance.now());
}

function mount(pg) {
  if (pg.mounted) return;
  const n = pg.n;
  // Buffers exist only while a page is near the screen.
  pg.flat = new Float64Array(n * 9); pg.loc = new Float64Array(n * 9);
  pg.cur = new Float64Array(n * 9); pg.from = new Float64Array(n * 9);
  pg.delay = new Float64Array(n); pg.zs = new Float64Array(n); pg.order = new Int32Array(n);
  pg.tw = new Float64Array(n * 7); pg.bodies = new Array(n).fill(null); pg.detachAt = new Float64Array(n);
  pg.words.forEach((w, i) => {
    const ox = w.x - PAGE_W / 2, oy = pg.H / 2 - w.y;
    pg.flat.set([ox, oy, 0, ox + w.len * S.cw * w.f, oy, 0, ox, oy - w.f, 0], i * 9);
    const ax = randUnit();
    pg.tw.set([(Math.random() - 0.5) * 3.6, ax[0], ax[1], ax[2],
               (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240], i * 7);
  });
  pg.cur.set(pg.flat);
  pg.ground = groundOf(pg.H);
  pg.canvas = document.createElement('canvas');
  pg.canvas.setAttribute('aria-hidden', 'true');
  pg.wrap.append(pg.canvas);
  pg.ctx = pg.canvas.getContext('2d');
  pg.mounted = true;
  sizeCanvas(pg);
  measure(pg);
  if (pg.gone <= BUILD_GONE) houseUp(pg);
}

function unmount(pg) {
  if (!pg.mounted) return;
  active.delete(pg);
  pg.canvas.remove(); pg.canvas = pg.ctx = null; pg.mounted = false;
  pg.base = 'flat'; pg.trans = null; pg.allDown = false; pg.collapsing = false; pg.idle = true;
  pg.flat = pg.loc = pg.cur = pg.from = pg.delay = pg.zs = pg.order = pg.tw = pg.bodies = pg.detachAt = null;
  pg.atlas = pg.atlasPos = null;
  caption(pg);
}

function caption(pg) {
  const on = pg.base === 'house';
  pg.wrap.classList.toggle('live', on && S.building);
  if (!pg.mentions) return;
  const hint = !on || pg.collapsing ? '' : pg.allDown ? ' Press Enter to rebuild.' : ' Press Enter to knock it down.';
  pg.wrap.setAttribute('aria-label', on ? `Page ${pg.num}, built into a house.${hint}` : `Page ${pg.num}`);
}

function houseUp(pg) {
  if (!S.building || S.dragging || !pg.mounted || !pg.mentions || pg.base === 'house') return;
  toHouse(pg, performance.now());
}
function houseDown(pg) {
  if (pg.base !== 'house') return;
  toFlat(pg, performance.now());
}

/* ---------- documents ---------- */
function setStat(html) { $('docStat').innerHTML = html; }
// The current text's title, set as a title, with any "house" in it blue.
let docTitle = '', docCredit = '';
const escapeHTML = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const blueHouse = html => html.replace(/[A-Za-z]*house[A-Za-z]*/gi, m => `<span class="h">${m}</span>`);
function titleHTML() {
  if (!docTitle) return '';
  const mark = docCredit ? '<sup class="ref">5</sup>' : '';
  return `<cite>${blueHouse(escapeHTML(docTitle))}</cite>${mark}. `;
}
// Footnote 5 in About this site: the credit for whichever text is showing.
// Links: write [words](https://address) to link the words, or paste a bare
// https:// address to show it as a link.
function showCredit() {
  const li = $('creditNote');
  if (!li) return;
  li.hidden = !docCredit;
  const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s]*[^\s.,;:)]/g;
  const a = (url, words) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">${words}</a>`;
  let html = '', at = 0;
  for (const m of docCredit.matchAll(LINK)) {
    html += blueHouse(escapeHTML(docCredit.slice(at, m.index)));
    html += m[1] ? a(m[2], blueHouse(escapeHTML(m[1]))) : a(m[0], escapeHTML(m[0].replace(/^https?:\/\//, '')));
    at = m.index + m[0].length;
  }
  li.querySelector('.txt').innerHTML = html + blueHouse(escapeHTML(docCredit.slice(at)));
}
function statLine(total, say) {
  const pages = `${titleHTML()}${total} page${total === 1 ? '' : 's'}.`;
  if (!say) return `${pages} None have a <span class="h">house</span>.`;
  if (say === total) return `${pages} ${total === 1 ? 'It has' : 'All have'} a <span class="h">house</span>.`;
  return `${pages} ${say} ${say === 1 ? 'has' : 'have'} a <span class="h">house</span>.`;
}

/* ---------- texts for Randomize Text (written in texts.js) ---------- */
// One page = everything between lines that hold only ---.
// One paragraph = everything between blank lines.
function parseText(text) {
  return text.replace(/\r\n?/g, '\n')
    .split(/^[ \t]*---[ \t]*$/m)
    .map(page => page.split(/\n[ \t]*\n/)
      .map(para => para.split(/\s+/).filter(Boolean))
      .filter(para => para.length))
    .filter(paras => paras.length)
    .map(paras => ({ H0: GEN_H, paras }));
}

function textPool() {
  const written = (window.HOUSE_TEXTS || [])
    .filter(t => t && typeof t.text === 'string' && t.text.trim())
    .map(t => ({ title: t.title || 'Untitled', credit: (t.credit || '').trim(), make: () => parseText(t.text) }));
  return written;
}

let lastText = null;
function loadRandom() {
  S.gen++; clearPages(); window.scrollTo(0, 0);
  const pool = textPool();
  if (!pool.length) { docTitle = docCredit = ''; showCredit(); setStat('No texts yet. Add one to texts.js, or upload a PDF.'); return; }
  let choice = pick(pool);
  if (pool.length > 1) while (choice.title === lastText) choice = pick(pool);
  lastText = choice.title;
  docTitle = choice.title;
  docCredit = choice.credit;
  showCredit();
  const pages = choice.make();
  pages.forEach(addPage);
  queueViews();
  setStat(statLine(pages.length, S.pages.filter(p => p.mentions).length));
}

// Rebuild paragraphs from a PDF page's text: lines are grouped by position,
// a bigger-than-usual gap between lines starts a new paragraph.
function extractParas(items, vp) {
  const lines = [];
  let cur = null, prevEnd = -Infinity, forceNew = true;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]) || 10, x = tx[4], y = tx[5];
    if (it.str.trim()) {
      if (forceNew || !cur || Math.abs(y - cur.y) > fh * 0.6) {
        cur = { y, fh, text: '' }; lines.push(cur); forceNew = false;
      } else if (x - prevEnd > fh * 0.15 && !/\s$/.test(cur.text)) {
        cur.text += ' ';
      }
      cur.text += it.str;
      cur.fh = Math.max(cur.fh, fh);
      prevEnd = x + (it.width || 0) * vp.scale;
      cur.end = prevEnd;
    }
    if (it.hasEOL) forceNew = true;
  }
  const paras = [];
  const maxEnd = Math.max(0, ...lines.map(l => l.end || 0));
  let prev = null;
  for (const ln of lines) {
    const t = ln.text.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const gap = prev ? ln.y - prev.y : Infinity;
    // new paragraph: extra space above, a jump back up (new column), or a short line ending a sentence
    const shortEnd = prev && /[.!?:”"]$/.test(prev.text.trim()) && prev.end < maxEnd - prev.fh * 3;
    if (!paras.length || gap < 0 || gap > Math.max(ln.fh, prev.fh) * 1.6 || shortEnd) paras.push('');
    const p = paras.length - 1;
    if (!paras[p]) paras[p] = t;
    else if (/[A-Za-z]-$/.test(paras[p]) && /^[a-z]/.test(t)) paras[p] = paras[p].slice(0, -1) + t;  // re-join hyphenated words
    else paras[p] += ' ' + t;
    prev = ln;
  }
  return paras.filter(Boolean).map(p => p.split(' ').filter(Boolean));
}

async function openPdf(file) {
  if (!window.pdfjsLib) { toast('The PDF reader failed to load. Check your connection and reload.'); return; }
  const gen = ++S.gen; clearPages(); window.scrollTo(0, 0);
  docTitle = file.name.replace(/\.pdf$/i, '');
  docCredit = '';                                   // uploaded files don't get a credit note
  showCredit();
  setStat(`${titleHTML()}Opening…`);
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, disableFontFace: true }).promise; }
  catch (e) {
    if (gen !== S.gen) return;
    setStat(e && e.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'That file couldn’t be opened as a PDF.');
    return;
  }
  const total = pdf.numPages; let say = 0, anyText = false;
  for (let p = 1; p <= total; p++) {
    if (gen !== S.gen) return;
    try {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: PAGE_W / base.width });
      const tc = await page.getTextContent();
      if (gen !== S.gen) return;
      const pg = addPage({ H0: vp.height, paras: extractParas(tc.items, vp) });
      if (pg.n) anyText = true;
      if (pg.mentions) say++;
      page.cleanup();
    } catch { if (gen !== S.gen) return; addPage({ H0: 1294, paras: [] }); }
    if (p < total && p % 5 === 0) setStat(`${titleHTML()}Reading ${p} of ${total} pages. ${say} ${say === 1 ? 'has' : 'have'} a <span class="h">house</span> so far.`);
  }
  if (gen !== S.gen) return;
  setStat(anyText ? statLine(total, say) : `${titleHTML()}${total} page${total === 1 ? '' : 's'}. No text found; this looks like a scanned PDF.`);
}

/* ---------- controls ---------- */
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4200); }

$('openPdf').onclick = () => $('pdfIn').click();
$('pdfIn').onchange = e => { const f = e.target.files[0]; if (f) openPdf(f); e.target.value = ''; };
$('randomize').onclick = loadRandom;

// Text Size: words reflow live while dragging; houses wait until you let go.
$('size').addEventListener('input', e => {
  S.size = +e.target.value; S.dragging = true;
  for (const pg of S.pages) {
    const was = pg.mounted;
    if (was) unmount(pg);
    layoutPage(pg);
    if (was) mount(pg);
  }
});
$('size').addEventListener('change', () => {
  S.dragging = false;
  queueViews();
});

// Text Weight: redraw flat pages and re-render the word atlas of any house.
let weightRaf = 0;
$('weight').addEventListener('input', e => {
  S.weight = +e.target.value / 100;
  if (weightRaf) return;
  weightRaf = requestAnimationFrame(() => {
    weightRaf = 0;
    for (const pg of S.pages) {
      if (!pg.mounted) continue;
      if (pg.atlas) buildAtlas(pg);
      draw(pg, performance.now());
    }
  });
});

// Building: off = read regularly.
$('building').addEventListener('click', e => {
  S.building = !S.building;
  e.currentTarget.setAttribute('aria-checked', String(S.building));
  for (const pg of S.pages) {
    if (!S.building) houseDown(pg);
    caption(pg);
  }
  if (S.building) queueViews();
});

// About this site: the footnotes, plus their reference marks.
$('aboutBtn').addEventListener('click', e => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', String(open));
  $('about').hidden = !open;
  document.body.classList.toggle('notes-open', open);
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('about').hidden) $('aboutBtn').click(); });

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
addEventListener('drop', e => {
  if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const pdf = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  pdf ? openPdf(pdf) : toast('Drop a PDF to read it.');
});

// Keep the header height in sync: pages count as scrolled away once they pass under it.
function trackHeader() {
  const h = Math.round($('bar').getBoundingClientRect().height);
  if (h === hdrH) return;
  hdrH = h;
  document.documentElement.style.setProperty('--hdr', h + 'px');
  queueViews();
}
new ResizeObserver(trackHeader).observe($('bar'));

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n, d) => cs.getPropertyValue(n).trim() || d;
  S.colors = { ink: get('--ink', '#111111'), blue: get('--blue', '#3172c1'), line: '#d6d6d6' };
}

/* ---------- boot ---------- */
(async () => {
  try { await Promise.race([document.fonts.load(`400 100px "Courier Prime"`), new Promise(r => setTimeout(r, 2500))]); } catch {}
  const c = document.createElement('canvas').getContext('2d');
  c.font = `100px ${FONT}`;
  S.cw = c.measureText('xxxxxxxxxx').width / 1000 || 0.6;
  readColors();
  trackHeader();
  loadRandom();
})();
})();