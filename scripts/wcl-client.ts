import type { WclFight, WclEvent, WclActor, EventType, MechanicConfig, PlayerInfo } from "../src/types";

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const GQL_URL = "https://www.warcraftlogs.com/api/v2/client";

export const DATA_TYPE_MAP: Record<EventType, string> = {
  damage: "DamageTaken",
  death: "Deaths",
  debuff: "Debuffs",
};

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a timeout + retry/backoff on 429, 5xx, and network errors.
 * Honors a Retry-After header when present; otherwise exponential backoff. */
async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        if (attempt === MAX_ATTEMPTS) throw new Error(`${label} failed: ${res.status} ${await res.text()}`);
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
        console.warn(`[wcl] ${label} ${res.status}; retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === MAX_ATTEMPTS) break;
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`[wcl] ${label} network error; retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${String((lastErr as Error)?.message ?? lastErr)}`);
}

export async function getAccessToken(
  id: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await request(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }, "token request");
  if (!res.ok) throw new Error(`WCL token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await request(fetchImpl, GQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  }, "GraphQL");
  if (!res.ok) throw new Error(`WCL GraphQL failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors) throw new Error(`WCL GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

const FIGHTS_QUERY = `
query($code: String!) {
  reportData {
    report(code: $code) {
      startTime
      zone { name }
      fights {
        id name encounterID kill startTime endTime bossPercentage fightPercentage difficulty
      }
    }
  }
}`;

export async function fetchReportFights(
  token: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ zoneName: string; reportStart: number; fights: WclFight[] }> {
  const data = await gql<{ reportData: { report: { startTime?: number; zone: { name: string } | null; fights: WclFight[] } } }>(
    token, FIGHTS_QUERY, { code }, fetchImpl,
  );
  const report = data.reportData.report;
  return { zoneName: report.zone?.name ?? "Unknown", reportStart: report.startTime ?? 0, fights: report.fights };
}

export interface GuildRef {
  name: string;
  serverSlug: string;
  serverRegion: string;
}

const GUILD_REPORTS_QUERY = `
query($name: String!, $slug: String!, $region: String!, $enc: Int!, $page: Int!) {
  reportData {
    reports(guildName: $name, guildServerSlug: $slug, guildServerRegion: $region, limit: 25, page: $page) {
      has_more_pages
      data { code startTime fights(encounterID: $enc) { difficulty } }
    }
  }
}`;

/** All of a guild's report codes that contain the encounter at the given
 * difficulty, oldest-first. Paginates the guild's report list. */
export async function fetchGuildReports(
  token: string,
  guild: GuildRef,
  encounterID: number,
  difficulty: number | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  type Rep = { code: string; startTime: number; fights: { difficulty: number | null }[] };
  const hits: { code: string; startTime: number }[] = [];
  let page = 1, emptyStreak = 0;
  // Reports come newest-first, so the boss's reports are contiguous. Once we've
  // found some and then hit several empty pages, the rest are older content.
  while (page <= 40) {
    const data = await gql<{ reportData: { reports: { has_more_pages: boolean; data: Rep[] } } }>(
      token, GUILD_REPORTS_QUERY,
      { name: guild.name, slug: guild.serverSlug, region: guild.serverRegion, enc: encounterID, page },
      fetchImpl,
    );
    const r = data.reportData.reports;
    let pageHits = 0;
    for (const rep of r.data) {
      if (rep.fights.some((f) => difficulty == null || f.difficulty === difficulty)) {
        hits.push({ code: rep.code, startTime: rep.startTime });
        pageHits += 1;
      }
    }
    emptyStreak = pageHits > 0 ? 0 : emptyStreak + 1;
    if (!r.has_more_pages || (hits.length > 0 && emptyStreak >= 3)) break;
    page += 1;
  }
  return hits.sort((a, b) => a.startTime - b.startTime).map((h) => h.code);
}

const PLAYERS_QUERY = `
query($code: String!) {
  reportData {
    report(code: $code) {
      masterData(translate: true) {
        actors(type: "Player") { id name type subType }
      }
    }
  }
}`;

/** Report-local actor IDs (used in event sourceID/targetID) → player name.
 * We filter to type "Player" server-side; pets/NPCs are excluded so their
 * damage is not mis-attributed to a player. */
export async function fetchPlayers(
  token: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, string>> {
  const data = await gql<{ reportData: { report: { masterData: { actors: WclActor[] } } } }>(
    token, PLAYERS_QUERY, { code }, fetchImpl,
  );
  const actors = data.reportData.report.masterData.actors ?? [];
  return new Map(actors.filter((a) => a.type === "Player").map((a) => [a.id, a.name]));
}

/** Player class + role from playerDetails, keyed by player name. Roles come
 * from the tanks/healers/dps buckets; class is each entry's `type`. */
export async function fetchPlayerInfo(
  token: string,
  code: string,
  fightIDs: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PlayerInfo>> {
  const query = `
    query($code: String!, $fightIDs: [Int]!) {
      reportData { report(code: $code) {
        playerDetails(fightIDs: $fightIDs)
      } }
    }`;
  const vars: Record<string, unknown> = { code, fightIDs };

  type Entry = { name: string; type?: string };
  type Buckets = { tanks?: Entry[]; healers?: Entry[]; dps?: Entry[] };
  // playerDetails returns { data: { playerDetails: { tanks, healers, dps } } }.
  const data = await gql<{ reportData: { report: { playerDetails: { data?: { playerDetails?: Buckets } } } } }>(
    token, query, vars, fetchImpl,
  );
  const buckets: Buckets = data.reportData.report.playerDetails?.data?.playerDetails ?? {};
  const out = new Map<string, PlayerInfo>();
  for (const [role, entries] of [["tank", buckets.tanks], ["healer", buckets.healers], ["dps", buckets.dps]] as const) {
    for (const e of entries ?? []) out.set(e.name, { class: e.type, role });
  }
  return out;
}

/** Server-side filter is more reliable than the `abilityID` argument, and for
 * deaths the killing spell lives under `killingAbility.id`, not `ability.id`.
 * Accepts a combined ability-id list so all mechanics of one event type can be
 * fetched in a single query (fewer API calls). */
export function buildFilterExpression(
  mechanic: Pick<MechanicConfig, "abilityIds" | "eventType">,
): string {
  const field = mechanic.eventType === "death" ? "killingAbility.id" : "ability.id";
  return `${field} IN (${mechanic.abilityIds.join(",")})`;
}

const EVENTS_QUERY = `
query($code: String!, $start: Float!, $end: Float!, $dataType: EventDataType!, $expr: String) {
  reportData {
    report(code: $code) {
      events(startTime: $start, endTime: $end, dataType: $dataType, filterExpression: $expr, limit: 10000) {
        data
        nextPageTimestamp
      }
    }
  }
}`;

/** Fetches all events of one event type within one fight, filtered to the given
 * ability ids (the union across all mechanics of that type), paging until
 * exhausted. An empty `abilityIds` fetches every event of the type (used to grab
 * all deaths). The caller maps each event back to a mechanic by its ability id. */
export async function fetchEventsByType(
  token: string,
  code: string,
  fight: WclFight,
  eventType: EventType,
  abilityIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<WclEvent[]> {
  const out: WclEvent[] = [];
  const dataType = DATA_TYPE_MAP[eventType];
  const expr = abilityIds.length > 0 ? buildFilterExpression({ abilityIds, eventType }) : null;
  let start = fight.startTime;
  for (let page = 0; page < 100; page++) {
    const data = await gql<{ reportData: { report: { events: { data: WclEvent[]; nextPageTimestamp: number | null } } } }>(
      token, EVENTS_QUERY,
      { code, start, end: fight.endTime, dataType, expr },
      fetchImpl,
    );
    const evPage = data.reportData.report.events;
    out.push(...evPage.data);
    // Stop when exhausted, or if the cursor fails to advance (guards against a
    // malformed response causing an infinite loop).
    if (evPage.nextPageTimestamp == null || evPage.nextPageTimestamp <= start) break;
    start = evPage.nextPageTimestamp;
  }
  return out;
}
