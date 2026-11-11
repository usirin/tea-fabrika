---
id: 0091
title: In next/, a folder of libfabrika's src/ that holds one subject is a module and its rank in the rule file is a layer, never a room or a floor, which stay only as the analogy
status: accepted
date: 2026-11-10
tags: [names, module, layer, room, floor, ddd, glossary, libfabrika, next]
---

# 0091: In next/, a folder of libfabrika's src/ that holds one subject is a module and its rank in the rule file is a layer, never a room or a floor, which stay only as the analogy

**What this decides:** the two names [0043](0043-rooms-on-floors.md) gave `next/`'s library
layout change: what it called a room is a module, and what it called a floor is a layer. Its rules
do not change.

## Context

[0043](0043-rooms-on-floors.md) named a folder of `next/packages/libfabrika/src` a room and its
rank in `layer-rules.json` a floor. [0055](0055-errors-named-by-their-service.md) and
[0062](0062-test-files-keep-the-floors.md) built on those words. The owner renamed both on
2026-11-10, for these reasons:

- **"Room" had two meanings in `next/`.** It was the library's folder (0043) and a place to talk:
  the frame's `room` row, and a lane's room in [0073](0073-a-lane-has-a-room.md). The glossary's
  context map had to warn "write 'a room of the library' when talk is near". In `next/`, a word
  means one thing. "Floor" has a second meaning too: [0082](0082-approvals-is-a-floor-for-every-run.md)
  makes `human-approvals` "a floor for every run", a minimum, a row in the same Shared names
  section.
- **Module is the industry's word.** Domain-Driven Design has Modules as a pattern of its own: a
  grouping of one cohesive subject inside a bounded context. Evans: "Choose MODULES that tell the
  story of the system and contain a cohesive set of concepts", and give them names that are part of
  the ubiquitous language (Domain-Driven Design, 2003, chapter 5). We follow DDD fully
  ([we follow DDD](../docs/direction/we-follow-ddd.md)), and that note already says a library
  folder is "not a context and not a layer". Effect says module too: AGENTS.md reads a suite
  "through its module" ([0029](0029-format-and-names-follow-effect.md)).
- **A floor was always a layer told as a picture.** 0043's own title says "a layer is a floor".

**How a layer relates to the five layers.** It is not one of them. Read on `origin/main` at
`826f900c3`: `layer-rules.json` has 31 rows, and 12 carry a `floor`, with ten values:

| Rank | Rows |
|---|---|
| 9 | `next-node` |
| 8 | `next-workers` (`cloudflare/`) |
| 7 | `next-libfabrika-entry` (`index.ts`) |
| 6 | `next-door` (`gateway/`) |
| 5 | `next-runtime` |
| 4 | `next-access` |
| 3 | `next-processes`, `next-presence` |
| 2 | `next-ledger`, `next-transport` |
| 1 | `next-telemetry` |
| 0 | `next-shared` (`Id.ts`, `ProcessId.ts`, `Sql.ts`, `Rev.ts`) |

libfabrika's modules sit on ranks 0 to 6. The ranks are finer than the
[five layers](../docs/direction/a-local-first-sync-engine.md) and cut across them: rank 2 holds the
data layer's `ledger/` and the transport layer's `transport/`, coordination's old files sit on
ranks 3, 4 and 5, and ranks 0, 7, 8 and 9 are no design layer at all. 0043 already noted "six
floors where the notes say five layers"; there are ten ranks now. So "layer" for a rank gives the
word a second meaning beside the five layers. This record writes the decision as made and lists the
clash under Not decided here.

## Decision

**In `next/`, a folder of libfabrika's `src/` that holds one subject is a module, and what 0043
called a floor is a layer; "rooms on floors" is only the analogy that explains the rule.**

- A **module** is one folder of `next/packages/libfabrika/src` with one subject: `gateway/`,
  `runtime/`, `access/`, `processes/`, `presence/`, `ledger/`, `telemetry/`, `transport/`.
- A **layer** is a module's rank in `layer-rules.json`. A module imports only from lower layers,
  never from its own.
- A module is not a bounded context and not a domain. The glossary's sections are the contexts, and
  a module's words have their rows in the context that owns them.
- **"Room" now means only a place to talk.** "Floor" is no name of the library.
- "Rooms on floors" stays only as the analogy that explains the rule. It is never a name in code,
  in the rule file, in the glossary's term column or in a lint message.
