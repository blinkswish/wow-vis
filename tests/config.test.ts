import { describe, it, expect } from "vitest";
import { validateBossConfig } from "../scripts/config";

const valid = {
  encounterID: 3009,
  displayName: "Test Boss",
  zone: "Test Zone",
  reportCode: "abc",
  mechanics: [
    { id: "fire", label: "Fire", color: "#ff0000", abilityIds: [1], eventType: "damage", countMode: "events" },
  ],
};

describe("validateBossConfig", () => {
  it("accepts a valid config", () => {
    expect(validateBossConfig(valid).encounterID).toBe(3009);
  });

  it("rejects a missing encounterID", () => {
    const bad = { ...valid, encounterID: undefined };
    expect(() => validateBossConfig(bad)).toThrow(/encounterID/);
  });

  it("rejects an unknown eventType", () => {
    const bad = { ...valid, mechanics: [{ ...valid.mechanics[0], eventType: "boom" }] };
    expect(() => validateBossConfig(bad)).toThrow(/eventType/);
  });

  it("rejects a mechanic with no abilityIds", () => {
    const bad = { ...valid, mechanics: [{ ...valid.mechanics[0], abilityIds: [] }] };
    expect(() => validateBossConfig(bad)).toThrow(/abilityIds/);
  });

  it("rejects non-integer ability ids (filterExpression injection guard)", () => {
    for (const evil of ["1) OR 1=1", 1.5, -3, NaN]) {
      const bad = { ...valid, mechanics: [{ ...valid.mechanics[0], abilityIds: [evil] }] };
      expect(() => validateBossConfig(bad)).toThrow(/abilityIds/);
    }
  });

  it("accepts an optional reportCodes array", () => {
    expect(validateBossConfig({ ...valid, reportCodes: ["aaa", "bbb"] }).reportCodes).toEqual(["aaa", "bbb"]);
  });

  it("rejects a non-string reportCodes entry", () => {
    expect(() => validateBossConfig({ ...valid, reportCodes: ["aaa", 7] })).toThrow(/reportCodes/);
  });

  it("allows an empty abilityIds for a death mechanic (all deaths)", () => {
    const cfg = { ...valid, mechanics: [{ id: "deaths", label: "Deaths", color: "#ffffff", abilityIds: [], eventType: "death", countMode: "events" }] };
    expect(validateBossConfig(cfg).mechanics[0].id).toBe("deaths");
  });

  it("still rejects empty abilityIds for a damage mechanic", () => {
    const cfg = { ...valid, mechanics: [{ ...valid.mechanics[0], abilityIds: [] }] };
    expect(() => validateBossConfig(cfg)).toThrow(/abilityIds/);
  });

  it("rejects a non-positive voidAfterDeaths", () => {
    expect(() => validateBossConfig({ ...valid, voidAfterDeaths: 0 })).toThrow(/voidAfterDeaths/);
  });

  it("accepts a positive debounceMs on a mechanic", () => {
    const cfg = { ...valid, mechanics: [{ ...valid.mechanics[0], debounceMs: 2500 }] };
    expect(validateBossConfig(cfg).mechanics[0].debounceMs).toBe(2500);
  });

  it("rejects a non-positive debounceMs", () => {
    const cfg = { ...valid, mechanics: [{ ...valid.mechanics[0], debounceMs: 0 }] };
    expect(() => validateBossConfig(cfg)).toThrow(/debounceMs/);
  });
});
