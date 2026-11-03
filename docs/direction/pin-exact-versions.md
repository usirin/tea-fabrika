# Exact npm versions only

Decided 2026-10-31 by the owner. This covers the whole repo, today's version and `next/`: every
`package.json` and `pnpm-workspace.yaml` git tracks, `experiments/`, `fixtures/` and `video/` too.
Every version we name is exact, and `pnpm lint` fails on anything else.

```yaml
# pnpm-workspace.yaml
savePrefix: ''      # `pnpm add` writes 7.0.2, not ^7.0.2
catalog:
  typescript: 7.0.2 # one line, the only place a shared version lives
```

```json
{"peerDependencies": {"effect": "catalog:"}, "devDependencies": {"effect": "catalog:"}}
```

```sh
$ pnpm lint:versions   # with a planted ^
packages/one/package.json: dependencies: thing: "^1.2.3"
exact-versions: 1 not exact. Write the version itself, or `catalog:` with the exact version in the catalog. See docs/direction/pin-exact-versions.md.
$ echo $?
1
```

## What was decided

- **Exact, in every field.** `dependencies`, `devDependencies`, `peerDependencies`,
  `optionalDependencies`, `overrides`, the catalog. No `^`, `~`, `>`, `<`, `*`, `x`, `latest`, tag or
  `||`.
- **The check lists what passes, not what fails.** A version like `1.2.3` or `2.0.0-beta.84`,
  `catalog:`, and `workspace:*`. Everything else fails: a range, a tag, `git:`, `file:`, `link:`, a
  URL, an `npm:` alias. None of those is in the tree today, so there are no exceptions to carry.
- **`workspace:*` passes, and `workspace:^` does not.** `workspace:*` is the sibling in this repo,
  never a release from the registry. In a pack, pnpm writes that sibling's exact version.
- **Peers use `catalog:` too.** A pack holds the version, not the word: pnpm swaps it on `pnpm pack`
  and `pnpm publish`.
- **`savePrefix: ''` makes `pnpm add` write exact.** The default is `^`. Tried with a real `pnpm add`
  on pnpm 10.27.0: `3.0.1` with the setting, `^3.0.1` without it. A version typed loosely still goes
  in as a range (`pnpm add thing@1` wrote `^1.0.0`), and then the check fails it.
- **The check is `oxlint-plugins/exact-versions.ts`**, run by `pnpm lint`. It reads
  `pnpm-workspace.yaml` with the `yaml` package, which was already in the lockfile through vite.
  `exact-versions.test.ts` plants each bad value and reads the real exit code.

## Why

- A range lets a new release change what we run the moment anyone regenerates the lockfile. Nobody
  chose that change, and it arrives mixed into some other diff.
- A bump should be one line someone chose, which a diff shows and a review can read.
- A written rule does not hold. The check does.

## What it costs

- A bump is by hand, and nothing brings security fixes by itself. We read and pick each one.
- A pack's peers are exact. Someone installing a pack must have that exact `effect`, or npm refuses
  with a peer conflict. Experiment 108 installed a tarball with a plain `npm install effect`, which
  takes the latest, so that step would now need the version named. Nothing is published yet, so
  nobody meets this today. If packs go out to strangers, peers are the first part to weigh again.
- A workspace bump moves every package together, since they share the catalog. That is what we want.

## How sure

95% that this is what the repo should do, since the owner decided it and it costs little. 90% on
the check: it is small and each bad value is planted. The doubt is what a future pnpm adds. A new
place to name a version stays unread until someone adds it to the check.

## What it cannot tell us

- **It pins only what we name.** What our dependencies depend on are ranges in their own manifests.
  Only the lockfile holds those, so CI's `--frozen-lockfile` is still needed, and regenerating the
  lockfile can still change them. Neither this rule nor this check protects that part.
- It does not check that an exact version is a good one, or that it exists.
- It reads only tracked files named exactly `package.json` or `pnpm-workspace.yaml`. A copy under
  another name, as in `experiments/results/`, is a record and is not read. So is a version written
  in a shell line or in a doc.
- An old release can be taken down from the registry. An exact version does not change that.
