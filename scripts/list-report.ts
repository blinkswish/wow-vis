import "dotenv/config";
import { getAccessToken, fetchReportFights, fetchPlayers } from "./wcl-client";

async function main() {
  const code = process.argv[2];
  if (!code) throw new Error("usage: npx tsx scripts/list-report.ts <reportCode>");
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing WCL creds in env");

  const token = await getAccessToken(id, secret);
  const { zoneName, fights } = await fetchReportFights(token, code);
  console.log(`zone: ${zoneName}`);
  console.log(`fights: ${fights.length}`);
  for (const f of fights) {
    const dur = Math.round((f.endTime - f.startTime) / 1000);
    console.log(
      `  fight ${String(f.id).padStart(3)} | enc ${String(f.encounterID).padStart(5)} | kill=${f.kill} | ${dur}s | ${f.name}`,
    );
  }
  const players = await fetchPlayers(token, code);
  console.log(`players (${players.size}): ${[...players.values()].join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
