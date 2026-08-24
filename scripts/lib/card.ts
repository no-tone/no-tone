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
 * The first version was 760 wide and shown at 820, which was fine - then the
 * display width came down to 460 and everything scaled with it, putting
 * 15px type on screen at 9px. Vector text costs nothing to re-lay-out, so the
 * geometry moved instead of the scale factor: every number below is a real
 * pixel on the reader's screen, and the font sizes are chosen for that. */
export const CARD_WIDTH = 460;

const PAD = 14;
const TITLE_BAR = 32;
const BAND_HEIGHT = 108;
const ROW = 20;
const KEY_WIDTH = 84;

const SIZE_TITLE = 9.5;
const SIZE_ROW = 11;
const SIZE_SMALL = 9.5;

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
  let y = bandY + BAND_HEIGHT + 26;

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
    const barHeight = 8;
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

    /* Two columns, not three. At this width three would put the longest name
       and its percentage past the right edge, and measuring to find out is not
       available here - see the note at the top. */
    const perRow = 2;
    const columnWidth = (CARD_WIDTH - barX - PAD) / perRow;
    languages.forEach((language, index) => {
      const column = index % perRow;
      const line = Math.floor(index / perRow);
      const x = barX + column * columnWidth;
      const lineY = y + line * 16;
      const colour = hex(
        sampleRamp(RAMPS[ramp], rampPosition(index, languages.length)),
      );
      body.push(
        `<rect x="${x}" y="${lineY - 7}" width="7" height="7" rx="1.5" fill="${colour}"/>`,
        `<text x="${x + 12}" y="${lineY}" fill="${theme.muted}" font-size="${SIZE_SMALL}" font-family="${FONT}">${esc(language.name)} ${Math.round(language.share * 100)}%</text>`,
      );
    });
    y += Math.ceil(languages.length / perRow) * 16;
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

  <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${height - 1}" rx="9" fill="${theme.ground}" stroke="${theme.rule}"/>
  ${BUTTONS.map((colour, index) => `<circle cx="${PAD + 5 + index * 14}" cy="${TITLE_BAR / 2}" r="4.5" fill="${colour}"/>`).join("\n  ")}
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
