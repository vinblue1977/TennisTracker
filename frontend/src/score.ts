// WTN writes scores winner first ("7-5 4-2"). The app always shows your side first, so a loss is flipped
// set by set ("5-7 2-4"). Words such as "def" (a default) are kept as they are.
export function mySideFirst(score: string, iWon: boolean): string {
  if (iWon) return score;
  return score
    .split(' ')
    .map((part) => {
      const games = /^(\d+)-(\d+)$/.exec(part);
      return games ? `${games[2]}-${games[1]}` : part;
    })
    .join(' ');
}
