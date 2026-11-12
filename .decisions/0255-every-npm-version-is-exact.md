---
id: 0255
title: Every npm version the repo names is exact, catalog: or workspace:*, never a range, tag or alias, and pnpm lint fails on anything else
status: accepted
date: 2026-10-31
tags: [dependencies, versions, pnpm, catalog, lint, both-versions]
---

# 0255: Every npm version the repo names is exact, catalog: or workspace:*, never a range, tag or alias, and pnpm lint fails on anything else

**What this decides:** how a version is written in every tracked `package.json` and
`pnpm-workspace.yaml`, today's version and `next/` alike, `experiments/`, `fixtures/` and `video/`
included.

## Context

Decided by the owner in [exact npm versions only](../docs/direction/pin-exact-versions.md). The
check is `oxlint-plugins/exact-versions.ts`, run by `pnpm lint`.
[0040](0040-existing-tools-before-hand-written.md) and
[0045](0045-test-steps-run-in-containers.md) say "exact version" in passing only.

```yaml
# pnpm-workspace.yaml
savePrefix: ''      # `pnpm add` writes 7.0.2, not ^7.0.2
catalog:
  typescript: 7.0.2 # the only place a shared version lives
```

## Decision

**A version we name is exact, in every field, and the check fails anything else.**

- Every dependency field and the catalog: `dependencies`, `devDependencies`, `peerDependencies`,
  `optionalDependencies`, `overrides`.
- The check lists what passes: an exact version such as `1.2.3` or `2.0.0-beta.84`, `catalog:`, and
  `workspace:*`. Everything else fails: a range, a tag, `workspace:^`, `git:`, `file:`, `link:`, a
  URL, an `npm:` alias.
- Peers use `catalog:` too. A shared version lives only in the catalog.
- `savePrefix: ''` makes `pnpm add` write an exact version, never pnpm's default `^`.

## Consequences

- A bump is one line someone chose, read in review. Nothing brings security fixes by itself.
- A pack's peers are exact, so an installer needs that exact `effect`. Nothing is published yet.
- It pins only what we name: what our dependencies depend on stays in the lockfile, so CI's
  `--frozen-lockfile` is still needed.
