# Tennis Tracker

An iPhone-first tennis app (PWA) on serverless AWS: World Tennis Number (WTN) history and matches, local match logging, partner and head-to-head stats, trophies, and push reminders.

Status: WTN sync, sign-in and API are live; app screens next.

## Development

```sh
make install   # Python (uv if installed) + Node tools
make check     # everything CI runs: privacy, lint, tests, frontend, audit, synth
```

Merges to `main` deploy to AWS automatically. Progress: [ROADMAP.md](ROADMAP.md).
