/* The profile picture: `bun run avatar`.
 *
 * The field and nothing else - no wordmark. Cropped to a circle by GitHub and
 * shown at 40px in half the places it appears, which is exactly the size at
 * which a four-letter mark becomes four grey smudges. A colour reads at 40px;
 * type does not.
 *
 * Deliberately NOT part of `bun run generate`, so the weekly refresh never
 * touches it. It is deterministic - same ramp, same noise, same bytes - and it
 * is not displayed in the README, so regenerating it on a schedule would be
 * committing an identical file forever and hoping nobody looks. Run it by hand
 * when the palette changes, then upload it: GitHub → Settings → Profile →
 * Picture. Nothing automates that last step; an avatar is not in a repository.
 */

import { renderBanner } from "./lib/banner.js";
import type { RampId } from "./lib/vendor/ramps.js";

/* The same ramp the card's band uses, so the avatar and the README are the
   same object seen twice. Change both together or neither. */
const RAMP: RampId = "glacier";

/* 640, which is not the largest that fits.
 *
 * GitHub rejects an avatar over 1 MB, and this image is mostly grain - one
 * noise value per output pixel, high-entropy, so it barely compresses and the
 * file grows with the square of the side. Measured: 640 is 520 kB, 800 is
 * 799 kB, and 1000 is 1231 kB and refused outright.
 *
 * 640 rather than 800 because the largest displayed size is 460 (the profile
 * page) and everything else is 40-80px, so 800 buys nothing but 280 kB and a
 * file sitting one bad compression away from being rejected. */
const SIZE = 640;

/* Where in the ramp the image sits. 0.42 is where the field's own default
   `progress` lands, which is the part of the ramp the site shows at rest -
   dark at the top, bright at the bottom, and the mid-tones through the middle
   where a circular crop keeps them. */
const PROGRESS = 0.42;

const png = renderBanner({
  width: SIZE,
  height: SIZE,
  ramp: RAMP,
  progress: PROGRESS,
});

await Bun.write("assets/avatar.png", png);
console.log(
  `assets/avatar.png  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(0)} KB` +
    "\nupload at: GitHub → Settings → Profile → Picture",
);
