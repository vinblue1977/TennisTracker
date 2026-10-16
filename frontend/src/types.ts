export interface Player {
  name: string;
  wtn: number | null;
}

export interface Match {
  id: string;
  SK: string; // MATCH#<date>#<id>
  event: string;
  kind: 'SINGLE' | 'DOUBLE';
  won: boolean | null;
  score: string; // your side first
  status: string | null;
  partners: Player[];
  opponents: Player[];
  upsetGap: number | null;
  source: string;
  note: string;
  starred: boolean;
}

export interface Rating {
  SK: string; // RATING#WTN#<kind>#<date>
  value: number;
  confidence: number | null;
}

export interface Upcoming {
  SK: string; // UPCOMING#<start>#<uid>
  title: string;
  location: string;
  start: string; // ISO, UTC
  end: string;
  allDay: boolean;
}

export interface Profile {
  tennisId: string | null;
  utr?: number | null; // doubles, entered by hand
  ntrp?: number | null;
  calendar?: { connected: boolean; status?: string; lastRunAt?: string; upcoming?: number };
  sync: { status?: string; lastRunAt?: string; latestDate?: string; latestValue?: number; matchCount?: number };
}

export interface Trophy {
  id: string;
  event: string;
  date: string; // YYYY-MM-DD
  result: 'winner' | 'finalist';
  note: string;
}

export interface Suggestion {
  id: string;
  event: string;
  date: string;
  matches: number;
  partner: string;
}

export interface Data {
  trophies: { trophies: Trophy[]; suggestions: Suggestion[] };
  profile: Profile;
  ratings: Rating[];
  matches: Match[];
  upcoming: Upcoming[];
  vapidKey?: string; // Web Push public key, from config.json
}
