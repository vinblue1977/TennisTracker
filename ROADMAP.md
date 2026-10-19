# Roadmap

Finished items move to **Done**. Cost so far ≈ $0; target ≈ $0.05–0.15/month.

## Done

- [x] Planning and mockup (iPhone-first, dark mode)
- [x] Repo + CI: title check, Python/TS checks, CodeQL, Dependabot, privacy guard, branch protection
- [x] AWS foundation: data table, deploy role, auto-deploy on merge
- [x] WTN sync: Lambda (Wed ×2 + Thu), failure email, first import
- [x] Sign-in (passkeys), `/me` API, hosting URL; faster parallel CI
- [x] README refresh; `make check` runs all CI checks locally
- [x] Sign-in account and passkey created
- [x] iPhone app: sign-in, Home, Matches, Match detail, notes, best-match stars; dark only; stricter CSP + security lints
- [x] Calendar sync: every 15 minutes from a public iCloud calendar; Next match on Home; Upcoming tab
- [x] Dark sign-in page
- [x] Push notifications: match reminders (2 h before), WTN changes, test button
- [x] Doubles UTR and NTRP entered by hand (Me tab), shown on Home
- [x] iPhone Home Screen widget (WTN + next match) via Scriptable and a revocable token
- [x] Trophies on the Me tab: added by hand, or suggested when you win every match of an event
- [x] Tappable Home cards: WTN → rating history, Win–loss → Matches, Upset wins → filtered list, Next match → Upcoming
- [x] Stats screen (doubles): win % by year, partners, head-to-head; from Home Win–loss and Me
- [x] Sync health on Me: last WTN and calendar sync, failures, last match seen

## Next

- [x] "Sync now" from the Mac (`make sync`)
- [ ] "Why did WTN move?": show the matches behind each rating change in the history
- [ ] Weekly backup: JSON dump of the table to S3 (lifecycle expiry; PITR stays on)

## Security and CI follow-ups (Oct 2026 review)

- [x] Deploy: AWS credentials only after the unhashed dev-tool install
- [x] Photo uploads land in `incoming/` and expire after a day unless confirmed
- [x] Cache the synthesized stack in `tests/test_infra.py` (one synth per context)
- [x] Hash-lock the CDK app and dev-tool requirements (`.in` files + `make lock`)
- [x] Secret scanning is on (provider patterns + push protection); the non-provider option is not offered for this repo (no toggle in Settings, API ignores it)
- [ ] Accepted: shared widget throttle can be used to 429 the widget; needs WAF/custom domain to fix

## Then

- [x] Log local match (doubles)
- [x] One-time spreadsheet import (script outside the repo)
- [x] Photos on trophies and matches
- [x] Desktop layout: sidebar from 900 px, two-column Home and Me, Matches list + selected match from 1100 px
- [ ] Repeating calendar events (e.g. weekly league nights)

## Ideas: quick wins

- [x] Export your data: "Download my matches (CSV)" on the Me tab
- [ ] Season recap card: matches, win %, best partner, biggest upset, trophies; shareable as an image
- [x] Streaks and form on Home ("W4", last 5, longest win streak)
- [ ] Offline read-only mode: service worker caches the last Home and Matches payload
- [ ] Pre-match notes on the Next match card: head-to-head and your last note about the opponent

## Ideas: medium

- [ ] Partner and opponent pages: record, timeline, scores, notes
- [ ] Surface and venue tags (hard/clay, indoor/outdoor, club) with win % per tag
- [ ] WTN trend chart with a 3-month projection and the matches that moved it most
- [ ] Match-day push the evening before: time, location, weather (Open-Meteo, no key), pack reminder
- [ ] Score entry for tiebreaks, match tiebreaks (10-point) and retirements

- [ ] Post-match debrief push after the scheduled end: one-tap mood and a note prompt
- [ ] Venue from the calendar event location, with win % per venue
- [ ] Opponent scouting card: head-to-head, their WTN, your last notes
- [ ] Pressure stats: third sets, tiebreaks, wins after losing the first set
- [ ] Partner chemistry: pair win % split by higher or lower rated team
- [ ] Goal tracker: target WTN or match count with progress on Home
- [ ] Patterns by weekday, start time and rest days
- [ ] Weekly digest push (Sunday) to replace smaller pushes

## Ideas: longer

- [ ] Monthly Claude Haiku summary of notes and results (cents per month)
- [ ] Revocable read-only share link for a partner or coach (reuse the widget token mechanism)
- [ ] Practice and fitness log (hitting, lessons, injuries) on the match timeline

## Later

- [ ] Tennis news (RSS or a free pro-tennis API plan)
- [ ] Tennis Warehouse deal watchlist (check their terms first)
- [ ] Match insights with a small Claude model
- [ ] USTA Connect sync if approved

## Watch

- [ ] ITF reply on API access; drop the curl User-Agent if granted
- [ ] Renew the outside-PR block before 15 Apr 2027
- [ ] Re-archive the Access Analyzer finding if the deploy role is replaced
- [ ] Move the Lambdas to Python 3.15 once it is generally available (preview since Aug 2026)
