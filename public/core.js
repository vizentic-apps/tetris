// Moteur Tetris : logique pure, sans DOM. Règles inspirées du guideline moderne
// (SRS, sac de 7, hold, ghost, lock delay). Pas de T-spin.

export const COLS = 10;
export const ROWS = 22; // 20 visibles + 2 zone cachée au-dessus
export const HIDDEN = 2;
export const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const LOCK_DELAY = 500;
export const MAX_LOCK_RESETS = 15;

const BASE = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

const rotateCW = (m) => m.map((_, y) => m.map((__, x) => m[m.length - 1 - x][y]));
const toCells = (m) => m.flatMap((row, y) => row.flatMap((v, x) => (v ? [[x, y]] : [])));

/** SHAPES[type][rot] = liste de [x, y] relatifs au coin haut-gauche de la boîte. */
export const SHAPES = Object.fromEntries(
  TYPES.map((t) => {
    const states = [BASE[t]];
    if (t !== 'O') for (let i = 1; i < 4; i++) states.push(rotateCW(states[i - 1]));
    else for (let i = 1; i < 4; i++) states.push(BASE[t]);
    return [t, states.map(toCells)];
  }),
);

// Tables de kicks SRS (x vers la droite, y vers le haut).
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const LINE_POINTS = [0, 100, 300, 500, 800];

/** Durée (ms) d'une case de chute naturelle au niveau donné. */
export const gravityMs = (level) =>
  Math.max(16, Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000);

export class Game {
  constructor({ rng = Math.random, startLevel = 1 } = {}) {
    this.rng = rng;
    this.startLevel = startLevel;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.queue = [];
    this.score = 0;
    this.lines = 0;
    this.level = this.startLevel;
    this.combo = -1;
    this.b2b = false;
    this.hold = null;
    this.canHold = true;
    this.over = false;
    this.events = [];
    this.piece = null;
    this.spawn();
  }

  // --- file de pièces (sac de 7) ---
  #refill() {
    while (this.queue.length < 7) {
      const bag = [...TYPES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.queue.push(...bag);
    }
  }
  next(n = 3) {
    this.#refill();
    return this.queue.slice(0, n);
  }

  spawn(type) {
    if (!type) {
      this.#refill();
      type = this.queue.shift();
    }
    // la 1re rangée occupée de la forme apparaît sur la 1re ligne visible
    this.piece = { type, rot: 0, x: 3, y: type === 'I' ? 1 : HIDDEN };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    if (this.collides(this.piece)) {
      this.over = true;
      this.events.push({ type: 'gameover' });
    }
  }

  // --- géométrie ---
  cells(p = this.piece) {
    return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy]);
  }
  collides(p) {
    return this.cells(p).some(
      ([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && this.grid[y][x] !== null),
    );
  }
  canDown() {
    return !this.collides({ ...this.piece, y: this.piece.y + 1 });
  }
  isGrounded() {
    return !this.canDown();
  }
  ghostDistance() {
    let d = 0;
    while (!this.collides({ ...this.piece, y: this.piece.y + d + 1 })) d++;
    return d;
  }

  // --- actions ---
  #moved() {
    if (this.isGrounded()) {
      if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockTimer = 0;
        this.lockResets++;
      }
    } else {
      this.lockTimer = 0;
    }
  }
  move(dx) {
    if (this.over) return false;
    const np = { ...this.piece, x: this.piece.x + dx };
    if (this.collides(np)) return false;
    this.piece = np;
    this.#moved();
    return true;
  }
  rotate(dir) {
    if (this.over || this.piece.type === 'O') return false;
    const from = this.piece.rot;
    const to = (from + dir + 4) % 4;
    const table = this.piece.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    for (const [dx, dy] of table[`${from}>${to}`]) {
      const np = { ...this.piece, rot: to, x: this.piece.x + dx, y: this.piece.y - dy };
      if (!this.collides(np)) {
        this.piece = np;
        this.#moved();
        return true;
      }
    }
    return false;
  }
  hardDrop() {
    if (this.over) return 0;
    const d = this.ghostDistance();
    this.piece = { ...this.piece, y: this.piece.y + d };
    this.score += 2 * d;
    this.#lock();
    return d;
  }
  holdPiece() {
    if (this.over || !this.canHold) return false;
    const cur = this.piece.type;
    const stored = this.hold;
    this.hold = cur;
    this.spawn(stored ?? undefined);
    this.canHold = false;
    this.events.push({ type: 'hold' });
    return true;
  }

  /** Avance le temps. `soft` = chute accélérée (1 point par case). */
  tick(dt, soft = false) {
    if (this.over) return;
    const base = gravityMs(this.level);
    const interval = soft ? Math.min(base, Math.max(base / 20, 18)) : base;
    this.gravityAcc += dt;
    while (this.gravityAcc >= interval) {
      if (this.canDown()) {
        this.piece = { ...this.piece, y: this.piece.y + 1 };
        if (soft) this.score += 1;
        this.gravityAcc -= interval;
      } else {
        this.gravityAcc = 0;
        break;
      }
    }
    if (this.isGrounded()) {
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.#lock();
    } else {
      this.lockTimer = 0;
    }
  }

  #lock() {
    const placed = this.cells();
    for (const [x, y] of placed) if (y >= 0) this.grid[y][x] = this.piece.type;
    this.events.push({ type: 'lock' });
    if (placed.every(([, y]) => y < HIDDEN)) {
      this.over = true;
      this.events.push({ type: 'gameover' });
      return;
    }
    const rows = [];
    for (let y = 0; y < ROWS; y++) if (this.grid[y].every((c) => c !== null)) rows.push(y);
    const n = rows.length;
    if (n > 0) {
      this.grid = [
        ...Array.from({ length: n }, () => Array(COLS).fill(null)),
        ...this.grid.filter((_, y) => !rows.includes(y)),
      ];
      this.combo++;
      let points = LINE_POINTS[n] * this.level;
      if (n === 4 && this.b2b) points = Math.floor(points * 1.5);
      if (this.combo > 0) points += 50 * this.combo * this.level;
      this.b2b = n === 4;
      this.score += points;
      this.lines += n;
      const level = this.startLevel + Math.floor(this.lines / 10);
      this.events.push({ type: 'clear', rows, lines: n, points, combo: this.combo });
      if (level > this.level) {
        this.level = level;
        this.events.push({ type: 'levelup', level });
      }
    } else {
      this.combo = -1;
    }
    this.canHold = true;
    this.spawn();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
