/*
 NeoChessBoard.js — a modern, canvas‑based chessboard library
 (c) 2025 — MIT License

 Goals
 - Chessbook‑like look & feel: flat modern board, smooth 60fps moves, arrows, highlights
 - Zero deps. Easy to drop‑in: <script type="module"> import NeoChessBoard from './NeoChessBoard.js'
 - Fast: layered canvases, offscreen sprites, devicePixelRatio aware
 - Pluggable rules: works great with chess.js / chessops if present; includes a light fallback

 Usage (ESM)
   import { Chessboard } from './NeoChessBoard.js';
   const board = new Chessboard('#board', { theme: 'midnight', interactive: true });
   board.setPosition(Chessboard.FEN.start);
   board.on('move', e => console.log(e));

 If window.Chess (chess.js) is present, rules & legality are automatic.
 Otherwise, a LightRules fallback allows basic movement + castle/promo (no check validation).
*/

export class EventBus {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const s = this.map.get(type);
    if (s) s.delete(fn);
  }
  emit(type, payload) {
    const s = this.map.get(type);
    if (!s) return;
    for (const fn of s)
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
  }
}

// ---------- Utilities ----------
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const now = () => performance.now();

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const isWhitePiece = (p) => p && p === p.toUpperCase();

// Piece letters FEN => type
// White: K Q R B N P; Black: k q r b n p
const PIECES = ["k", "q", "r", "b", "n", "p", "K", "Q", "R", "B", "N", "P"];

// ---------- FEN parsing / board state ----------
function parseFEN(fen) {
  // Very lenient parser; expects spaces and fields
  const parts = fen.trim().split(/\s+/);
  const boardPart = parts[0];
  const turn = parts[1] || "w";
  const castling = parts[2] || "-";
  const ep = parts[3] || "-";
  const halfmove = parseInt(parts[4] || "0", 10);
  const fullmove = parseInt(parts[5] || "1", 10);
  const rows = boardPart.split("/");
  const board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[7 - r]) {
      // FEN ranks 8..1, we store board[rank][file] with rank 0=1st rank
      if (/[1-8]/.test(ch)) c += parseInt(ch, 10);
      else {
        board[r][c] = ch;
        c++;
      }
    }
  }
  return { board, turn, castling, ep, halfmove, fullmove };
}

function boardToFEN(state) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let s = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r][f];
      if (!p) empty++;
      else {
        if (empty) {
          s += String(empty);
          empty = 0;
        }
        s += p;
      }
    }
    if (empty) s += String(empty);
    rows.push(s);
  }
  return `${rows.join("/")} ${state.turn} ${state.castling || "-"} ${state.ep || "-"} ${state.halfmove || 0} ${
    state.fullmove || 1
  }`;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------- LightRules (fallback) ----------
