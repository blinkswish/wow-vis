export type EventType = "damage" | "death" | "debuff";

export interface MechanicConfig {
  id: string;          // stable key, e.g. "fire"
  label: string;       // display, e.g. "Stood in Fire"
  color: string;       // hex, e.g. "#ff5555"
  abilityIds: number[];
  excludeAbilityIds?: number[]; // never count events from these abilities (for death:
                                // by killing ability, e.g. omit unavoidable wipe mechanics)
  eventType: EventType; // which WCL dataType to query
  countMode: "events";  // each matching event = 1 mistake
  // Collapse repeated hits on the same player within this window (ms) into one,
  // counting only landed hits (unmitigatedAmount > 0). For multi-hit abilities
  // this turns raw tick count into "distinct times clipped" (accuracy).
  debounceMs?: number;
}

export interface BossConfig {
  encounterID: number;
  displayName: string;
  zone: string;
  reportCode: string;        // primary report (kept for reference / single-report use)
  reportCodes?: string[];    // optional: explicit report list (pins; overrides guild discovery)
  guild?: { name: string; serverSlug: string; serverRegion: string }; // auto-discover this guild's reports
  difficulty?: number;       // optional: only include fights of this difficulty (e.g. 5 = Mythic)
  voidAfterDeaths?: number;  // optional: ignore all events after the Nth death in a pull
                             // (a wipe was likely called, so later events are noise)
  progressionOnly?: boolean; // optional: keep only pulls up to & including the first kill (drop farm)
  mechanics: MechanicConfig[];
}

/** Subset of a WCL fight we rely on. */
export interface WclFight {
  id: number;
  name: string;
  encounterID: number;
  kill: boolean | null;
  startTime: number;       // ms relative to report start
  endTime: number;
  bossPercentage: number | null;  // percentage 0..100 (WCL v2 Float)
  fightPercentage: number | null;
  difficulty?: number | null;     // WCL difficulty id (e.g. 5 = Mythic)
}

/** A player actor from the report's masterData. */
export interface WclActor {
  id: number;
  name: string;
  type: string;      // "Player", "NPC", "Pet", ...
  subType?: string;  // class for players
}

/** Subset of a WCL raw event (from `events.data`) we rely on. */
export interface WclEvent {
  timestamp: number;
  type: string;
  sourceID?: number;        // actor causing the event (boss/ability source)
  targetID?: number;        // actor on the receiving end (the player, for DamageTaken)
  abilityGameID?: number;
  amount?: number;          // damage dealt to target
  absorbed?: number;        // damage absorbed by shields
  unmitigatedAmount?: number;
  killingAbilityGameID?: number;
}

/** Per-player tally for one mechanic within one pull (non-cumulative). */
export interface PlayerStat {
  count: number;   // number of mistake events
  damage: number;  // total damage taken from the mechanic
}

export interface PullData {
  pull: number;            // 1-based ordinal among matching fights
  fightId: number;
  startTime: number;
  durationMs: number;
  kill: boolean;
  bossPercent: number;     // 0-100
  // mechanicId -> playerName -> increment for THIS pull only.
  byMechanic: Record<string, Record<string, PlayerStat>>;
}

export interface PlayerInfo {
  class?: string;  // WCL class name, e.g. "Paladin"
  role?: string;   // "tank" | "healer" | "dps"
}

export interface VizData {
  zone: string;
  boss: string;
  encounterID: number;
  reportCode: string;
  generatedAt: string;
  mechanics: Pick<MechanicConfig, "id" | "label" | "color">[];
  players: string[];       // all player names seen across the prog
  playerInfo?: Record<string, PlayerInfo>; // name -> class/role
  voidAfterDeaths?: number; // events ignored after the Nth death in a pull
  pulls: PullData[];
}
