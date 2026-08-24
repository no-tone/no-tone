/* The card: the ssh-cv window, as an SVG, with the field inside it.
 *
 * Deliberately the same object as `ssh cv.tone.rip` draws - three traffic
 * lights, a dim right-aligned title, a rule, a key/value column, a footer
 * line. The palette is lifted straight from apps/ssh-cv/internal/tui/theme.go
 * rather than re-picked, so the card and the terminal are the same grey.
 *
 * The banner is a row inside the window rather than a second image above it,
 * which is what makes this one object instead of two stacked ones. Three
 * layers, in order:
 *
 *   1. the field, as an embedded PNG - per-pixel noise, so it has to be a
 *      raster, and rendered at 1x because soft is the intent (see banner.ts)
 *   2. a vignette, as an SVG radial gradient - so it can be tuned without
 *      re-encoding an image, and so it has no flat plateau
 *   3. the wordmark, as rectangles - four letters of axis-aligned boxes whose
 *      whole point is hard edges, sharp at any zoom and any display density
 *
 * Two constraints shape everything here, and both come from where it is
 * displayed:
 *
 *   **No fonts, no external anything.** GitHub renders this through an <img>,
 *   which is a sandbox: no webfont loads and no file can be referenced, which
 *   is exactly why the field is a data URI rather than a `src`. Type is a
 *   monospace *stack* and resolves to whatever the reader already has, so text
 *   widths are unknown at build time - hence fixed columns and never a layout
 *   that depends on measuring a string.
 *
 *   **One cached response for everyone.** A `prefers-color-scheme` query
 *   inside the SVG does work in a browser, but GitHub proxies images and
 *   serves one copy to every reader, so half of them would get the wrong one.
 *   Two files and a <picture> element is the thing that actually works - which
 *   is why `dark` is an argument here rather than a media query.
 */

import { relativeTime, type Stats } from "./github.js";
import { RAMPS, type RampId, sampleRamp } from "./vendor/ramps.js";
import { GLYPH_ROWS, wordCells } from "./wordmark.js";

/* apps/ssh-cv/internal/tui/theme.go, verbatim. The ANSI-256 indices in that
   file are the terminal's problem; the hexes are the design. */
const DARK = {
  ground: "#000000",
  text: "#ffffff",
  muted: "#b4b4b4",
  faint: "#8a8a8a",
  rule: "#3a3a3a",
} as const;

/* The site's light theme, from packages/ui/src/styles/tokens.css. Not an
   inversion of the above: #000 on #fff is harsher than either design uses. */
const LIGHT = {
  ground: "#ffffff",
  text: "#161a23",
  muted: "#3d4353",
  faint: "#5c6373",
  rule: "#d8dae0",
} as const;

/* The one thing that is not from the terminal. macOS window buttons are these
   colours everywhere, and changing them would break the reference. */
const BUTTONS = ["#ff5f57", "#febc2e", "#28c840"] as const;

const FONT =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";

/* Authored at the size it is displayed at, 1:1.
 *
 * This is the third width, and the reason it keeps moving is worth writing
 * down: because the card is authored 1:1, changing the display width is not a
 * zoom, it is a re-layout. 760-authored-shown-at-820 was fine. Dropping the
 * display to 460 without touching the geometry put 15px type on screen at 9px,
 * which is where "too small" came from - the card was not too small, the text
 * inside it was. So every number below moves together, and the font sizes are
 * chosen for the width rather than inherited from a previous one.
 *
 * 700 puts the row text at 14px, which is what GitHub sets its own body text
 * at, so the card reads as part of the page rather than as a thumbnail of
 * something. */
export const CARD_WIDTH = 700;

const PAD = 20;
const TITLE_BAR = 44;
const BAND_HEIGHT = 160;
const ROW = 28;
const KEY_WIDTH = 120;

const SIZE_TITLE = 12;
const SIZE_ROW = 14;
const SIZE_SMALL = 11.5;

/* The resolution to render the field at, which is deliberately *not* the band
 * it fills - the <image> element scales it, and 0.6x is invisible on something
 * whose softness is the point (it is already a quarter-scale upscale, see
 * banner.ts). Only the aspect ratio has to match, or `slice` would crop it.
 *
 * This is what keeps the embed affordable. At 1:1 the band would be 660x160,
 * which is 105k pixels of grain - high-entropy, so it barely compresses - and
 * that lands at roughly a quarter of a megabyte per file, twice, in every
 * commit that touches the numbers. */
