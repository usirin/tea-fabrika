# P13 test record

This is the test writer's record for `next/` notes, tracker ticket 281. It covers no code from today's version. Seeded cases use 119120 and one vitest worker.

## Laws

| Law | Test and plant |
|---|---|
| p52, progress | [program.laws.test.ts:45](../../../next/programs/notes/src/program.laws.test.ts#L45), independent per-note versions, exact bodies, empty text and empty Cmds. Plants: ignore a save, refuse every save, count versions across notes. |
| p52, stored input and sender | [runner.laws.test.ts:191](../../../next/programs/notes/src/runner.laws.test.ts#L191) and [sender:242](../../../next/programs/notes/src/runner.laws.test.ts#L242), actual SQLite inbox entries, all metadata, unchanged earlier entries, person and agent writers. Plants: replace a row, drop optional fields, trust supplied writer fields, give update a writer clock. |
| p53, accepted | [runner.laws.test.ts:289](../../../next/programs/notes/src/runner.laws.test.ts#L289), original placing after later saves and reopened files; different ids with identical text. Plants: check base first, deduplicate by body. |
| p53, refused | [runner-replies.test.ts:153](../../../next/packages/libfabrika/src/app/runner-replies.test.ts#L153), future base remains refused after advancing, reopening and replacing the process. Plants: recheck the base, keep a reply in memory or under its old process id. |
| p53, reply storage | [process-replies.test.ts:78](../../../next/packages/libfabrika/src/coordination/process-replies.test.ts#L78), insert-only replies, name and letter isolation, reopen, failed writes and retained older replies. Plants: overwrite a reply, key only by letter, evict on failure. |
| p53, identity and answer order | [notes-stage.test.ts:324](../../../next/apps/fabrika/src/notes-stage.test.ts#L324) rejects changed text and another admitted client. [runner-replies.test.ts:182](../../../next/packages/libfabrika/src/app/runner-replies.test.ts#L182) requires storage failure instead of a terminal answer. Plants: match only the letter id, answer before saving. |
| p54, stale and race | [runner.laws.test.ts:314](../../../next/programs/notes/src/runner.laws.test.ts#L314) and [race:352](../../../next/programs/notes/src/runner.laws.test.ts#L352), true `now`, unchanged inbox/model/watchers, one winner on one base, independent notes. Plants: `<`, append anyway, stale `now`, remove permit, project-wide version. |
| p54, size | [program.laws.test.ts:120](../../../next/programs/notes/src/program.laws.test.ts#L120) checks exact UTF-8 bytes, equality and size-before-base. [runner.laws.test.ts:381](../../../next/programs/notes/src/runner.laws.test.ts#L381) checks the complete escaped row plus metadata. Plants: string length, reject equality, ignore escaping. |
| p55, history | [history.test.ts:63](../../../next/programs/notes/src/history.test.ts#L63), every version, all metadata, both clocks, caller pages and additive fields. Plants: latest-only history, sender-time order, trimming, lost page. |
| p55, replay | [program.laws.test.ts:137](../../../next/programs/notes/src/program.laws.test.ts#L137) checks repeated folds under a stricter refusal. [history.test.ts:171](../../../next/programs/notes/src/history.test.ts#L171) reads P8's permanent fixture, and [malformed saves:127](../../../next/programs/notes/src/history.test.ts#L127) requires checked failures. Plants: call refuse, silently skip a save, throw on untrusted data. |
| p55, checkpoint | [runner.laws.test.ts:414](../../../next/programs/notes/src/runner.laws.test.ts#L414) and [saved failure:456](../../../next/programs/notes/src/runner.laws.test.ts#L456), reopen with checkpoint, remove only checkpoint, rebuild twice, retain all letters on saved failure. Plants: checkpoint as sole copy, omit a note, reset after a broken save. |
| S2, p88 | [program.laws.test.ts:167](../../../next/programs/notes/src/program.laws.test.ts#L167), real `syncTest` at every JSON cut, duplicate-id rejection and saved text above today's refusal limit. Plants: lose id, body or version during encoding. |
| p56, text and stage | [notes-stage.test.ts:268](../../../next/apps/fabrika/src/notes-stage.test.ts#L268), real `dev.ts`, kill workerd, reconnect, exact history and retained pending letter. Plants: memory-only text, newline normalization, new retry id. This proves no screen. |
| recording | [notes-spans.test.ts:125](../../../next/apps/fabrika/src/notes-spans.test.ts#L125) and [replay:171](../../../next/apps/fabrika/src/notes-spans.test.ts#L171), actual P37 sink and records, ended/flushed outcomes, checkpoint versus full replay, no body in span tags, health or replies. [notes-stage.test.ts:340](../../../next/apps/fabrika/src/notes-stage.test.ts#L340) checks body-free door input metadata and wire refusal fields. Plants: log Msg, omit refusal tags, flush early. |
| p24, p32, p65 | Existing browser, package and layer checks. [deps.test.ts:311](../../../next/apps/fabrika/src/exam/deps.test.ts#L311) now also requires the notes entry to exist. No new source-shape test or exception. |
| read and list | [program.laws.test.ts:205](../../../next/programs/notes/src/program.laws.test.ts#L205), present/missing notes, independent versions, stable order, derived names and no mutation or write from reads. |

## Expected red results

Final narrow run: 41 checks collected, 33 failed for the expected reasons below and 8 existing package/exam checks passed. Every law ran; no suite failed to collect.

The base has no notes `program.ts`, `history.ts` or public entry. Those laws collect and fail on their planned missing modules. The notes package manifest and boundary row are in this test commit; its `tsconfig.json` is still the builder's file.

The reply-store methods are absent. Its three laws fail on that absence. The existing runner demonstrates both intended p53 failures: a previously refused future base becomes accepted, and a failed reply write still returns a terminal refusal. Those are missing P13 behavior, not test errors.

P8's `fixtures/next/notes-letters.jsonl` is absent. Its compatibility test fails opening that exact documented path. This is an unmet plan prerequisite. No replacement fixture was made.

P12's `next/apps/fabrika/dev.ts` is absent. Every real-wire law fails there before it allocates a listener or starts a child. The tests use P12's planned CLI and wire methods, also checked against its test writer's contracts. No raw Miniflare substitute is used.

Own test errors found during authoring were fixed: one missing brace, Effect 4's typed `tap` callback, a pbt generic inference, and history helper context types. A focused compiler check then reported only absent notes modules and reply methods. This does not typecheck code that has not been built.

Formatting passed. The requested `pnpm lint` call found one empty type literal in a test. That was fixed. The complete linter then had zero blocking findings, and every remaining lint part passed separately: exact versions, layers, boundaries, browser bundle, unreachable exports, Compiler, token checks and format checks. No lint rule or ledger was weakened.

The root type check stopped on the planned missing reply methods. A focused compiler check covered all new test files, including notes before its builder-owned typecheck config exists. Its remaining errors were only missing `program.ts`, `history.ts`, `reply` and `rememberReply`. The stage checks were rerun after tightening child-group and temporary-home cleanup; all three still failed only on missing P12 `dev.ts`.

## Proof still due from the lead

Run the real stage laws after combining P12 and P13. They must show a real workerd PID dies, its replacement listens at the same address and home, every saved body's bytes survive, and a retained stable letter lands once. Changed text and another admitted client must fail the original binding. Domain refusals must preserve `now` and `most` over the wire, and door input records must retain save metadata without draft text.

T17's builder-owned measurement driver must save 1,000 and 10,000 accepted 5 KB bodies on that real local stage. Use reproducible note ids and bodies. Record actual body and encoded row bytes, individual samples, versions, build hashes and stage settings. Keep checkpoint wakes, full folds with only the checkpoint removed, and restart/reconnect after killing workerd as separate samples. Record inbox count, checkpoint bytes, object bytes, workerd RSS, replay duration and sink flush duration. The experiment and `field/` records must say whether each sample actually folded history. There is no performance threshold in these tests.

Every stage child gets a short fresh temporary `FABRIKA_HOME`; paid model calls remain disabled. P20 still owes visible draft behavior, and P26 still owes real Cloudflare cold-start and hibernation measurements.

## Integration details

P6's current complete-row limit is 2,000,000 bytes. A 256 KiB body of NUL characters encodes below that limit, so the over-budget test includes additional escaped note metadata. Calling that body alone oversized would be a test mistake.

Stable test letters use UUIDv7 TypeIDs. The current P11 stamped input parent still uses its installed `in-process_...` decoder. The history schema must reuse libfabrika's final ledger and id schemas when the lead combines the input-id change; the tests do not redefine production schemas.

The stage timing and measurement results remain unknown. These red tests prove what is missing on the base; they do not prove the later implementation or the real local stage works.
