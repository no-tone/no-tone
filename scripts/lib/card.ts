/* The stats card: the ssh-cv window, as an SVG.
 *
 * Deliberately the same object as `ssh cv.tone.rip` draws - three traffic
 * lights, a dim right-aligned title, a rule, a key/value column, a footer of
 * hints. The palette is lifted straight from apps/ssh-cv/internal/tui/theme.go
 * rather than re-picked, so the card and the terminal are the same grey.
 *
 * Two constraints shape everything here, and both come from where it is
 * displayed:
 *
 *   **No fonts.** GitHub renders this through an <img>, which is a sandbox: no
 *   webfont loads, no external anything. So the type is a monospace *stack*
 *   and resolves to whatever the reader already has. Which means text widths
 *   are unknown at build time - hence a fixed key column and a fixed value
 *   column, and never a layout that depends on measuring a string.
 *
 *   **No JavaScript, no CSS variables that matter.** A `prefers-color-scheme`
 *   media query inside an SVG loaded via <img> does work in current browsers,
 *   but GitHub's image proxy caches one response and serves it to everyone, so
 *   relying on it means half the readers get the wrong one. Two files and a
 *   <picture> element is the thing that actually works.
 */

import { relativeTime, type Stats } from "./github.js";
import { RAMPS, type RampId, sampleRamp } from "./vendor/ramps.js";

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

const WIDTH = 760;
const PAD = 26;
const TITLE_BAR = 44;
const ROW = 30;
const LINE = 15;

/** XML-escape. Repository names and language names come off an API. */
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

  // Absent rather than zero when there was no token: printing "0
  // contributions" because a secret expired is worse than printing nothing.
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

export interface CardOptions {
  stats: Stats;
  ramp: RampId;
  dark: boolean;
  now: Date;
}

export function renderCard({ stats, ramp, dark, now }: CardOptions): string {
  const theme = dark ? DARK : LIGHT;
  const rows = rowsFor(stats, now);
  const languages = stats.languages;

  const KEY_X = PAD;
  const VALUE_X = PAD + 132;

  let y = TITLE_BAR + 34;
  const body: string[] = [];

  for (const row of rows) {
    body.push(
      `<text x="${KEY_X}" y="${y}" fill="${theme.faint}" font-size="${LINE}" font-family="${FONT}">${esc(row.key)}</text>`,
      `<text x="${VALUE_X}" y="${y}" fill="${theme.text}" font-size="${LINE}" font-family="${FONT}">${esc(row.value)}</text>`,
    );
    y += ROW;
  }

  if (languages.length > 0) {
    y += 8;
    body.push(
      `<text x="${KEY_X}" y="${y}" fill="${theme.faint}" font-size="${LINE}" font-family="${FONT}">languages</text>`,
    );

    // The bar is painted from the field's own ramp rather than from GitHub's
    // language colours. Those are recognisable but they are somebody else's
    // palette, and six of them next to each other is the exact confetti this
    // whole design is trying not to be. Sampled across the ramp instead, so
    // the bar is legible as one object and the legend carries the naming.
    const barX = VALUE_X;
    const barWidth = WIDTH - VALUE_X - PAD;
    const barHeight = 10;
    const gap = 2;

    let offset = 0;
    languages.forEach((language, index) => {
      // Spread the samples across the ramp's brighter half: the bottom of a
      // dark ramp is nearly the card's own background.
      const position =
        languages.length === 1
          ? 0.7
          : 0.34 + (index / (languages.length - 1)) * 0.62;
      const colour = hex(sampleRamp(RAMPS[ramp], position));
      const segment = Math.max(
        2,
        language.share * (barWidth - gap * (languages.length - 1)),
      );
      body.push(
        `<rect x="${(barX + offset).toFixed(1)}" y="${y - barHeight + 1}" width="${segment.toFixed(1)}" height="${barHeight}" rx="2" fill="${colour}"/>`,
      );
      offset += segment + gap;
    });

    y += ROW - 4;

    // The legend, wrapped by hand into rows of three. Measuring is impossible
    // here (see the note at the top), so the columns are fixed and the names
    // are short enough that a wide monospace still fits.
    const perRow = 3;
    const columnWidth = (WIDTH - VALUE_X - PAD) / perRow;
    languages.forEach((language, index) => {
      const column = index % perRow;
      const line = Math.floor(index / perRow);
      const x = VALUE_X + column * columnWidth;
      const lineY = y + line * 22;
      const position =
        languages.length === 1
          ? 0.7
          : 0.34 + (index / (languages.length - 1)) * 0.62;
      const colour = hex(sampleRamp(RAMPS[ramp], position));
      body.push(
        `<rect x="${x}" y="${lineY - 8}" width="8" height="8" rx="1.5" fill="${colour}"/>`,
        `<text x="${x + 14}" y="${lineY}" fill="${theme.muted}" font-size="12" font-family="${FONT}">${esc(language.name)} ${Math.round(language.share * 100)}%</text>`,
      );
    });
    y += Math.ceil(languages.length / perRow) * 22;
  }

  const footerY = y + 18;
  const height = footerY + PAD;

  const stamp = stats.generatedAt.slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(`${stats.login} — ${stats.repos} repos, ${stats.stars} stars, ${stats.followers} followers`)}">
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${theme.ground}" stroke="${theme.rule}"/>
  ${BUTTONS.map((colour, index) => `<circle cx="${PAD + index * 18}" cy="${TITLE_BAR / 2}" r="5.5" fill="${colour}"/>`).join("\n  ")}
  <text x="${WIDTH - PAD}" y="${TITLE_BAR / 2 + 4}" text-anchor="end" fill="${theme.faint}" font-size="12" font-family="${FONT}">${esc(`${stats.login} — stats · ${stamp}`)}</text>
  <line x1="${PAD}" y1="${TITLE_BAR}" x2="${WIDTH - PAD}" y2="${TITLE_BAR}" stroke="${theme.rule}"/>
  ${body.join("\n  ")}
  <text x="${PAD}" y="${footerY}" fill="${theme.faint}" font-size="12" font-family="${FONT}">regenerated weekly · ssh cv.tone.rip · tone.rip</text>
</svg>
`;
}
