# Decision Log — All-in-One Fantasy Dashboard

Append-only. Each entry: date · what was tried · outcome (WORKS / REJECTED / OPEN) · why.
This is the canonical log for **this** project (separate from the fantasy_football_project logs).

---

## 2026-08-13 — Phase 1 (Sleeper) built + expanded — WORKS
Separate static project at `fantasy-dashboard/index.html`. Does not touch the CAN AM tools or the nfl-picks-tracker.

**Scope shipped:** one dark, mobile-first dashboard for all 3 Sleeper leagues (JunceBoxes):
- My team (starters mapped to real lineup slots + bench + IR/taxi), current matchup + score, all-teams view, standings, league analyzer, and an auction salary-cap view for the salary-dynasty league.

**Architecture decisions:**
- **Single self-contained `index.html`, vanilla JS, no build** — same low-friction pattern as the picks tracker; trivial to host on GitHub Pages. WORKS.
- **Provider abstraction:** `providers.<platform>.load()` returns a normalized league schema (me / matchup / standings / teams / analyzer). `providers.sleeper` implemented; `providers.espn` / `providers.yahoo` are stubs that throw "not enabled yet." Keeps the analytics + render layers platform-agnostic. WORKS.
- **Data normalization:** render slots generically by zipping Sleeper `starters[]` with each league's `roster_positions[]` (minus BN/IR/TAXI). One code path renders standard, superflex, and IDP leagues with no per-league hardcoding. WORKS (verified across 8-team standard, 10-team superflex+IDP, 10-team superflex).
- **Player dictionary cache:** `/players/nfl` is ~14 MB. Fetch once, slim to `id → {name,pos,team}`, cache in `localStorage` with a 24h TTL. Avoids re-downloading 14 MB per visit. WORKS.

**League analyzer (starter set):** lineup-shape distribution + most-common shape, positional quirks ("only team starting N of a position"), unusual-lineup flags, transactions + FAAB-spent-of-budget, weekly scoring / top scorer / points-left-on-bench (computed from `players_points` − `starters_points`), and my-team-vs-league ranks (points-for, activity). Anything unsupported is shown in a visible "not shown" box, never faked. Explicit SKIPS recorded: trade win/loss grading & projections (not in Sleeper's API); boom/bust & bench points show as zero until games are played (Week 1 preseason at build time).

**Salaries (salary-dynasty league only):**
- The league is an **auction** (`draft.type=auction`, budget $365). Per-player salary = auction draft `pick.metadata.amount`. Roster objects carry NO salary field, so salaries must come from draft picks.
- **Carryover bug found + fixed:** the dynasty is a carryover league with **two** auction drafts (an initial auction + a 2026 offseason auction) plus a linear rookie draft (no $). Reading only the newest draft floored ~27 kept players/team to $1 (wrong). **Fix:** merge ALL auction drafts oldest-first (newer price overwrites older). Result: cap totals land at a realistic $319–$351 / $365 and only 3–7 genuine waiver pickups per team are floored. Stars price correctly (Saquon $52, St. Brown $63, Herbert $43). WORKS.
- Genuine pickups / undrafted → **$1 floor**, flagged `$X·?` ("verify") in the UI. Per-team cap total + progress bar (turns red if over cap).

**Verification (headless Chrome, 390px mobile):** 3 leagues render; all-teams counts 8/10/10; 305 salary chips + 10 cap bars in the dynasty; salary-cap badge appears on the dynasty league only; **zero horizontal overflow**; JS parses clean.

## 2026-08-13 — CREDENTIAL-SECURITY ARCHITECTURE for Phases 2–3 (ESPN + Yahoo) — DECIDED (binding)
ESPN needs session cookies (`espn_s2` + `SWID`); Yahoo needs OAuth tokens. These are account secrets.

- **DECISION:** secrets live **only** in **Vercel serverless functions' protected environment variables**, server-side. The serverless function calls ESPN/Yahoo and returns **only fantasy DATA** to the browser. The browser never receives a token or cookie.
- **REJECTED (never build this way):** the "private repo feeds the public site" pattern. A browser cannot keep a secret — any token embedded in the public page to read a private repo is itself exposed in that public page. That's obfuscation, not security.
- **Why now:** recording this before Phase 2 starts so the unsafe pattern is never accidentally built. The Phase 1 Sleeper path is safe as a static public site precisely because Sleeper's API is public and requires no secret.

**Phasing:** Phase 1 Sleeper (static GitHub Pages) ✅ · Phase 2 ESPN (6 leagues, serverless) 🔜 · Phase 3 Yahoo (2 leagues, serverless OAuth) 🔜.

## 2026-08-13 — Deploy Phase 1 to its own public GitHub Pages site — OPEN
Deploying as a standalone public repo (no secrets in the repo, safe). Live URL to be recorded here once Pages builds.
