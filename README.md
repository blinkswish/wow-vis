# wow-vis — Raid Mistake Visualiser

An 8-bit bar-chart race of per-player raid mistakes across a boss progression,
built from [Warcraft Logs](https://www.warcraftlogs.com) data. Pick a mechanic
and watch who's getting clipped, dying, or standing in stuff over the whole prog.
Count or damage, with or without tanks. You can export the animation to MP4.

The site is static, so it hosts free on GitHub Pages. Your API credentials stay
on your machine: a local script pulls the logs and writes a plain JSON file, and
the website only ever reads that JSON.

---

## Try the demo (no API key needed)

```bash
git clone <your-fork-url> wow-vis && cd wow-vis
npm install
npm run dev
```

Open the served URL. It comes with generated demo data so you can see it working
straight away. To point it at your own guild's logs, keep reading.

---

## Use it for your guild

### 1. Get a Warcraft Logs API key

1. Log in at <https://www.warcraftlogs.com>.
2. Go to <https://www.warcraftlogs.com/api/clients/> (or: your avatar →
   *Settings* → scroll to *Web API* → *Manage your V2 clients*).
3. Click *Create Client*:
   - Name: anything (e.g. `wow-vis`).
   - Redirect URLs: `http://localhost`. It's required but this tool never uses it.
   - Leave "Public client" unchecked.
4. Copy the Client ID and Client Secret it gives you.

This uses the v2 client-credentials flow, which only reads public log data. There's
no account login or write access involved.

### 2. Add your credentials

```bash
cp .env.example .env
```

Then put your keys in `.env`:

```ini
WCL_CLIENT_ID=your_client_id
WCL_CLIENT_SECRET=your_client_secret
```

`.env` is gitignored. Don't commit it.

### 3. Point it at your guild and boss

Edit `config/bosses/midnight.json` (or copy it to a new file for another boss).
For a new guild you really only change the `guild` block and the boss IDs:

```jsonc
{
  "encounterID": 3183,            // the boss (see "Finding IDs" below)
  "displayName": "Midnight Falls",
  "zone": "My Realm",
  "difficulty": 5,                // 3 = Normal, 4 = Heroic, 5 = Mythic
  "voidAfterDeaths": 2,           // ignore events after the Nth death in a pull (wipe called)
  "progressionOnly": true,        // keep only pulls up to and including the first kill
  "guild": {
    "name": "My Guild Name",      // exact guild name
    "serverSlug": "my-realm",     // lowercase, hyphenated realm, e.g. area-52
    "serverRegion": "US"          // US / EU / KR / TW / CN
  },
  "mechanics": [ /* see "Finding IDs" and "Config reference" */ ]
}
```

### 4. Fetch your data

```bash
npm run fetch -- midnight
```

(The `--` is npm's, separating its own args from the script's. `midnight` is the
config file name, `config/bosses/midnight.json`.)

This finds all of the guild's reports for that boss, pulls the relevant events,
and writes `public/data/midnight.json`. It picks up new raid nights automatically
on each run, and caches reports locally so re-runs are quick.

### 5. View it

```bash
npm run dev          # hot-reloading dev server
```

---

## Deploy to GitHub Pages

1. Push your fork to GitHub. Commit your generated `public/data/*.json` too. The
   site needs it, and it's just public log data with no secrets in it.
2. In the repo: Settings → Pages → Source = GitHub Actions.
3. Set `base` in `vite.config.ts` to `"/<your-repo-name>/"`.
4. Push to `main`. The workflow at `.github/workflows/deploy.yml` builds and
   publishes to `https://<you>.github.io/<repo>/`.

---

## Finding encounter & ability IDs

Grab any Warcraft Logs report URL for your guild
(`warcraftlogs.com/reports/XXXXXXXX`) and use the helper scripts:

```bash
# Boss/encounter IDs + the player roster in a report:
npx tsx scripts/list-report.ts <reportCode>

# All of a guild's reports for an encounter (to confirm guild/realm/region):
npx tsx scripts/list-guild-reports.ts "<Guild>" <serverSlug> <region> <encounterID>

# Which abilities hurt players in a fight, by damage (to pick mechanics):
npx tsx scripts/list-abilities.ts <reportCode> <fightId>

# Look up an ability's game ID by (partial) name:
npx tsx scripts/find-ability.ts <reportCode> "Heaven's Glaives"
```

