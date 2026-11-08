# P13 tests, revised plan

Ticket 281, Tier 1 P13, `next/` only. This is a new tests step above the older tests commit.
It follows the plan approved again on 2026-11-08. Generated cases use seed 119120.
No product file, saved P8 fixture byte or lockfile was changed.

## Laws and their plants

The names below link to each law's first line. Every behavior check uses generated inputs.
P8's fixed saved format is the labeled exception. The plant named in each test is the break that
the law must catch. Missing product code prevents measuring those mutations yet; this record
does not claim that a mutation of absent code was killed.

| Law | File:line and plant |
|---|---|
| p52 | [runner.laws.test.ts:194](../../../next/programs/notes/src/runner.laws.test.ts#L194): replace a row, drop optional save/writer fields, share versions across notes, refuse valid saves. |
| p52 progress | [program.laws.test.ts:52](../../../next/programs/notes/src/program.laws.test.ts#L52): ignore/refuse a current-base save or emit a Cmd. Every generated sequence includes empty text. |
| p52 sender | [runner.laws.test.ts:245](../../../next/programs/notes/src/runner.laws.test.ts#L245): trust forged writer fields or pass clocks into the pure update. |
| p53 accepted | [runner.laws.test.ts:304](../../../next/programs/notes/src/runner.laws.test.ts#L304): check base before ID, deduplicate by body, lose placing on reopen. |
| p53 refused | [runner-replies.test.ts:178](../../../next/packages/libfabrika/src/app/runner-replies.test.ts#L178): recheck a future base after it becomes current, lose a reply on reopen/replacement. |
| p53 identity | [notes-stage.test.ts:442](../../../next/apps/fabrika/src/notes-stage.test.ts#L442): borrow a reply after changing caller, target or payload. [runner-replies.test.ts:216](../../../next/packages/libfabrika/src/app/runner-replies.test.ts#L216): answer before reply storage succeeds. |
| p53 durable storage | [process-replies.test.ts:116](../../../next/packages/libfabrika/src/coordination/process-replies.test.ts#L116): overwrite, store only in memory, key only by letter or old process. [Failure:153](../../../next/packages/libfabrika/src/coordination/process-replies.test.ts#L153): acknowledge a failed write or lose an older reply. |
| p53 reply decoding | [process-replies.test.ts:186](../../../next/packages/libfabrika/src/coordination/process-replies.test.ts#L186): throw, ignore or erase corrupt stored JSON/Reply fields. [runner-replies.test.ts:251](../../../next/packages/libfabrika/src/app/runner-replies.test.ts#L251): accept malformed Sent or its wrong terminal case. |
| p54 | [program.laws.test.ts:68](../../../next/programs/notes/src/program.laws.test.ts#L68), [malformed:85](../../../next/programs/notes/src/program.laws.test.ts#L85), [runner:341](../../../next/programs/notes/src/runner.laws.test.ts#L341): use `<`, give stale `now`, admit malformed bases, append/publish a refused save. |
| p54 race | [runner.laws.test.ts:379](../../../next/programs/notes/src/runner.laws.test.ts#L379): remove the permit or use a project-wide note version. |
| p54 size | [program.laws.test.ts:102](../../../next/programs/notes/src/program.laws.test.ts#L102): count JS characters, reject MOST equality, check base first. [runner:429](../../../next/programs/notes/src/runner.laws.test.ts#L429): ignore complete encoded-row bytes. |
| p55 | [history.test.ts:90](../../../next/programs/notes/src/history.test.ts#L90): retain only latest versions, sort by sender clock, trim bodies, lose metadata or a page. |
| p55 replay | [program.laws.test.ts:133](../../../next/programs/notes/src/program.laws.test.ts#L133): call today's refusal during replay. [history:113](../../../next/programs/notes/src/history.test.ts#L113), [metadata:146](../../../next/programs/notes/src/history.test.ts#L146), [runner:537](../../../next/programs/notes/src/runner.laws.test.ts#L537): throw, skip malformed saved data, erase letters or reset state. |
| p55 saved format | [history.test.ts:193](../../../next/programs/notes/src/history.test.ts#L193): rename saved fields or apply a stricter current limit to P8's unchanged eight-row fixture. |
| p55 checkpoint | [runner.laws.test.ts:489](../../../next/programs/notes/src/runner.laws.test.ts#L489): keep only a checkpoint or omit a note in the full fold at generated cuts. |
| Notes duplicate IDs | [program.laws.test.ts:162](../../../next/programs/notes/src/program.laws.test.ts#L162): drop uniqueness checking on otherwise valid generated notes. |
| Notes saved body | [program.laws.test.ts:185](../../../next/programs/notes/src/program.laws.test.ts#L185), [history:180](../../../next/programs/notes/src/history.test.ts#L180): put today's limit in saved Notes, Save, Msg or history decoding. |
| S2, p88 | [program.laws.test.ts:213](../../../next/programs/notes/src/program.laws.test.ts#L213): drop ID, body or version at a JSON save/load cut. Uses real `syncTest`. |
| read | [program.laws.test.ts:257](../../../next/programs/notes/src/program.laws.test.ts#L257): return another note/version, mutate on read. Uses tea's pbt from real init. |
| list | [program.laws.test.ts:257](../../../next/programs/notes/src/program.laws.test.ts#L257): duplicate rows, reorder on read or trim saved text while deriving a name. |
| p56 stage and text | [notes-stage.test.ts:338](../../../next/apps/fabrika/src/notes-stage.test.ts#L338): keep saves only in memory, normalize text, change a retry ID or lose a retained pending send. Generated restart cuts, real wire, workerd replacement, checkpoint wake and full fold. |
| audit encoding | [program.laws.test.ts:232](../../../next/programs/notes/src/program.laws.test.ts#L232): retain a body, drop save metadata or throw on malformed outside input. The pure `audit` contract returns Result. |
| stored audit and delivery | [notes-stage.test.ts:471](../../../next/apps/fabrika/src/notes-stage.test.ts#L471): lose `now`/`most` over delivery or keep accepted/refused bodies in actual door input records. |
| recording | [notes-spans.test.ts:159](../../../next/apps/fabrika/src/notes-spans.test.ts#L159), [replay:227](../../../next/apps/fabrika/src/notes-spans.test.ts#L227), [failure:267](../../../next/apps/fabrika/src/notes-spans.test.ts#L267): omit outcomes, flush early, leak bodies in actual spans/health/replies, mislabel a checkpoint as a fold or acknowledge recording failure. |
| p24, p32, p65 | Existing browser/layer/package checks plus the enabled notes import restriction. [Import plant:57](../../../oxlint-plugins/required-browser-entry.test.ts#L57): Node, coordination, today's code and Markdown. |
| required browser entry | [required-browser-entry.test.ts:37](../../../oxlint-plugins/required-browser-entry.test.ts#L37), [valid cases:48](../../../oxlint-plugins/required-browser-entry.test.ts#L48): remove export, use only a window export, remove target, name a directory or escape the package. |

## Runs and limits

Final narrow run: **48 checks collected, 12 passed, 36 failed**. No suite failed to collect.
All tests named above ran, including their named plant cases. No full suite ran.
Every command kept `TYPESAFE_API_KEY` unset and used one vitest worker.

The 36 reds are expected missing work: 23 notes program/history/audit laws, six reply laws,
three P37 notes-recording laws, three real-stage laws and the existing notes browser bundle.
The real-stage laws stop at missing P12 `dev.ts`, before opening a listener or child.
There is no green claim about workerd, sockets, process inspection or wake measurements here.
On this sandbox, socket allocation and `ps` may also be blocked once P12 exists.

The lint plants passed: six broken entries detected, four valid entries accepted, and all four
forbidden imports detected. False alarms were zero in those valid cases. The actual tree's one
new-rule finding is correct: notes declares an entry whose builder-owned file does not exist.

`pnpm format` applied formatting. Its lint-fix phase then stopped on that missing entry.
The one `pnpm lint` run stopped on the same single expected finding, with no test-side diagnostic.
Later lint steps did not run after that failure. No rule or ledger was weakened.

The requested `pnpm typecheck` hit pnpm's unsafe task-state symlink before compiling. After fixing
the ignored local dependency setup, its recursive compiler phase ran serially and stopped at
missing reply methods. A narrow continuation included the new tests, including notes before its
builder-owned tsconfig exists. It found one test-side error, an unavailable fast-check type alias;
that is now an explicit input type. Other reported errors name missing program/history/audit
modules or missing `reply`/`rememberReply`. There was no second workspace typecheck.

An existing dependency-reader false alarm from merged P8 was fixed in `deps.test.ts`: the regex
read quoted bundle-plant code as an actual import of `${pkg}`. The installed Oxc parser now reads
imports, and a generated plant checks quoted versus executable import text. All nine other
dependency checks pass. The remaining browser red is the missing notes entry.

## Plan conflicts the lead must resolve

The shared Id change here provides `Id.make("input")`. It has **not** changed `ParentText` or
`Incoming.envelope.id`; both still require the old input-parent format. The revised tests use
UUIDv7 input IDs for both delivery IDs, as the approved plan says. Current runner laws therefore
also stop at `RunnerError bad_input` until that prerequisite's schema migration is supplied.
An earlier targeted run using the old parent format reached the intended missing behavior:
a terminal future-base refusal turned into acceptance after the note advanced.

P8's saved fixture has `p8-01` through `p8-08` IDs and old input parents. P8's own fixture law pins
those exact bytes. The new plan's projected Version requires an input TypeID while also requiring
this unchanged fixture to remain readable. Those requirements conflict without an explicit
compatibility decision. The fixture was read, never rewritten or regenerated.

## What the lead's real-stage run still owes

The stage test starts only P12's real `dev.ts`, with its own short temporary `FABRIKA_HOME`.
It must show a real workerd PID dies, its replacement reconnects on the same wrapper/address/home,
every prior inbox entry and historical body remains byte for byte, a lost accepted answer keeps
its original placing, and a driver-retained pending letter lands once. It must reject changed
caller, target and payload bindings. This proves no screen behavior.

The test-only [storage hooks](../../../next/apps/fabrika/src/notes-stage.test.ts#L284) and
[checkpoint hook](../../../next/apps/fabrika/src/notes-stage.test.ts#L296) operate only after stopping
the wrapper. They find the notes checkpoint by process ID, measure it and the SQLite files, and
optionally delete only its derived checkpoint. Restart uses the same home. The inbox must remain
unchanged and the view must match both with a checkpoint and after a full fold.

T17 still needs the builder's real-stage driver at **1,000 and 10,000 accepted saves of 5 KB**.
Record actual encoded bytes, individual samples, package versions, build hashes and stage settings.
Keep checkpoint load, full fold after checkpoint removal, and workerd restart/reconnect separate.
Record inbox count, checkpoint/object bytes, workerd RSS, replay count/cursor/duration and sink
flush duration. State whether each path really folded history. Save results in an experiment and
`field/`. No guessed performance threshold or extra notes cache belongs in this row.

These red laws cannot prove an implementation that does not exist yet, actual wake costs, visible
draft recovery, Cloudflare cold starts or future compatibility decisions.
