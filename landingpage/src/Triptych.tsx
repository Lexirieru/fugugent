import { useEffect, useRef } from "react";
import {
  ALLOWLIST_CAP,
  ALLOWLIST_EXPIRY,
  CATALOGUE_TOTAL,
  EVER_ACTED,
  HF_AFTER,
  HF_BEFORE,
  RENTABLE,
  VERIFIED_CONTRACTS,
} from "./content";

/**
 * Three cards, one composition.
 *
 * Everything inside the scene is sized in container query units against
 * `.triptych__scene`, so the three cards keep their proportions to each other at
 * every width instead of each one reflowing on its own. The scene carries an
 * `aspect-ratio` rather than a height, which is what makes `cqh` definite: the
 * ratio is chosen so `--cards-scale` resolves to 1 on a normal desktop and only
 * starts shrinking when the scene is genuinely too short.
 *
 * The two charts are drawn on canvas rather than shipped as images because they
 * have to stay crisp on a retina screen at any container width, and because the
 * numbers in them are the real ones.
 */

/** Health factor across 24 observations. The highlighted bar is where it acted. */
const BARS = [
  74, 71, 76, 69, 72, 66,
  61, 57, 60, 52, 49, 45,
  38, 34, 30, 26, 22, 100,
  88, 84, 87, 82, 85, 83,
];
const ACTIVE_BAR = 17;

/* ── Canvas 1: the sparkle icon ─────────────────────────────────────
 *
 * Frozen data, redrawn on resize and DPR-aware. Two sparkles, the second larger
 * and offset, each an eight-pointed star whose corners are rounded toward the
 * neighbouring midpoints.
 */
const SPARKLES = [
  { x: 0.01, y: 0.01, size: 0.5 },
  { x: 0.28, y: 0.26, size: 0.72 },
];

const SPARKLE_POINTS: Array<[number, number]> = [
  [0.5, 0.06],
  [0.59, 0.41],
  [0.94, 0.5],
  [0.59, 0.59],
  [0.5, 0.94],
  [0.41, 0.59],
  [0.06, 0.5],
  [0.41, 0.41],
];

const ROUNDNESS = 0.34;

function roundedPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  roundness: number,
) {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const a = { x: cur.x + (prev.x - cur.x) * roundness, y: cur.y + (prev.y - cur.y) * roundness };
    const b = { x: cur.x + (next.x - cur.x) * roundness, y: cur.y + (next.y - cur.y) * roundness };
    if (i === 0) ctx.moveTo(a.x, a.y);
    else ctx.lineTo(a.x, a.y);
    ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  ctx.closePath();
}

function drawSparkles(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const base = Math.min(rect.width, rect.height);
  for (const sparkle of SPARKLES) {
    const size = sparkle.size * base;
    const ox = sparkle.x * rect.width;
    const oy = sparkle.y * rect.height;
    const pts = SPARKLE_POINTS.map(([px, py]) => ({ x: ox + px * size, y: oy + py * size }));
    ctx.save();
    ctx.fillStyle = "rgba(255,220,202,.55)";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1.1, size * 0.15);
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255,255,255,.78)";
    ctx.shadowBlur = size * 0.06;
    roundedPolygon(ctx, pts, ROUNDNESS);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/* ── Canvas 2: the decision flow ────────────────────────────────────
 *
 * Five bezier ribbons running left to right, narrowing as they converge, with a
 * white thread laid over each. Source and target are fractions of the height, so
 * the whole thing rescales with the card and never needs a viewBox.
 */
const RIBBONS = [
  { source: [0.08, 0.26], target: [0.29, 0.32], color: "rgba(255,189,144,.60)" },
  { source: [0.23, 0.42], target: [0.3, 0.335], color: "rgba(255,149,80,.70)" },
  { source: [0.5, 0.75], target: [0.32, 0.355], color: "rgba(255,136,64,.82)" },
  { source: [0.69, 0.98], target: [0.33, 0.365], color: "rgba(255,181,128,.54)" },
  { source: [0.39, 0.51], target: [0.31, 0.345], color: "rgba(255,105,0,.96)" },
];

const THREADS: Array<[number, number, number]> = [
  [0.05, 0.3, 0.68],
  [0.2, 0.315, 0.6],
  [0.62, 0.342, 0.84],
  [0.82, 0.352, 0.74],
  [0.97, 0.36, 0.64],
];

const SOURCE_HOLD = 0.38;
const TARGET_APPROACH = 0.74;
const THREAD_WIDTH = 0.00135;

