/**
 * Fugu — ikan buntal kartun yang MENGEMBANG seiring beban risiko.
 *
 * `puff` adalah satu angka 0..1. Nol = tenang, satu = kritis. Seluruh bentuk
 * dan warna diturunkan dari angka itu saja, jadi mustahil ada fugu yang
 * bentuknya tidak cocok dengan metriknya. Komponen ini murni (tanpa state,
 * tanpa efek) sehingga aman dipakai di server maupun client.
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

/** Skala warna kembung: tenang → waspada → tertekan → kritis. */
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

/** Warna aksen fugu pada tingkat kembung tertentu — dipakai juga oleh teks/label. */
export function puffColor(p: number): string {
  return rgbToCss(puffRgb(p));
}

function shade(rgb: Rgb, amount: number): string {
  const target: Rgb = amount >= 0 ? [255, 255, 255] : [7, 12, 22];
  return rgbToCss(mix(rgb, target, Math.abs(amount)));
}

export type FuguProps = {
  /** 0 = tenang, 1 = kritis. */
  puff: number;
  className?: string;
  /** Teks alternatif; kalau kosong, SVG diperlakukan sebagai dekorasi. */
  title?: string;
  /** Napas halus saat tekanan tinggi. */
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

  // Duri mengelilingi badan, tetapi tidak menutup ekor (kanan) dan mulut (kiri).
  const spikes: string[] = [];
  const COUNT = 22;
  for (let i = 0; i < COUNT; i += 1) {
    const a = (i / COUNT) * Math.PI * 2;
    const cos = Math.cos(a);
    // Lewati zona ekor dan zona wajah.
    if (cos > 0.82 || cos < -0.9) continue;
    const tip = [R(cx + (rx + spikeLen) * cos), R(cy + (ry + spikeLen) * Math.sin(a))];
    const l = a - spikeWide;
    const r = a + spikeWide;
    const pl = [R(cx + rx * Math.cos(l)), R(cy + ry * Math.sin(l))];
    const pr = [R(cx + rx * Math.cos(r)), R(cy + ry * Math.sin(r))];
    spikes.push(`M${pl[0]} ${pl[1]} L${tip[0]} ${tip[1]} L${pr[0]} ${pr[1]} Z`);
  }

  // Wajah melebar seiring badan mengembang.
  const eyeY = R(cy - ry * 0.3);
  const eyeDx = R(rx * 0.36);
  const eyeR = R(9.5 + 2.5 * p);
  const pupilR = R(4.6 - 1.1 * p); // pupil mengecil = tegang
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
        {/* Ekor */}
        <path
          d={`M${tailX} ${cy} L${R(tailX + tailLen)} ${R(cy - tailSpread)} Q${R(tailX + tailLen * 0.55)} ${cy} ${R(tailX + tailLen)} ${R(cy + tailSpread)} Z`}
          fill={bodyDark}
        />
        {/* Sirip punggung */}
        <path
          d={`M${R(cx - 6)} ${R(cy - ry + 2)} Q${R(cx + 4)} ${R(cy - ry - 16 - 6 * p)} ${R(cx + 20)} ${R(cy - ry + 6)} Z`}
          fill={bodyDark}
        />
        {/* Duri */}
        <g fill={bodyDark} opacity={0.95}>
          {spikes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {/* Badan */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={body} />
        {/* Perut */}
        <ellipse
          cx={R(cx - rx * 0.06)}
          cy={R(cy + ry * 0.34)}
          rx={R(rx * 0.72)}
          ry={R(ry * 0.46)}
          fill={belly}
          opacity={0.55}
        />
        {/* Kilau */}
        <ellipse
          cx={R(cx - rx * 0.42)}
          cy={R(cy - ry * 0.52)}
          rx={R(rx * 0.22)}
          ry={R(ry * 0.16)}
          fill={bodyLight}
          opacity={0.5}
        />
        {/* Sirip samping */}
        <ellipse
          cx={R(cx - rx * 0.72)}
          cy={R(cy + ry * 0.18)}
          rx={R(11 + 2 * p)}
          ry={R(7 + 2 * p)}
          fill={bodyDark}
          transform={`rotate(-18 ${R(cx - rx * 0.72)} ${R(cy + ry * 0.18)})`}
        />
        {/* Mata */}
        <g>
          <circle cx={R(cx - eyeDx)} cy={eyeY} r={eyeR} fill="#f8fbff" />
          <circle cx={R(cx + eyeDx)} cy={eyeY} r={eyeR} fill="#f8fbff" />
          <circle cx={R(cx - eyeDx + 1.2)} cy={R(eyeY + 1)} r={pupilR} fill="#0b1524" />
          <circle cx={R(cx + eyeDx + 1.2)} cy={R(eyeY + 1)} r={pupilR} fill="#0b1524" />
          <circle cx={R(cx - eyeDx + 2.6)} cy={R(eyeY - 1.4)} r={1.5} fill="#ffffff" />
          <circle cx={R(cx + eyeDx + 2.6)} cy={R(eyeY - 1.4)} r={1.5} fill="#ffffff" />
        </g>
        {/* Alis — makin miring saat tertekan */}
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
        {/* Mulut */}
        <ellipse cx={cx} cy={mouthY} rx={mouthRx} ry={mouthRy} fill="#0b1524" opacity={0.82} />
      </g>
    </svg>
  );
}