// Minimal rules: piece moves (no check validation), basic castling, pawn double, captures, en passant (simple), promotion
// For production legality, inject chess.js via options.rulesAdapter or include window.Chess.
class LightRules {
  constructor(fen = START_FEN) {
    this.state = parseFEN(fen);
  }
  clone() {
    const c = new LightRules();
    c.state = JSON.parse(JSON.stringify(this.state));
    return c;
  }
  getFEN() {
    return boardToFEN(this.state);
  }
  setFEN(f) {
    this.state = parseFEN(f);
  }
  pieceAt(square) {
    const { f, r } = sqToFR(square);
    return this.state.board[r][f];
  }
  turn() {
    return this.state.turn;
  }
  // Generate pseudo-legal moves for UI dots (not exhaustive but decent)
  movesFrom(square) {
    const p = this.pieceAt(square);
    if (!p) return [];
    const isW = isWhitePiece(p);
    const me = isW ? "w" : "b";
    if (me !== this.state.turn) return [];
    const { f, r } = sqToFR(square);
    const add = (F, R) => {
      if (F < 0 || F > 7 || R < 0 || R > 7) return null;
      return { f: F, r: R };
    };
    const occ = (F, R) => this.state.board[R][F];
    const enemy = (pp) => pp && isWhitePiece(pp) !== isW;
    const pushes = [];
    switch (p.toLowerCase()) {
      case "p": {
        const dir = isW ? 1 : -1; // r increasing towards rank 8
        const startRank = isW ? 1 : 6;
        // one step
        if (!occ(f, r + dir)) pushes.push({ f, r: r + dir });
        // two steps
        if (r === startRank && !occ(f, r + dir) && !occ(f, r + 2 * dir)) pushes.push({ f, r: r + 2 * dir });
        // captures
        for (const df of [-1, 1]) {
          const F = f + df,
            R = r + dir;
          if (F >= 0 && F < 8 && R >= 0 && R < 8) {
            const t = occ(F, R);
            if (t && enemy(t)) pushes.push({ f: F, r: R });
          }
        }
        // en passant simple (from ep square)
        if (this.state.ep && this.state.ep !== "-") {
          const { f: ef, r: er } = sqToFR(this.state.ep);
          if (er === r + dir && Math.abs(ef - f) === 1) pushes.push({ f: ef, r: er, ep: true });
        }
        break;
      }
      case "n":
        for (const [df, dr] of [
          [1, 2],
          [2, 1],
          [-1, 2],
          [-2, 1],
          [1, -2],
          [2, -1],
          [-1, -2],
          [-2, -1],
        ]) {
          const F = f + df,
            R = r + dr;
          if (F < 0 || F > 7 || R < 0 || R > 7) continue;
          const t = occ(F, R);
          if (!t || enemy(t)) pushes.push({ f: F, r: R });
        }
        break;
      case "b":
        ray(f, r, [1, 1]);
        ray(f, r, [-1, 1]);
        ray(f, r, [1, -1]);
        ray(f, r, [-1, -1]);
        break;
      case "r":
        ray(f, r, [1, 0]);
        ray(f, r, [-1, 0]);
        ray(f, r, [0, 1]);
        ray(f, r, [0, -1]);
        break;
      case "q":
        ray(f, r, [1, 0]);
        ray(f, r, [-1, 0]);
        ray(f, r, [0, 1]);
        ray(f, r, [0, -1]);
        ray(f, r, [1, 1]);
        ray(f, r, [-1, 1]);
        ray(f, r, [1, -1]);
        ray(f, r, [-1, -1]);
        break;
      case "k": {
        for (let df = -1; df <= 1; df++)
          for (let dr = -1; dr <= 1; dr++)
            if (df || dr) {
              const F = f + df,
                R = r + dr;
              if (F < 0 || F > 7 || R < 0 || R > 7) continue;
              const t = occ(F, R);
              if (!t || enemy(t)) pushes.push({ f: F, r: R });
            }
        // castling naive (no check validation)
        if ((isW && this.state.castling.includes("K")) || (!isW && this.state.castling.includes("k"))) {
          if (!occ(5, r) && !occ(6, r)) pushes.push({ f: 6, r, castle: "K" });
        }
        if ((isW && this.state.castling.includes("Q")) || (!isW && this.state.castling.includes("q"))) {
          if (!occ(1, r) && !occ(2, r) && !occ(3, r)) pushes.push({ f: 2, r, castle: "Q" });
        }
        break;
      }
    }
    function ray(f0, r0, [df, dr]) {
      let F = f0 + df,
        R = r0 + dr;
      while (F >= 0 && F < 8 && R >= 0 && R < 8) {
        const t = occ(F, R);
        if (!t) {
          pushes.push({ f: F, r: R });
        } else {
          if (enemy(t)) pushes.push({ f: F, r: R });
          break;
        }
        F += df;
        R += dr;
      }
    }
    return pushes.map(({ f: rF, r: rR, ...rest }) => ({ from: sq(f, r), to: sq(rF, rR), ...rest }));
  }
  move({ from, to, promotion }) {
    const s = this.clone();
    const a = sqToFR(from),
      b = sqToFR(to);
    const p = s.state.board[a.r][a.f];
    if (!p) return { ok: false, reason: "empty" };
    const isW = isWhitePiece(p);
    if ((isW && s.state.turn !== "w") || (!isW && s.state.turn !== "b")) return { ok: false, reason: "turn" };
    const moves = this.movesFrom(from);
    const mv = moves.find((m) => m.to === to);
    if (!mv) return { ok: false, reason: "illegal" };
    // Handle en passant capture
    if (mv.ep) {
      const dir = isW ? 1 : -1;
      s.state.board[b.r - dir][b.f] = null;
    }
    // Move piece
    s.state.board[b.r][b.f] = p;
    s.state.board[a.r][a.f] = null;
    // Pawn promotion
    if (p.toLowerCase() === "p" && (b.r === 7 || b.r === 0)) {
      const promo = promotion || "q";
      s.state.board[b.r][b.f] = isW ? promo.toUpperCase() : promo.toLowerCase();
    }
    // Castling rook move
    if (p.toLowerCase() === "k" && Math.abs(b.f - a.f) === 2) {
      // castle
      if (b.f === 6) {
        // king side
        s.state.board[a.r][5] = s.state.board[a.r][7];
        s.state.board[a.r][7] = null;
      } else if (b.f === 2) {
        // queen side
        s.state.board[a.r][3] = s.state.board[a.r][0];
        s.state.board[a.r][0] = null;
      }
      // remove castling rights for that color
      if (isW) s.state.castling = (s.state.castling || "").replace("K", "").replace("Q", "");
      else s.state.castling = (s.state.castling || "").replace("k", "").replace("q", "");
    }
    // Update EP square
    s.state.ep = "-";
    if (p.toLowerCase() === "p" && Math.abs(b.r - a.r) === 2) {
      const dir = isW ? 1 : -1;
      s.state.ep = sq(a.f, a.r + dir);
    }
    // Turn & counters
    s.state.turn = s.state.turn === "w" ? "b" : "w";
    s.state.halfmove = p.toLowerCase() === "p" || mv.captured ? 0 : (s.state.halfmove || 0) + 1;
    if (s.state.turn === "w") s.state.fullmove = (s.state.fullmove || 1) + 1;
    const before = boardToArr(this.state.board);
    const after = boardToArr(s.state.board);
    return {
      ok: true,
      state: s.state,
      fen: s.getFEN(),
      move: { from, to, piece: p, captured: mv.captured || null, before, after },
    };
  }
}

