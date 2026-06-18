# wow-vis — Raid Mistake Visualiser

An 8-bit **animated bar-chart race** of per-player raid mistakes across a boss
progression, built from [Warcraft Logs](https://www.warcraftlogs.com) data.
Pick a mechanic, watch who's getting clipped / dying / standing in stuff over
the whole prog — count or damage, with or without tanks. Exports to MP4. The
site is **fully static**, so it deploys free to GitHub Pages.

Your API credentials never leave your machine: a local script pulls the logs and
writes a plain JSON file; the website only ever reads that JSON.

---

## Try the demo (no API key needed)

```bash
git clone <your-fork-url> wow-vis && cd wow-vis
npm install
npm run dev
```

Open the served URL. It ships with generated demo data so you can see the thing
work immediately. To use **your** guild's real logs, read on.

---

## Use it for your guild

### 1. Get a Warcraft Logs API key

1. Log in at <https://www.warcraftlogs.com>.
2. Go to **<https://www.warcraftlogs.com/api/clients/>** (or: your avatar →
   *Settings* → scroll to **Web API** → *Manage your V2 clients*).
3. Click **Create Client**:
   - **Name:** anything (e.g. `wow-vis`).
   - **Redirect URLs:** `http://localhost` (required, but unused by this tool).
   - Leave "Public client" **unchecked**.
4. You'll get a **Client ID** and **Client Secret**. Copy both.

> This uses the **v2 client-credentials** flow — it reads public log data only.
> No account login or write access is involved.

### 2. Add your credentials

```bash
cp .env.example .env
```

Edit `.env`:

```ini
WCL_CLIENT_ID=your_client_id
WCL_CLIENT_SECRET=your_client_secret
```

`.env` is gitignored — **never commit it**.

### 3. Point it at your guild and boss

Edit `config/bosses/midnight.json` (or copy it to a new file per boss). The two
things you change for a new guild are the `guild` block and the boss IDs:

```jsonc
{
  "encounterID": 3183,            // the boss — see "Finding IDs" below
  "displayName": "Midnight Falls",
  "zone": "My Realm",
  "difficulty": 5,                // 3=Normal, 4=Heroic, 5=Mythic
  "voidAfterDeaths": 2,           // ignore events after the Nth death/pull (wipe called)
  "progressionOnly": true,        // keep only pulls up to & including the first kill
  "guild": {
    "name": "My Guild Name",      // exact guild name
    "serverSlug": "my-realm",     // lowercase, hyphenated realm (e.g. area-52)
    "serverRegion": "US"          // US / EU / KR / TW / CN
  },
  "mechanics": [ /* see "Finding IDs" and "Config reference" */ ]
}
```

### 4. Fetch your data

```bash
npm run fetch -- --boss midnight
```

This discovers all of your guild's reports for that boss, pulls the relevant
events, and writes `public/data/midnight.json`. New raid nights are picked up
automatically on each run. Reports are cached locally, so re-runs are fast.

### 5. View it

```bash
npm run dev          # hot-reloading dev server
```

---

## Deploy to GitHub Pages

