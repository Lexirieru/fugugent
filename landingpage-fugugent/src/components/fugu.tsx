/**
 * Fugu — the cartoon pufferfish that PUFFS UP as the risk load grows.
 *
 * `puff` is a single number in 0..1. Zero = calm, one = critical. Every shape and colour
 * is derived from that number alone, so it is impossible to end up with a fugu whose
 * shape does not match its metric. This component is pure (no state, no effects), so it
 * is safe on the server as well as the client.
 */

const CLAMP = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const R = (n: number) => Math.round(n * 100) / 100;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The puff colour scale: calm → watchful → strained → critical. */
const STOPS: Array<{ at: number; rgb: Rgb }> = [
  { at: 0, rgb: hexToRgb("#2dd4bf") },
  { at: 0.45, rgb: hexToRgb("#facc15") },
  { at: 0.72, rgb: hexToRgb("#fb923c") },
  { at: 1, rgb: hexToRgb("#f43f5e") },
];

function puffRgb(p: number): Rgb {
  const t = CLAMP(p);
  for (let i = 1; i < STOPS.length; i += 1) {
    const lo = STOPS[i - 1];
    const hi = STOPS[i];
    if (t <= hi.at) {
      const span = hi.at - lo.at;
      return mix(lo.rgb, hi.rgb, span === 0 ? 0 : (t - lo.at) / span);
    }
  }
  return STOPS[STOPS.length - 1].rgb;
}

/** The fugu's accent colour at a given puff level — also used by text and labels. */
export function puffColor(p: number): string {
  return rgbToCss(puffRgb(p));
}

function shade(rgb: Rgb, amount: number): string {
  const target: Rgb = amount >= 0 ? [255, 255, 255] : [7, 12, 22];
  return rgbToCss(mix(rgb, target, Math.abs(amount)));
}

export type FuguProps = {
  /** 0 = calm, 1 = critical. */
  puff: number;
  className?: string;
  /** Alternative text; when empty, the SVG is treated as decoration. */
  title?: string;
  /** A subtle breath under high pressure. */
  animated?: boolean;
};

