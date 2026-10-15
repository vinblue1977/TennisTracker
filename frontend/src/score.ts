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
