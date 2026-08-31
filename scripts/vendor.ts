/* Pull the field renderer and palette maths in from tonil: `bun run vendor`.
 *
 * The banner on this profile is not a picture of the site's gradient field. It
 * is the field - the same `renderField`, the same OKLCh ramp ladder, the same
 * noise - run headlessly and written to a PNG. That is only true if these
 * files are tonil's files, so they are fetched rather than retyped, and this
 * script is how they get refreshed.
 *
 * Why vendored at all, instead of importing `@repo/ui/gradient`: that package
 * is a workspace package inside a private-ish monorepo with its own build
 * tooling, and this repository is a README. Vendoring three files of pure
 * maths - no DOM, no dependencies, no imports outside themselves - costs a
 * `bun run vendor` when the palette changes and buys a repo that installs
 * nothing and can be understood in one sitting.
 *
 * What makes it safe: these three are the stable, boring end of that package.
 * `oklab.ts` is colour-space conversion, `ramps.ts` is the ladder that turns
 * an accent into four stops, `field.ts` is value noise and a sampler. None of
 * them has changed shape in the life of the site, and if one does, the worst
 * case is a banner that looks slightly different from the site until someone
 * runs this again.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/riptone/tonil/main/packages/ui/src/gradient";

/* field.ts imports from ramps.ts, ramps.ts from oklab.ts, oklab.ts from
   nothing. Fetched in that order so a partial failure leaves the tree in a
   state where the missing file is the one at the top. */
const FILES = ["oklab.ts", "ramps.ts", "field.ts"] as const;

const HEADER = `/* Vendored from tonil - do not edit here.
 *
 * Source: packages/ui/src/gradient/%NAME%
 *         ${SOURCE}/%NAME%
 *
 * Refresh with \`bun run vendor\`. Editing this copy instead means the banner
 * stops being the site's field and starts being a lookalike, which is the one
 * thing the banner is for.
 */

`;

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "lib", "vendor");
await mkdir(out, { recursive: true });

for (const name of FILES) {
  const response = await fetch(`${SOURCE}/${name}`);
  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`);
  }
  const body = await response.text();

  // A fetch that 200s with an HTML error page would otherwise be written out
  // as a TypeScript file and fail much later, somewhere less obvious.
  if (!body.includes("export")) {
    throw new Error(`${name}: fetched ${body.length} bytes with no exports`);
  }

  await Bun.write(
    join(out, name),
    HEADER.replaceAll("%NAME%", name) + body,
  );
  console.log(`vendored ${name}  (${body.length} bytes)`);
}
