# What makes a legitimate port entry

This repository indexes **flatscreen games you can play in VR, and the port that makes that
possible** — a VR mod, a source port rebuilt for VR, or a per-game profile for a universal
injector. One port is one file, `ports/<slug>.yml`.

A pull request should be **approved and merged** when all of these hold:

- It adds or updates exactly one port entry (plus that port's images), nothing else.
- The entry is a **real** VR port of a **real** flatscreen game — not a joke, not spam, not an
  advertisement, not an unrelated project that merely mentions VR.
- The facts are internally consistent: the `name`, `games`, `platform`, `category`, `status`,
  `version` and `version_date` make sense together.
- Every required field is present and sensible (the schema check already enforces presence;
  you are judging plausibility and honesty).
- **`download_url` and `source_url` point to the creator's own page** — a GitHub/GitLab/Codeberg
  release or repo, SideQuest, itch.io, a Patreon/announcement post. They must NOT point to a
  rehosted mod binary, a pirated copy of the original game, a random file host, or an unrelated
  link. This project never hosts game files and only links the creator.
- `required_files` makes clear the user must own the original game.

**Request changes** (politely, with concrete fixes) when any of the above fails: a dead or
wrong link, a mismatched version, a missing/implausible field, a rehosted-binary or piracy
link, an off-topic or promotional entry, or anything the static check flagged.

Contributors are often first-time GitHub users. Keep feedback short, kind, and specific about
exactly what to change.
