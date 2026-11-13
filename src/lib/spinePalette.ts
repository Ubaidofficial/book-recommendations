/**
 * Deterministic cloth-binding colours for drawn spines and cover stand-ins.
 *
 * Picked by hashing the slug, so a book keeps one colour on every surface and
 * between renders (server and client agree, no hydration drift). No image
 * analysis: covers are remote and sampling them would need CORS anyway.
 * Every pair keeps the ink at WCAG AA contrast or better against its cloth.
 */
export interface SpineColour {
  cloth: string;
  ink: string;
}

const PALETTE: SpineColour[] = [
  { cloth: "#2f3e5c", ink: "#f3ede2" }, // navy
  { cloth: "#7a2e2e", ink: "#f6e9dc" }, // oxblood
  { cloth: "#2e5a4a", ink: "#eef2e6" }, // bottle green
  { cloth: "#c9a24a", ink: "#2a2016" }, // mustard
  { cloth: "#4b3f9e", ink: "#f1eeff" }, // ink violet (house accent, darker)
  { cloth: "#e6dccb", ink: "#2b2520" }, // linen
  { cloth: "#3b3a42", ink: "#ece8e1" }, // charcoal
  { cloth: "#9a4f2c", ink: "#fbeee3" }, // rust
  { cloth: "#46698a", ink: "#f2f5f8" }, // slate blue
  { cloth: "#6b5378", ink: "#f5eef7" }, // plum
  { cloth: "#d4c6ad", ink: "#2c261e" }, // sand
  { cloth: "#1f4e5f", ink: "#e9f3f5" }, // teal
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function spineColour(seed: string): SpineColour {
  return PALETTE[hash(seed || "?") % PALETTE.length];
}

/**
 * Colours for a run of books standing side by side: each keeps its own
 * colour unless that matches its left neighbour, in which case it takes the
 * next one in the palette. Still deterministic for a given order.
 */
export function shelfColours(seeds: string[]): SpineColour[] {
  const out: SpineColour[] = [];
  seeds.forEach((seed, i) => {
    let k = hash(seed || "?") % PALETTE.length;
    if (i > 0 && PALETTE[k] === out[i - 1]) k = (k + 1) % PALETTE.length;
    out.push(PALETTE[k]);
  });
  return out;
}