- Names only. Every rule of 0043, 0055 and 0062 holds, read with the new words.

**Binding constraints:**

- New code, comments, prose and lint messages in `next/` say module and layer from today.
- Older records keep their text. Their status lines point here.

## Consequences

- **The glossary changes in this pull request.** `room (library)` becomes `module`, `floor`
  becomes `layer (library)`, and the rows that said "the room `x/`" say "the module `x/`". The key
  carries `(library)` because Frame already has a `layer` row, and the file refuses one key in two
  sections. The talk `room` row is not touched.
- **0043, 0055 and 0062 are amended in part,** names only: each title names room or floor as a
  library word. [0051](0051-gateway-connection-and-node-by-job.md) says room in its prose and
  keeps its status. AGENTS.md's two bullets say module and layer.
- **The rename in code, the rule file and lint messages is a follow-up tracker ticket,** not filed
  by this record. Lines that say room or floor in the library meaning, counted on `826f900c3`:
  - `next/`: 72 lines in 11 files, 55 of them in `next/apps/fabrika/src/exam/layers.test.ts`.
  - `.agents/`: 5 lines in 2 files, `movecheck.ts` and `movecheck.test.ts`.
  - Outside those two, the same ticket covers `oxlint-plugins/` (116 lines, with the rule
    `fabrika/rooms` in `rooms.ts`), `.oxlintrc.json` (10) and `layer-rules.json` (18, with its
    `floor` key on 12 rows). These three were not sorted by hand: only `Math.floor` was dropped.
  - How: `nice -n 19 rg -i -w '(rooms?|floors?)'`, then dropped by hand `Math.floor`, everyday
    "room" for space ("has room", "leave room", "room to spare"), the gateway's waiting room, a
    minimum ("the 20 GB floor", numbers that "are a floor") and a design token's contrast floors.
    No line under `next/` or `.agents/` uses the talk meaning: 0073's lane room is not built.
- Two direction notes keep their dated paragraphs that say room and floor:
  [the five layers](../docs/direction/a-local-first-sync-engine.md) and
  [we follow DDD](../docs/direction/we-follow-ddd.md). They change with the follow-up.
- Not decided here, for the lead to bring to the owner:
  - **"Layer" gets a second meaning in one context.** Shared names is the shared kernel, where
    "each means one thing everywhere". `.glossary/TERMS.md` already has `five layers` (Clients),
    one of the five design layers, and `layer` (Frame), one of six window levels. A library layer
    is neither. Writing "a library layer" in full is the stopgap the context map gives.
  - **Effect's `Layer`.** In `next/` a service is offered as a `Layer` (AGENTS.md, after
    [0061](0061-resources-are-acquired-in-a-scope.md)). "The ledger's layer" can now mean its rank
    or its Effect `Layer`. No glossary row names Effect's `Layer`.
  - **The rule file's own word.** In `layer-rules.json`, each entry under `layers` is a named group
    of paths, such as `next-ledger`, close to one module. Its rank is the `floor` key. So the file
    calls a module's row a layer, and this record calls the rank a layer. What the key becomes is
    the follow-up's, and it may need a ruling.
  - **"Module" already means one file.** [0032](0032-libraries-take-effects-file-layout.md) says
    "a flat `src/` of PascalCase modules", one file each, as in Effect's own `src/`
    (`Deferred.ts`). 0062 puts a suite "beside its module", the file `Sink.ts`. AGENTS.md reads
    `SinkTest.suite` "through its module", the file `SinkTest.ts`. An ES module is a file too. So
    a module is now a folder and a file. Evans's Module is a grouping, which fits the folder.

## Records

- [`.glossary/TERMS.md`](../.glossary/TERMS.md): `room (library)` renamed to `module`, `floor`
  renamed to `layer (library)`, with their Not columns kept. Changed: `telemetry`, `presence`,
  `access`, `gateway`, `MailboxError`, `ProcessManagerError` and the `five layers` Not column. The
  context map's `room` line, a new `layer` line, and one open clash.
- [0043](0043-rooms-on-floors.md), [0055](0055-errors-named-by-their-service.md),
  [0062](0062-test-files-keep-the-floors.md): status line and a one-line pointer each.
- [AGENTS.md](../AGENTS.md): the library-layout bullet and its test-files clause.
