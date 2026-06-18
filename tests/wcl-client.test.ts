import { describe, it, expect, vi } from "vitest";
import { getAccessToken, fetchReportFights, fetchPlayers, buildFilterExpression, DATA_TYPE_MAP } from "../scripts/wcl-client";

describe("fetchPlayers", () => {
  it("maps player actor IDs to names and excludes non-players", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { reportData: { report: { masterData: { actors: [
          { id: 1, name: "Anya", type: "Player" },
          { id: 2, name: "Borg", type: "Player" },
          { id: 99, name: "Imp", type: "Pet" },
        ] } } } },
      }),
    });
    const players = await fetchPlayers("tok", "abc", fetchImpl as unknown as typeof fetch);
    expect(players.get(1)).toBe("Anya");
    expect(players.get(2)).toBe("Borg");
    expect(players.has(99)).toBe(false);
  });
});

describe("getAccessToken", () => {
  it("posts client-credentials with basic auth and returns the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok123" }),
    });
    const token = await getAccessToken("id", "secret", fetchImpl as unknown as typeof fetch);
    expect(token).toBe("tok123");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.warcraftlogs.com/oauth/token");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Basic " + Buffer.from("id:secret").toString("base64"),
    );
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "nope" });
    await expect(getAccessToken("id", "secret", fetchImpl as unknown as typeof fetch)).rejects.toThrow(/401/);
  });
});

describe("fetchReportFights", () => {
  it("maps the GraphQL payload to fights and zone name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { reportData: { report: {
          startTime: 1700000000000,
          zone: { name: "Midnight Zone" },
          fights: [{ id: 6, name: "Boss", encounterID: 3009, kill: false, startTime: 5, endTime: 65, bossPercentage: 4000, fightPercentage: 4000 }],
        } } },
      }),
    });
    const { zoneName, reportStart, fights } = await fetchReportFights("tok", "abc", fetchImpl as unknown as typeof fetch);
    expect(zoneName).toBe("Midnight Zone");
    expect(reportStart).toBe(1700000000000);
    expect(fights[0].encounterID).toBe(3009);
  });
});

describe("DATA_TYPE_MAP", () => {
  it("maps event types to WCL enum values", () => {
    expect(DATA_TYPE_MAP.damage).toBe("DamageTaken");
    expect(DATA_TYPE_MAP.death).toBe("Deaths");
    expect(DATA_TYPE_MAP.debuff).toBe("Debuffs");
  });
});

describe("buildFilterExpression", () => {
  it("uses ability.id for damage/debuff", () => {
    expect(buildFilterExpression({ abilityIds: [1, 2], eventType: "damage" })).toBe("ability.id IN (1,2)");
    expect(buildFilterExpression({ abilityIds: [9], eventType: "debuff" })).toBe("ability.id IN (9)");
  });
  it("uses killingAbility.id for death", () => {
    expect(buildFilterExpression({ abilityIds: [3, 4], eventType: "death" })).toBe("killingAbility.id IN (3,4)");
  });
});
