import { describe, it, expect } from "vitest";
import { Playback } from "../src/animation";

describe("Playback", () => {
  it("advances head by pullsPerSecond * dt", () => {
    const p = new Playback(10, 2); // 2 pulls/sec
    p.advance(1000);
    expect(p.head).toBeCloseTo(2);
  });

  it("clamps head at pullCount and reports done", () => {
    const p = new Playback(3, 100);
    p.advance(1000);
    expect(p.head).toBe(3);
    expect(p.done).toBe(true);
  });

  it("seekFraction maps [0,1] onto [0,pullCount]", () => {
    const p = new Playback(8, 1);
    p.seekFraction(0.5);
    expect(p.head).toBe(4);
  });

  it("gives a deterministic frame->head mapping for export", () => {
    const p = new Playback(6, 2); // 3 seconds total
    expect(p.totalFrames(30)).toBe(90);
    expect(p.headForFrame(0, 30)).toBe(0);
    expect(p.headForFrame(90, 30)).toBe(6);
  });
});