function drawFlow(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const w = rect.width;
  const h = rect.height;

  for (const ribbon of RIBBONS) {
    const [sTop, sBottom] = ribbon.source;
    const [tTop, tBottom] = ribbon.target;
    ctx.beginPath();
    ctx.moveTo(0, h * sTop);
    ctx.bezierCurveTo(w * SOURCE_HOLD, h * sTop, w * TARGET_APPROACH, h * tTop, w, h * tTop);
    ctx.lineTo(w, h * tBottom);
    ctx.bezierCurveTo(w * TARGET_APPROACH, h * tBottom, w * SOURCE_HOLD, h * sBottom, 0, h * sBottom);
    ctx.closePath();
    ctx.fillStyle = ribbon.color;
    ctx.fill();
  }

  ctx.lineWidth = Math.max(0.72, w * THREAD_WIDTH);
  for (const [from, to, alpha] of THREADS) {
    ctx.beginPath();
    ctx.moveTo(0, h * from);
    ctx.bezierCurveTo(w * SOURCE_HOLD, h * from, w * TARGET_APPROACH, h * to, w, h * to);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.stroke();
  }
}

/* ── The card entrance ──────────────────────────────────────────────
 *
 * Six layers per card, run through the Web Animations API. It is deliberately
 * not CSS: the ordering depends on measurements taken at the moment the section
 * comes into view (are the cards on one row or stacked, which one is nearest the
 * centre), which a stylesheet cannot know.
 *
 * The important part is what happens when it does NOT run. Nothing here is
 * hidden by a stylesheet rule. The starting state is the first keyframe of an
 * animation, so no animation means no hidden state: reduced motion, a browser
 * with no `animate`, or a throw all end with three visible cards.
 */
const EASE_PLACE = "cubic-bezier(.16,1,.3,1)";
const EASE_WIPE = "cubic-bezier(.24,.86,.28,1)";

function playCards(scene: HTMLElement) {
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const cards = Array.from(scene.querySelectorAll<HTMLElement>(".card")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (cards.length === 0) return;

  const boxes = cards.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  const topMost = Math.min(...boxes.map((b) => b.rect.top));
  const tolerance = Math.max(4, Math.max(...boxes.map((b) => b.rect.height)) * 0.04);
  const singleRow = boxes.every((b) => b.rect.top - topMost <= tolerance);

  const viewportCentre = window.innerWidth / 2;
  let ordered: typeof boxes;
  let primary: HTMLElement | null = null;

  if (singleRow) {
    const middle = boxes[Math.min(1, boxes.length - 1)];
    primary = middle.el;
    const rest = boxes
      .filter((b) => b !== middle)
      .sort((a, b) => {
        const da = Math.abs(a.rect.left + a.rect.width / 2 - viewportCentre);
        const db = Math.abs(b.rect.left + b.rect.width / 2 - viewportCentre);
        return da - db;
      });
    ordered = [middle, ...rest];
  } else {
    ordered = [...boxes].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  }

  const compact = window.innerWidth <= 512;
  const rise = compact ? 11 : 16;
  const running: Animation[] = [];

  ordered.forEach((box, order) => {
    const isPrimary = box.el === primary;
    const delay = singleRow
      ? isPrimary
        ? 60
        : 245 + (order - 1) * 85
      : 70 + order * 115;

    let drift = 0;
    if (singleRow && !isPrimary) {
      const centreOffset = box.rect.left + box.rect.width / 2 - viewportCentre;
      const sign = centreOffset === 0 ? 0 : centreOffset > 0 ? 1 : -1;
      drift = -sign * Math.min(box.rect.width * 0.018, 7);
    }

    const add = (
      el: Element | null,
      frames: Keyframe[],
      duration: number,
      extraDelay: number,
      easing: string,
    ) => {
      if (!el) return;
      try {
        running.push(el.animate(frames, { duration, delay: delay + extraDelay, easing, fill: "both" }));
      } catch {
        /* One layer failing must not take the card with it. */
      }
    };

    // No clip-path on the card itself: it would cut its own shadow off.
    add(
      box.el,
      [
        { opacity: 0, transform: `translate3d(${drift}px, ${rise}px, 0) scale(.985)` },
        { opacity: 1, transform: "none" },
      ],
      compact ? 780 : isPrimary ? 960 : 900,
      0,
      EASE_PLACE,
    );

    add(
      box.el.querySelector(".panel"),
      [
        { opacity: 0, transform: "scale(.994)", clipPath: `inset(0 0 ${compact ? 26 : 34}% 0)` },
        { opacity: 1, transform: "none", clipPath: "inset(0 0 0 0)" },
      ],
      compact ? 620 : 720,
      200,
      EASE_WIPE,
    );

    add(
      box.el.querySelector(".card-copy"),
      [
        { opacity: 0, transform: `translate3d(0, ${compact ? 8 : 11}px, 0)` },
        { opacity: 1, transform: "none" },
      ],
      compact ? 540 : 620,
      330,
      EASE_PLACE,
    );

    // The heading and the description are only UNCOVERED, never transformed:
    // both already carry a transform of their own for the lettering, and a
    // second one would fight it.
    add(
      box.el.querySelector(".card-copy h2"),
      [{ clipPath: "inset(-30% 0 100% 0)" }, { clipPath: "inset(-30% 0 -30% 0)" }],
      compact ? 470 : 540,
      350,
      EASE_WIPE,
    );
    add(
      box.el.querySelector(".card-copy p"),
      [{ clipPath: "inset(-30% 0 100% 0)" }, { clipPath: "inset(-30% 0 -30% 0)" }],
      compact ? 430 : 490,
      450,
      EASE_WIPE,
    );

    add(
      box.el.querySelector(".corner-icon"),
      [
        { opacity: 0, transform: "scale(.88)" },
        { opacity: 1, transform: "none" },
      ],
      compact ? 340 : 400,
      540,
      EASE_PLACE,
    );
  });

  // Cancelling on finish drops the `fill: both` hold, so the cards go back to
  // being ordinary painted elements with no animation state attached.
  Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => {
    for (const a of running) {
      try {
        a.cancel();
      } catch {
        /* already gone */
      }
    }
  });
}

