/**
 * Two-circle Venn diagram, area-proportional: each circle's area is its
 * person's shelf size and the lens area is the number of shared books (solved
 * numerically). Pure SVG, server-rendered, no client JS.
 *
 * Names and colour keys sit in HTML below the drawing so they stay readable
 * when the SVG is scaled down on a phone.
 */

const VB_W = 640;
const VB_H = 280;
const MAX_R = 118;
const MIN_R = 34;

function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 + a2 - k;
}

/** Centre distance giving the target lens area (bisection; area falls as d grows). */
function distanceFor(r1: number, r2: number, target: number): number {
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (lensArea(r1, r2, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function VennDiagram({
  nameA,
  nameB,
  sizeA,
  sizeB,
  shared,
}: {
  nameA: string;
  nameB: string;
  sizeA: number;
  sizeB: number;
  shared: number;
}) {
  const big = Math.max(sizeA, sizeB, 1);
  let rA = Math.max(MIN_R, MAX_R * Math.sqrt(Math.max(sizeA, 1) / big));
  let rB = Math.max(MIN_R, MAX_R * Math.sqrt(Math.max(sizeB, 1) / big));

  // Area units per book, taken from the bigger circle so it stays exact.
  const unit = (Math.PI * Math.max(rA, rB) ** 2) / big;
  const minR = Math.min(rA, rB);
  const target = Math.min(shared * unit, Math.PI * minR * minR * 0.97);
  let d = shared > 0 ? distanceFor(rA, rB, target) : rA + rB + 24;
  // Always leave room for the "only" labels inside each crescent.
  d = Math.max(d, Math.abs(rA - rB) + 26);

  // Fit horizontally.
  const span = rA + d + rB;
  const fit = Math.min(1, (VB_W - 24) / span);
  rA *= fit;
  rB *= fit;
  d *= fit;
  const left = (VB_W - (rA + d + rB)) / 2;
  const cxA = left + rA;
  const cxB = cxA + d;
  const cy = VB_H / 2;

  const lensL = Math.max(cxB - rB, cxA - rA);
  const lensR = Math.min(cxA + rA, cxB + rB);
  const lensMid = shared > 0 ? (lensL + lensR) / 2 : (cxA + rA + cxB - rB) / 2;
  const onlyAX = (cxA - rA + Math.min(lensL, cxB - rB)) / 2;
  const onlyBX = (Math.max(lensR, cxA + rA) + cxB + rB) / 2;
  const onlyA = Math.max(0, sizeA - shared);
  const onlyB = Math.max(0, sizeB - shared);

  const label =
    `${nameA} recommends ${sizeA} books and ${nameB} recommends ${sizeB}. ` +
    `${shared} ${shared === 1 ? "book is" : "books are"} on both lists; ${onlyA} only on ${nameA}’s and ${onlyB} only on ${nameB}’s.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={label} className="w-full h-auto max-h-[300px]">
        <circle cx={cxA} cy={cy} r={rA} fill="#5b4fcf" fillOpacity={0.16} stroke="#5b4fcf" strokeWidth={2} />
        <circle cx={cxB} cy={cy} r={rB} fill="#e07b39" fillOpacity={0.16} stroke="#e07b39" strokeWidth={2} />
        <g fontFamily="inherit" textAnchor="middle" fill="#1b1b1f">
          <text x={lensMid} y={cy + 4} fontSize={48} fontWeight={700} paintOrder="stroke" stroke="#faf9f7" strokeWidth={6} strokeLinejoin="round">
            {shared}
          </text>
          <text x={lensMid} y={cy + 32} fontSize={18} fill="#5d5d66" paintOrder="stroke" stroke="#faf9f7" strokeWidth={4}>
            in common
          </text>
          {onlyA > 0 && (
            <text x={onlyAX} y={cy + 8} fontSize={26} fontWeight={600} fill="#4a3eb8">
              {onlyA}
            </text>
          )}
          {onlyB > 0 && (
            <text x={onlyBX} y={cy + 8} fontSize={26} fontWeight={600} fill="#a8521f">
              {onlyB}
            </text>
          )}
        </g>
      </svg>
      <figcaption className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-[#5b4fcf] bg-[#5b4fcf]/20" />
          <span>
            <b className="text-ink">{nameA}</b> · {sizeA} books
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-[#e07b39] bg-[#e07b39]/20" />
          <span>
            <b className="text-ink">{nameB}</b> · {sizeB} books
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
