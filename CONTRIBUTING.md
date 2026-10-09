# Contributing

One port = one file: `ports/<slug>.yml`. The slug is kebab-case and is usually the port's own name (`lambda1vr`, `two-forks-vr`).

**Edit data, never the README table.** The table is generated. CI fails a PR whose README or `data/ports.json` doesn't match the data files.

## Steps

1. Copy an existing file in `ports/` or the template below.
2. Fill in every required field. The schema is [`schema/port.schema.json`](schema/port.schema.json).
3. Run `npm ci && npm run build && npm test`, then commit the regenerated `README.md` and `data/ports.json`.
4. Open a PR using the template.

## Template

```yaml
name: ExamplePortVR                 # the port's own name
games:                              # original flatscreen game(s)
  - "Example Game"
category: mod                       # mod | source-port | injector
authors:
  - name: Creator Name
    url: https://github.com/creator # optional
platform: pcvr                      # pcvr | standalone | both
headsets:                           # optional, standalone only
  - Meta Quest
controls: 6dof                      # optional: 6dof | 3dof | gamepad | mixed
status: beta                        # alpha | beta | stable | abandoned
version: "1.2.0"                    # quote it
version_date: "2026-01-31"          # date of that release, quoted
download_url: https://github.com/creator/example/releases/latest
source_url: https://github.com/creator/example   # repo or announcement post
homepage: https://example.com       # optional
license: MIT                        # SPDX id, proprietary, unknown, or see-repository
price: "$5 on Patreon"              # optional, omit when free
required_files: "an owned PC install of Example Game"
known_bugs:                         # [] if none known
  - "Cutscenes render flat"
notes: "Free-form, optional."
screenshots:                        # optional
  - file: images/exampleportvr/menu.webp
    credit: Creator Name
    source_url: https://github.com/creator/example
added_by: human                     # human | bot
discovered_via: "https://discord.com/channels/... or a source name"
last_checked: "2026-02-01"          # when someone last confirmed the version
```

## Rules

- **Link to the creator's release page only.** No rehosted binaries, no game files, no piracy links.
- **Credit the source.** `discovered_via` records where the port was found.
- **Screenshots** go in `images/<slug>/`, ≤ 300 KB each, and need a `credit` and `source_url`.
- **Quote** versions and dates. A bare `1.0` parses as a number and fails validation.
- **Mark a port `abandoned`** rather than deleting it once it is no longer maintained.
