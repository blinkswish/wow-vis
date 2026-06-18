// Deterministic, feature-complete demo data so the app works WITHOUT a WCL API
// key (npm run dev shows this). Generic names/guild — not real log data.
// Run: node scripts/gen-mock.mjs  ->  writes public/data/midnight.json
import { mkdir, writeFile } from "node:fs/promises";

// Seeded LCG so the mock is reproducible (no Math.random).
let seed = 1337;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// name -> { class (WCL class name, drives bar color), role }
const roster = {
  Tankadin: { class: "Paladin", role: "tank" },
  Bloodfury: { class: "DeathKnight", role: "tank" },
  Lightwell: { class: "Priest", role: "healer" },
  Mistweave: { class: "Monk", role: "healer" },
  Regrowth: { class: "Druid", role: "healer" },
  Pyroclast: { class: "Mage", role: "dps" },
  Shadowtide: { class: "Warlock", role: "dps" },
  Stormfang: { class: "Shaman", role: "dps" },
  Quickshot: { class: "Hunter", role: "dps" },
  Backstabby: { class: "Rogue", role: "dps" },
  Wreckage: { class: "Warrior", role: "dps" },
  Felblade: { class: "DemonHunter", role: "dps" },
  Emberwing: { class: "Evoker", role: "dps" },
  Moonfyre: { class: "Druid", role: "dps" },
};
const players = Object.keys(roster);

const mechanics = [
  { id: "fire", label: "Stood in Fire", color: "#ff5555", eventType: "damage", perHit: 42000 },
  { id: "soak", label: "Missed Soak", color: "#55aaff", eventType: "damage", perHit: 120000 },
  { id: "cleave", label: "Cleave Hit", color: "#ffcc44", eventType: "damage", perHit: 64000 },
  { id: "deaths", label: "Deaths", color: "#ff5555", eventType: "death" },
];

// Per-player, per-mechanic "weakness": higher = more mistakes. Deterministic so
// the leaderboards differ per mechanic.
const weakness = {};
for (const p of players) {
  weakness[p] = {};
  for (const m of mechanics) weakness[p][m.id] = 0.4 + rng() * 1.2;
}
const isTank = (p) => roster[p].role === "tank";

const N = 36;
const pulls = [];
for (let i = 0; i < N; i++) {
  const t = i / (N - 1); // 0..1 prog
  const learn = 1 - 0.7 * t; // mistakes trend down as the guild improves
  const kill = i === N - 1;
  const byMechanic = {};
  for (const m of mechanics) {
    const perPlayer = {};
    for (const p of players) {
      if (m.id === "deaths") {
        // 0 or 1 death this pull; first-2-deaths cutoff is implied by capping total.
        continue; // handled below to enforce <= 2 per pull
      }
      // Tanks rarely eat "soak"; everyone can stand in fire/cleave.
      const factor = m.id === "soak" && isTank(p) ? 0.1 : 1;
      const base = weakness[p][m.id] * learn * 2.4 * factor;
      const noise = 0.6 + rng() * 0.9;
      let count = Math.max(0, Math.round(base * noise - (kill ? 1 : 0)));
      if (rng() > 0.9) count += 1 + Math.round(rng() * 3);
      if (count > 0) perPlayer[p] = { count, damage: Math.round(count * m.perHit * (0.8 + rng() * 0.5)) };
    }
    byMechanic[m.id] = perPlayer;
  }
  // Deaths: pick up to 2 distinct players (weighted by overall sloppiness), unless kill.
  const deaths = {};
  if (!kill) {
    const ranked = players
      .map((p) => ({ p, w: (weakness[p].fire + weakness[p].soak) * (0.5 + rng()) }))
      .sort((a, b) => b.w - a.w);
    const nDeaths = rng() < 0.15 * learn ? 1 : 2;
    for (const { p } of ranked.slice(0, nDeaths)) deaths[p] = { count: 1, damage: 0 };
  }
  byMechanic.deaths = deaths;

  pulls.push({
    pull: i + 1,
    fightId: 100 + i,
    startTime: i * 600000,
    durationMs: Math.round((90 + t * 210) * 1000),
    kill,
    bossPercent: kill ? 0 : Math.round((100 - t * 96) * 10) / 10,
    byMechanic,
  });
}

const viz = {
  zone: "Demo Realm",
  boss: "Demo Boss",
  encounterID: 9999,
  reportCode: "DEMOCODE",
  generatedAt: "2026-06-18T00:00:00Z",
  mechanics: mechanics.map((m) => ({ id: m.id, label: m.label, color: m.color })),
  players: [...players].sort((a, b) => a.localeCompare(b)),
  playerInfo: roster,
  voidAfterDeaths: 2,
  pulls,
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/midnight.json", JSON.stringify(viz, null, 2));
console.log(`wrote public/data/midnight.json — demo: ${players.length} players, ${N} pulls`);
