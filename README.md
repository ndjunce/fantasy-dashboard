# All-in-One Fantasy Dashboard

A single, mobile-first dashboard that unifies fantasy football leagues across **Sleeper, ESPN, and Yahoo** into one view — rosters, matchups, standings, and a league analyzer — so a manager with leagues scattered across three platforms stops app-hopping and sees everything in one place.

**Live (Phase 1 — Sleeper):** _deployed via GitHub Pages — see the repo's Pages URL._

---

## The problem

Serious fantasy players routinely run leagues on multiple platforms (I run ~11 across Sleeper, ESPN, and Yahoo). Each platform has its own app, its own login, and its own idea of what a "league" looks like. There is no first-party way to see all of them together, and the data models are wildly different — different roster shapes (standard vs. superflex vs. IDP), different scoring, different ID schemes, and different authentication (Sleeper is open; ESPN needs session cookies; Yahoo needs OAuth).

This project solves that with a **provider-abstraction layer** that normalizes each platform into one shared schema, plus an **analytics layer** on top of the normalized data.

## What it does (Phase 1, shipped)

For each Sleeper league:
- **My team** — starters mapped to the league's real lineup slots, plus bench and IR/taxi.
- **Current matchup** — my team vs. opponent with live scores for the active week.
- **All teams** — every roster in the league (expandable), my team highlighted.
- **Standings** — records + points-for, my team highlighted.
- **League Analyzer** — roster-construction shapes (who runs 3WR vs. 2RB/2TE), "only team starting 2 TE"-style quirks, unusual-lineup flags, transaction/FAAB activity, weekly scoring + points-left-on-bench (once games are played), and my-team-vs-league ranks.
- **Salary cap** (auction/salary leagues) — per-player salary and per-team cap totals, pulled from the league's auction draft history.

The analyzer is deliberately honest: anything the source API can't support (e.g. trade grading, or boom/bust before games are played) is listed in a visible "not shown" box rather than faked.

## Tech stack

- **Frontend:** vanilla HTML/CSS/JavaScript, no build step, no framework — a single self-contained `index.html`. Dark, responsive, mobile-first.
- **Data:** Sleeper public REST API (read-only, no auth).
- **Client-side caching:** the Sleeper player dictionary is ~14 MB; it's fetched once and cached in `localStorage` (slimmed to `id → {name, pos, team}`, 24-hour TTL) so it isn't re-downloaded on every visit.
- **Hosting:** GitHub Pages (static, no secrets) for Phase 1.
- **Planned backend (Phases 2–3):** Vercel serverless functions for the platforms that require credentials.

## Architecture

### 1. Provider abstraction + data normalization
Every platform is wrapped behind a common interface:

```
providers.<platform>.load() → normalized leagues[]
```

Each normalized league has the same shape regardless of source:

```
{ provider, leagueId, name, seasonWeek, roster_positions, salary?,
  me:      { teamName, record, pf, pa, starters[], bench[], salary? },
  matchup: { me, opp },
  standings[],  teams[],  analyzer{} }
```

Normalization handles the hard part — mapping each platform's raw roster into shared lineup slots. Sleeper's `starters[]` array is zipped against the league's `roster_positions[]`, so the same code renders a standard 1QB league, a superflex league, and an 11-starter IDP league without any per-league hardcoding.

### 2. Analytics layer
Pure functions over the normalized data compute lineup-shape distributions, positional quirks, FAAB/transaction trends, weekly scoring, and personal-vs-league ranks. Because it runs on the normalized schema (not raw Sleeper JSON), the same analytics will work for ESPN and Yahoo once those providers land.

### 3. Credential security (Phases 2–3) — the key design decision
ESPN and Yahoo require secrets (ESPN session cookies; Yahoo OAuth tokens). **A browser cannot keep a secret** — anything shipped to the client is readable by anyone. So the future design is explicit:

- Secrets live **only** in **Vercel serverless functions' protected environment variables**, server-side.
- The serverless function talks to ESPN/Yahoo, and returns **only fantasy data** to the browser.
- The browser never receives a token, cookie, or anything that could be replayed.

Specifically rejected: the "private repo feeds the public site" pattern. Any token embedded in a public page to read a private repo is itself exposed in that public page — that's not security, it's obfuscation. (Recorded in `DECISION_LOG.md`.)

## Phases

| Phase | Platform | Auth | Hosting | Status |
|-------|----------|------|---------|--------|
| 1 | **Sleeper** (3 leagues) | none (public API) | GitHub Pages (static) | ✅ Shipped |
| 2 | **ESPN** (6 leagues) | session cookies | Vercel serverless (secrets server-side) | 🔜 Planned |
| 3 | **Yahoo** (2 leagues) | OAuth | Vercel serverless | 🔜 Planned |

## What works / what's in progress (honest status)

**Works today:**
- All 3 Sleeper leagues load with real player names, records, matchups, standings.
- Generic roster rendering across standard / superflex / IDP league shapes.
- League analyzer (lineup shapes, quirks, FAAB, my-vs-league ranks).
- Auction salary cap view for the salary-dynasty league (merges multiple auction drafts for accurate carryover pricing; genuine pickups floored to $1 and flagged for verification).
- Mobile layout, no horizontal scroll; player dictionary cached client-side.

**In progress / next:**
- ESPN provider via serverless backend (Phase 2).
- Yahoo provider via serverless OAuth (Phase 3).
- Weekly scoring/boom-bust visualizations become populated once the season's games are played (the plumbing is in place; the numbers are zero in the preseason).

## Running locally
It's a static file — open `index.html` in any browser, or serve the folder with any static server. The username is set in the `CONFIG` block near the top of the script.

## Notes
- Player names, team names, and league names come straight from the Sleeper API (the actual league names may differ from casual nicknames).
- No data is written anywhere; the app is read-only. The only client storage is the cached player dictionary in `localStorage`.