function CornerIcon() {
  return (
    <span className="corner-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M7 12h10M13 8l4 4-4 4" />
      </svg>
    </span>
  );
}

export default function Triptych() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const sparkleRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvases: Array<[HTMLCanvasElement | null, (c: HTMLCanvasElement) => void]> = [
      [sparkleRef.current, drawSparkles],
      [flowRef.current, drawFlow],
    ];
    const observers: ResizeObserver[] = [];
    for (const [canvas, draw] of canvases) {
      if (!canvas) continue;
      draw(canvas);
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => draw(canvas));
        ro.observe(canvas);
        observers.push(ro);
      }
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (typeof IntersectionObserver === "undefined") {
      playCards(scene);
      return;
    }
    let played = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !played) {
            played = true;
            playCards(scene);
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(scene);
    return () => io.disconnect();
  }, []);

  return (
    <section className="section triptych" aria-labelledby="triptych-title">
      <div className="section-inner">
        <p className="eyebrow">what the chain says</p>
        <h2 className="section-title" id="triptych-title">
          One number decides, and the chain writes it down.
        </h2>
        <p className="section-lede">
          Three things that already happened. The chart on the left is a real health
          factor, the panel in the middle is the real allowlist, and the count on the
          right is the catalogue as it stands today.
        </p>
      </div>

      <div className="triptych__scene" ref={sceneRef}>
        <div className="cards">
          {/* ── Card 1: it watches, then acts ────────────────────── */}
          <article className="card">
            <div className="panel panel--chart">
              <div className="timeline">
                <div className="value-chip">
                  {HF_BEFORE} <span aria-hidden="true">&#8594;</span> {HF_AFTER}
                </div>
                <div className="bars">
                  {BARS.map((height, i) => (
                    <span
                      className={i === ACTIVE_BAR ? "bar active" : "bar"}
                      key={i}
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <div className="axis" aria-hidden="true">
                  <span>SAFE</span>
                  <span>WATCH</span>
                  <span>ACT</span>
                  <span>SAFE</span>
                </div>
              </div>
            </div>
            <div className="card-copy">
              <h2>It watches, then acts</h2>
              <p>
                One number decides,
                <br />
                and the chain records it.
              </p>
              <CornerIcon />
            </div>
          </article>

          {/* ── Card 2: the allowlist ────────────────────────────── */}
          <article className="card">
            <div className="panel panel--assistant">
              <div className="assistant-head">
                <span className="assistant-badge">HelloFugu</span>
              </div>
              <p className="question">What should this agent be allowed to do?</p>
              <div className="prompt">
                <code>repay</code>
                <code>approve</code>
                <span className="prompt-note">
                  {ALLOWLIST_CAP}. Expires {ALLOWLIST_EXPIRY}.
                </span>
              </div>
              <button className="automate" type="button" tabIndex={-1} aria-hidden="true">
                Hire
                <canvas className="magic" ref={sparkleRef} data-sparkle-icon="" aria-hidden="true" />
              </button>
              <span className="cursor" aria-hidden="true" />
            </div>
            <div className="card-copy">
              <h2>Limits the chain enforces</h2>
              <p>Two functions. Nothing else.</p>
              <CornerIcon />
            </div>
          </article>

          {/* ── Card 3: the catalogue ────────────────────────────── */}
          <article className="card">
            <div className="panel panel--flow">
              <div className="metric">
                <strong>{CATALOGUE_TOTAL}</strong>
                <span className="metric-label">Agents in the catalogue</span>
                <span className="metric-green">{RENTABLE} ready to hire</span>
              </div>
              <canvas className="decision-flow" ref={flowRef} aria-hidden="true" />
              <div className="tags">
                <span className="tag">Listed: {RENTABLE}</span>
                <span className="tag">Ever sent a transaction: {EVER_ACTED}</span>
                <span className="tag">Verified contracts: {VERIFIED_CONTRACTS}</span>
              </div>
            </div>
            <div className="card-copy">
              <h2>Nine kinds, one catalogue</h2>
              <p>
                Most have no price yet,
                <br />
                and the page says so.
              </p>
              <CornerIcon />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
