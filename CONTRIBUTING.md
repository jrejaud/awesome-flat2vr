# Contributing

## How the data works

- **One port, one file:** each port is `ports/<slug>.yml`.
- **Generated from the data:** `README.md` and [`data/ports.json`](data/ports.json) are built from those files by `npm run build`.
- **Open data:** everything is CC0, so other sites and tools are free to use `data/ports.json`.
- **Downloads go to the creator:** nothing here hosts game files or mod binaries, and every download link points to the creator's own release page.
- **You must own the original game.**
- **Images:** each game in an entry needs an image in `images/<slug>/`. `node scripts/enrich.mjs <slug>` fetches it (Steam store art, falling back to a YouTube thumbnail) and finds YouTube reviews.
- **Not indexed:** universal injectors (UEVR, UUVR). A per-game UEVR profile _is_ indexed, with `category: profile`.

One port = one file: `ports/<slug>.yml`. The slug is kebab-case and is usually the port's own name (`lambda1vr`, `two-forks-vr`).

**Edit data, never the README table.** The table is generated. CI fails a PR whose README or `data/ports.json` doesn't match the data files.

## Steps

1. Copy an existing file in `ports/` or the template below.
2. Fill in every required field. The schema is [`schema/port.schema.json`](schema/port.schema.json).
3. Run `npm ci && npm run build && npm test`, then commit the regenerated `README.md` and `data/ports.json`.
4. Open a PR using the template.

## Template

```yaml
name: ExamplePortVR # the port's own name
games: # original flatscreen game(s)
  - 'Example Game'
category: mod # mod | source-port | profile
authors:
  - name: Creator Name
    url: https://github.com/creator # optional
platform: pcvr # pcvr | standalone | both
headsets: # optional, standalone only
  - Meta Quest
controls: 6dof # optional: 6dof | 3dof | gamepad | mixed
status: beta # alpha | beta | stable | abandoned
version: '1.2.0' # quote it
version_date: '2026-01-31' # date of that release, quoted
download_url: https://github.com/creator/example/releases/latest
source_url: https://github.com/creator/example # repo or announcement post
homepage: https://example.com # optional
license: MIT # SPDX id, proprietary, unknown, or see-repository
price: '$5 on Patreon' # optional, omit when free
required_files: 'an owned PC install of Example Game'
known_bugs: # [] if none known
  - 'Cutscenes render flat'
notes: 'Free-form, optional.'
images: # one per game; node scripts/enrich.mjs fills this
  - game: 'Example Game'
    file: images/exampleportvr/example-game.jpg
    credit: Example Game store art
    source_url: https://store.steampowered.com/app/123/
reviews: # optional, YouTube reviews/showcases
  - title: 'Example Game VR is incredible'
    channel: Some VR Channel
    url: https://www.youtube.com/watch?v=xxxxxxxxxxx
added_by: human # human | bot
discovered_via: 'https://discord.com/channels/... or a source name'
last_checked: '2026-02-01' # when someone last confirmed the version
```

## Rules

- **Link to the creator's release page only.** No rehosted binaries, no game files, no piracy links.
- **Credit the source.** `discovered_via` records where the port was found.
- **Images** go in `images/<slug>/`, ≤ 300 KB each, with a `credit` and `source_url`.
- **Quote** versions and dates. A bare `1.0` parses as a number and fails validation.
- **Mark a port `abandoned`** rather than deleting it once it is no longer maintained.

## Discovery bot

A daily bot (`scripts/discover/`) looks for new ports and new releases in Elliott Tate's Flat2VR release reports, GitHub, SideQuest and Reddit. It opens or updates one rolling PR from the `bot/discovery` branch. Its entries are marked `added_by: bot`, and `discovered_via` credits where each one was found. It only links URLs that appear in the source material, and every entry must pass the schema before it is proposed.

Run it locally without writing anything: `node scripts/discover/run.mjs --dry-run --sources gists --max-extract 3`. This needs `gh` and `claude` on the PATH.
