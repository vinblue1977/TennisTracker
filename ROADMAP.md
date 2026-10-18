# Roadmap

Finished items move to **Done**. Cost so far ≈ $0; target ≈ $0.05–0.15/month.

## Done

- [x] Planning and mockup (iPhone-first, dark mode)
- [x] Repo + CI: title check, Python/TS checks, CodeQL, Dependabot, privacy guard, branch protection
- [x] AWS foundation: data table, deploy role, auto-deploy on merge
- [x] WTN sync: daily Lambda, failure email, first import
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

## Next: WTN dashboard on iPhone

- [ ] "Sync now" from the Mac (`make sync`)

## Security and CI follow-ups (Oct 2026 review)

- [x] Deploy: AWS credentials only after the unhashed dev-tool install
- [x] Photo uploads land in `incoming/` and expire after a day unless confirmed
- [ ] Cache the synthesized stack in `tests/test_infra.py` (each test re-synths, ~4 s; saves ~15-20 s per CI run)
- [ ] Hash-lock `requirements.txt` and `requirements-dev.txt` (`pip-compile --generate-hashes`)
- [ ] Turn on secret scanning for non-provider patterns (free)
- [ ] Accepted: shared widget throttle can be used to 429 the widget; needs WAF/custom domain to fix

## Then

- [x] Log local match (doubles)
- [x] One-time spreadsheet import (script outside the repo)
- [x] Photos on trophies and matches
- [ ] Repeating calendar events (e.g. weekly league nights)
- [ ] Desktop layout

## Later

- [ ] Photo album
- [ ] Tennis news (RSS or a free pro-tennis API plan)
- [ ] Tennis Warehouse deal watchlist (check their terms first)
- [ ] Match insights with a small Claude model
- [ ] USTA Connect sync if approved

## Watch

- [ ] ITF reply on API access; drop the curl User-Agent if granted
- [ ] Renew the outside-PR block before 15 Apr 2027
- [ ] Re-archive the Access Analyzer finding if the deploy role is replaced
- [ ] Move the Lambdas to Python 3.15 once it is generally available (preview since Aug 2026)
