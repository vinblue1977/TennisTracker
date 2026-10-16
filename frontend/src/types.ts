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

export interface Profile {
  tennisId: string | null;
  sync: { status?: string; lastRunAt?: string; latestDate?: string; latestValue?: number; matchCount?: number };
}

export interface Data {
  profile: Profile;
  ratings: Rating[];
  matches: Match[];
}
