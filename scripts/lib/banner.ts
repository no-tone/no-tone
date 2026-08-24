/* The gradient field, as a PNG. Just the field - no wordmark, no vignette.
 *
 * Not a screenshot and not an approximation. `renderField` here is the same
 * function tone.rip runs in a Web Worker on every page load, given the same
 * ramp and the same tuning constants, so the colour is identical by
 * construction rather than by matching hex codes by eye.
 *
 * Two things are reproduced deliberately, because they are what makes the
 * field look like itself rather than like a gradient:
 *
 *   1. The upscale IS the softness. The site renders at a quarter of display
 *      size and lets the browser stretch it; there is no blur filter
 *      anywhere. So this renders small and upscales too - bilinearly, in
 *      code, because the PNG has to arrive already soft.
 *   2. Grain is a separate layer, at one noise pixel per output pixel. In the
 *      browser it is a tiled DOM element in `mix-blend-mode: overlay`; here
 *      it is composited directly, which is the same arithmetic.
 *
 * **Why the wordmark is not in here.** It used to be, stamped into the pixels
 * after the upscale. Then the banner moved inside the stats card, which is an
 * SVG, and an SVG can hold the mark as rectangles - so it does. The field is
 * the one thing that genuinely has to be a raster (it is per-pixel noise); the
 * mark is four letters of axis-aligned boxes whose entire point is hard edges,
 * and as vector it stays sharp at any zoom and on any display density while
 * the field underneath stays deliberately soft. See card.ts.
 *
 * That split is also what keeps the embedded image small: the field can be
 * rendered at 1x, because soft is the intent, where a stamped wordmark would
 * have forced 2x to avoid blurring the mark.
 */

import { renderField } from "./vendor/field.js";
import { renderGrainTile } from "./vendor/field.js";
import { RAMPS, type RampId } from "./vendor/ramps.js";
import { encodePng } from "./png.js";

/* Lifted from noise-gradient.ts's DEFAULTS. Copied rather than imported
   because they live in the mount function's options, which is DOM-bound -
   these are the four that shape the image. */
const FREQUENCY = 2;
const WARP = 0.3;
const TRAVEL = 1;
const ANGLE = 90;
const RENDER_SCALE = 0.25;
const GRAIN_SIZE = 200;
const GRAIN_ALPHA = 0.25;
const GRAIN_DEPTH = 50;

export interface BannerOptions {
  width: number;
  height: number;
  ramp: RampId;
  /** Where in the ramp the field sits, 0-1. The site drives this from scroll. */
  progress?: number;
  /** Autonomous drift. Changing it moves the noise without changing anything else. */
  phase?: number;
}

function samplePixel(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  out: [number, number, number],
): void {
  // Bilinear. Clamped at the edges rather than wrapped: the field is not
  // tileable, and wrapping would seam the right edge onto the left.
  const x = Math.min(Math.max(fx, 0), width - 1);
  const y = Math.min(Math.max(fy, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = x - x0;
  const ty = y - y0;

  for (let channel = 0; channel < 3; channel++) {
    const a = source[(y0 * width + x0) * 4 + channel]!;
    const b = source[(y0 * width + x1) * 4 + channel]!;
    const c = source[(y1 * width + x0) * 4 + channel]!;
    const d = source[(y1 * width + x1) * 4 + channel]!;
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    out[channel] = top + (bottom - top) * ty;
  }
}

export function renderBanner(options: BannerOptions): Uint8Array {
  const { width, height, ramp, progress = 0.42, phase = 0 } = options;

  // The small buffer the field is actually computed in.
  const smallWidth = Math.max(2, Math.round(width * RENDER_SCALE));
  const smallHeight = Math.max(2, Math.round(height * RENDER_SCALE));
  const small = new Uint8ClampedArray(smallWidth * smallHeight * 4);

  renderField(small, {
    width: smallWidth,
    height: smallHeight,
    // The display aspect, not the buffer's - this is what keeps noise cells
    // square when the box is much wider than it is tall, which a banner is.
    aspect: width / height,
    ramp: RAMPS[ramp],
    frequency: FREQUENCY,
    warp: WARP,
    travel: TRAVEL,
    angle: ANGLE,
    progress,
    phase,
    loop: false,
  });

  const grain = new Uint8ClampedArray(GRAIN_SIZE * GRAIN_SIZE * 4);
  renderGrainTile(grain, GRAIN_SIZE, GRAIN_DEPTH);

  const out = new Uint8ClampedArray(width * height * 4);
  const rgb: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      samplePixel(
        small,
        smallWidth,
        smallHeight,
        (x + 0.5) * RENDER_SCALE - 0.5,
        (y + 0.5) * RENDER_SCALE - 0.5,
        rgb,
      );

      // Overlay blend against the grain tile, which is greyscale, so one
      // channel of it is the whole story.
      const tile = ((y % GRAIN_SIZE) * GRAIN_SIZE + (x % GRAIN_SIZE)) * 4;
      const noise = grain[tile]! / 255;

      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const base = rgb[channel]! / 255;
        const blended =
          base < 0.5
            ? 2 * base * noise
            : 1 - 2 * (1 - base) * (1 - noise);
        const mixed = base + (blended - base) * GRAIN_ALPHA;
        out[index + channel] = Math.round(mixed * 255);
      }
      out[index + 3] = 255;
    }
  }

  return encodePng(out, width, height);
}
