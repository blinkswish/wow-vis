import { describe, it, expect } from "vitest";
import { extractMistakes, normalizePercent, type MechanicPlayerStats } from "../scripts/extract-mistakes";
import type { BossConfig, WclFight } from "../src/types";

const config: BossConfig = {
  encounterID: 3009,
  displayName: "Boss",
  zone: "Zone",
  reportCode: "abc",
  mechanics: [
    { id: "fire", label: "Fire", color: "#ff0000", abilityIds: [100, 101], eventType: "damage", countMode: "events" },
    { id: "soak", label: "Soak", color: "#00ff00", abilityIds: [200], eventType: "death", countMode: "events" },
  ],
};

const fights: WclFight[] = [
  { id: 6, name: "Boss", encounterID: 3009, kill: false, startTime: 5000, endTime: 65000, bossPercentage: 40, fightPercentage: 40 },
  { id: 2, name: "Boss", encounterID: 3009, kill: true, startTime: 1000, endTime: 121000, bossPercentage: 0, fightPercentage: 0 },
  { id: 9, name: "Other", encounterID: 9999, kill: false, startTime: 9000, endTime: 9500, bossPercentage: 50, fightPercentage: 50 },
];

// Per-fight, per-mechanic, per-player stats as the fetch layer builds them.
const byFight = new Map<number, MechanicPlayerStats>([
  [2, { fire: { Anya: { count: 2, damage: 200 } }, soak: { Borg: { count: 1, damage: 0 } } }], // earliest -> pull 1
  [6, { fire: { Borg: { count: 1, damage: 90 } } }],                                            // pull 2; soak -> {}
]);

const players = ["Borg", "Anya"];

describe("normalizePercent", () => {
  it("passes a 0..100 value through unchanged", () => expect(normalizePercent(40)).toBe(40));
  it("defensively divides legacy hundredths", () => expect(normalizePercent(4000)).toBe(40));
  it("defaults null to 100", () => expect(normalizePercent(null)).toBe(100));
});

describe("extractMistakes", () => {
  const out = extractMistakes(config, fights, byFight, players, { Anya: { class: "Mage", role: "dps" } }, "2026-01-01T00:00:00Z");

  it("includes only matching-encounter fights, chronological", () => {
    expect(out.pulls.map((p) => p.fightId)).toEqual([2, 6]);
    expect(out.pulls.map((p) => p.pull)).toEqual([1, 2]);
  });

  it("carries per-player stats and fills missing mechanics with {}", () => {
    expect(out.pulls[0].byMechanic.fire).toEqual({ Anya: { count: 2, damage: 200 } });
    expect(out.pulls[0].byMechanic.soak).toEqual({ Borg: { count: 1, damage: 0 } });
    expect(out.pulls[1].byMechanic.soak).toEqual({});
  });

  it("derives kill, duration, and normalized boss percent", () => {
    expect(out.pulls[0].kill).toBe(true);
    expect(out.pulls[1].durationMs).toBe(60000);
    expect(out.pulls[1].bossPercent).toBe(40);
  });

  it("sorts the player roster and carries mechanic metadata", () => {
    expect(out.players).toEqual(["Anya", "Borg"]);
    expect(out.mechanics).toEqual([
      { id: "fire", label: "Fire", color: "#ff0000" },
      { id: "soak", label: "Soak", color: "#00ff00" },
    ]);
  });
});