function boardToArr(board) {
  const arr = [];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p) arr.push({ square: sq(f, r), piece: p });
    }
  return arr;
}

function sq(file, rank) {
  return FILES[file] + RANKS[rank];
}
function sqToFR(square) {
  const f = FILES.indexOf(square[0]);
  const r = RANKS.indexOf(square[1]);
  return { f, r };
}

// ---------- Drawing: modern flat pieces (canvas)
// We rasterize programmatically to an offscreen spritesheet for perf.
class FlatSprites {
  rr(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
  constructor(size, colors) {
    this.size = size;
    this.colors = colors;
    this.cache = new Map();
    this.sheet = this._buildSheet(size);
  }
  key(size) {
    return `${size}`;
  }
  _buildSheet(size) {
    const px = size; // each sprite is size x size
    const sheet =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(px * 6, px * 2)
        : (() => {
            const c = document.createElement("canvas");
            c.width = px * 6;
            c.height = px * 2;
            return c;
          })(); // order: kqrbnp (row 0 black, row1 white)
    const ctx = sheet.getContext("2d");
    const order = ["k", "q", "r", "b", "n", "p"];
    order.forEach((t, i) => {
      this._drawPiece(ctx, i * px, 0, px, t, "black");
      this._drawPiece(ctx, i * px, px, px, t, "white");
    });
    return sheet;
  }
  _drawPiece(ctx, x, y, s, type, color) {
    const C = color === "white" ? this.colors.whitePiece : this.colors.blackPiece;
    const S = this.colors.pieceShadow;
    ctx.save();
    ctx.translate(x, y);
    // Shadow
    ctx.fillStyle = S;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.68, s * 0.28, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    switch (type) {
      case "p":
        this._pawn(ctx, s);
        break;
      case "r":
        this._rook(ctx, s);
        break;
      case "n":
        this._knight(ctx, s);
        break;
      case "b":
        this._bishop(ctx, s);
        break;
      case "q":
        this._queen(ctx, s);
        break;
      case "k":
        this._king(ctx, s);
        break;
    }
    ctx.restore();
  }
  _base(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.7);
    ctx.quadraticCurveTo(s * 0.5, s * 0.6, s * 0.8, s * 0.7);
    ctx.lineTo(s * 0.8, s * 0.8);
    ctx.quadraticCurveTo(s * 0.5, s * 0.85, s * 0.2, s * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  _pawn(ctx, s) {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.38, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.38, s * 0.52);
    ctx.quadraticCurveTo(s * 0.5, s * 0.42, s * 0.62, s * 0.52);
    ctx.quadraticCurveTo(s * 0.64, s * 0.6, s * 0.5, s * 0.62);
    ctx.quadraticCurveTo(s * 0.36, s * 0.6, s * 0.38, s * 0.52);
    ctx.closePath();
    ctx.fill();
    this._base(ctx, s);
  }
  _rook(ctx, s) {
    // tower
    ctx.beginPath();
    this.rr(ctx, s * 0.32, s * 0.3, s * 0.36, s * 0.34, s * 0.04);
    ctx.fill();
    // crenels
    ctx.beginPath();
    this.rr(ctx, s * 0.3, s * 0.22, s * 0.12, s * 0.1, s * 0.02);
    ctx.fill();
    ctx.beginPath();
    this.rr(ctx, s * 0.44, s * 0.2, s * 0.12, s * 0.12, s * 0.02);
    ctx.fill();
    ctx.beginPath();
    this.rr(ctx, s * 0.58, s * 0.22, s * 0.12, s * 0.1, s * 0.02);
    ctx.fill();
    this._base(ctx, s);
  }
  _bishop(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.42, s * 0.12, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // mitre slot
    const C = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.28);
    ctx.lineTo(s * 0.5, s * 0.52);
    ctx.lineWidth = s * 0.04;
    ctx.stroke();
    ctx.globalCompositeOperation = C;
    this._base(ctx, s);
  }
  _knight(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.64, s * 0.6);
    ctx.quadraticCurveTo(s * 0.7, s * 0.35, s * 0.54, s * 0.28);
    ctx.quadraticCurveTo(s * 0.46, s * 0.24, s * 0.44, s * 0.3);
    ctx.quadraticCurveTo(s * 0.42, s * 0.42, s * 0.34, s * 0.44);
    ctx.quadraticCurveTo(s * 0.3, s * 0.46, s * 0.28, s * 0.5);
    ctx.quadraticCurveTo(s * 0.26, s * 0.6, s * 0.38, s * 0.62);
    ctx.closePath();
    ctx.fill();
    // eye
    const C = ctx.fillStyle;
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.36, s * 0.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C;
    this._base(ctx, s);
  }
  _queen(ctx, s) {
    // crown
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.3);
    ctx.lineTo(s * 0.4, s * 0.18);
    ctx.lineTo(s * 0.5, s * 0.3);
    ctx.lineTo(s * 0.6, s * 0.18);
    ctx.lineTo(s * 0.7, s * 0.3);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.5, s * 0.16, s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    this._base(ctx, s);
  }
  _king(ctx, s) {
    // cross
    ctx.beginPath();
    this.rr(ctx, s * 0.47, s * 0.16, s * 0.06, s * 0.16, s * 0.02);
    ctx.fill();
    ctx.beginPath();
    this.rr(ctx, s * 0.4, s * 0.22, s * 0.2, s * 0.06, s * 0.02);
    ctx.fill();
    // body
    ctx.beginPath();
    this.rr(ctx, s * 0.36, s * 0.34, s * 0.28, s * 0.26, s * 0.08);
    ctx.fill();
    this._base(ctx, s);
  }
}