1. Push your fork to GitHub. Commit your generated `public/data/*.json` (the site
   needs it — it's just public log data, no secrets).
2. In the repo: **Settings → Pages → Source = GitHub Actions**.
3. Set `base` in `vite.config.ts` to `"/<your-repo-name>/"`.
4. Push to `main` — the included workflow (`.github/workflows/deploy.yml`) builds
   and publishes to `https://<you>.github.io/<repo>/`.

---

## Finding encounter & ability IDs

Grab any Warcraft Logs report URL for your guild
(`warcraftlogs.com/reports/XXXXXXXX`) and use the helper scripts:

```bash
# Boss/encounter IDs + the player roster in a report:
npx tsx scripts/list-report.ts <reportCode>

# All of a guild's reports for an encounter (to confirm guild/realm/region):
npx tsx scripts/list-guild-reports.ts "<Guild>" <serverSlug> <region> <encounterID>

# Which abilities hurt players in a fight (to pick mechanics), by damage:
npx tsx scripts/list-abilities.ts <reportCode> <fightId>

# Look up an ability's game ID by (partial) name:
npx tsx scripts/find-ability.ts <reportCode> "Heaven's Glaives"
```

A good "mistake" mechanic is an **avoidable** ability that hits only the people
who fail it (high variance between players), not raid-wide damage everyone takes.

---

## Config reference

Each `config/bosses/<name>.json`:

| Field | Required | Meaning |
|---|---|---|
| `encounterID` | ✓ | WCL encounter id for the boss |
| `displayName` | ✓ | Title shown in the chart |
| `zone` | ✓ | Label only |
| `reportCode` | ✓ | A fallback single report (used if no `guild`/`reportCodes`) |
| `difficulty` | | Only include fights of this difficulty (5 = Mythic) |
| `guild` | | `{ name, serverSlug, serverRegion }` — auto-discover the guild's reports |
| `reportCodes` | | Explicit report list (pins; overrides `guild`) |
| `voidAfterDeaths` | | Ignore all events after the Nth death in a pull |
| `progressionOnly` | | Keep only pulls up to & including the first kill (drop farm) |
| `mechanics[]` | ✓ | What counts as a mistake (below) |

Each mechanic:

| Field | Required | Meaning |
|---|---|---|
| `id` | ✓ | Stable key |
| `label` | ✓ | Display name |
| `color` | ✓ | `#rrggbb` (used when a player's class color is unknown) |
| `abilityIds` | ✓\* | Ability game ids to count. `[]` on a `death` mechanic = **all deaths** |
| `eventType` | ✓ | `damage` \| `death` \| `debuff` |
| `countMode` | ✓ | `"events"` |
| `debounceMs` | | Collapse repeat hits on a player within this window into one (multi-hit volleys → one "clip") |
| `excludeAbilityIds` | | Never count these (deaths: by killing ability — e.g. omit unavoidable wipe mechanics) |

---

## How the mistake metrics work

- **Per-player attribution.** Damage-taken events are attributed to the player who
  took them; deaths to the player who died.
- **Death cutoff (`voidAfterDeaths`).** A wipe is usually called after a couple of
  deaths, so events after the Nth death are noise. Only the first N deaths per
  pull count, and **simultaneous deaths** (same timestamp = a raid-wide hit) are
  dropped — they're the wipe trigger, not individual blame.
- **Debounce (`debounceMs`).** Multi-hit abilities fire as rapid volleys; this
  collapses a volley into one "you got clipped" so the count reflects accuracy.
- **Excludes (`excludeAbilityIds`).** Deaths from listed abilities are never
  blamed on a player (e.g. unavoidable mechanics).
- **Progression-only.** Keeps only pulls through the guild's first kill, dropping
  farm — and doesn't even fetch the farm pulls.
- **Tank detection.** Each player's role is resolved by majority vote across all
  reports, so off-spec pulls don't mislabel a tank. The "No tanks" toggle uses it.

---

## How it works (architecture)

```
.env creds ─▶ npm run fetch ─▶ public/data/<boss>.json (committed)
                                      │
                          static site reads the JSON
                                      │
              8-bit canvas race  ─▶  ffmpeg.wasm  ─▶  .mp4 download
```

The WCL **client secret can never ship in a static site**, so the fetch runs
locally and bakes a secret-free JSON file that the site serves. Reports are
immutable once logged, so fetched events are cached under `cache/` (gitignored);
re-aggregating (tweaking the cutoff, mechanics, etc.) costs **zero** API calls.
`--no-cache` forces a refresh.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (hot reload) |
| `npm run fetch -- --boss <name>` | Pull + aggregate → `public/data/<name>.json` |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests |
| `node scripts/gen-mock.mjs` | Regenerate the demo data (no API needed) |

Fetch flags: `--no-cache` (force refresh), `--reports a,b` (override the report list).

---

## Troubleshooting

- **`Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET`** — fill in `.env`.
- **`discovered 0 reports`** — check `guild.name` (exact), `serverSlug`
  (lowercase-hyphenated), and `serverRegion`. Confirm with `list-guild-reports.ts`.
- **`No matching fights`** — wrong `encounterID` or `difficulty`. Run
  `list-report.ts <code>` to see the encounter ids present.
- **A mechanic shows all zeros** — wrong `abilityIds`. Use `list-abilities.ts` /
  `find-ability.ts` to get the right ones.
- **Export "loading encoder" for a while** — first use downloads a ~30 MB encoder
  from a CDN; it's cached by the browser afterward.

---

## License

[MIT](./LICENSE). Not affiliated with Blizzard Entertainment or Warcraft Logs.
