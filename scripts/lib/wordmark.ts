/* The `tone` wordmark, as pixels.
 *
 * The same bitmaps as tonil's packages/ui/src/brand/generate.py, kept here as
 * data rather than fetched because they *are* the design: five by eight cells,
 * one stroke width, no anti-aliasing. There is nothing to derive.
 *
 * Two letters carry a second meaning:
 *
 *   t   a cross - the crossbar runs the letter's full width instead of
 *       sitting off to one side, so it reads as a crucifix before it reads
 *       as a letter.
 *   n   a headstone - an arch on two legs, a post standing taller than the
 *       slab on the left, and two engraved lines between them. The post is
 *       what makes the lines safe: a plain arch with lines in its counter
 *       reads as "A" once it is sitting next to "o" and "e".
 *
 * Row 0 is blank for every letter except `n`, which uses it for the post.
 */

const GLYPHS: Record<string, readonly string[]> = {
  t: [".....", "..#..", "#####", "..#..", "..#..", "..#..", "..#..", "..#.."],
  o: [".....", ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  n: ["#....", ".###.", "#...#", "#...#", "#.#.#", "#...#", "#.#.#", "#...#"],
  e: [".....", "#####", "#....", "#....", "####.", "#....", "#....", "#####"],
};

export const GLYPH_COLS = 5;
export const GLYPH_ROWS = 8;
/** Blank columns between letters. */
export const GLYPH_GAP = 1;

export interface Cell {
  col: number;
  row: number;
}

/**
 * Every filled cell of `word`, in a single coordinate space.
 *
 * Returned as cells rather than pixels so the caller owns the scale: the
 * banner stamps them at whatever size makes the mark the right weight against
 * the field behind it.
 */
export function wordCells(word: string): {
  cells: Cell[];
  cols: number;
  rows: number;
} {
  const cells: Cell[] = [];
  let x = 0;
  for (const character of word) {
    const glyph = GLYPHS[character];
    if (!glyph) throw new Error(`no glyph for ${JSON.stringify(character)}`);
    glyph.forEach((line, row) => {
      [...line].forEach((ink, col) => {
        if (ink === "#") cells.push({ col: x + col, row });
      });
    });
    x += GLYPH_COLS + GLYPH_GAP;
  }
  return {
    cells,
    // The trailing gap after the last letter is not part of the word.
    cols: x - GLYPH_GAP,
    rows: GLYPH_ROWS,
  };
}
