import { describe, it, expect, vi } from "vitest";
import { renderFrame, LOGICAL_WIDTH, LOGICAL_HEIGHT } from "../src/render";
import type { VizData } from "../src/types";

const data: VizData = {
  zone: "Z", boss: "B", encounterID: 1, reportCode: "abc", generatedAt: "t",
  mechanics: [
    { id: "fire", label: "Fire", color: "#ff0000" },
    { id: "soak", label: "Soak", color: "#00ff00" },
  ],
  players: ["Anya", "Borg", "Cyd"],
  pulls: [
    {
      pull: 1, fightId: 1, startTime: 0, durationMs: 0, kill: false, bossPercent: 80,
      byMechanic: {
        fire: { Anya: { count: 3, damage: 300 }, Borg: { count: 1, damage: 100 } },
        soak: { Cyd: { count: 2, damage: 240 } },
      },
    },
    {
      pull: 2, fightId: 2, startTime: 0, durationMs: 0, kill: true, bossPercent: 0,
      byMechanic: {
        fire: { Borg: { count: 4, damage: 500 } },
        soak: { Anya: { count: 1, damage: 120 } },
      },
    },
  ],
};

function stubCtx() {
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("renderFrame", () => {
  it("has the expected logical dimensions", () => {
    expect(LOGICAL_WIDTH).toBe(320);
    expect(LOGICAL_HEIGHT).toBe(320);
  });

  it("paints and draws without throwing for any head + metric in range", () => {
    const ctx = stubCtx();
    for (const head of [0, 0.5, 1.5, 2]) {
      renderFrame(ctx, data, head, { mechanicId: "fire", metric: "count" });
      renderFrame(ctx, data, head, { mechanicId: "soak", metric: "damage" });
    }
    const fillRect = ctx.fillRect as unknown as ReturnType<typeof vi.fn>;
    const fillText = ctx.fillText as unknown as ReturnType<typeof vi.fn>;
    expect(fillRect.mock.calls.length).toBeGreaterThan(0);
    // player names appear as text
    expect(fillText.mock.calls.some((c) => String(c[0]).includes("Anya"))).toBe(true);
  });

  it("tolerates an unknown mechanicId by falling back to the first", () => {
    const ctx = stubCtx();
    expect(() => renderFrame(ctx, data, 1, { mechanicId: "nope", metric: "count" })).not.toThrow();
  });

  it("hides players with zero value for the selected mechanic", () => {
    // soak: only Cyd (pull 1) and Anya (pull 2) ever take it; Borg never does.
    const ctx = stubCtx();
    renderFrame(ctx, data, 2, { mechanicId: "soak", metric: "count" });
    const fillText = ctx.fillText as unknown as ReturnType<typeof vi.fn>;
    const drawn = fillText.mock.calls.map((c) => String(c[0]));
    expect(drawn).toContain("Cyd");
    expect(drawn).toContain("Anya");
    expect(drawn).not.toContain("Borg");
  });
});