export function Fugu({ puff, className, title, animated = true }: FuguProps) {
  const p = CLAMP(puff);
  const base = puffRgb(p);
  const body = rgbToCss(base);
  const bodyDark = shade(base, -0.34);
  const bodyLight = shade(base, 0.34);
  const belly = shade(base, 0.62);

  const cx = 100;
  const cy = 102;
  const rx = R(52 + 15 * p);
  const ry = R(38 + 28 * p);
  const spikeLen = R(5 + 15 * p);
  const spikeWide = 0.075 + 0.02 * p;

  // The spikes ring the body, but do not cover the tail (right) or the face (left).
  const spikes: string[] = [];
  const COUNT = 22;
  for (let i = 0; i < COUNT; i += 1) {
    const a = (i / COUNT) * Math.PI * 2;
    const cos = Math.cos(a);
    // Skip the tail zone and the face zone.
    if (cos > 0.82 || cos < -0.9) continue;
    const tip = [R(cx + (rx + spikeLen) * cos), R(cy + (ry + spikeLen) * Math.sin(a))];
    const l = a - spikeWide;
    const r = a + spikeWide;
    const pl = [R(cx + rx * Math.cos(l)), R(cy + ry * Math.sin(l))];
    const pr = [R(cx + rx * Math.cos(r)), R(cy + ry * Math.sin(r))];
    spikes.push(`M${pl[0]} ${pl[1]} L${tip[0]} ${tip[1]} L${pr[0]} ${pr[1]} Z`);
  }

  // The face widens as the body puffs up.
  const eyeY = R(cy - ry * 0.3);
  const eyeDx = R(rx * 0.36);
  const eyeR = R(9.5 + 2.5 * p);
  const pupilR = R(4.6 - 1.1 * p); // a shrinking pupil = tension
  const mouthY = R(cy + ry * 0.42);
  const mouthRx = R(6 + 5 * p);
  const mouthRy = R(4.5 + 4.5 * p);

  const tailX = R(cx + rx - 2);
  const tailSpread = R(20 + 6 * p);
  const tailLen = R(30 - 6 * p);

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g className={animated ? "fugu-breathe" : undefined}>
        {/* Tail */}
        <path
          d={`M${tailX} ${cy} L${R(tailX + tailLen)} ${R(cy - tailSpread)} Q${R(tailX + tailLen * 0.55)} ${cy} ${R(tailX + tailLen)} ${R(cy + tailSpread)} Z`}
          fill={bodyDark}
        />
        {/* Dorsal fin */}
        <path
          d={`M${R(cx - 6)} ${R(cy - ry + 2)} Q${R(cx + 4)} ${R(cy - ry - 16 - 6 * p)} ${R(cx + 20)} ${R(cy - ry + 6)} Z`}
          fill={bodyDark}
        />
        {/* Spikes */}
        <g fill={bodyDark} opacity={0.95}>
          {spikes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {/* Body */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={body} />
        {/* Belly */}
        <ellipse
          cx={R(cx - rx * 0.06)}
          cy={R(cy + ry * 0.34)}
          rx={R(rx * 0.72)}
          ry={R(ry * 0.46)}
          fill={belly}
          opacity={0.55}
        />
        {/* Highlight */}
        <ellipse
          cx={R(cx - rx * 0.42)}
          cy={R(cy - ry * 0.52)}
          rx={R(rx * 0.22)}
          ry={R(ry * 0.16)}
          fill={bodyLight}
          opacity={0.5}
        />
        {/* Side fin */}
        <ellipse
          cx={R(cx - rx * 0.72)}
          cy={R(cy + ry * 0.18)}
          rx={R(11 + 2 * p)}
          ry={R(7 + 2 * p)}
          fill={bodyDark}
          transform={`rotate(-18 ${R(cx - rx * 0.72)} ${R(cy + ry * 0.18)})`}
        />
        {/* Eyes */}
        <g>
          <circle cx={R(cx - eyeDx)} cy={eyeY} r={eyeR} fill="#f8fbff" />
          <circle cx={R(cx + eyeDx)} cy={eyeY} r={eyeR} fill="#f8fbff" />
          <circle cx={R(cx - eyeDx + 1.2)} cy={R(eyeY + 1)} r={pupilR} fill="#0b1524" />
          <circle cx={R(cx + eyeDx + 1.2)} cy={R(eyeY + 1)} r={pupilR} fill="#0b1524" />
          <circle cx={R(cx - eyeDx + 2.6)} cy={R(eyeY - 1.4)} r={1.5} fill="#ffffff" />
          <circle cx={R(cx + eyeDx + 2.6)} cy={R(eyeY - 1.4)} r={1.5} fill="#ffffff" />
        </g>
        {/* Eyebrows — angling further down under strain */}
        <g stroke={bodyDark} strokeWidth={2.6} strokeLinecap="round" opacity={0.85}>
          <line
            x1={R(cx - eyeDx - eyeR)}
            y1={R(eyeY - eyeR - 3 - 2 * p)}
            x2={R(cx - eyeDx + eyeR * 0.6)}
            y2={R(eyeY - eyeR - 1 + 4 * p)}
          />
          <line
            x1={R(cx + eyeDx + eyeR)}
            y1={R(eyeY - eyeR - 3 - 2 * p)}
            x2={R(cx + eyeDx - eyeR * 0.6)}
            y2={R(eyeY - eyeR - 1 + 4 * p)}
          />
        </g>
        {/* Mouth */}
        <ellipse cx={cx} cy={mouthY} rx={mouthRx} ry={mouthRy} fill="#0b1524" opacity={0.82} />
      </g>
    </svg>
  );
}
