import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, COLS, ROWS, TYPES, SHAPES, LOCK_DELAY, MAX_LOCK_RESETS } from '../public/core.js';

// rng déterministe
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const fresh = (type = 'I') => {
  const g = new Game({ rng: seeded(7) });
  g.piece = { type, rot: 0, x: 3, y: 1 };
  return g;
};

test('sac de 7 : chaque tranche de 7 pièces contient les 7 formes', () => {
  const g = new Game({ rng: seeded(3) });
  const seq = [g.piece.type, ...g.next(6)];
  assert.deepEqual([...seq].sort(), [...TYPES].sort());
  for (let i = 0; i < 7; i++) g.hardDrop();
  const second = [g.piece.type, ...g.next(6)];
  assert.deepEqual([...second].sort(), [...TYPES].sort());
});

test('hardDrop sur plateau vide pose la pièce en bas', () => {
  const g = fresh('I');
  const d = g.hardDrop();
  assert.ok(d > 0);
  assert.ok(g.grid[ROWS - 1].some((c) => c === 'I'));
  assert.equal(g.score, 2 * d);
});

test('une ligne complète est effacée (100 pts au niveau 1)', () => {
  const g = fresh('I');
  for (let x = 0; x < COLS; x++) if (x < 3 || x > 6) g.grid[ROWS - 1][x] = 'O';
  g.piece = { type: 'I', rot: 0, x: 3, y: 1 };
  const d = g.hardDrop();
  assert.equal(g.lines, 1);
  assert.equal(g.score, 100 + 2 * d);
  assert.ok(g.grid[ROWS - 1].every((c) => c === null));
});

test('tetris : 4 lignes = 800, puis back-to-back x1.5', () => {
  const g = fresh('I');
  for (let y = ROWS - 4; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) g.grid[y][x] = 'O';
  g.piece = { type: 'I', rot: 1, x: COLS - 3, y: 0 }; // verticale, colonne COLS-1
  assert.ok(!g.collides(g.piece));
  const d = g.hardDrop();
  assert.equal(g.lines, 4);
  assert.equal(g.score, 800 + 2 * d);
  const before = g.score;
  for (let y = ROWS - 4; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) g.grid[y][x] = 'O';
  g.piece = { type: 'I', rot: 1, x: COLS - 3, y: 0 };
  const d2 = g.hardDrop();
  // combo = 1 -> +50*1*niveau ; b2b -> 1200
  assert.equal(g.score - before, 1200 + 50 + 2 * d2);
});

test('niveau +1 tous les 10 lignes', () => {
  const g = fresh('I');
  g.lines = 9;
  for (let x = 0; x < COLS; x++) if (x < 3 || x > 6) g.grid[ROWS - 1][x] = 'O';
  g.hardDrop();
  assert.equal(g.level, 2);
  assert.ok(g.drainEvents().some((e) => e.type === 'levelup'));
});

test('4 rotations ramènent à la forme de départ (espace libre)', () => {
  for (const t of TYPES) {
    const g = fresh(t);
    g.piece.y = 8;
    const start = JSON.stringify(g.cells().sort());
    for (let i = 0; i < 4; i++) assert.ok(t === 'O' ? !g.rotate(1) : g.rotate(1));
    assert.equal(JSON.stringify(g.cells().sort()), start, t);
  }
});

test('formes : chaque état a 4 cases', () => {
  for (const t of TYPES) for (const s of SHAPES[t]) assert.equal(s.length, 4);
});

test('wall kick : I verticale contre le mur droit', () => {
  const g = fresh('I');
  g.piece = { type: 'I', rot: 1, x: COLS - 3, y: 8 }; // colonne COLS-1
  assert.ok(g.rotate(-1));
  assert.ok(g.cells().every(([x]) => x >= 0 && x < COLS));
});

test('rotation impossible quand tout est bloqué', () => {
  const g = fresh('T');
  g.piece.y = 10;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) g.grid[y][x] = 'O';
  for (const [x, y] of g.cells()) g.grid[y][x] = null;
  const before = JSON.stringify(g.piece);
  assert.equal(g.rotate(1), false);
  assert.equal(JSON.stringify(g.piece), before);
});

test('hold : une seule fois par pièce, échange ensuite', () => {
  const g = fresh('T');
  assert.ok(g.holdPiece());
  assert.equal(g.hold, 'T');
  assert.ok(!g.holdPiece());
  g.hardDrop();
  assert.ok(g.holdPiece());
});

test('gravité : 1 case par seconde au niveau 1', () => {
  const g = fresh('T');
  const y = g.piece.y;
  g.tick(999);
  assert.equal(g.piece.y, y);
  g.tick(1);
  assert.equal(g.piece.y, y + 1);
});

test('soft drop rapporte 1 point par case', () => {
  const g = fresh('T');
  const y = g.piece.y;
  g.tick(500, true);
  assert.ok(g.piece.y > y);
  assert.equal(g.score, g.piece.y - y);
});

test('lock delay : verrouillage après 500 ms au sol, reset par mouvement (plafonné)', () => {
  const g = fresh('O');
  g.piece.y = g.piece.y + g.ghostDistance();
  g.tick(LOCK_DELAY - 1);
  assert.ok(!g.events.some((e) => e.type === 'lock'));
  g.move(1);
  g.tick(LOCK_DELAY - 1);
  assert.ok(!g.events.some((e) => e.type === 'lock'));
  g.tick(1);
  assert.ok(g.events.some((e) => e.type === 'lock'));

  const h = fresh('O');
  h.piece.y = h.piece.y + h.ghostDistance();
  for (let i = 0; i < MAX_LOCK_RESETS + 3; i++) {
    h.move(i % 2 ? -1 : 1);
    h.tick(LOCK_DELAY - 1);
  }
  assert.ok(h.events.some((e) => e.type === 'lock'), 'plafond de resets atteint');
});

test('game over quand la pièce ne peut pas apparaître', () => {
  const g = fresh('T');
  for (let y = 0; y < 4; y++) for (let x = 0; x < COLS; x++) g.grid[y][x] = 'O';
  g.spawn('T');
  assert.ok(g.over);
  assert.ok(g.drainEvents().some((e) => e.type === 'gameover'));
  assert.equal(g.move(1), false);
});

test('verrouillage entièrement dans la zone cachée = game over', () => {
  const g = fresh('O');
  for (let y = 2; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 0) g.grid[y][x] = 'O';
  for (let y = 2; y < ROWS; y++) g.grid[y][0] = 'O';
  g.piece = { type: 'O', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  assert.ok(g.over);
});

test('reset remet tout à zéro', () => {
  const g = new Game({ rng: seeded(5) });
  g.hardDrop();
  g.reset();
  assert.equal(g.score, 0);
  assert.equal(g.lines, 0);
  assert.ok(!g.over);
  assert.ok(g.grid.every((r) => r.every((c) => c === null)));
});
