# Tennis Tracker

An iPhone-first tennis app (PWA) on serverless AWS: World Tennis Number (WTN) history and matches, local match logging, partner and head-to-head stats, trophies, and push reminders.

Status: WTN sync, sign-in and API are live; app screens next.

## Home Screen widget

1. Install the free Scriptable app and make a new script from `scripts/widget.js`.
2. In the app: Me › Home Screen widget › Turn on, then copy the setup line (shown once).
3. Run the script once and paste the line; it is kept in the iPhone Keychain.
4. Add a Scriptable widget (small or medium) and choose the script.

Lost the phone or the line? Turn the widget off in the app; the token stops working at once.

## Development

```sh
make install   # Python (uv if installed) + Node tools
make check     # everything CI runs: privacy, lint, tests, frontend, audit, synth
```

Merges to `main` deploy to AWS automatically. Progress: [ROADMAP.md](ROADMAP.md).
