// Made-up data for local development and screenshots (dev builds only; never real people).
import type { Data, Match } from './types';

const m = (date: string, event: string, won: boolean | null, score: string, partner: string, opponents: [string, number][], upsetGap: number | null = null): Match => ({
  id: `wtn:${date}-${event.length}`,
  SK: `MATCH#${date}#wtn:${date}-${event.length}`,
  event,
  kind: 'DOUBLE',
  won,
  score,
  status: 'COMPLETED',
  partners: [{ name: partner, wtn: 26.4 }],
  opponents: opponents.map(([name, wtn]) => ({ name, wtn })),
  upsetGap,
  source: 'WTN',
  note: '',
  starred: false,
});

export const mockData: Data = {
  upcoming: [
    { SK: 'UPCOMING#2026-10-17T02:00Z#a', title: 'City Doubles Final', location: 'Test Club, Court 3', start: '2026-10-17T02:00:00+00:00', end: '2026-10-17T04:00:00+00:00', allDay: false },
    { SK: 'UPCOMING#2026-10-17T14:00Z#b', title: 'Evening League match', location: 'Sample Park', start: '2026-10-17T14:00:00+00:00', end: '2026-10-17T15:30:00+00:00', allDay: false },
  ],
  profile: { tennisId: 'TES•••0001', utr: 7.25, ntrp: 3.5, calendar: { connected: true, status: 'ok', upcoming: 2 }, sync: { status: 'ok', lastRunAt: '2026-10-16T11:00:05Z', latestDate: '2026-10-05', latestValue: 25, matchCount: 6 } },
  ratings: [
    ['2010-01-01', 29.1],
    ['2025-01-13', 27.87],
    ['2025-04-14', 26.88],
    ['2025-08-04', 26.13],
    ['2026-02-09', 26.56],
    ['2026-03-16', 25.35],
    ['2026-09-21', 25.12],
    ['2026-09-28', 25.34],
    ['2026-10-05', 25.0],
  ].map(([date, value]) => ({ SK: `RATING#WTN#DOUBLE#${date}`, value: value as number, confidence: 80 })),
  matches: [
    m('2026-10-02', 'City Doubles Playoff', true, '6-3 6-2', 'Alex Example', [['Sam Sample', 27.02], ['Jo Test', 27.21]]),
    m('2026-09-26', 'Evening League 18 & Over', false, '5-7 2-4', 'Kim Placeholder', [['Lee Demo', 25.01], ['Max Mock', 24.16]]),
    m('2026-09-19', 'Evening League 18 & Over', true, '6-4 6-3', 'Kim Placeholder', [['Pat Fake', 25.73], ['Ray Dummy', 26.0]], 0.6),
    m('2026-03-14', 'Winter League 40 & Over', true, '6-3 6-4', 'Drew Sample', [['Cam Test', 24.69], ['Ash Mock', 24.18]], 1.77),
    m('2025-08-03', 'District Championships 40 & Over', true, '3-6 7-6 1-0', 'Robin Example', [['Taylor Demo', 23.31], ['Jordan Fake', 24.3]], 3.25),
    m('2025-04-27', 'Winter League 40 & Over', false, '2-6 0-6', 'Morgan Test', [['Casey Mock', 26.44], ['Riley Demo', 24.63]]),
  ],
};
