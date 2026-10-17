import { Game, COLS, ROWS, HIDDEN, SHAPES } from './core.js';

const VISIBLE = ROWS - HIDDEN;
const DAS = 150; // délai avant répétition (ms)
const ARR = 40; // intervalle de répétition (ms)
const FLASH_MS = 160;

const COLORS = { I: '#4cc9f0', O: '#f9c74f', T: '#b388eb', S: '#8bd17c', Z: '#ef476f', J: '#5b7cfa', L: '#f8961e' };
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
const PALETTE = Object.fromEntries(
  Object.entries(COLORS).map(([t, base]) => [t, { base, light: shade(base, 0.35), dark: shade(base, -0.35) }]),
);

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 760px), (pointer: coarse)');

const el = {
  stage: $('stage'), frame: $('frame'), board: $('board'), hold: $('hold'), next: $('next'),
  score: $('score'), level: $('level'), lines: $('lines'), best: $('best'),
  overlay: $('overlay'), ovTitle: $('ovTitle'), ovText: $('ovText'), ovScore: $('ovScore'), ovBtn: $('ovBtn'),
  install: $('installBtn'), pause: $('pauseBtn'), live: $('live'),
};
const bctx = el.board.getContext('2d');
const hctx = el.hold.getContext('2d');
const nctx = el.next.getContext('2d');

const game = new Game();
let state = 'menu'; // menu | playing | paused | over
let best = Number(store.get('tetris.best')) || 0;
let cell = 24;
let flashes = [];
let softHeld = false;
const held = { left: false, right: false };
let lastH = null;
let repeat = 0;

// ---------- Rendu ----------
function drawCell(ctx, x, y, s, type, alpha = 1) {
  const c = PALETTE[type];
  const p = s >= 14 ? 1 : 0;
  const w = s - p * 2;
  const bevel = Math.max(1, Math.round(s * 0.12));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c.base;
  ctx.fillRect(x + p, y + p, w, w);
  ctx.fillStyle = c.light;
  ctx.fillRect(x + p, y + p, w, bevel);
  ctx.fillRect(x + p, y + p, bevel, w);
  ctx.fillStyle = c.dark;
  ctx.fillRect(x + p, y + p + w - bevel, w, bevel);
  ctx.fillRect(x + p + w - bevel, y + p, bevel, w);
  ctx.globalAlpha = 1;
}

