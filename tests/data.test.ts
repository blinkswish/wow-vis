import { describe, it, expect } from "vitest";
import { assertVizData, cumulativeRanking, maxCumulative, tankNames } from "../src/data";
import type { VizData } from "../src/types";

const good: VizData = {
  zone: "Z", boss: "B", encounterID: 1, reportCode: "abc", generatedAt: "t",
  mechanics: [{ id: "fire", label: "Fire", color: "#ff0000" }],
  players: ["Anya", "Borg"],
  pulls: [
    {
      pull: 1, fightId: 2, startTime: 0, durationMs: 1000, kill: false, bossPercent: 50,
      byMechanic: { fire: { Anya: { count: 3, damage: 300 }, Borg: { count: 1, damage: 100 } } },
    },
    {
      pull: 2, fightId: 6, startTime: 0, durationMs: 1000, kill: true, bossPercent: 0,
      byMechanic: { fire: { Anya: { count: 1, damage: 90 }, Borg: { count: 4, damage: 500 } } },
    },
  ],
};

describe("assertVizData", () => {
  it("accepts well-formed data", () => {
    expect(assertVizData(good).pulls.length).toBe(2);
  });
  it("rejects missing pulls array", () => {
    expect(() => assertVizData({ ...good, pulls: null })).toThrow(/pulls/);
  });
  it("rejects missing players array", () => {
    expect(() => assertVizData({ ...good, players: null })).toThrow(/players/);
  });
});

describe("cumulativeRanking", () => {
  it("sums full pulls and ranks descending by count", () => {
    // through pull 2 (head=2): Anya 3+1=4, Borg 1+4=5 -> Borg leads
    const r = cumulativeRanking(good, "fire", "count", 2);
    expect(r.map((p) => [p.name, p.value])).toEqual([["Borg", 5], ["Anya", 4]]);
  });

  it("partially weights the in-progress pull", () => {
    // head=1.5: pull1 full + half of pull2. Anya 3 + 0.5*1 = 3.5, Borg 1 + 0.5*4 = 3
    const r = cumulativeRanking(good, "fire", "count", 1.5);
    expect(r[0]).toEqual({ name: "Anya", value: 3.5 });
    expect(r[1]).toEqual({ name: "Borg", value: 3 });
  });

  it("ranks by damage when metric is damage", () => {
    const r = cumulativeRanking(good, "fire", "damage", 2);
    expect(r.map((p) => p.name)).toEqual(["Borg", "Anya"]); // 600 vs 390
  });

  it("includes players with zero at head 0", () => {
    const r = cumulativeRanking(good, "fire", "count", 0);
    expect(r.every((p) => p.value === 0)).toBe(true);
    expect(r.length).toBe(2);
  });
});

describe("maxCumulative", () => {
  it("returns the top final total for the metric", () => {
    expect(maxCumulative(good, "fire", "count")).toBe(5);   // Borg's 5
    expect(maxCumulative(good, "fire", "damage")).toBe(600); // Borg's 600
  });
});

describe("tank exclusion", () => {
  const withTanks: VizData = { ...good, playerInfo: { Borg: { class: "Warrior", role: "tank" }, Anya: { class: "Mage", role: "dps" } } };

  it("tankNames returns only tank-role players", () => {
    expect([...tankNames(withTanks)]).toEqual(["Borg"]);
  });

  it("cumulativeRanking omits excluded players entirely", () => {
    const r = cumulativeRanking(withTanks, "fire", "count", 2, tankNames(withTanks));
    expect(r.map((p) => p.name)).toEqual(["Anya"]); // Borg (tank) excluded
  });
});