A good "mistake" mechanic is something avoidable that only hits the people who
fail it, so the counts vary a lot between players. Raid-wide damage everyone eats
makes for a boring, flat race.

---

## Config reference

Each `config/bosses/<name>.json`:

| Field | Required | Meaning |
|---|---|---|
| `encounterID` | yes | WCL encounter id for the boss |
| `displayName` | yes | Title shown in the chart |
| `zone` | yes | Label only |
| `reportCode` | yes | A fallback single report, used if there's no `guild` or `reportCodes` |
| `difficulty` | | Only include fights of this difficulty (5 = Mythic) |
| `guild` | | `{ name, serverSlug, serverRegion }` to auto-discover the guild's reports |
| `reportCodes` | | Explicit report list (pins it; overrides `guild`) |
| `voidAfterDeaths` | | Ignore all events after the Nth death in a pull |
| `progressionOnly` | | Keep only pulls up to and including the first kill (drop farm) |
| `mechanics[]` | yes | What counts as a mistake (below) |

Each mechanic:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable key |
| `label` | yes | Display name |
| `color` | yes | `#rrggbb`, used when a player's class color isn't known |
| `abilityIds` | yes\* | Ability game ids to count. `[]` on a `death` mechanic means all deaths |
| `eventType` | yes | `damage`, `death`, or `debuff` |
| `countMode` | yes | `"events"` |
| `debounceMs` | | Collapse repeat hits on a player within this window into one. Turns multi-hit volleys into a single "clip" |
| `excludeAbilityIds` | | Never count these. For deaths, matched by killing ability (e.g. to drop unavoidable wipe mechanics) |

---

## How the mistake metrics work

A few of these have opinions baked in, so it's worth knowing what they do.

- **Per-player attribution.** Damage-taken events go to the player who took them;
  deaths go to the player who died.
- **Death cutoff (`voidAfterDeaths`).** A wipe usually gets called after a couple
  of deaths, so anything after that is noise. Only the first N deaths in a pull
  count. Simultaneous deaths (same timestamp, so a raid-wide hit) are dropped
  too. That's the wipe trigger, not one person's fault.
- **Debounce (`debounceMs`).** Some abilities hit several times in a fraction of a
  second. This collapses a volley into one "you got clipped" so the number means
  "times caught," not "ticks taken."
- **Excludes (`excludeAbilityIds`).** Deaths from the listed abilities never get
  pinned on a player. Use it for stuff nobody can avoid.
- **Progression only.** Keeps pulls through the guild's first kill and drops the
  farm after it. It doesn't even fetch the farm pulls.
- **Tank detection.** A player's role is a majority vote across all their reports,
  so an off-spec night won't get a tank mislabelled as DPS. The "No tanks" toggle
  relies on it.

---

## How it works

```
.env creds ─▶ npm run fetch ─▶ public/data/<boss>.json (committed)
                                      │
                          static site reads the JSON
                                      │
              8-bit canvas race  ─▶  ffmpeg.wasm  ─▶  .mp4 download
```

The WCL client secret can't ship in a static site, so the fetch runs locally and
bakes a secret-free JSON file for the site to serve. Reports never change once
they're logged, so fetched events get cached under `cache/` (gitignored).
Re-aggregating after a config tweak (cutoff, mechanics, and so on) costs no API
calls at all. Pass `--no-cache` if you ever need to force a refresh.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (hot reload) |
| `npm run fetch -- <name>` | Pull and aggregate into `public/data/<name>.json` |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests |
| `node scripts/gen-mock.mjs` | Regenerate the demo data (no API needed) |

Fetch flags: `--no-cache` forces a refresh, `--reports a,b` overrides the report list.

---

## Troubleshooting

- `Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET`: fill in `.env`.
- `discovered 0 reports`: check `guild.name` (it's exact), `serverSlug`
  (lowercase, hyphenated), and `serverRegion`. Sanity-check with `list-guild-reports.ts`.
- `No matching fights`: wrong `encounterID` or `difficulty`. Run
  `list-report.ts <code>` to see which encounter ids are actually in the report.
- A mechanic shows all zeros: wrong `abilityIds`. Use `list-abilities.ts` or
  `find-ability.ts` to get the right ones.
- Export sits on "loading encoder" for a bit: the first run downloads a ~30 MB
  encoder from a CDN. The browser caches it after that.

---

## License

[MIT](./LICENSE). Not affiliated with Blizzard Entertainment or Warcraft Logs.
