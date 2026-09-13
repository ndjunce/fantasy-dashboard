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

## 2026-08-13 — FIXED ESPN apiBase → real Vercel domain; all 9 leagues now reachable — WORKS
Phase 2 deploy was live but the frontend pointed at the WRONG Vercel URL, so GitHub Pages got "Failed to fetch" on all 6 ESPN leagues.

**Root cause:** `CONFIG.espn.apiBase` absolute fallback was a guessed placeholder `fantasy-dashboard-ndjunce.vercel.app` (returned 404 — that project name doesn't exist). Real production domain is `fantasy-dashboard-orpin.vercel.app` (Vercel account fun-fun-fun1, project fantasy-dashboard). NOT a code/CORS bug — the proxy + Production env vars (ESPN_S2/ESPN_SWID) + cookies were all already correct.

**Fix:** one-line change in `index.html` — apiBase fallback → `https://fantasy-dashboard-orpin.vercel.app/api/espn`. Commit `e3fe8a5`, pushed to main.

**Verified live (2026-08-13):**
- Proxy returns real data (not auth_expired / not server_not_configured) for all 6 ESPN leagues via `/api/espn?league=..&season=2026`: Royal Crushers 12, Dargelong 12, 2QB/Winona 12, 6-man 6, CAN AM 10, Uncle and Boys 8 teams.
- CORS: proxy returns `Access-Control-Allow-Origin: https://ndjunce.github.io` for that origin → the GitHub Pages cross-origin fetch will succeed.
- Sleeper side already live: 3 leagues (8 greasy turds, The Soup Kitchen, Busch Apple Salary Dynasty), all 2026 in_season; trending-adds endpoint 200.
- Raw github main index.html confirmed contains orpin URL, old placeholder gone.

**Primary bookmark:** `https://fantasy-dashboard-orpin.vercel.app/` — serves the whole dashboard AND reaches ESPN same-origin (no CORS in play). The GitHub Pages copy also works now via the cross-origin proxy (CORS-allowed).

**Freeze point before this change:** tag `good-dashboard-pre-espn-url` → f9d7068 (pushed). Roll back there if needed.

**Honest limitations (unchanged, pre-existing):** no Start/Sit view exists in this dashboard (weekly_start_sit.py lives in fantasy_football_project, not wired here — would be a new build + needs model-as-API, not a Sunday item); ESPN weekly points show 0 until kickoff; ESPN per-league free-agent list still deferred (D2 uses Sleeper leaguewide trending-adds, honestly labeled "not a projection").

## 2026-08-13 — Feature 1: player images w/ headshot → team-logo → initial fallback — WORKS
Player rows were text-only (no images). Added a player image to every row via the single `playerRow()` render point.

**Fallback chain (per player):**
1. ESPN headshot CDN by espn player id: `a.espncdn.com/i/headshots/nfl/players/full/{espnId}.png`.
2. On headshot error → team logo `a.espncdn.com/i/teamlogos/nfl/500/scoreboard/{team}.png` on a white circular chip w/ dark ring (reused picks-site `.logo` pattern so dark team marks — NYG/BAL/CHI/NE/JAX/LV — stay readable on the dark bg).
3. On logo error / no team → position-colored initial circle.
- 28px round (26px on mobile). `loading="lazy"`. All fallbacks are client-side `onerror` swaps — zero extra cost to us; images come from ESPN's public CDN.

**Data plumbing:**
- ESPN player `id` IS the espn id → `espnId` set directly in `playerOf()`; headshots resolve reliably for all 6 ESPN leagues.
- Sleeper: extended the slim player cache to carry `espn_id` (key `e`); bumped cache key `sleeper_players_nfl_v1`→`v2` so stale caches refresh. `resolvePlayer()` now passes `espnId`. **Honest limitation (verified):** Sleeper's `espn_id` is present for many but NOT all players (e.g. Puka Nacua row had none; "Josh Allen" full-name lookup is ambiguous with the OL). Those degrade to team logo — exactly the intended fallback. Partial headshot coverage on Sleeper, full logo coverage.

**Verified before push:** CDN patterns return 200 image/png (headshot 3929630 ✓, phi/nyg logos ✓); a bogus headshot id returns 404 so the onerror fallback fires. Extracted `<script>` parses clean via `new Function()` (node). 
**Verified live:** orpin (Vercel, primary bookmark) serves `playerImg()` + `.pimg` CSS + v2 cache key. GitHub Pages copy lagging a few min (normal Pages CDN propagation; same commit).

**Commit `0a48b28`. Freeze point before this:** tag `good-dashboard-9-leagues` → efb99dd (pushed) — roll back there if the images look worse.

**Scope/blast radius:** additive only — 1 CSS block + `playerImg()`/`headshotUrl()`/`teamLogoUrl()` helpers + `.pl` grid 3→4 cols + espn_id plumbing. No data-layer/proxy/league-loading changes. If images fail entirely, rows still render (text untouched).

**Next (NOT started, awaiting user approval of design):** Feature 2 — filter/grouping controls for "All My Players" (position, matchup, game-window early/noon-late-primetime). Game-window grouping is the priority.

## 2026-08-13 — Feature 2a: game-window grouping for All My Players + league priority order — WORKS
Grouping-first per user: built game-window grouping ALONE (the priority); position/league/starter FILTERS deferred to a follow-up.

**Game-window buckets (7, user-specified, ET-based) — Sunday early games get their OWN bucket, not folded:**
Thursday Night · Sunday Morning / Intl (<12:00 ET, e.g. 9:30 London) · Sunday Early (1:00 ET) · Sunday Late Afternoon (4:05/4:25) · Sunday Night (SNF) · Monday Night (MNF) · Other / TBD / Bye.
- `classifyWindow(iso)` converts kickoff to US-Eastern parts via `Intl.DateTimeFormat(timeZone:"America/New_York")` (handles EDT/EST, avoids local-tz drift), then buckets by day-of-week + ET minutes. Empty buckets skipped; groups render in fixed lineup-setting order; each shows a count badge.
- **Honesty rule kept:** no kickoff / unscheduled / Fri-Sat specials → "Other / TBD / Bye", never faked. Reused the EXISTING `loadNflSchedule` (ESPN public scoreboard) + kickoff plumbing — did NOT duplicate it (per user).
- **Unit-tested before push (node):** 9/9 kickoff vectors classify correctly (TNF, 9:30 London, 1pm, 4:05, 4:25, SNF, MNF, Black-Friday→Other, null→Other). `<script>` parses clean via new Function().

**League priority order (user-defined, applies EVERYWHERE leagues list — cards + AMP):**
`LEAGUE_PRIORITY` array + `leagueRank()`/`sortByPriority()`; `allLeagues` sorted once in boot() so cards + all-my-players both follow it. Order: CAN AM, Royal Crushers, Busch Apple Salary Dynasty, KFL(Yahoo-not-loaded), Uncle and Boys, 2QB/Winona, Dargelong, 6-man, The Soup Kitchen, Guillotine(Yahoo-not-loaded). Loose contains-match so minor name variants still slot; unknown → end. Verified sort output matches the requested order.

**Also (Feature-1 follow-through):** AMP rows now use `playerImg()` (headshot→logo→initial) for visual consistency with league rosters.

**Bug found + fixed in scope (my Feature-1 regression):** the Available/Pickups tab still read `localStorage.getItem("sleeper_players_nfl_v1")` — but Feature 1 bumped the cache key to v2, so it read a stale/empty dict and couldn't resolve trending-add names. Fixed → v2. (Logged per worklog rule: discovered breakage fixed immediately.)

**Verified live (orpin):** classifyWindow / WINDOW_ORDER / LEAGUE_PRIORITY / "grouped by game window" / v2-cache all present in the deployed source.

**Commit `e508968`. Freeze point before this:** tag `good-dashboard-player-images` → 5444fb3 (pushed).

**Scope/blast radius:** only the All-My-Players tab grouping + boot() league sort + the one Available-tab cache-key fix. ESPN proxy, league loading, D2 logic untouched.

**Next (NOT started, awaiting user go):** Feature 2b — position grouping mode; then 2c — matchup grouping; then the position/league/starters FILTER control bar. Grouping modes order: game-window(default) → position → matchup.

## 2026-08-13 — Feature 2 fixes items 1-3 (Available/Pickups tab) — WORKS
**Root cause (items 1 & 2, same bug — my Feature-1 regression):** Feature 1 changed the shared `.pl` grid from 3 cols (46px 1fr auto) to 4 cols (46px **28px** 1fr auto) to add the player image, but the Available-tab row template was never updated. With no image `<span>`, the player NAME fell into the fixed 28px image column and got CSS-truncated to a single char → "M…"/"K…"/"C…". 
- **Proven, not guessed:** live check showed trending ids DO resolve to full names in the Sleeper dict (Michael **M**ayer / **K**aelon Black / **C**hris Bell = the exact initials seen) — so names were fine; the column was the problem.
- **Fix:** added `playerImg(a)` to the Available row (fills the image column → name flows to 1fr) — fixes BOTH the truncation (item 1) and the missing images (item 2). Pulled `espn_id` into the available-player object so headshots resolve; players w/o espn_id (Mayer/Tucker/Fields verified) fall back to team logo, as designed.
**Item 3:** Available leagues now `sortByPriority(sleeperLeagues)` → user league order (was showing "8 greasy turds" first).
- Verified live on orpin: avail rows have playerImg + espn_id pull + priority sort. JS parses clean (node).
**Commit `fa3c427`. Freeze before this batch:** tag `good-dashboard-2a` → f3a342d.
**Lesson logged:** when changing a SHARED layout (.pl grid), audit ALL row templates that use it — AMP + Available + league rosters. Missed Available in Feature 1.

## 2026-08-13 — Feature 2 item 4: All My Players rows are tap-to-expand — WORKS
Rows were static text ("2 leagues"). Now each player row is a `<details><summary>` — tap to expand and see WHICH leagues they're rostered in, listed in the user's league PRIORITY order, each tagged **▶ START** (green) or **bench** based on where you actually start them.
- Tracked per-league starter status via a new `startSet` (Set of league names) in `buildAllMyPlayers`; leagues array pre-sorted by `leagueRank()`. Caret rotates on open. Native `<details>` = works on mobile tap, no JS handler.
- Verified live on orpin (pl-d details + pl-start markers present). JS parses clean; league-order sim correct (CAN AM > Dargelong > The Soup Kitchen).
**Commit `e529805`.**
**Remaining for Feature 2:** item 5 (week handling) — INVESTIGATE + propose before coding (user requirement). Not yet started.

## 2026-08-13 — Feature 2 item 5: single-sourced NFL week + game status/score + Upcoming-only — WORKS (visuals pending Sunday)
**Problem (investigated + reported before coding):** two DISCONNECTED week sources — the "Week N" subhead came from Sleeper `state/nfl` (auto-advances), but the game schedule came from ESPN `scoreboard?dates=YYYY` which returns "whatever week ESPN currently serves" and can't be asked for a specific week. Result: label + games could disagree; "next Thursday" showed because ESPN was already serving the upcoming slate. Also: NO game status was captured (played vs upcoming looked identical; no scores).

**Fix (option a, user-chosen — fix the root, don't paper over):**
- New `loadNflState()` → live week/season/seasonType from Sleeper (verified: week=1 season=2026 regular). Resolved FIRST in boot(), then providers + schedule load in parallel.
- `loadNflSchedule(season, week, seasonType)` now requests ESPN scoreboard with explicit `&seasontype={1|2|3}&week=N` → games shown ALWAYS match the labeled week (single source).
- Captures per-game status via `parseGameStatus` (state pre/in/post + completed + shortDetail) and per-team score. `gameStatusChip()` renders: **✓ Final W–L** (green, muted row) · **● LIVE W–L** (red) · **kickoff time** (scheduled) · **TBD** (no feed data — never fabricated).
- **"Upcoming only" toggle** (module state `AMP_UPCOMING_ONLY` + delegated change handler + in-place `paintAMP()` re-render) collapses already-played/in-progress games. **"Week N" label** in the AMP header (from the single NFL-state source, auto-advances).
- Honesty guardrails kept: missing status/score → TBD/scheduled, never guessed; if week can't resolve, falls back gracefully.

**AUTO-ROLL answers (now correct):** week number auto-advances (Sleeper state); schedule auto-follows because it's fetched for THAT week; played-vs-upcoming visually distinct (Final/LIVE/scheduled) + optional filter.

**Testing:** cannot hit ESPN scoreboard server-side (Akamai 403s non-browser/datacenter origins — confirmed). So unit-tested the LOGIC against saved sample scoreboard payloads (pre/in/post) via node: **13/13 pass** — scheduled→kickoff+upcoming, in→LIVE+score+not-upcoming, post→Final+score (correct per-team score orientation home vs away)+not-upcoming, unknown→TBD+upcoming, window classification intact, URL builds explicit seasontype&week. `<script>` parses clean. Verified live on orpin: loadNflState / week-param schedule / gameStatusChip / toggle / Week-label all present.
**KNOWN-PENDING (honest):** played-game VISUALS (Final/LIVE styling) can't be fully verified until real games go Final — user will eyeball Sunday afternoon. Cosmetic: `fmtKick` clock label renders in viewer's local tz (correct/intended); bucketing forces ET (tz-correct).

**Commit `4eadc94`. Freeze before this batch:** tag `good-dashboard-2b-items1-4` → 4f78635.

## Feature 2 COMPLETE (items 1-5 all shipped + verified live on orpin). Next: option 2 — opponent lineup + borrowed projections.

## 2026-08-13 — Feature 2 FILTERS (the original "then add filters" piece) — WORKS
Finished the filter control bar on All My Players that was deferred when week-handling + option-2 investigation got inserted.
- **Position dropdown** (only positions present, sensible order QB/RB/WR/TE/K/DEF/DL/LB/DB), **League dropdown** (leagues present, USER PRIORITY order via `ampLeagues`), **Starters-only toggle** (`starterIn>0`). All COMPOSE with the existing **Upcoming-only** toggle + **game-window grouping**. **Clear** button (+ empty-state clear link) appears when any filter active. Live count "X of N players".
- Client-side only on the flat `AMP_DATA.list`; re-renders in place via `paintAMP()` + delegated change/click handlers. Module state: `AMP_POS / AMP_LEAGUE / AMP_STARTERS_ONLY / AMP_UPCOMING_ONLY`.
- **Unit-tested (node): 11/11** — each filter, all compositions (WR+starters, league+starters+upcoming, empty result), dropdown ordering (ampPositions, ampLeagues priority), handler wiring. `<script>` parses clean. Verified live on orpin (amp-filters bar + all 3 controls + helper + clear present).
- **Commit `e42ce9a`. Freeze before this:** tag `good-dashboard-pre-filters` → aa0c2fb.

### DASHBOARD STOPPING POINT (user switching to resume/job work). Feature 1 (player images) + Feature 2 (game-window grouping + tap-to-expand leagues + week single-sourcing + game status/score + filters) all COMPLETE and live on https://fantasy-dashboard-orpin.vercel.app/.

## 2026-08-13 — BACKLOG (approved for LATER, NOT built): Option 2 — opponent lineup + borrowed ESPN projections
User approved the plan + approach but deferred building it to focus on resume/job work. Captured here so it's not lost.

**Investigation findings (verified live, so the build is de-risked):**
- **Opponent rosters are ALREADY parsed, just discarded.** Both providers' matchup code already resolves the opponent team object (ESPN: `oppTeam=teams.find(...oppSide.teamId)`; Sleeper: `oppT=teams.find(...oppM.roster_id)`) and `buildTeam` already builds full starters/bench for it. Current code keeps only opp name+total points. Opponent lineup = free, no new fetches.
- **ESPN projections ALREADY flow through the proxy — verified on live Royal Crushers:** each player's `stats[]` has a weekly projection row `statSourceId=1` (projected) + `statSplitTypeId=1` (weekly) + `scoringPeriodId=<week>` → `appliedTotal` (e.g. Jeanty Wk1 = 18.02). Actual is `statSourceId=0` same week (fills post-kickoff). NO proxy change needed. Covers the 6 ESPN leagues.
- **Sleeper has NO projections** (API doesn't expose them — already documented in skips). Covers the 3 Sleeper leagues.

**APPROVED APPROACH (build later): 2-A + inline.**
- 2-A: show borrowed ESPN projections for the 6 ESPN leagues (native scoring, accurate); for the 3 Sleeper leagues show opponent lineup with projection column = "—" + honest note "Sleeper doesn't provide projections." REJECTED 2-B (cross-map Sleeper→ESPN projection via espn_id) because ESPN-scored projections are WRONG for a Sleeper league's different scoring rules = would show a misleading number (violates honesty rule).
- Inline: expand each league card's existing matchup strip into side-by-side you-vs-opponent starting lineups (Feature-1 player images), per-player `proj X.X` (ESPN), projected side totals + margin ("Projected: You 118.4 – 106.2 (+12.2)"). Once games live: actual-vs-projected side by side (actual already in same payload).
- **Binding label:** "Projections borrowed from ESPN's own weekly numbers — not our model." No overpromising a JunceBox projection.
- Build order: 2-opt-A (opp starters into matchup obj both providers + extract ESPN weekly proj into player.projPts + side-by-side render) → 2-opt-B (actual-vs-projected + favored summary once games live).
- **Test note:** can't hit ESPN server-side (Akamai 403) but the proxy can (that's how Jeanty 18.02 was confirmed). Unit-test extraction+total math vs saved payloads; user eyeballs live.
- **Freeze tag when resumed:** start from `good-dashboard-opt2-start` / current `good-dashboard-pre-filters` lineage.

## 2026-08-13 — Feature 2 GROUPING MODES (2b position + 2c by-game) — WORKS. FEATURE 2 TRULY COMPLETE.
The two grouping modes from the original Feature 2 design were never built (only game-window shipped). Added a "Group by" selector: **Game window (default) / By game / Position**, composing with all filters + toggles.
- **2c By game (the one most wanted):** groups all my players in the SAME NFL game under one header ("SEA vs SF" + kickoff), for spotting when one game covers multiple roster spots / stacks. **Stable matchup key** = sorted team pair (`[team,opp].sort().join("__")`) so a player and their opponent-team teammates land in ONE group regardless of home/away. Games ordered by kickoff (TBD last); starters first within a game. Added `oppAbbr` + `matchupKey`/`matchupLabel` to each player in `buildAllMyPlayers`.
- **2b Position:** QB/RB/WR/TE/K/DEF/DL/LB/DB headers (present-only, fixed order), alpha within.
- `groupPlayers(list,mode)` dispatcher; `AMP_GROUP` state; `ampGroup` select wired in change handler. Clear button resets FILTERS only (leaves grouping mode) — correct. Dynamic subhead label ("by game" / "by position" / "by game window").
- **Unit-tested (node): 13/13** — matchup-key stability (SF+SEA players → one group), kickoff ordering, TBD bucket, position order, dispatcher routing + default, wiring. (Two initial test "fails" were my wrong assertions — unsorted matchup key + test data missing p.window — code was correct; fixed the test.) `<script>` parses clean. Verified live on orpin (all 6 markers).
- **Commit `38b1bc2`. Freeze before this:** tag `good-dashboard-pre-groupmodes` → 1db30e7.

### FEATURE 2 NOW TRULY COMPLETE — full original design shipped: game-window grouping + BY-GAME + BY-POSITION grouping modes, tap-to-expand league detail, single-sourced week + game status/score, and position/league/starters/upcoming filters. All live + verified on https://fantasy-dashboard-orpin.vercel.app/. DASHBOARD WORK STOPS HERE — pivoting to resume/job. Option 2 (opponent lineup + borrowed ESPN projections) remains the approved-for-later backlog item.
