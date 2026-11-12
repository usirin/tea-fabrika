---
id: 0132
title: A path pack may sit anywhere on the machine, in the repo's fabrika.toml and in the person's, and fabrika never refuses a path for leaving the repo
status: accepted
date: 2026-11-11
tags: [packs, fabrika-toml, paths, hot-reload, next]
---

# 0132: A path pack may sit anywhere on the machine, in the repo's fabrika.toml and in the person's, and fabrika never refuses a path for leaving the repo

```toml
# A sketch. .fabrika/fabrika.toml in a project, edited by the person working in it.
[pack.my-tools]
from = "../../my-programs/my-tools"   # outside the repo: allowed, read from this machine's disk

[pack.team-tools]
from = "./packs/team-tools"           # inside the repo: travels with the commit
```

**What this decides:** a `from` that starts with a dot may lead to any folder the machine can read,
and what a person commits to a shared file is that person's call.

## Context

The plan for outside programs (P40, tracker ticket 715 for slice 1) asked the owner one question
before slice 2: should a path that resolves outside the selected repo be refused in Tier 1,
symlinks included? [0084](0084-own-pack-listed-by-path.md) says a dot means a path from the folder
of the `fabrika.toml` that names it, and left this open. The owner answered on 2026-11-11.

The known way: Neovim loads plugins from any folder on its `runtimepath`, and Cargo's `path`
dependencies may point outside the package
([specifying path dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#specifying-path-dependencies)).
Neither refuses a path for where it leads.

## Decision

**Fabrika loads a path pack from wherever its `from` leads, and never refuses it for being outside
the repo.**

- **Both files.** The rule holds for the repo's `.fabrika/fabrika.toml` and for the person's
  `~/.fabrika/fabrika.toml`. A person may add their own local programs to a project's file,
  wherever those programs sit.
- **Committing is the person's call.** A shared file that names a folder only one machine has is
  the author's to notice and fix. Fabrika may help a person see it, with a notice. It does not
  block.
- **A machine without the folder says so.** There the pack does not load, and the message names
  the pack, the path and the file and line that listed it. Nothing else stops.
- **A path pack hot reloads in dev,** like a built-in program
  ([hot reload](../docs/direction/hot-reload.md)): a save brings the new code into the running app.
- The rest of 0084 holds: a dot means a path, the base is the folder of the file that names it, and
  a path pack has no `ref` and no lock line.

## Consequences

- P40's slice 2 drops the "reject paths outside the repo" case and its symlink check, and gains two:
  a path outside the repo loads, and a missing folder reports itself.
- The cost: code read from outside the repo is in no commit of that repo. What ran is still known,
  since every entry a process writes names the build that wrote it (hot reload's `build` hash).
- Not decided here: how the notice looks, and what a lane or a cloud instance does with a pack
  whose folder it cannot see beyond reporting it.
