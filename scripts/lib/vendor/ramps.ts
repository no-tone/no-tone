/* Vendored from tonil - do not edit here.
 *
 * Source: packages/ui/src/gradient/ramps.ts
 *         https://raw.githubusercontent.com/no-tone/tonil/main/packages/ui/src/gradient/ramps.ts
 *
 * Refresh with `bun run vendor`. Editing this copy instead means the banner
 * stops being the site's field and starts being a lookalike, which is the one
 * thing the banner is for.
 */

/* Colour ramps for the gradient field.

   A ramp is a short list of `[position, colour]` stops that the field
   samples per pixel. Stops are authored in sRGB (matching tokens.css) but
   every ramp we *derive* is built in OKLCh - see ./oklab.ts for why.

   The named ramps are not a new palette. They are the site's existing
   signature colours, the ones the globe already assigns per node, spread
   into a field. Picking the ramp from the active signature is the point:
   the panel behind the content and the accent on the content are then the
   same colour system rather than two decisions kept in sync by hand. */

import {
  hexToRgb,
  oklchToSrgb,
  type Rgb,
  rgbToCss,
  srgbToOklch,
} from "./oklab.js";

/** `[position 0–1, colour]`. Positions ascend; the first should be 0 and the last 1. */
export type RampStop = readonly [number, Rgb];
export type Ramp = readonly RampStop[];

/** A ramp stop flattened for `postMessage`: `[position, r, g, b]`. */
export type FlatRampStop = readonly [number, number, number, number];

/**
 * Colour at `t` along the ramp, clamped at both ends.
 *
 * Interpolation is plain componentwise sRGB, matching what a browser does
 * for a legacy `linear-gradient`. That is deliberate: the *stops* are placed
 * perceptually (in OKLCh, by `signatureRamp`), and once they sit close
 * together in lightness, straight-line blending between them is both
 * indistinguishable from an OKLab blend and several times cheaper - which
 * matters at one call per pixel per frame.
 */
export function sampleRamp(ramp: Ramp, t: number): Rgb {
  let previous: RampStop | undefined;
  for (const stop of ramp) {
    const [position, colour] = stop;
    if (t <= position) {
      if (!previous) return colour;
      const [previousPosition, previousColour] = previous;
      const span = position - previousPosition;
      const f = span <= 0 ? 0 : (t - previousPosition) / span;
      return [
        previousColour[0] + (colour[0] - previousColour[0]) * f,
        previousColour[1] + (colour[1] - previousColour[1]) * f,
        previousColour[2] + (colour[2] - previousColour[2]) * f,
      ];
    }
    previous = stop;
  }
  return previous ? previous[1] : [0, 0, 0];
}

