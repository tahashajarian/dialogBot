# AI suggestion QA tools

Use the local browser dashboard or terminal runner to exercise the real suggestion
logic without editing a Telegram user's favorites or touching MongoDB.

## Browser dashboard (recommended)

On Windows, double-click:

```text
start-suggestion-lab.cmd
```

Or run:

```powershell
npm.cmd run qa:suggestions:web
```

The command opens `http://127.0.0.1:4173` in the default browser. The dashboard:

- includes 21 varied Persian and English starter profiles, including Persian-interface profiles whose favorites use Latin-script titles;
- lets you edit every favorite, request, rejection, liked item, and saved item;
- saves custom profiles only in browser local storage;
- streams each live result as it finishes;
- shows success rate and response timing;
- supports source-identity inspection, copy, quality marking, cancellation, and JSON export;
- keeps API credentials on the local Node server and never sends them to the page;
- binds to localhost and does not write to MongoDB, Telegram, quotas, or Stars.

Use a different port when needed:

```powershell
npm.cmd run qa:suggestions:web -- --port=4400
```

Prevent automatic browser opening:

```powershell
npm.cmd run qa:suggestions:web -- --no-open
```

## Terminal runner

The runner:

- reads AI credentials and model settings from `.env`;
- uses the production book, movie, and retrieval-first music services;
- does not start the bot;
- does not write to MongoDB;
- does not consume user suggestion quotas or Stars;
- blocks favorites and earlier results within the same run, so repeated runs
  exercise fresh suggestions.

## Built-in profiles

List the available Persian and English profiles:

```powershell
npm.cmd run qa:suggestions -- list
```

Run ten suggestions against the Iranian music profile:

```powershell
npm.cmd run qa:suggestions -- run fa-iranian-music --count=10
```

Run five Iranian movie suggestions with a temporary request/mood:

```powershell
npm.cmd run qa:suggestions -- run fa-iranian-movies --count=5 --mood="تلخ و اجتماعی"
```

Run two suggestions for every built-in profile:

```powershell
npm.cmd run qa:suggestions -- all --count=2
```

Add temporary negative or positive signals without changing stored user data:

```powershell
npm.cmd run qa:suggestions -- run fa-iranian-music --count=5 --reject="فاصله‌ها — احسان خواجه‌امیری|یه روز خوب میاد — سیروان خسروی"
```

Use `--verbose` to show the underlying catalogue identity for music. Use
`--json` for machine-readable output and timing comparisons.

## Custom profile

Create a JSON file:

```json
{
  "id": "my-music-test",
  "label": "My temporary music profile",
  "section": "music",
  "lang": "fa",
  "userText": "آرام و شبانه",
  "favorites": [
    "ترنج — محسن نامجو",
    "بوی عیدی — فرهاد",
    "عشق سرعت — کیوسک"
  ],
  "rejected": [
    "فاصله‌ها — احسان خواجه‌امیری"
  ]
}
```

Run it with:

```powershell
npm.cmd run qa:suggestions -- file .\my-music-test.json --count=5
```

Custom files are read-only. They are never imported into the database.

## Interpreting a run

Each run prints the user-facing suggestion and elapsed time. A failure prints
its internal reason so catalogue coverage, AI output, and duplicate behavior can
be tested without searching runtime logs.

This is a live external test: AI and music catalogue availability can still
vary between runs. Keep `--count` bounded to avoid unnecessary API usage.

## Reproducing accounts with long saved history

A clean preset is easier than a real account because it has no saved, recent, or
rejected items. Use `fa-latin-mainstream-movies-heavy-history` to exercise a
movie profile with a large blocked history similar to a long-lived production
account. This is useful for catching duplicate exhaustion and timeout issues
that may not appear with a fresh preset.