const FIELD_SCALE = 0.6;
export const FIELD_RENDER = {
  width: Math.round((CARD_WIDTH - PAD * 2) * FIELD_SCALE),
  height: Math.round(BAND_HEIGHT * FIELD_SCALE),
} as const;

/** XML-escape. Repository and language names come off an API. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hex(rgb: readonly number[]): string {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface Row {
  key: string;
  value: string;
}

function rowsFor(stats: Stats, now: Date): Row[] {
  const rows: Row[] = [
    { key: "repos", value: String(stats.repos) },
    { key: "stars", value: String(stats.stars) },
    { key: "followers", value: String(stats.followers) },
  ];

  // Absent rather than zero when there was no token: printing "0" because a
  // secret expired is worse than printing nothing.
  if (stats.contributions !== null) {
    rows.push({
      key: "commits",
      value: `${stats.contributions.toLocaleString("en-GB")} in the last year`,
    });
  }
  if (stats.latest) {
    rows.push({
      key: "latest",
      value: `${stats.latest.name} · ${relativeTime(stats.latest.pushedAt, now)}`,
    });
  }
  if (stats.sshCvVersion) {
    rows.push({ key: "ssh-cv", value: stats.sshCvVersion });
  }
  return rows;
}

/** Where language `index` samples the ramp. Kept in one place so the bar and
 *  the legend cannot disagree about which colour belongs to which name. */
function rampPosition(index: number, count: number): number {
  // The brighter half only: the bottom of a dark ramp is nearly the card's own
  // background, so a segment painted from it would read as a gap.
  return count === 1 ? 0.7 : 0.34 + (index / (count - 1)) * 0.62;
}

export interface CardOptions {
  stats: Stats;
  ramp: RampId;
  dark: boolean;
  now: Date;
  /** The field, as PNG bytes. Embedded, because an <img> SVG cannot fetch. */
  field: Uint8Array;
}

