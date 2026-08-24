/* Regenerate the profile: `bun run generate`.
 *
 * Writes three things and rewrites one section of README.md:
 *
 *   assets/banner.png        the site's gradient field with the wordmark in it
 *   assets/stats-dark.svg    the ssh-cv window, holding live numbers
 *   assets/stats-light.svg   the same, for a light-themed reader
 *
 * The banner is deterministic and the card is not, and that distinction is the
 * whole reason this is one script rather than two. A weekly job that rewrote a
 * 650 kB PNG every run would add a megabyte of git history a month for an
 * image that never changed a pixel; a weekly job that rewrites a 4 kB SVG adds
 * nothing anyone will notice. So the banner is only written when its bytes
 * actually differ - which is to say, when the palette or the wordmark changes
 * and somebody meant it.
 *
 * Everything reports whether it changed, so the workflow can skip the commit
 * entirely on a quiet week.
 */

import { renderBanner } from "./lib/banner.js";
import { renderCard } from "./lib/card.js";
import { fetchStats } from "./lib/github.js";
import type { RampId } from "./lib/vendor/ramps.js";

const LOGIN = "no-tone";

/* Glacier: deep sea to ice. The calmest of the set and the one built to sit
   behind text, which is what a banner with a wordmark on it is. Change this
   and re-run to repaint both the banner and the card's language bar - they
   sample the same ramp, so they cannot disagree. */
const RAMP: RampId = "glacier";

const BANNER = { width: 1200, height: 320 } as const;

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

if (
  await writeIfChanged(
    "assets/banner.png",
    renderBanner({ ...BANNER, ramp: RAMP }),
  )
) {
  wrote.push("assets/banner.png");
}

for (const dark of [true, false]) {
  const path = `assets/stats-${dark ? "dark" : "light"}.svg`;
  if (await writeIfChanged(path, renderCard({ stats, ramp: RAMP, dark, now }))) {
    wrote.push(path);
  }
}

/* A pixel width, not `width="100%"`.
 *
 * `100%` has no ceiling: on a wide window the profile column is wider than
 * either image is meant to be, so the banner grows until it dominates the page
 * and the card's type is scaled up past the size it was laid out at.
 *
 * A fixed width still shrinks on a phone, because GitHub's own README styles
 * apply `max-width: 100%` to images - so this is a cap rather than a size.
 * 820 sits just inside the profile column at desktop width, and the banner is
 * authored at 1200 wide, which leaves it downscaling (sharp) rather than
 * stretching on a high-density screen.
 *
 * Not `height`: these two have different aspect ratios, and matching their
 * widths is what makes them line up as one stacked block. */
const DISPLAY_WIDTH = 820;

/* `<picture>` rather than a media query inside the SVG: GitHub proxies images
   and serves one cached response to everybody, so the choice has to be made by
   the reader's browser from the markup, not inside the file. */
const block = `<a href="https://tone.rip">
  <img alt="tone" src="assets/banner.png" width="${DISPLAY_WIDTH}">
</a>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="assets/stats-light.svg">
  <img alt="${plural(stats.repos, "public repo")} · ${plural(stats.stars, "star")} · ${plural(stats.followers, "follower")}" src="assets/stats-dark.svg" width="${DISPLAY_WIDTH}">
</picture>`;

const readme = await Bun.file("README.md").text();
if (await writeIfChanged("README.md", spliceReadme(readme, block))) {
  wrote.push("README.md");
}

if (wrote.length === 0) {
  console.log("nothing changed");
} else {
  console.log(`wrote ${wrote.join(", ")}`);
}
