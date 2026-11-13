/**
 * Two-circle Venn diagram, area-proportional: each circle's area is its
 * person's shelf size and the lens area is the number of shared books (solved
 * numerically). Pure SVG, server-rendered, no client JS.
 *
 * Names and colour keys sit in HTML below the drawing so they stay readable
 * when the SVG is scaled down on a phone.
 */

const VB_W = 640;
/** Room above the circles for the "in common" callout when the lens is too narrow to hold it. */
const CALLOUT_BAND = 84;
/** Narrowest lens (viewBox units) that holds the count and "in common" inside it. */
const MIN_LENS_FOR_LABEL = 150;
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
  const maxR = Math.max(rA, rB);

  const lensL = Math.max(cxB - rB, cxA - rA);
  const lensR = Math.min(cxA + rA, cxB + rB);
  const lensMid = shared > 0 ? (lensL + lensR) / 2 : (cxA + rA + cxB - rB) / 2;
  // A thin lens (two big shelves, few shared books) cannot hold the label:
  // it would sit on the circle borders. Put it above, with a leader line.
  const inside = shared > 0 && lensR - lensL >= MIN_LENS_FOR_LABEL;
  const cy = (inside ? 16 : CALLOUT_BAND) + maxR;
  const vbH = cy + maxR + 16;
  // Upper point where the two circles cross (top tip of the lens).
  const ix = shared > 0 && d > 0 ? (d * d + rA * rA - rB * rB) / (2 * d) : 0;
  const tipY = shared > 0 ? cy - Math.sqrt(Math.max(0, rA * rA - ix * ix)) : cy;
  // The callout hangs over the chord through the two crossing points: below
  // the tip, that line runs inside the overlap all the way to its centre.
  const calloutX = shared > 0 ? cxA + ix : lensMid;
  const onlyAX = (cxA - rA + Math.min(lensL, cxB - rB)) / 2;
  const onlyBX = (Math.max(lensR, cxA + rA) + cxB + rB) / 2;
  const onlyA = Math.max(0, sizeA - shared);
  const onlyB = Math.max(0, sizeB - shared);

  const label =
    `${nameA} recommends ${sizeA} books and ${nameB} recommends ${sizeB}. ` +
    `${shared} ${shared === 1 ? "book is" : "books are"} on both lists; ${onlyA} only on ${nameA}’s and ${onlyB} only on ${nameB}’s.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${VB_W} ${vbH}`} role="img" aria-label={label} className="w-full h-auto max-h-[340px]">
        <circle cx={cxA} cy={cy} r={rA} fill="#5b4fcf" fillOpacity={0.16} stroke="#5b4fcf" strokeWidth={2} />
        <circle cx={cxB} cy={cy} r={rB} fill="#e07b39" fillOpacity={0.16} stroke="#e07b39" strokeWidth={2} />
        <g fontFamily="inherit" textAnchor="middle" fill="#1b1b1f">
          {inside ? (
            <>
              <text x={lensMid} y={cy + 4} fontSize={52} fontWeight={600} fontFamily="var(--font-serif)" paintOrder="stroke" stroke="#ffffff" strokeWidth={6} strokeLinejoin="round">
                {shared}
              </text>
              <text x={lensMid} y={cy + 34} fontSize={22} fill="#5d5d66" paintOrder="stroke" stroke="#ffffff" strokeWidth={4}>
                in common
              </text>
            </>
          ) : (
            <>
              {shared > 0 ? (
                <>
                  {/* The count sits right over the leader line; the words run on beside it. */}
                  <text x={calloutX} y={52} fontSize={48} fontWeight={600} fontFamily="var(--font-serif)">
                    {shared}
                  </text>
                  <text x={calloutX + String(shared).length * 13 + 10} y={50} fontSize={24} fill="#5d5d66" textAnchor="start">
                    in common
                  </text>
                </>
              ) : (
                <text x={calloutX} y={52} fontSize={24} fill="#5d5d66">
                  No books in common
                </text>
              )}
              {shared > 0 && (
                <>
                  <line x1={calloutX} y1={64} x2={calloutX} y2={cy} stroke="#1b1b1f" strokeWidth={1.5} />
                  <circle cx={calloutX} cy={cy} r={5} fill="#1b1b1f" />
                </>
              )}
            </>
          )}
          {onlyA > 0 && (
            <text x={onlyAX} y={cy + 8} fontSize={30} fontWeight={600} fontFamily="var(--font-serif)" fill="#4a3eb8">
              {onlyA}
            </text>
          )}
          {onlyB > 0 && (
            <text x={onlyBX} y={cy + 8} fontSize={30} fontWeight={600} fontFamily="var(--font-serif)" fill="#a8521f">
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
