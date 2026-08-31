/* Regenerate the profile: `bun run generate`.
 *
 * Writes two files and rewrites one section of README.md:
 *
 *   assets/stats-dark.svg    the ssh-cv window, holding live numbers, with the
 *                            site's gradient field as a band inside it
 *   assets/stats-light.svg   the same, for a light-themed reader
 *
 * One image rather than a banner and a card, because a window with the field
 * inside it is one object and two stacked images are two.
 *
 * Nothing is written whose bytes have not changed. That matters more than it
 * sounds: each of these carries the field as embedded base64, so a weekly job
 * that rewrote them unconditionally would add a quarter of a megabyte of git
 * history every week for an image that had not moved a pixel. The field is
 * deterministic - same ramp, same noise, same output - so on a week where only
 * the numbers moved, only the numbers are committed.
 */

import { renderBanner } from "./lib/banner.js";
import { CARD_WIDTH, FIELD_RENDER, renderCard } from "./lib/card.js";
import { fetchStats } from "./lib/github.js";
import type { RampId } from "./lib/vendor/ramps.js";

const LOGIN = "riptone";

/* Glacier: deep sea to ice. The calmest of the set and the one built to sit
   behind text, which is what a banner with a wordmark on it is. Change this
   and re-run to repaint both the banner and the card's language bar - they
   sample the same ramp, so they cannot disagree. */
const RAMP: RampId = "glacier";

/* The card owns the field's resolution, because the card owns the band it has
   to fill - see FIELD_RENDER in card.ts for why it is smaller than that band.
   Derived rather than repeated here: two numbers that must match are two
   numbers that will eventually not. */
const FIELD = FIELD_RENDER;

/** The alt text is a sentence a screen reader says, so "1 stars" is wrong. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Write only if the content differs.
 *
 * Returns whether it wrote. Bytes rather than mtime, because every file here
 * is regenerated from scratch on every run and mtime would always differ.
 */
async function writeIfChanged(
  path: string,
  content: Uint8Array | string,
): Promise<boolean> {
  const next =
    typeof content === "string" ? new TextEncoder().encode(content) : content;

  const file = Bun.file(path);
  if (await file.exists()) {
    const current = new Uint8Array(await file.arrayBuffer());
    if (current.length === next.length && current.every((b, i) => b === next[i])) {
      return false;
    }
  }
  await Bun.write(path, next);
  return true;
}

/**
 * Replace the generated block in README.md, leaving everything else alone.
 *
 * Markers rather than writing the whole file: the prose around the card is
 * hand-written and should stay that way. A generator that owns the entire
 * README is a generator you have to edit to change a sentence.
 */
function spliceReadme(readme: string, block: string): string {
  const start = "<!-- generated:start -->";
  const end = "<!-- generated:end -->";
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `README.md is missing the ${start} / ${end} markers - refusing to guess where the generated block goes`,
    );
  }
  return (
    readme.slice(0, from + start.length) +
    "\n" +
    block.trim() +
    "\n" +
    readme.slice(to)
  );
}

const now = new Date();
const token = process.env.STATS_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.log("no STATS_TOKEN or GITHUB_TOKEN: contributions will be omitted");
}

const stats = await fetchStats(LOGIN, token, now);
console.log(
  `stats: ${stats.repos} repos, ${stats.stars} stars, ${stats.followers} followers, ` +
    `${stats.contributions ?? "?"} contributions, ${stats.languages.length} languages`,
);

const wrote: string[] = [];

/* Rendered once and embedded in both variants. The field does not change with
   the colour scheme - it is the same photograph either way. */
const field = renderBanner({ ...FIELD, ramp: RAMP });

for (const dark of [true, false]) {
  const path = `assets/stats-${dark ? "dark" : "light"}.svg`;
  if (
    await writeIfChanged(
      path,
      renderCard({ stats, ramp: RAMP, dark, now, field }),
    )
  ) {
    wrote.push(path);
  }
}

/* Displayed at its authored size, 1:1 - see CARD_WIDTH in card.ts.
 *
 * A pixel width, never `width="100%"`: percent has no ceiling, so on a wide
 * window the card stretched past the size its type was laid out at. A fixed
 * width still shrinks on a phone, because GitHub's own README styles apply
 * `max-width: 100%` to images - so this is a ceiling, not a size. */
const DISPLAY_WIDTH = CARD_WIDTH;

/* One image, linked to the site. `<picture>` rather than a media query inside
   the SVG: GitHub proxies images and serves one cached response to everybody,
   so the choice has to be made by the reader's browser from the markup, not
   inside the file. */
const block = `<a href="https://tone.rip">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="assets/stats-light.svg">
    <img alt="tone stats: ${plural(stats.repos, "public repo")} · ${plural(stats.stars, "star")} · ${plural(stats.followers, "follower")}" src="assets/stats-dark.svg" width="${DISPLAY_WIDTH}">
  </picture>
</a>`;

const readme = await Bun.file("README.md").text();
if (await writeIfChanged("README.md", spliceReadme(readme, block))) {
  wrote.push("README.md");
}

if (wrote.length === 0) {
  console.log("nothing changed");
} else {
  console.log(`wrote ${wrote.join(", ")}`);
}
