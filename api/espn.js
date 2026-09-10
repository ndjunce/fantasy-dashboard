/* ============================================================================
   ESPN serverless proxy (Vercel).  Phase 2 of the All-in-One Fantasy Dashboard.

   WHY THIS EXISTS: ESPN private leagues need account cookies (espn_s2 + SWID).
   A browser cannot keep a secret, so the cookie lives ONLY here in Vercel's
   encrypted environment variables. This function calls ESPN server-side and
   returns ONLY fantasy DATA to the browser — the cookie never leaves the server.

   ENV VARS (set in Vercel dashboard → Project → Settings → Environment Variables):
     ESPN_S2   = <your espn_s2 cookie value>
     ESPN_SWID = {your-SWID-including-braces}

   Read-only: this function only issues GETs to ESPN's read endpoint.
   ============================================================================ */

// The ONLY leagues this proxy will fetch. Prevents the function from being used
// to proxy arbitrary ESPN league IDs with your cookie.
const LEAGUE_WHITELIST = new Set([
  "963488",      // Royal Crushers
  "484087929",   // Dargelong
  "764639655",   // 2QB / Winona
  "175994",      // 6-man
  "1910409336",  // CAN AM
  "771790710",   // Uncle and Boys
]);

// Only these ESPN "views" may be requested (read-only data views we actually use).
const VIEW_WHITELIST = new Set([
  "mTeam","mRoster","mMatchup","mSettings","mStandings","mSchedule","kona_player_info",
]);

// Origins allowed to call this from a browser. Same-origin (the vercel.app deploy)
// needs no CORS, but we also allow the GitHub Pages copy as a convenience.
const ALLOWED_ORIGINS = [
  "https://ndjunce.github.io",
];

// tiny in-memory cache (per warm lambda) — ~60s, eases rapid refreshes / ESPN load.
const CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000;

function setCors(req, res){
  const origin = req.headers.origin;
  if(origin && ALLOWED_ORIGINS.includes(origin)){
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === "OPTIONS"){ res.status(204).end(); return; }
  if(req.method !== "GET"){ res.status(405).json({ error:"method_not_allowed" }); return; }

  const s2 = process.env.ESPN_S2;
  const swidRaw = process.env.ESPN_SWID;
  if(!s2 || !swidRaw){
    res.status(500).json({ error:"server_not_configured",
      message:"ESPN_S2 / ESPN_SWID env vars are not set on the server." });
    return;
  }
  const swid = swidRaw.startsWith("{") ? swidRaw : "{" + swidRaw.replace(/[{}]/g,"") + "}";

  // parse query
  const { league, season = "2026", scoringPeriodId } = req.query || {};
  const leagueId = String(league || "");
  if(!LEAGUE_WHITELIST.has(leagueId)){
    res.status(400).json({ error:"league_not_allowed",
      message:"That league id is not in the server whitelist." });
    return;
  }
  // views: default to the standard set; allow an explicit &view= list, filtered to the whitelist
  let views = [];
  const raw = req.query.view;
  if(raw){
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    views = list.filter(v => VIEW_WHITELIST.has(v));
  }
  if(!views.length) views = ["mTeam","mRoster","mMatchup","mSettings","mStandings","mSchedule"];

  const qs = new URLSearchParams();
  views.forEach(v => qs.append("view", v));
  if(scoringPeriodId) qs.set("scoringPeriodId", String(scoringPeriodId));

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${encodeURIComponent(season)}`
    + `/segments/0/leagues/${encodeURIComponent(leagueId)}?${qs.toString()}`;

  const cacheKey = url;
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if(hit && (now - hit.ts) < CACHE_TTL_MS){
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(hit.data);
    return;
  }

  try{
    const espnRes = await fetch(url, {
      headers: {
        "Cookie": `espn_s2=${s2}; SWID=${swid}`,
        "User-Agent": "Mozilla/5.0 (fantasy-dashboard serverless proxy)",
        "Accept": "application/json",
      },
    });

    if(espnRes.status === 401 || espnRes.status === 403){
      // cookie dead/expired — tell the client cleanly so it can show a refresh-cookie state.
      res.status(200).json({ error:"espn_auth_expired",
        message:"ESPN session cookie is missing/expired. Refresh ESPN_S2 + ESPN_SWID in Vercel." });
      return;
    }
    if(!espnRes.ok){
      res.status(502).json({ error:"espn_upstream", status: espnRes.status });
      return;
    }
    const data = await espnRes.json();
    CACHE.set(cacheKey, { ts: now, data });
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json(data);
  }catch(e){
    res.status(502).json({ error:"fetch_failed", message: String(e && e.message || e) });
  }
};
