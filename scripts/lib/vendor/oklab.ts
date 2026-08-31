/* Vendored from tonil - do not edit here.
 *
 * Source: packages/ui/src/gradient/oklab.ts
 *         https://raw.githubusercontent.com/riptone/tonil/main/packages/ui/src/gradient/oklab.ts
 *
 * Refresh with `bun run vendor`. Editing this copy instead means the banner
 * stops being the site's field and starts being a lookalike, which is the one
 * thing the banner is for.
 */

/* sRGB ↔ OKLab / OKLCh.

   Ramps are authored as sRGB stops because that is how the rest of the
   design tokens are written, but every *derived* colour - the dark-theme
   variant of a ramp, the hue-spread stops built around a signature colour -
   is computed in OKLab. Interpolating or relighting in sRGB drags colours
   through grey at the midpoint and shifts hue as lightness changes; OKLab
   is perceptually uniform, so "same hue, lighter" actually stays the same
   hue. Björn Ottosson's matrices, unmodified. */

export type Rgb = readonly [number, number, number];
/** Lightness 0–1, and the two opponent axes. */
export type Oklab = readonly [number, number, number];
/** Lightness 0–1, chroma (roughly 0–0.4), hue in degrees. */
export type Oklch = readonly [number, number, number];

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(channel: number): number {
  const v =
    channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

export function srgbToOklab([r, g, b]: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear-light sRGB, *unclamped* - values outside 0–1 mean out of gamut. */
function oklabToLinearSrgb([L, a, b]: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Convert to sRGB, clipping anything out of gamut.
 *
 * Prefer {@link oklchToSrgb} for derived colours: clipping is exactly the
 * failure this module exists to avoid - see the note there.
 */
export function oklabToSrgb(lab: Oklab): Rgb {
  const [r, g, b] = oklabToLinearSrgb(lab);
  return [toGamma(r), toGamma(g), toGamma(b)];
}

/** Slack for float error, so a colour exactly on the boundary counts as inside. */
const GAMUT_EPSILON = 1e-6;

export function isInGamut(lab: Oklab): boolean {
  const linear = oklabToLinearSrgb(lab);
  return linear.every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  );
}

export function oklabToOklch([L, a, b]: Oklab): Oklch {
  const chroma = Math.hypot(a, b);
  // Hue of a neutral is meaningless; report 0 rather than atan2's noise so
  // round-tripping greys is stable.
  const hue =
    chroma < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, chroma, hue];
}

export function oklchToOklab([L, chroma, hue]: Oklch): Oklab {
  const radians = (hue * Math.PI) / 180;
  return [L, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

export function srgbToOklch(rgb: Rgb): Oklch {
  return oklabToOklch(srgbToOklab(rgb));
}

/**
 * Convert OKLCh to sRGB, reducing chroma until the colour fits the gamut.
 *
 * The naive path - convert, then clamp each channel - is what makes derived
 * palettes go wrong. sRGB cannot hold a saturated blue at lightness 0.86;
 * clamping the overflow silently drags the result to a *different* lightness
 * and hue (for `#4d8dff` at L=0.86, roughly 0.83 and 11° off). Since the
 * whole point of `signatureRamp` is that every signature lands at the same
 * lightness, that error would show up as some accents producing a visibly
 * heavier field than others.
 *
 * Holding lightness and hue fixed and giving up chroma instead is the
 * CSS Color 4 approach, and it is the right trade here: a slightly less
 * saturated highlight is invisible, a lightness mismatch between signatures
 * is not. Binary search converges to well under one 8-bit step in 16 steps.
 */
export function oklchToSrgb(lch: Oklch): Rgb {
  const lab = oklchToOklab(lch);
  if (isInGamut(lab)) return oklabToSrgb(lab);

  const [L, chroma, hue] = lch;
  // Lightness alone is always representable, so chroma 0 is a guaranteed floor.
  let low = 0;
  let high = chroma;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (isInGamut(oklchToOklab([L, mid, hue]))) low = mid;
    else high = mid;
  }
  return oklabToSrgb(oklchToOklab([L, low, hue]));
}

/** Perceptual lightness of a colour, 0 (black) – 1 (white). */
export function lightnessOf(rgb: Rgb): number {
  return srgbToOklab(rgb)[0];
}

/**
 * Re-light a colour to a target lightness, keeping its hue.
 *
 * `chromaScale` pulls saturation in or out at the same time - useful because
 * a colour pushed to a very high or very low lightness keeps more chroma
 * than sRGB can represent, and clipping it there is what makes naive
 * "lighten" functions go chalky.
 */
export function withLightness(
  rgb: Rgb,
  lightness: number,
  chromaScale = 1,
): Rgb {
  const [, chroma, hue] = srgbToOklch(rgb);
  return oklchToSrgb([lightness, chroma * chromaScale, hue]);
}

/** Rotate a colour's hue by `degrees`, keeping lightness and chroma. */
export function withHueShift(rgb: Rgb, degrees: number): Rgb {
  const [L, chroma, hue] = srgbToOklch(rgb);
  return oklchToSrgb([L, chroma, (((hue + degrees) % 360) + 360) % 360]);
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse `#rgb` / `#rrggbb`. Throws on anything else - ramps are authored, not user input. */
export function hexToRgb(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) throw new Error(`Not a hex colour: ${hex}`);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}
