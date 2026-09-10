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

## 2026-08-13 — Deployed Phase 1 to its own public GitHub Pages site — WORKS
Standalone public repo `ndjunce/fantasy-dashboard` (only index.html + README + DECISION_LOG; no secrets — safe as public). Pages enabled main/root.
- **Live URL: https://ndjunce.github.io/fantasy-dashboard/**
- Verified live (headless, 390px mobile): HTTP 200; all 3 leagues render with real player names; all-teams 8/10/10; dynasty shows 💰 SALARY CAP $365 with 305 salary chips + cap bars; zero horizontal overflow.

## 2026-08-13 — Phase 2 (ESPN, 6 leagues) built via Vercel serverless — WORKS (deploy pending user)
Added all 6 ESPN leagues + two cross-league views. Cookie (espn_s2 + SWID) stays server-side per the Phase-2 security decision; the browser only ever gets DATA.

**Serverless proxy — `api/espn.js` (Vercel function):**
- Reads `ESPN_S2` + `ESPN_SWID` from Vercel env vars (never in code/git). SWID auto-braced.
- **League whitelist** (server-side): only my 6 league IDs (963488, 484087929, 764639655, 175994, 1910409336, 771790710) — the proxy can't be abused to fetch arbitrary leagues with my cookie.
- **View whitelist**: mTeam/mRoster/mMatchup/mSettings/mStandings/mSchedule/kona_player_info only.
- **CORS** locked to https://ndjunce.github.io (same-origin on the vercel.app deploy needs none).
- **~60s in-memory cache** per warm lambda; read-only GETs only.
- **401/403 → returns `{error:"espn_auth_expired"}`** (HTTP 200) so the UI shows a clean "refresh cookie" state instead of failing silently. Missing env → `server_not_configured`.
- `vercel.json` (cleanUrls + s-maxage=60 on /api) and `.vercelignore` (never ships the local cookie file or `_*` test artifacts).

**Dashboard `providers.espn`:** calls the proxy per league (`/api/espn?league=..&season=2026`), normalizes ESPN's shape into the SAME league object Sleeper uses (teams/me/matchup/standings/analyzer) so the existing card renderer + view tabs (My Team / All Teams / Analyzer / Standings) work unchanged. Handles ESPN SLOT/POS/proTeamId maps; generic across standard + 2QB/superflex + IDP shapes. `apiBase` = `/api/espn` on vercel.app/localhost, else absolute vercel URL (placeholder to update post-deploy). `authExpired` surfaces a per-card refresh-cookie message.

**Cross-league views (Sleeper + ESPN):**
- **D1 "All My Players"** — every rostered player across all 9 leagues, deduped by name+pos, showing which/how-many leagues + starter count, with this week's opponent + kickoff from ESPN's PUBLIC scoreboard (no auth). Grouped by kickoff day; players with no scheduled game show **TBD** (never faked).
- **D2 "Available / Pickups"** — per Sleeper league: players NOT rostered in that league, ranked by **Sleeper leaguewide trending-adds (24h)** + flagged where I'm thin (position need). Explicitly labeled **not a projection**; scoring-based ranking noted as "fills in once games are played." ESPN per-league free-agent list deferred (needs a heavier authed players query) — honest note shown, trending-adds still cross-references by name.

**VERIFIED end-to-end locally** (dev server injecting the real cookie into the function; headless Chrome @390px): all **9 league cards render (3 Sleeper + 6 ESPN), zero errors, zero horizontal overflow**; whitelist rejects a non-approved league id; ESPN roster names correct (Saquon/Hampton/Irving etc.); D1 = 113 unique players; D2 = trending lists for the 3 Sleeper leagues + ESPN note. Cookie never left the server. Secret scan: token in NO committable file; espn_auth.local.json gitignored.

**Honest limitations recorded:** ESPN weekly points are 0 pre-kickoff (Week 1); D1 kickoffs show TBD until the scoreboard has the week's games; ESPN FAAB/trade grading not fully exposed by the API; ESPN per-league available-players list is the next iteration.

## 2026-08-13 — DEPLOY Phase 2 to Vercel — OPEN (user action)
Repo `ndjunce/fantasy-dashboard` gets `api/espn.js` + `vercel.json`. User imports repo to Vercel + sets ESPN_S2/ESPN_SWID env vars (values pasted in Vercel UI by the user, never in chat/git). Live vercel.app URL becomes the ESPN-enabled dashboard (phone + laptop). Update `CONFIG.espn.apiBase` absolute fallback to the real vercel domain if the GitHub Pages copy should also reach ESPN.