// Colors & themes
const THEMES = {
  classic: {
    light: "#EBEDF0",
    dark: "#B3C0CE",
    boardBorder: "#0F172A0F",
    whitePiece: "#f8fafc",
    blackPiece: "#0f172a",
    pieceShadow: "rgba(0,0,0,0.15)",
    moveFrom: "rgba(250, 204, 21, 0.55)",
    moveTo: "rgba(34,197,94,0.45)",
    lastMove: "rgba(59,130,246,0.35)",
    premove: "rgba(147,51,234,0.35)",
    dot: "rgba(2,6,23,0.35)",
    arrow: "rgba(34,197,94,0.9)",
  },
  midnight: {
    light: "#2A2F3A",
    dark: "#1F242E",
    boardBorder: "#00000026",
    whitePiece: "#E6E8EC",
    blackPiece: "#111418",
    pieceShadow: "rgba(0,0,0,0.25)",
    moveFrom: "rgba(250, 204, 21, 0.4)",
    moveTo: "rgba(34,197,94,0.35)",
    lastMove: "rgba(59,130,246,0.3)",
    premove: "rgba(147,51,234,0.30)",
    dot: "rgba(255,255,255,0.35)",
    arrow: "rgba(59,130,246,0.9)",
  },
};

// ---------- Main Chessboard ----------
export class Chessboard {
  // Public overlay API
  addArrow(from, to, color) {
    if (!this._arrows) this._arrows = [];
    this._arrows.push({ from, to, color });
    this._drawOverlay();
  }
  clearArrows() {
    this._arrows = [];
    this._drawOverlay();
  }
  highlightSquares(squares, style = "fromTo") {
    this._customHighlights = { squares, style };
    this._drawOverlay();
  }
  clearHighlights() {
    this._customHighlights = null;
    this._drawOverlay();
  }