function drawBoard() {
  const s = cell;
  const W = COLS * s;
  const H = VISIBLE * s;
  bctx.clearRect(0, 0, W, H);
  bctx.fillStyle = '#0e1422';
  bctx.fillRect(0, 0, W, H);
  bctx.strokeStyle = 'rgba(255,255,255,.045)';
  bctx.lineWidth = 1;
  bctx.beginPath();
  for (let x = 1; x < COLS; x++) { bctx.moveTo(x * s + 0.5, 0); bctx.lineTo(x * s + 0.5, H); }
  for (let y = 1; y < VISIBLE; y++) { bctx.moveTo(0, y * s + 0.5); bctx.lineTo(W, y * s + 0.5); }
  bctx.stroke();

  for (let y = HIDDEN; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = game.grid[y][x];
      if (t) drawCell(bctx, x * s, (y - HIDDEN) * s, s, t);
    }
  }

  if (state !== 'menu' && !game.over && game.piece) {
    const t = game.piece.type;
    const d = game.ghostDistance();
    if (d > 0) {
      for (const [x, y] of game.cells()) {
        if (y + d < HIDDEN) continue;
        const gx = x * s;
        const gy = (y + d - HIDDEN) * s;
        bctx.fillStyle = PALETTE[t].base;
        bctx.globalAlpha = 0.16;
        bctx.fillRect(gx + 1, gy + 1, s - 2, s - 2);
        bctx.globalAlpha = 0.7;
        bctx.strokeStyle = PALETTE[t].base;
        bctx.strokeRect(gx + 1.5, gy + 1.5, s - 3, s - 3);
        bctx.globalAlpha = 1;
      }
    }
    for (const [x, y] of game.cells()) if (y >= HIDDEN) drawCell(bctx, x * s, (y - HIDDEN) * s, s, t);
  }

  for (const f of flashes) {
    bctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - f.t / FLASH_MS)})`;
    for (const y of f.rows) if (y >= HIDDEN) bctx.fillRect(0, (y - HIDDEN) * s, W, s);
  }
}

function drawMini(ctx, canvas, types, mini) {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  types.forEach((t, i) => {
    if (!t) return;
    const cells = SHAPES[t][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const ox = (4 - w) / 2 - Math.min(...xs);
    const oy = i * 3 + (3 - h) / 2 - Math.min(...ys);
    for (const [x, y] of cells) drawCell(ctx, (x + ox) * mini, (y + oy) * mini, mini, t);
  });
}

let hudKey = '';
function renderHud() {
  const nextCount = compact.matches ? 1 : 3;
  const key = [game.score, game.level, game.lines, best, game.hold, game.canHold, game.next(nextCount).join(), cell].join('|');
  if (key === hudKey) return;
  hudKey = key;
  const fmt = (n) => n.toLocaleString('fr-FR');
  el.score.textContent = fmt(game.score);
  el.level.textContent = String(game.level);
  el.lines.textContent = String(game.lines);
  el.best.textContent = fmt(best);
  const mini = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mini')) || 22;
  drawMini(hctx, el.hold, [game.hold], mini);
  if (game.hold && !game.canHold) {
    hctx.globalCompositeOperation = 'source-atop';
    hctx.fillStyle = 'rgba(11,15,23,.55)';
    hctx.fillRect(0, 0, el.hold.width, el.hold.height);
    hctx.globalCompositeOperation = 'source-over';
  }
  drawMini(nctx, el.next, game.next(nextCount), mini);
}

function fit() {
  const r = el.stage.getBoundingClientRect();
  cell = Math.max(10, Math.floor(Math.min(r.width / COLS, r.height / VISIBLE)));
  const dpr = devicePixelRatio || 1;
  const w = cell * COLS;
  const h = cell * VISIBLE;
  el.board.width = w * dpr; el.board.height = h * dpr;
  el.board.style.width = `${w}px`; el.board.style.height = `${h}px`;
  el.frame.style.width = `${w}px`; el.frame.style.height = `${h}px`;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mini = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mini')) || 22;
  const n = compact.matches ? 1 : 3;
  for (const [c, rows] of [[el.hold, 3], [el.next, 3 * n]]) {
    c.width = 4 * mini * dpr; c.height = rows * mini * dpr;
    c.style.width = `${4 * mini}px`; c.style.height = `${rows * mini}px`;
  }
  hudKey = '';
}

// ---------- États ----------
const announce = (msg) => { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); };

function showOverlay({ title, text, score, button }) {
  el.ovTitle.textContent = title;
  el.ovText.textContent = text;
  el.ovScore.hidden = score == null;
  if (score != null) el.ovScore.textContent = score;
  el.ovBtn.textContent = button;
  el.overlay.hidden = false;
  el.ovBtn.focus({ preventScroll: true });
}
function resetInput() {
  held.left = held.right = softHeld = false;
  lastH = null;
}
function start() {
  game.reset();
  flashes = [];
  resetInput();
  state = 'playing';
  el.overlay.hidden = true;
  document.activeElement?.blur?.();
  announce('Partie lancée');
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  resetInput();
  showOverlay({ title: 'Pause', text: 'La partie est suspendue.', button: 'Reprendre' });
}
function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  el.overlay.hidden = true;
  document.activeElement?.blur?.();
}
function endGame() {
  state = 'over';
  resetInput();
  const record = game.score > best;
  if (record) { best = game.score; store.set('tetris.best', String(best)); }
  showOverlay({
    title: 'Partie terminée',
    text: record ? 'Nouveau record !' : `Meilleur score : ${best.toLocaleString('fr-FR')}`,
    score: `${game.score.toLocaleString('fr-FR')} pts · ${game.lines} lignes`,
    button: 'Rejouer',
  });
  announce(`Partie terminée. Score ${game.score}.${record ? ' Nouveau record.' : ''}`);
}
function handleEvents() {
  for (const e of game.drainEvents()) {
    if (e.type === 'clear') {
      if (!reduceMotion.matches) flashes.push({ rows: e.rows, t: 0 });
      const names = ['', 'Une ligne', 'Deux lignes', 'Trois lignes', 'Tetris !'];
      announce(`${names[e.lines]}, ${e.points} points`);
      try { navigator.vibrate?.(e.lines === 4 ? [20, 30, 40] : 15); } catch { /* ignoré */ }
    } else if (e.type === 'levelup') {
      announce(`Niveau ${e.level}`);
    } else if (e.type === 'gameover') {
      endGame();
    }
  }
}

// ---------- Entrées ----------
function press(a) {
  if (a === 'pause') { state === 'playing' ? pause() : resume(); return; }
  if (state !== 'playing') return;
  switch (a) {
    case 'left': case 'right':
      held[a] = true; lastH = a; repeat = DAS;
      game.move(a === 'left' ? -1 : 1);
      break;
    case 'down': softHeld = true; break;
    case 'rotCW': game.rotate(1); break;
    case 'rotCCW': game.rotate(-1); break;
    case 'drop': game.hardDrop(); break;
    case 'hold': game.holdPiece(); break;
  }
  handleEvents();
}
function release(a) {
  if (a === 'left' || a === 'right') {
    held[a] = false;
    if (lastH === a) { lastH = held.left ? 'left' : held.right ? 'right' : null; repeat = ARR; }
  } else if (a === 'down') softHeld = false;
}

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'rotCW', KeyX: 'rotCW', KeyW: 'rotCW', KeyZ: 'rotCCW', Space: 'drop',
  KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold', KeyP: 'pause', Escape: 'pause',
};
addEventListener('keydown', (e) => {
  const a = KEYS[e.code];
  if (!a || e.ctrlKey || e.metaKey || e.altKey) return;
  if (state === 'playing') { e.preventDefault(); if (!e.repeat) press(a); return; }
  if (state === 'paused' && a === 'pause') { e.preventDefault(); resume(); }
});
addEventListener('keyup', (e) => { const a = KEYS[e.code]; if (a) release(a); });

for (const b of document.querySelectorAll('#touch [data-act]')) {
  const a = b.dataset.act;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); press(a); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => release(a));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
el.ovBtn.addEventListener('click', () => (state === 'paused' ? resume() : start()));
el.pause.addEventListener('click', () => { press('pause'); el.pause.blur(); });

// Pause automatique si on quitte la page
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', pause);

// Installation PWA
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; el.install.hidden = false; });
addEventListener('appinstalled', () => { deferredInstall = null; el.install.hidden = true; });
el.install.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  el.install.hidden = true;
});

// ---------- Boucle ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (state === 'playing') {
    const h = lastH && held[lastH] ? lastH : null;
    if (h) {
      repeat -= dt;
      while (repeat <= 0) {
        if (!game.move(h === 'left' ? -1 : 1)) { repeat = ARR; break; }
        repeat += ARR;
      }
    }
    game.tick(dt, softHeld);
    handleEvents();
  }
  for (const f of flashes) f.t += dt;
  flashes = flashes.filter((f) => f.t < FLASH_MS);
  drawBoard();
  renderHud();
  requestAnimationFrame(frame);
}

new ResizeObserver(fit).observe(el.stage);
compact.addEventListener('change', fit);
fit();
showOverlay({ title: 'Tetris', text: 'Empile les pièces, complète des lignes.', button: 'Jouer' });
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
if (location.hash === '#debug') window.__tetris = { game, get state() { return state; } };
