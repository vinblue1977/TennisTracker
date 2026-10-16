// WTN writes scores winner first ("7-5 4-2"). The app always shows your side first, so a loss is flipped
// set by set ("5-7 2-4"), including tiebreak detail ("7-6(5)" -> "6-7(5)", "7-6(7-5)" -> "6-7(5-7)").
// Words such as "def" (a default) are kept as they are.
const SET = /^(\d+)-(\d+)(?:\((\d+)(?:-(\d+))?\))?$/;

export function mySideFirst(score: string, iWon: boolean): string {
  if (iWon) return score;
  return score
    .split(' ')
    .map((part) => {
      const m = SET.exec(part);
      if (!m) return part;
      const [, a, b, tbA, tbB] = m;
      const tiebreak = tbA === undefined ? '' : tbB === undefined ? `(${tbA})` : `(${tbB}-${tbA})`;
      return `${b}-${a}${tiebreak}`;
    })
    .join(' ');
}

/** Your result from a score with your side first: more sets won is a win, fewer a loss, level is null. */
export function winnerFromScore(score: string): boolean | null {
  let diff = 0;
  for (const part of score.trim().split(/\s+/)) {
    const m = SET.exec(part);
    if (m) diff += Math.sign(Number(m[1]) - Number(m[2]));
  }
  return diff > 0 ? true : diff < 0 ? false : null;
}
