import { readFile } from "node:fs/promises";
import type { BossConfig, EventType } from "../src/types";

const EVENT_TYPES: EventType[] = ["damage", "death", "debuff"];

export function validateBossConfig(raw: unknown): BossConfig {
  const c = raw as Record<string, unknown>;
  if (typeof c.encounterID !== "number") throw new Error("config: encounterID must be a number");
  if (typeof c.displayName !== "string") throw new Error("config: displayName must be a string");
  if (typeof c.zone !== "string") throw new Error("config: zone must be a string");
  if (typeof c.reportCode !== "string") throw new Error("config: reportCode must be a string");
  if (c.reportCodes !== undefined &&
      (!Array.isArray(c.reportCodes) || !c.reportCodes.every((r) => typeof r === "string")))
    throw new Error("config: reportCodes must be an array of strings");
  if (c.guild !== undefined) {
    const g = c.guild as Record<string, unknown>;
    if (typeof g.name !== "string" || typeof g.serverSlug !== "string" || typeof g.serverRegion !== "string")
      throw new Error("config: guild must be { name, serverSlug, serverRegion } strings");
  }
  if (c.difficulty !== undefined && typeof c.difficulty !== "number")
    throw new Error("config: difficulty must be a number");
  if (c.voidAfterDeaths !== undefined && (typeof c.voidAfterDeaths !== "number" || c.voidAfterDeaths < 1))
    throw new Error("config: voidAfterDeaths must be a positive number");
  if (c.progressionOnly !== undefined && typeof c.progressionOnly !== "boolean")
    throw new Error("config: progressionOnly must be a boolean");
  if (!Array.isArray(c.mechanics) || c.mechanics.length === 0)
    throw new Error("config: mechanics must be a non-empty array");

  for (const m of c.mechanics as Record<string, unknown>[]) {
    if (typeof m.id !== "string") throw new Error("config: mechanic.id must be a string");
    if (typeof m.label !== "string") throw new Error("config: mechanic.label must be a string");
    if (typeof m.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(m.color))
      throw new Error(`config: mechanic.color must be a #rrggbb hex (got ${m.color})`);
    if (!EVENT_TYPES.includes(m.eventType as EventType))
      throw new Error(`config: mechanic.eventType must be one of ${EVENT_TYPES.join("|")} (${m.id})`);
    // Ability ids are interpolated into the WCL filterExpression, so they must
    // be safe non-negative integers (no injection via a hand-edited config).
    const isAbilityId = (a: unknown) => typeof a === "number" && Number.isInteger(a) && a >= 0;
    // A "death" mechanic with an empty abilityIds list means "all deaths".
    if (!Array.isArray(m.abilityIds) || !m.abilityIds.every(isAbilityId) ||
        (m.abilityIds.length === 0 && m.eventType !== "death"))
      throw new Error(`config: mechanic.abilityIds must be a non-empty array of non-negative integers (${m.id})`);
    if (m.excludeAbilityIds !== undefined &&
        (!Array.isArray(m.excludeAbilityIds) || !m.excludeAbilityIds.every(isAbilityId)))
      throw new Error(`config: mechanic.excludeAbilityIds must be an array of non-negative integers (${m.id})`);
    if (m.countMode !== "events") throw new Error(`config: mechanic.countMode must be "events" (${m.id})`);
    if (m.debounceMs !== undefined && (typeof m.debounceMs !== "number" || m.debounceMs <= 0))
      throw new Error(`config: mechanic.debounceMs must be a positive number (${m.id})`);
  }
  return c as unknown as BossConfig;
}

export async function loadBossConfig(path: string): Promise<BossConfig> {
  const text = await readFile(path, "utf8");
  return validateBossConfig(JSON.parse(text));
}
