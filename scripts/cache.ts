import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { WclFight, PlayerInfo } from "../src/types";

const CACHE_DIR = "cache";
const SCHEMA = 2; // bump when the cached shape changes, to invalidate old caches

/** Only the event fields the aggregator needs (keeps the cache small). */
export interface CachedEvent {
  timestamp: number;
  targetID?: number;
  abilityGameID?: number;
  amount?: number;
  unmitigatedAmount?: number;
  killingAbilityGameID?: number;
}

/** A WCL report is immutable once logged, so its fetched data caches forever. */
export interface ReportCache {
  code: string;
  schema: number;
  fetchedAt: string;
  reportStart: number;
  zoneName: string;
  fights: WclFight[];
  players: [number, string][];            // actor id -> name
  playerInfo?: [string, PlayerInfo][];    // name -> class/role
  events: Record<string, CachedEvent[]>;  // key: `${fightId}:${eventType}:${abilityKey}`
}

export function newCache(code: string): ReportCache {
  return { code, schema: SCHEMA, fetchedAt: "", reportStart: 0, zoneName: "", fights: [], players: [], events: {} };
}

export function eventsKey(fightId: number, eventType: string, abilityIds: number[]): string {
  const k = abilityIds.length ? [...abilityIds].sort((a, b) => a - b).join("-") : "ALL";
  return `${fightId}:${eventType}:${k}`;
}

export async function loadReportCache(code: string): Promise<ReportCache | null> {
  try {
    const c = JSON.parse(await readFile(`${CACHE_DIR}/${code}.json`, "utf8")) as ReportCache;
    return c.schema === SCHEMA ? c : null;
  } catch {
    return null; // missing or unreadable → treat as no cache
  }
}

export async function saveReportCache(c: ReportCache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(`${CACHE_DIR}/${c.code}.json`, JSON.stringify(c));
}