  static FEN = { start: START_FEN };
  constructor(root, opts = {}) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.root) throw new Error("Root element not found");

    // Options
    this.size = opts.size || 480;
    this.orientation = opts.orientation || "white"; // 'white' bottom or 'black'
    this.interactive = opts.interactive !== false; // default true
    this.themeName = opts.theme || "midnight";
    this.theme = { ...THEMES[this.themeName] };
    this.showCoords = opts.showCoordinates ?? true;
    this.animationMs = opts.animationMs || 150;
    this.highlightLegal = opts.highlightLegal ?? true;

    // Rules adapter
    if (opts.rulesAdapter) this.rules = opts.rulesAdapter;
    else if (typeof window !== "undefined" && window.Chess) {
      const game = new window.Chess();
      this.rules = {
        setFEN: (f) => game.load(f),
        getFEN: () => game.fen(),
        turn: () => game.turn(),
        movesFrom: (sq) =>
          game
            .moves({ square: sq, verbose: true })
            .map((m) => ({ from: m.from, to: m.to, promotion: m.promotion, captured: m.captured })),
        move: ({ from, to, promotion }) => {
          const res = game.move({ from, to, promotion: promotion || "q" });
          if (!res) return { ok: false, reason: "illegal" };
          return { ok: true, fen: game.fen(), move: res, state: null };
        },
      };
      this._usingChessJS = true;
    } else {
      console.warn("[NCB] chess.js not found. Using light rules (no check/mate validation).");
      this.rules = new LightRules();
    }

    // State
    this.state = parseFEN(START_FEN);
    this.bus = new EventBus();
    this._arrows = [];
    this._highlights = []; // for right-click highlights
    this._customHighlights = null;
    this._lastMove = null;
    this._premove = null;
    this._dragging = null;
    this._drawingState = null; // For right-click drawings
    this._hoverSq = null;
    this._selected = null;
    this._legalCached = null;

    // DOM & canvases
    this._buildDOM();
    this._attachEvents();
    this.setPosition(opts.fen || START_FEN, { immediate: true });
    this.resize();
  }

  on(type, fn) {
    return this.bus.on(type, fn);
  }

  destroy() {
    this._removeEvents();
    this.root.innerHTML = "";
  }

  setTheme(name) {
    if (!THEMES[name]) return;
    this.themeName = name;
    this.theme = { ...THEMES[name] };
    this._rasterize();
    this.renderAll();
  }

  setOrientation(o) {
    this.orientation = o === "black" ? "black" : "white";
    this.renderAll();
  }

  flip() {
    this.setOrientation(this.orientation === "white" ? "black" : "white");
  }

  getPosition() {
    return boardToFEN(this.state);
  }

  // Programmatic move with animation
  move(from, to, promotion = "q") {
    const res = this.rules.move({ from, to, promotion });
    if (res && res.ok) {
      const oldState = JSON.parse(JSON.stringify(this.state));
      const newFen = this._usingChessJS ? this.rules.getFEN() : res.fen;
      const newState = parseFEN(newFen);
      this._lastMove = { from, to };
      this.state = newState; // Update state immediately
      this.rules.setFEN(newFen);
      this._animateTo(newState, oldState);
      this.bus.emit("move", { from, to, fen: newFen });
      return true;
    } else {
      this.bus.emit("illegal", { from, to, reason: res?.reason || "illegal" });
      return false;
    }
  }

  _checkAndPlayPremove() {
    if (!this._premove) return;
    const { from, to } = this._premove;
    const piece = this._pieceAt(from);
    if (!piece) {
      this._premove = null;
      this.renderAll(); // Redraw to clear premove highlight
      return;
    }
    const side = isWhitePiece(piece) ? "w" : "b";
    if (side === this.state.turn) {
      const premoveToPlay = this._premove;
      this._premove = null; // Clear before moving to avoid loops
      if (!this.move(premoveToPlay.from, premoveToPlay.to)) {
        // Premove was illegal (e.g. king is in check). Clear and redraw.
        this.renderAll();
      }
    }
  }

  setPosition(fen, { immediate = false } = {}) {
    const oldState = JSON.parse(JSON.stringify(this.state));
    this.rules.setFEN(fen);
    this.state = parseFEN(this.rules.getFEN());
    this._lastMove = null;
    this._premove = null;

    if (immediate) {
      this._clearAnim();
      this.renderAll();
    } else {
      // Animate from old to new.
      this._animateTo(this.state, oldState);
    }
    this.bus.emit("update", { fen: this.getPosition() });
  }

  // ---------- DOM ----------
  _buildDOM() {
    this.root.classList.add("ncb-root");
    this.root.style.position = "relative";
    this.root.style.userSelect = "none";
    this.root.style.width = this.size + "px";
    this.root.style.height = this.size + "px";

    // Layers: board, pieces, overlay
    this.cBoard = document.createElement("canvas");
    this.cPieces = document.createElement("canvas");
    this.cOverlay = document.createElement("canvas");
    for (const c of [this.cBoard, this.cPieces, this.cOverlay]) {
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      this.root.appendChild(c);
    }

    this.ctxB = this.cBoard.getContext("2d");
    this.ctxP = this.cPieces.getContext("2d");
    this.ctxO = this.cOverlay.getContext("2d");

    // Sprites
    this._rasterize();

    // Resize observer for responsive containers
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.root);
  }

  resize() {
    const rect = this.root.getBoundingClientRect();
    const sz = Math.min(rect.width, rect.height);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.cBoard, this.cPieces, this.cOverlay]) {
      c.width = Math.round(sz * dpr);
      c.height = Math.round(sz * dpr);
    }
    this.sizePx = sz;
    this.square = (sz * dpr) / 8;
    this.dpr = dpr;
    this.renderAll();
  }

  _rasterize() {
    this.sprites = new FlatSprites(128, this.theme); // base 128 then scaled
  }

  // ---------- Rendering ----------
  renderAll() {
    this._drawBoard();
    this._drawPieces();
    this._drawOverlay();
  }

  _sqToXY(square) {
    const { f, r } = sqToFR(square);
    const ff = this.orientation === "white" ? f : 7 - f; // file on canvas
    const rr = this.orientation === "white" ? 7 - r : r; // rank on canvas (y-coord)
    return { x: ff * this.square, y: rr * this.square };
  }

  _drawBoard() {
    const ctx = this.ctxB;
    const s = this.square;
    const { light, dark, boardBorder } = this.theme; // a1 is light with (r+f)%2===0
    const W = this.cBoard.width,
      H = this.cBoard.height;
    ctx.clearRect(0, 0, W, H);
    // Border glow
    ctx.fillStyle = boardBorder;
    ctx.fillRect(0, 0, W, H);
    // Grid
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const x = (this.orientation === "white" ? f : 7 - f) * s; // canvas x from board file
        const y = (this.orientation === "white" ? 7 - r : r) * s; // canvas y from board rank
        ctx.fillStyle = (r + f) % 2 === 0 ? light : dark;
        ctx.fillRect(x, y, s, s);
      }
    // Coordinates
    if (this.showCoords) {
      ctx.save();
      ctx.font = `${Math.floor(s * 0.18)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (let f = 0; f < 8; f++) {
        const file = this.orientation === "white" ? FILES[f] : FILES[7 - f];
        ctx.fillText(file, f * s + s * 0.06, H - s * 0.06);
      }
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      for (let r = 0; r < 8; r++) {
        const rank = this.orientation === "white" ? RANKS[7 - r] : RANKS[r];
        ctx.fillText(rank, s * 0.94, r * s + s * 0.06);
      }
      ctx.restore();
    }
  }

  _drawPieceSprite(ctx, piece, x, y, scale = 1) {
    // Map piece to spritesheet index
    const map = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 };
    const isW = isWhitePiece(piece);
    const idx = map[piece.toLowerCase()];
    const s128 = 128;
    const sx = idx * s128;
    const sy = isW ? s128 : 0;
    const size = this.square;
    const drawS = Math.min(this.square, this.square); // full square
    const d = drawS * scale;
    const dx = x + (this.square - d) / 2;
    const dy = y + (this.square - d) / 2;
    this.ctxP.drawImage(this.sprites.sheet, sx, sy, s128, s128, dx, dy, d, d);
  }

  _drawPieces() {
    const ctx = this.ctxP;
    const W = this.cPieces.width,
      H = this.cPieces.height;
    ctx.clearRect(0, 0, W, H);
    // Draw all except the dragging one
    const draggingSq = this._dragging?.from;
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const p = this.state.board[r][f];
        if (!p) continue;
        const square = sq(f, r);
        if (draggingSq === square) continue;
        const { x, y } = this._sqToXY(square);
        this._drawPieceSprite(ctx, p, x, y, 1.0);
      }
    // Dragging piece on top
    if (this._dragging) {
      const { piece, x, y } = this._dragging;
      this._drawPieceSprite(ctx, piece, x - this.square / 2, y - this.square / 2, 1.05);
    }
  }

  _drawOverlay() {
    const ctx = this.ctxO;
    const W = this.cOverlay.width,
      H = this.cOverlay.height;
    ctx.clearRect(0, 0, W, H);

    // Draw temporary arrow for right-click drag
    if (this._drawingState && this._drawingState.to) {
      const startCoords = this._sqToXY(this._drawingState.from);
      const fromX = startCoords.x + this.square / 2;
      const fromY = startCoords.y + this.square / 2;
      const { x: toX, y: toY } = this._drawingState.to;
      this._drawArrowBetweenPoints(ctx, fromX, fromY, toX, toY, this.theme.arrow);
    }

    const s = this.square;

    // Last move highlight
    if (this._lastMove) {
      const { from, to } = this._lastMove;
      const A = this._sqToXY(from),
        B = this._sqToXY(to);
      ctx.fillStyle = this.theme.lastMove;
      ctx.fillRect(A.x, A.y, s, s);
      ctx.fillRect(B.x, B.y, s, s);
    }

    // Custom highlights
    if (this._customHighlights && this._customHighlights.squares) {
      const col = this.theme.moveTo;
      ctx.fillStyle = col;
      for (const sqr of this._customHighlights.squares) {
        const B = this._sqToXY(sqr);
        ctx.fillRect(B.x, B.y, s, s);
      }
    }

    // Selection & legal dots
    if (this._selected) {
      const A = this._sqToXY(this._selected);
      ctx.fillStyle = this.theme.moveFrom;
      ctx.fillRect(A.x, A.y, s, s);
      if (this.highlightLegal && this._legalCached) {
        ctx.fillStyle = this.theme.dot;
        for (const m of this._legalCached) {
          const B = this._sqToXY(m.to);
          ctx.beginPath();
          ctx.arc(B.x + s / 2, B.y + s / 2, s * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Arrows
    for (const a of this._arrows) {
      this._drawArrow(a.from, a.to, a.color || this.theme.arrow);
    }

    // Highlights from right-click
    ctx.fillStyle = this.theme.moveTo;
    for (const sq of this._highlights) {
      const { x, y } = this._sqToXY(sq);
      ctx.fillRect(x, y, s, s);
    }

    // Premove squares
    if (this._premove) {
      const A = this._sqToXY(this._premove.from),
        B = this._sqToXY(this._premove.to);
      ctx.fillStyle = this.theme.premove;
      ctx.fillRect(A.x, A.y, s, s);
      ctx.fillRect(B.x, B.y, s, s);
    }

    // Drop target
    if (this._hoverSq && this._dragging) {
      const B = this._sqToXY(this._hoverSq);
      ctx.fillStyle = this.theme.moveTo;
      ctx.fillRect(B.x, B.y, s, s);
    }
  }

  _drawArrowBetweenPoints(ctx, fromX, fromY, toX, toY, color) {
    const dx = toX - fromX,
      dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len,
      uy = dy / len;
    const head = Math.min(16 * this.dpr, len * 0.25);
    const thick = Math.max(6 * this.dpr, this.square * 0.08);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    // shaft
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX - ux * head, toY - uy * head);
    ctx.lineWidth = thick;
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - ux * head - uy * head * 0.5, toY - uy * head + ux * head * 0.5);
    ctx.lineTo(toX - ux * head + uy * head * 0.5, toY - uy * head - ux * head * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawArrow(from, to, color) {
    const s = this.square;
    const A = this._sqToXY(from),
      B = this._sqToXY(to);
    const fromX = A.x + s / 2,
      fromY = A.y + s / 2;
    const toX = B.x + s / 2,
      toY = B.y + s / 2;
    this._drawArrowBetweenPoints(this.ctxO, fromX, fromY, toX, toY, color);
  }

  // ---------- Interaction ----------
  _updateCursor(pt) {
    if (this._dragging) {
      this.cOverlay.style.cursor = "grabbing";
      return;
    }

    if (!this.interactive || !pt || this._drawingState) {
      this.cOverlay.style.cursor = "default";
      return;
    }

    const sq = this._xyToSquare(pt.x, pt.y);
    const piece = this._pieceAt(sq);
    const canMove = piece && (isWhitePiece(piece) ? "w" : "b") === this.state.turn;
    this.cOverlay.style.cursor = canMove ? "grab" : "default";
  }

  _attachEvents() {
    this._onContextMenu = (e) => e.preventDefault();
    this.cOverlay.addEventListener("contextmenu", this._onContextMenu);

    this._onPointerDown = (e) => {
      const pt = this._evtToBoard(e);
      if (!pt) return;

      if (e.button === 2) {
        // Right-click for drawing
        this._drawingState = { from: this._xyToSquare(pt.x, pt.y), to: null };
        this._updateCursor(pt);
        return;
      }

      if (e.button !== 0 || !this.interactive) return;

      // Left-click for moving
      const from = this._xyToSquare(pt.x, pt.y);
      const piece = this._pieceAt(from);
      if (piece) {
        this._selected = from;
        this._legalCached = this.rules.movesFrom(from);
        this._dragging = { from, piece, x: pt.x, y: pt.y };
        this._hoverSq = from;
        this.renderAll();
        this._updateCursor(pt);
      }
    };

    this._onPointerMove = (e) => {
      const pt = this._evtToBoard(e);
      this._updateCursor(pt);
      if (!pt) return;

      if (this._dragging) {
        // Left-click drag for moving piece
        this._dragging.x = pt.x;
        this._dragging.y = pt.y;
        this._hoverSq = this._xyToSquare(pt.x, pt.y);
        this._drawPieces();
        this._drawOverlay();
      } else if (this._drawingState) {
        // Right-click drag for drawing
        this._drawingState.to = { x: pt.x, y: pt.y };
        this._drawOverlay();
      }
    };

    this._onPointerUp = (e) => {
      // Handle right-click drawings
      const pt = this._evtToBoard(e);
      if (e.button === 2 && this._drawingState) {
        // If a premove exists, the first right-click action is to cancel it.
        if (this._premove) {
          this._premove = null;
          this._drawingState = null; // Consume the drawing action
          this._updateCursor(pt);
          this.renderAll();
          return;
        }

        const from = this._drawingState.from;
        const to = pt ? this._xyToSquare(pt.x, pt.y) : from; // if dropped outside, treat as click
        this._drawingState = null;

        if (from === to) {
          // Single right-click, toggle highlight
          const index = this._highlights.indexOf(from);
          if (index > -1) this._highlights.splice(index, 1);
          else this._highlights.push(from);
        } else {
          // Right-click drag, toggle arrow
          const index = this._arrows.findIndex((a) => a.from === from && a.to === to);
          if (index > -1) this._arrows.splice(index, 1);
          else this._arrows.push({ from, to });
        }
        this._updateCursor(pt);
        this.renderAll();
        return;
      }

      if (!this._dragging) return; // The rest is for left-click piece move
      const drop = this._hoverSq;
      const from = this._dragging.from;
      this._dragging = null;
      this._hoverSq = null;
      this._updateCursor(pt);

      if (!drop || drop === from) {
        this._selected = null;
        this._legalCached = null;
        this.renderAll();
        return;
      }

      const piece = this._pieceAt(from);
      if (!piece) {
        this.renderAll();
        return;
      }
      const pieceColor = isWhitePiece(piece) ? "w" : "b";

      // Reset selection state for all paths
      this._selected = null;
      this._legalCached = null;

      // Not our turn? Treat as a premove.
      if (pieceColor !== this.state.turn) {
        this._premove = { from, to: drop };
        this.renderAll();
        return;
      }

      // Our turn. Try to make the move.
      const legal = this.rules.move({ from, to: drop });
      if (legal?.ok) {
        const oldState = JSON.parse(JSON.stringify(this.state));
        const newFen = this._usingChessJS ? this.rules.getFEN() : legal.fen;
        const newState = parseFEN(newFen);
        this._lastMove = { from, to: drop };
        this.state = newState; // Update state immediately
        this.rules.setFEN(newFen);
        this._animateTo(newState, oldState);
        this.bus.emit("move", { from, to: drop, fen: newFen });
      } else {
        // Genuinely illegal move
        this.renderAll();
        this.bus.emit("illegal", { from, to: drop, reason: legal?.reason || "illegal" });
      }
    };

    this.cOverlay.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
  }

  _removeEvents() {
    this.cOverlay.removeEventListener("pointerdown", this._onPointerDown);
    this.cOverlay.removeEventListener("contextmenu", this._onContextMenu);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    if (this._ro) this._ro.disconnect();
  }

  _evtToBoard(e) {
    const rect = this.cOverlay.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.cOverlay.width / rect.width);
    const y = (e.clientY - rect.top) * (this.cOverlay.height / rect.height);
    if (x < 0 || y < 0 || x > this.cOverlay.width || y > this.cOverlay.height) return null;
    return { x, y };
  }

  _xyToSquare(x, y) {
    const f = clamp(Math.floor(x / this.square), 0, 7);
    const r = clamp(Math.floor(y / this.square), 0, 7);
    const ff = this.orientation === "white" ? f : 7 - f; // board file from canvas x
    const rr = this.orientation === "white" ? 7 - r : r; // board rank from canvas y
    return sq(ff, rr);
  }
  _pieceAt(square) {
    const { f, r } = sqToFR(square);
    return this.state.board[r][f];
  }

  // ---------- Animation ----------
  _clearAnim() {
    cancelAnimationFrame(this._raf || 0);
    this._raf = 0;
    this._anim = null;
  }
  _animateTo(targetState, startState) {
    this._clearAnim();
    const start = startState;
    const end = targetState;
    const startTime = now();
    const dur = this.animationMs;
    const movingMap = new Map();
    // detect piece moves by square
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const a = start.board[r][f];
        const b = end.board[r][f];
        if (a && (!b || a !== b)) {
          // find where 'a' appears in end
          const to = findPiece(end.board, a, r, f, start.board);
          if (to) {
            movingMap.set(sq(f, r), sq(to.f, to.r));
          }
        }
      }
    const tick = () => {
      const t = clamp((now() - startTime) / dur, 0, 1);
      const e = easeOutCubic(t);
      // Draw pieces: interpolate moving ones
      const ctx = this.ctxP;
      ctx.clearRect(0, 0, this.cPieces.width, this.cPieces.height);
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          const targetPiece = end.board[r][f];
          if (!targetPiece) continue;
          const toSq = sq(f, r);
          const fromSqKey = [...movingMap.entries()].find(([from, to]) => to === toSq)?.[0];
          if (fromSqKey) {
            const { x: fx, y: fy } = this._sqToXY(fromSqKey);
            const { x: tx, y: ty } = this._sqToXY(toSq);
            const x = lerp(fx, tx, e),
              y = lerp(fy, ty, e);
            this._drawPieceSprite(ctx, targetPiece, x, y, 1.0);
          } else {
            const { x, y } = this._sqToXY(toSq);
            this._drawPieceSprite(ctx, targetPiece, x, y, 1.0);
          }
        }
      this._drawOverlay();
      if (t < 1) this._raf = requestAnimationFrame(tick);
      else {
        this._raf = 0; // Final render to clean up any animation artifacts
        this.renderAll();
        this._checkAndPlayPremove();
      }
    };
    this._raf = requestAnimationFrame(tick);
  }
}

function findPiece(board, piece, r0, f0, startBoard) {
  // Prefer matching destination that differs from start
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      if (board[r][f] === piece && startBoard[r][f] !== piece) return { r, f };
    }
  return null;
}

// ---------- Public helpers ----------
export const NeoChessThemes = THEMES;

// Tiny helper to mount quickly
export function mountChessboard(root, opts) {
  return new Chessboard(root, opts);
}

// Attach minimal styles for the container (optional)
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
  .ncb-root { display:block; max-width:100%; aspect-ratio:1/1; border-radius:14px; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.10); }
  canvas { image-rendering: optimizeQuality; }
  `;
  document.head.appendChild(style);
}