export function renderCard({
  stats,
  ramp,
  dark,
  now,
  field,
}: CardOptions): string {
  const theme = dark ? DARK : LIGHT;
  const rows = rowsFor(stats, now);
  const languages = stats.languages;

  // Suffixed so the two variants never collide if both ever land in one
  // document. `<picture>` renders only one, but ids are cheap to make safe.
  const scope = dark ? "d" : "l";

  const bandX = PAD;
  const bandY = TITLE_BAR + 10;
  const bandWidth = CARD_WIDTH - PAD * 2;

  /* The wordmark, centred in the band. Sized off the band height so it keeps
     its proportions if the band ever changes, and rounded to a whole number of
     pixels per cell - a fractional cell size is how a pixel font stops looking
     like one. */
  const { cells, cols } = wordCells("tone");
  const cell = Math.max(2, Math.round((BAND_HEIGHT * 0.4) / GLYPH_ROWS));
  const markWidth = cols * cell;
  const markHeight = GLYPH_ROWS * cell;
  const markX = Math.round(bandX + (bandWidth - markWidth) / 2);
  const markY = Math.round(bandY + (BAND_HEIGHT - markHeight) / 2);

  const body: string[] = [];
  let y = bandY + BAND_HEIGHT + 34;

  for (const row of rows) {
    body.push(
      `<text x="${PAD}" y="${y}" fill="${theme.faint}" font-size="${SIZE_ROW}" font-family="${FONT}">${esc(row.key)}</text>`,
      `<text x="${PAD + KEY_WIDTH}" y="${y}" fill="${theme.text}" font-size="${SIZE_ROW}" font-family="${FONT}">${esc(row.value)}</text>`,
    );
    y += ROW;
  }

  if (languages.length > 0) {
    y += 6;
    body.push(
      `<text x="${PAD}" y="${y}" fill="${theme.faint}" font-size="${SIZE_ROW}" font-family="${FONT}">languages</text>`,
    );

    /* The bar is painted from the field's own ramp rather than from GitHub's
       language colours. Those are recognisable, but they are somebody else's
       palette and six of them side by side is the exact confetti this design
       is trying not to be. The legend carries the naming instead. */
    const barX = PAD + KEY_WIDTH;
    const barWidth = CARD_WIDTH - barX - PAD;
    const barHeight = 10;
    const gap = 2;

    let offset = 0;
    languages.forEach((language, index) => {
      const colour = hex(
        sampleRamp(RAMPS[ramp], rampPosition(index, languages.length)),
      );
      const segment = Math.max(
        2,
        language.share * (barWidth - gap * (languages.length - 1)),
      );
      body.push(
        `<rect x="${(barX + offset).toFixed(1)}" y="${y - barHeight}" width="${segment.toFixed(1)}" height="${barHeight}" rx="2" fill="${colour}"/>`,
      );
      offset += segment + gap;
    });

    y += ROW;

    /* Three columns fit at this width; they did not at 460, which is the kind
       of thing that has to be re-decided when the geometry moves rather than
       scaled. Measuring to be sure is not available here - see the note at the
       top - so the count is conservative for the longest plausible name. */
    const perRow = 3;
    const columnWidth = (CARD_WIDTH - barX - PAD) / perRow;
    languages.forEach((language, index) => {
      const column = index % perRow;
      const line = Math.floor(index / perRow);
      const x = barX + column * columnWidth;
      const lineY = y + line * 21;
      const colour = hex(
        sampleRamp(RAMPS[ramp], rampPosition(index, languages.length)),
      );
      body.push(
        `<rect x="${x}" y="${lineY - 8}" width="8" height="8" rx="1.5" fill="${colour}"/>`,
        `<text x="${x + 14}" y="${lineY}" fill="${theme.muted}" font-size="${SIZE_SMALL}" font-family="${FONT}">${esc(language.name)} ${Math.round(language.share * 100)}%</text>`,
      );
    });
    y += Math.ceil(languages.length / perRow) * 21;
  }

  const footerY = y + 8;
  const height = Math.round(footerY + PAD);

  const stamp = stats.generatedAt.slice(0, 10);
  const fieldUri = `data:image/png;base64,${Buffer.from(field).toString("base64")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}" role="img" aria-label="${esc(`tone — ${stats.repos} repos, ${stats.stars} stars, ${stats.followers} followers`)}">
  <defs>
    <clipPath id="band-${scope}">
      <rect x="${bandX}" y="${bandY}" width="${bandWidth}" height="${BAND_HEIGHT}" rx="5"/>
    </clipPath>
    <radialGradient id="halo-${scope}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="#000000" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${height - 1}" rx="10" fill="${theme.ground}" stroke="${theme.rule}"/>
  ${BUTTONS.map((colour, index) => `<circle cx="${PAD + 6 + index * 19}" cy="${TITLE_BAR / 2}" r="5.5" fill="${colour}"/>`).join("\n  ")}
  <text x="${CARD_WIDTH - PAD}" y="${TITLE_BAR / 2 + 3.5}" text-anchor="end" fill="${theme.faint}" font-size="${SIZE_TITLE}" font-family="${FONT}">${esc(`tone — stats · ${stamp}`)}</text>
  <line x1="${PAD}" y1="${TITLE_BAR}" x2="${CARD_WIDTH - PAD}" y2="${TITLE_BAR}" stroke="${theme.rule}"/>

  <g clip-path="url(#band-${scope})">
    <image href="${fieldUri}" x="${bandX}" y="${bandY}" width="${bandWidth}" height="${BAND_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>
    <ellipse cx="${markX + markWidth / 2}" cy="${markY + markHeight / 2}" rx="${markWidth * 1.5}" ry="${markHeight * 1.9}" fill="url(#halo-${scope})"/>
    <g fill="#ffffff">${cells
      .map(
        ({ col, row }) =>
          `<rect x="${markX + col * cell}" y="${markY + row * cell}" width="${cell}" height="${cell}"/>`,
      )
      .join("")}</g>
  </g>

  ${body.join("\n  ")}
  <text x="${PAD}" y="${footerY}" fill="${theme.faint}" font-size="${SIZE_SMALL}" font-family="${FONT}">regenerated weekly · ssh cv.tone.rip · tone.rip</text>
</svg>
`;
}
