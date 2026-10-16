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
- [x] Calendar sync: hourly from a public iCloud calendar; Next match on Home; Upcoming tab
- [x] Dark sign-in page
- [x] Push notifications: match reminders (8:00pm the evening before, 2 h before), WTN changes, test button
- [x] Doubles UTR and NTRP entered by hand (Me tab), shown on Home

## Next: WTN dashboard on iPhone

- [ ] "Sync now" from the Mac (`make sync`)
- [ ] Trophies (suggested from event names)

## Then

- [ ] Log local match + one-time spreadsheet import
- [ ] Stats: partners, head-to-head, win % by year, upset wins, best matches
- [ ] Repeating calendar events (e.g. weekly league nights)
- [ ] Desktop layout

## Later

- [ ] Photo album
- [ ] Tennis news (RSS or a free pro-tennis API plan)
- [ ] Tennis Warehouse deal watchlist (check their terms first)
- [ ] Match insights with a small Claude model
- [ ] Friends, shared results, mini league
- [ ] iPhone Home Screen widget (WTN + next match); web apps can't add widgets, so needs a small native app or a Scriptable/Shortcuts widget
- [ ] USTA Connect sync if approved

## Watch

- [ ] ITF reply on API access; drop the curl User-Agent if granted
- [ ] Renew the outside-PR block before 15 Apr 2027
- [ ] Re-archive the Access Analyzer finding if the deploy role is replaced