/** A CSS `linear-gradient(...)` approximating the ramp with `steps + 1` stops. */
export function rampToCss(
  ramp: Ramp,
  steps = 24,
  direction = "to bottom",
): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stops.push(`${rgbToCss(sampleRamp(ramp, t))} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

/**
 * A CSS gradient built from a rendered frame's row profile.
 *
 * The worker averages a fixed number of horizontal bands out of every frame
 * and hands them back as flat RGB triples. Feeding that here yields a
 * gradient string matching what is on screen *right now* - noise
 * displacement and scroll offset included - which is what lets other
 * elements (an accent word, a rule, a scrollbar) be filled from the colours
 * the field is actually showing rather than a static approximation of them.
 */
export function rowsToCss(
  rows: ArrayLike<number>,
  direction = "to bottom",
): string {
  const count = Math.floor(rows.length / 3);
  if (count < 2) throw new Error("rowsToCss needs at least two rows");
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const colour: Rgb = [
      rows[i * 3] ?? 0,
      rows[i * 3 + 1] ?? 0,
      rows[i * 3 + 2] ?? 0,
    ];
    stops.push(`${rgbToCss(colour)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export interface SignatureRampOptions {
  /** Build for a dark surface (the default) or a light one. */
  dark?: boolean;
  /**
   * Degrees of hue rotation between the ramp's ends.
   *
   * One hue at four lightnesses reads as a flat wash. Fanning the stops
   * across ~60° of hue gives the field somewhere to travel as it scrolls
   * while staying recognisably a single colour.
   */
  hueSpread?: number;
}

/**
 * `[position, lightness, chromaScale, hueOffset]`
 *
 * The ladder is shared: `signatureRamp` uses all four fields, `duotoneRamp`
 * uses the first three and takes its hue from the two anchors instead.
 */
type LadderStep = readonly [number, number, number, number];

const DARK_LADDER: readonly LadderStep[] = [
  [0.0, 0.3, 0.55, -1],
  [0.42, 0.68, 1.0, 0],
  [0.86, 0.86, 0.62, 1],
  [1.0, 0.92, 0.4, 1.2],
];

const LIGHT_LADDER: readonly LadderStep[] = [
  [0.0, 0.52, 0.7, -1],
  [0.42, 0.72, 0.95, 0],
  [0.86, 0.9, 0.5, 1],
  [1.0, 0.95, 0.3, 1.2],
];

/**
 * Build a four-stop field ramp from one signature colour.
 *
 * The shape - deep and slightly desaturated at 0, the accent itself just
 * past a third, bright and lower-chroma near the top - is tuned so
 * `progress: 0` sits in shadow and scrolling walks up into light. Lightness
 * targets are absolute OKLab values rather than relative adjustments, so
 * every signature yields a field of the same visual weight: a pale mono and
 * a saturated orange land in the same place.
 */
export function signatureRamp(
  accent: Rgb,
  options: SignatureRampOptions = {},
): Ramp {
  const { dark = true, hueSpread = 32 } = options;
  const [, chroma, hue] = srgbToOklch(accent);
  const ladder = dark ? DARK_LADDER : LIGHT_LADDER;
  return ladder.map(([position, lightness, chromaScale, hueSteps]) => {
    const shifted = (((hue + hueSteps * hueSpread) % 360) + 360) % 360;
    return [
      position,
      oklchToSrgb([lightness, chroma * chromaScale, shifted]),
    ] as RampStop;
  });
}

/**
 * Build a ramp that travels between two colours.
 *
 * `signatureRamp` fans one accent across ~60° of hue, which keeps a field
 * recognisably one colour. This does the opposite: it takes two anchors that
 * may be nowhere near each other - a deep teal and a pastel pink - and walks
 * from the shadow below the first, through both, to a highlight above the
 * second.
 *
 * Two things make an arbitrary pair work rather than turn to mud:
 *
 *   - Hue travels the short way round the wheel in OKLCh, so teal→pink goes
 *     through blue and magenta rather than sliding through grey. Interpolating
 *     the same pair in sRGB passes straight through the desaturated middle,
 *     which is exactly the "AI gradient" look.
 *   - Lightness follows a fixed ladder rather than the anchors' own. Two
 *     colours picked for their hue rarely differ in lightness the way a field
 *     needs, and without this the gradient has no direction to travel in.
 *     The anchors contribute hue and chroma; the ladder supplies the climb.
 */
export function duotoneRamp(
  from: Rgb,
  to: Rgb,
  options: SignatureRampOptions = {},
): Ramp {
  const { dark = true } = options;
  const [, fromChroma, fromHue] = srgbToOklch(from);
  const [, toChroma, toHue] = srgbToOklch(to);

  // Shortest path around the hue circle: +200° and -160° are the same
  // rotation, and taking the long way is what drags a ramp through grey.
  let delta = ((toHue - fromHue + 540) % 360) - 180;
  // A pair that is nearly opposite has no short way; nudge it so the walk is
  // deterministic instead of flipping on a rounding error.
  if (Math.abs(Math.abs(delta) - 180) < 0.001) delta = 180;

  const ladder = dark ? DARK_LADDER : LIGHT_LADDER;
  return ladder.map(([position, lightness, chromaScale]) => {
    // `position` doubles as how far along the hue walk this stop sits.
    const hue = (((fromHue + delta * position) % 360) + 360) % 360;
    const chroma = fromChroma + (toChroma - fromChroma) * position;
    return [
      position,
      oklchToSrgb([lightness, chroma * chromaScale, hue]),
    ] as RampStop;
  });
}

/**
 * The site's signature accents, as authored in tokens.css and the globe's
 * `SIGS` table. Kept as hex here so `@repo/ui` stays free of app imports;
 * these are the dark-theme values, which are the tuned ones.
 */
export const SIGNATURE_ACCENTS = {
  mono: "#ece9e1",
  blue: "#4d8dff",
  green: "#3ddc97",
  violet: "#b47cff",
  coral: "#ff5c7a",
  orange: "#ff5c00",
} as const;

export type SignatureId = keyof typeof SIGNATURE_ACCENTS;

/**
 * Named two-colour fields.
 *
 * Deliberately not variations on one hue. A gradient that runs violet to
 * lavender is the house style of every AI product shipped since 2023, and
 * looking like that is a choice worth not making by accident. These each
 * cross a real distance - teal to blush, moss to citrus - so the field has
 * somewhere to go as it scrolls.
 */
export const DUOTONES = {
  /** Deep teal → pastel blush. Cool through magenta. */
  tealBlush: ["#0d4f54", "#ffb3c7"],
  /** Forest → citrus. Green without going near lime-on-black. */
  moss: ["#10402f", "#d6f87e"],
  /** Midnight indigo → warm amber. The widest travel of the set. */
  dusk: ["#1b1f6b", "#ffb257"],
  /** Deep sea → ice. Cold end to end; good behind dense text. */
  glacier: ["#0a2a4a", "#a8e8f0"],
  /** Oxblood → sand. Warm end to end. */
  rust: ["#4a1a12", "#e8c9a0"],
  /** Slate → jade. Nearly neutral, for when the field should recede. */
  quiet: ["#1e2430", "#7fd4b0"],
} as const;

export type DuotoneId = keyof typeof DUOTONES;

/**
 * Every ready-made dark-surface ramp: one per signature accent, one per
 * named duotone.
 */
export const RAMPS: Record<SignatureId | DuotoneId, Ramp> = {
  ...(Object.fromEntries(
    Object.entries(SIGNATURE_ACCENTS).map(([id, hex]) => [
      id,
      signatureRamp(hexToRgb(hex)),
    ]),
  ) as Record<SignatureId, Ramp>),
  ...(Object.fromEntries(
    Object.entries(DUOTONES).map(([id, [from, to]]) => [
      id,
      duotoneRamp(hexToRgb(from), hexToRgb(to)),
    ]),
  ) as Record<DuotoneId, Ramp>),
};

export type RampId = SignatureId | DuotoneId;

/** Flatten a ramp so it survives `postMessage`'s structured clone as plain data. */
export function serializeRamp(ramp: Ramp): FlatRampStop[] {
  return ramp.map(
    ([position, [r, g, b]]) => [position, r, g, b] as FlatRampStop,
  );
}

export function deserializeRamp(flat: readonly FlatRampStop[]): Ramp {
  return flat.map(([position, r, g, b]) => [position, [r, g, b]] as RampStop);
}
