# Ticket 540 generator audit

`next/` only. Compared every property in the eight ticket files with `4ddc0ed7`,
then with `af14c20d`, before choosing the bounds below. No product change belongs
to this work. Fixed inputs remain beside their generated inputs.

## How the bounds were checked

The installed versions are Effect and `@effect/vitest` 4.1.1 and fast-check 4.10.2.
These facts come from their installed source, not from observed samples:

- fast-check's default `small` generates collection lengths up to
  `min(maxLength, 2 * minLength + 10)`. With no explicit maximum, this is 10
  for an empty string and 12 for a nonempty string. A pattern applies this
  separately to each repetition, before adding its fixed prefix.
- Effect's default size is 10. It limits the complete string or pattern,
  each collection, and shared recursive work. An integer with no lower or
  upper bound uses size squared for that missing bound. Explicit numeric
  bounds override size. Finite noninteger numbers keep their full range.
- `fc.jsonValue()` has no hard depth bound. No finite Effect size retains
  that space. `unboundedJson` therefore uses the original fast-check input,
  fed by an Effect-generated full signed 32-bit seed. Bounded JSON uses
  finite Schema levels instead of a shared recursive budget.
- Fixed-length IDs and spans keep their minimum lengths even at size 10.
  Increasing size alone does not repair a missing object key or union branch.

The old generator column gives its declared bounds. An effective generation
bound that differs is stated too. The new column gives reachable generation
bounds, with the explicit property size. These are range comparisons, not a
claim that one finite sample visits every value.

## Input definitions

- `I32`: integers -2147483648..2147483647. `N32`: 0..2147483647.
  No depth, keys, or collection size applies to a scalar number.
- `S(a,b)`: strings with UTF-16 length a..b, no keys or nesting. Old default
  strings use ASCII graphemes; Effect strings include that alphabet.
- `J(d)`: null, booleans, all finite doubles, strings/keys 0..10, arrays and
  objects of width 0..10. No required object keys. Maximum container depth d.
  `J(*)` is the original fast-check JSON with no hard depth limit.
- `CP`: required keys `{saved:{v,build,model,after},turn,cmds}`. Old v is I32,
  build S(0,10), model/turn J(*), after N32, cmds 0..5 J(*) values. New keeps
  these bounds. JSON round trips canonicalize -0 as before this audit.
- `PID`: `process_` plus one character 0..7 and 25 TypeID characters, length
  34. `PERSON`: `person_` plus the same 26 characters, length 33. Neither
  has variable depth or keys. `TRACE` and `SPAN` are nonzero-leading hex
  strings of exactly 32 and 16 characters.
- `NAME`: `[a-z][a-z0-9._:-]{0,30}`, with the same reserved-name filters.
  Old effective length 1..11, declared 1..31. New 1..31.
- `SESSION`: all keys required: PROCESS, OTHER_PROCESS, START, PERSON,
  TRACE, SPAN, key, agentKey, id, kinds. PROCESS differs from OTHER_PROCESS.
  key has `SHA256:person-` plus S(1,40), agentKey `SHA256:agent-` plus S(1,40).
  Old effective total lengths 15..26 and 14..25; declared maxima 54 and 53.
  id is `write-` plus 1..20 lowercase letters/digits, old effective 7..18,
  declared 7..26. kinds has exactly two distinct S(1,30), excluding answered,
  old effective length 1..12. New reaches all declared lengths at size 54.
- `POLICY`: required why, crashes, until. Old why S(1,40), effective 1..12;
  crashes 1..32; until N32. New why 1..40, crashes 1..1601 at size 40,
  until -2147483648..2147483647. No recursive values.
- `SPAN-NAME`: `notes:` plus `[a-z][a-z0-9._-]{0,30}`. Old effective 7..17,
  declared 7..37. New 7..37. `SPAN-ID`: `[a-z][a-z0-9_-]{0,30}`, old
  effective 1..11, declared 1..31, new 1..31. `SPAN-KEY`: `key-` plus
  SPAN-ID, old effective 5..15, declared 5..35, new 5..35.
- `ACTIVITY`: tagged idle with required process PID, or tagged stepping with
  required process PID, letter and build. Old text S(1,40), effective 1..12.
  New PW6 text 1..40. The tag is required in either case.
- `ENVELOPES`: outer list 1..8. Each body is J(1), an object with any subset
  of m/n/_tag/ref/to holding J(2), or exactly `{m:{_tag:"DOWN",ref:J(1)}}`.
  Old subset width 0..4; current and new width 0..5. No key is required in the
  subset branch. Every subset from the old generator remains possible.

## Every property

IDs follow the order at `4ddc0ed7`. A `+` names a property added afterward.
Shared definitions above include each value's range, length, depth and keys.
“E10” below means the previous head's default Effect size 10, before this fix.

| Law and subject | Old at 4ddc0ed7 | Previous head | New |
| --- | --- | --- | --- |
| ST1 malformed checkpoint | CP | E10 CP, v ±100, after 0..100, shared JSON budget | CP; size 12 |
| ST2 lazy storage | S(1,unbounded), effective 1..12 | S(1,10) | S(1,12); size 12 |
| ST3 reopen checkpoint | CP | E10 CP | CP; size 12 |
| ST4 transaction rollback | CP | E10 CP | CP; size 12 |
| ST5 runtime decoding | input S(1,unbounded), effective 1..12; pos N32; ran 0..8 strings 0..10 | input 1..10; pos 0..100; ran 0..10 strings 0..10 | input 1..12; pos N32; ran 0..8 strings 0..10; size 12 |
| ST6 record retries | input/build S(1,unbounded), effective 1..12; pos N32 | input/build 1..10; pos 0..100 | input/build 1..12; pos N32; size 12 |
| ST+7 selected stores | absent | CP; Placed requires id/rev/pos, id from JSON-quoting a string 0..10, rev/pos 0..100; ACTIVITY E10 | CP; id from JSON-quoting a string 0..12, rev/pos N32; ACTIVITY size 12, text 1..12 |
| TC1 first id | accepted S(1,256), effective 1..12; refused S(257,1024), effective 257..524 | accepted 1..10; refused 257 only | accepted 1..256; refused 257..1024; size 1024 |
| TC2 first name | same TC1 | same TC1 | same TC1 |
| TC3 code program | same TC1 | same TC1 | same TC1 |
| TC4 code hash | same TC1 | same TC1 | same TC1 |
| TC5 again why | same TC1 | same TC1 | same TC1 |
| TC6 client id | same TC1 | same TC1 | same TC1 |
| TC7 DOWN ref | same TC1 | same TC1 | same TC1 |
| TC8 DOWN why | same TC1 | same TC1 | same TC1 |
| TC9 monitored ref | same TC1 | same TC1 | same TC1 |
| TC10 demonitored ref | same TC1 | same TC1 | same TC1 |
| TC11 exited why | same TC1 | same TC1 | same TC1 |
| TC12 down why | same TC1 | same TC1 | same TC1 |
| TC13 registered name | same TC1 | same TC1 | same TC1 |
| TC14 started name | same TC1 | same TC1 | same TC1 |
| TC15 dead error count | count 1..32, constructs errors count and count+32, plus 33 | same numeric bounds | same; size 1024 |
| TC16 dead error text | same TC1 | same TC1 | same TC1 |
| TC17 dead m/build | same TC1 | same TC1 | same TC1 |
| TC18 refuse monitor ref | S(257,1024), effective 257..524 | 257 only | 257..1024; size 1024 |
| TC19 accept monitor ref | S(1,256), effective 1..12 | 1..10 | 1..256; size 1024 |
| TC20 refuse client id | same TC18 | same TC18 | same TC18 |
| TC21 refuse exit why | same TC18 | same TC18 | same TC18 |
| TC22 refuse down why | same TC18 | same TC18 | same TC18 |
| TC23 refuse start id | same TC18 | same TC18 | same TC18 |
| TC24 refuse start name | same TC18 | same TC18 | same TC18 |
| TC25 refuse start program | same TC18 | same TC18 | same TC18 |
| TC26 refuse start hash | same TC18 | same TC18 | same TC18 |
| TC27 refuse restart why | same TC18 | same TC18 | same TC18 |
| TC28 accepted delivery | ref/why S(1,256), effective 1..12 each | 1..10 each | 1..256 each; size 1024 |
| TC29 any Unicode ref | graphemes 1..40; composite graphemes 252..260; or 5 units repeated to length 200..2100000 | same via full I32 seed; repeats have explicit numeric bounds | unchanged; size 10, all numeric bounds explicit; graphemes stay fast-check because Effect has no grapheme generator |
| SS1 lifecycle streams | NAME excluding door/processes/watcher:1/client: | E10 complete pattern 1..10 | NAME; size 60 |
| SS2 prewritten ids | any nonempty subset of 18 fixed stream/id pairs | 18 required booleans select any nonempty subset | unchanged; size 10, length 18 is explicit |
| SS3 reserved inboxes | processes, or processes/ plus S(0,50), effective suffix 0..10 | complete pattern length 9..10 | complete length 9 or 10..60, all suffixes 0..50; size 60 |
| SS4 signal ids | DOWN plus 0..5 J(2) values | 0..5 Schema.Json values with shared E10 budget | 0..5 J(2) values; size 60 |
| SS5 trusted signal | ref S(1,40), effective 1..12 | 1..10 | 1..40; size 60 |
| SS6 renewed watch | ref S(1,40), effective 1..12 | 1..10 | 1..40; size 60 |
| SS7 total receive | ENVELOPES | ENVELOPES, size 110 | unchanged; size 110 |
| SS8 caller keys | two S(1,40), effective 1..12 each | 1..10 each | 1..40 each; size 60 |
| SS9 trust check | NAME excluding door/processes/client: | complete pattern 1..10 | NAME; size 60 |
| SS10 reserved name | door or processes | same literals | unchanged; size 60 |
| SS+11 bare reserved stream | absent | two Schema.String, lengths 0..10 | unchanged; size 10 |
| SS+12 refused start/id | absent | filtered NAME E10 | NAME; size 60 |
| SS+13 bound name | absent | filtered NAME E10 | NAME; size 60 |
| SM1 complete receipt | SESSION | fixed IDs intact; key 15, agentKey 14, write id 7..10, kinds 1..10 | SESSION; size 54 |
| SM2 interleaved identity | SESSION | same E10 SESSION | SESSION; size 54 |
| SM3 not_delivered | SESSION | same E10 SESSION | SESSION; size 54 |
| SM4 spent | SESSION | same E10 SESSION | SESSION; size 54 |
| SM5 person_only | SESSION | same E10 SESSION | SESSION; size 54 |
| SM6 ended | SESSION | same E10 SESSION | SESSION; size 54 |
| SM7 wrong process | SESSION | same E10 SESSION | SESSION; size 54 |
| SM8 agent approval | SESSION | same E10 SESSION | SESSION; size 54 |
| SM9 allowed kinds | SESSION | same E10 SESSION | SESSION; size 54 |
| SM10 retry/wake | SESSION | same E10 SESSION | SESSION; size 54 |
| SM11 atomic receipt | SESSION | same E10 SESSION | SESSION; size 54 |
| SM12 exit/wake | SESSION | same E10 SESSION | SESSION; size 54 |
| SM13 revocation | SESSION | same E10 SESSION | SESSION; size 54 |
| SM14 missing parent | SESSION | same E10 SESSION | SESSION; size 54 |
| SM15 signal ids | DOWN plus 0..4 J(2); spaced prefix plus 0..3 J(1), whitespace empty/space/LF/tab; or DOWN prefix plus S(0,20), effective 0..10; filtered inSignalSpace | all three kinds; rest 0..4 J(2); tail 0..20; size 440 | unchanged; size 440; new is a superset of old spacing/depth/width/tail |
| SM+16 fresh database | absent | E10 SESSION | SESSION; size 54 |
| SM+17 replay body | absent | E10 SESSION | SESSION; size 54 |
| SM+18 ordinary approval | absent | E10 SESSION | SESSION; size 54 |
| PW1 lower boundary | now 0..1000000; period 0..10000; offset -1..1 | same explicit numeric bounds | unchanged; size 40 |
| PW2 intensity | now 0..1000000; period 1..10000; offsets 0..30 integers 0..1000, effective list 0..10 | same numbers; list 0..10 | list 0..30, same numbers; size 40 |
| PW3 order | list 0..40 integers 0..10000, effective list 0..10 | list 0..10, same numbers | list 0..40, same numbers; size 40 |
| PW4 absent marker | undefined or idle ACTIVITY with PID | same union and required process key | unchanged; size 40 |
| PW5 idle identity | PID | same fixed pattern length | unchanged; size 40 |
| PW6 interrupted | PID; letter/build S(1,40), effective 1..12 | letter/build 1..10 | PID; letter/build 1..40; size 40 |
| PW7 corrupt activity | J(*) excluding valid ACTIVITY | recursive Schema.Json, shared E10 budget | original J(*) excluding ACTIVITY; size 40 |
| PW8 down shapes | PID and POLICY | why 1..10; crashes 1..101; until -100..100 | PID and POLICY; size 40 |
| PW9 record policy | POLICY | same E10 POLICY | POLICY; size 40 |
| PW10 dead errors | list 2..31 S(1,40), effective count 2..14, text 1..12; constructs matching tries/limit | count 2..10, text 1..10 | count 2..31, text 1..40; required tag/tries/limit/m/build/errors; size 40 |
| PW+11 down refusals | absent | E10 POLICY | POLICY; size 40 |
| SP1 mailbox send | SPAN-NAME, SPAN-ID | complete lengths 7..10 and 1..10 | SPAN-NAME, SPAN-ID; size 40 |
| SP2 mailbox receive | SPAN-NAME | complete length 7..10 | SPAN-NAME; size 40 |
| SP3 process start | SPAN-NAME; program/hash SPAN-ID | complete lengths 7..10 and 1..10 | original patterns, full declared lengths; size 40 |
| SP4 member writes | SPAN-KEY | complete length 5..10 | SPAN-KEY; size 40 |
| SP5 sheet race | SPAN-KEY | complete length 5..10 | SPAN-KEY; size 40 |
| SP6 long tags | integer length 129..1000, process cap 129..256 | same explicit numeric bounds | unchanged; size 40 |
| SP7 live key count | SPAN-KEY | complete length 5..10 | SPAN-KEY; size 40 |
| SP8 read no append | count 2..20 | same explicit numeric bounds | unchanged; size 40 |
| SP9 ignored rev | SPAN-KEY | complete length 5..10 | SPAN-KEY; size 40 |
| SP10 message id | SPAN-ID | length 1..10 | SPAN-ID; size 40 |
| SP11 failed send | SPAN-NAME, SPAN-ID | lengths 7..10 and 1..10 | SPAN-NAME, SPAN-ID; size 40 |
| SP+12 failed members read | absent | storage or bad_row | unchanged; size 10 |
| SP+13 rank refusal | absent | SPAN-KEY E10, effective length 5..10 | unchanged; size 10 |
| SP+14 repeated founding | absent | two founded facts, required tag/id/name/keys/window; strings 0..10; keys list 0..10; window null or string; no recursive values | unchanged; size 10 |
| PS1 one process span | ref S(1,40), effective 1..12 | ref 1..10 | ref 1..40; size 40 |
| PS2 separate lives | two distinct PID | same fixed lengths and inequality | unchanged; size 40 |
| PS3 delivery lag | now 0..1000000; lag 0..50000; two dates 1900-01-01..2100-01-01 inclusive, valid only | same explicit numeric/date bounds | unchanged; size 40 |
| PS4 content leak | two S(0,40) suffixes, effective 0..10, fixed marker prefixes of length 20 | same suffixes 0..10 | suffixes 0..40, same prefixes; size 40 |
| text grantText | fixed format, no generator | unchanged | unchanged |
| text revokeText | fixed format, no generator | unchanged | unchanged |
| text addText | fixed format, no generator | unchanged | unchanged |
| text enrollmentText | fixed format, no generator | unchanged | unchanged |

## Planted failures

Each break ran alone, with seed 119120 and one Vitest worker, against the real
product code. The full test file ran each time. Each file passed before its
plant. All five product files were restored and compared byte for byte with
their saved copies after the runs.

- Cursor clamp at 100: ST1, ST3, ST4 and ST+7 failed. ST1 shrank to cursor 101.
- First start IDs accepted at lengths 258..1024, with 257 still refused:
  TC1 and TC23 failed. TC1 shrank to an accepted length 1 and refused length 258.
- Mailbox permits signal IDs over 1024 characters: SS4 failed on length 1041.
- Mailbox permits a reserved destination longer than 11 characters containing
  whitespace: SS3 failed and shrank to `processes/  `.
- SavedInput returns the wrong signer for a key longer than 20 characters:
  SM2 and SM9 failed. SM2's reduced input had an agent key of length 27.
- Dead skips matching errors to tries above 10 tries: PW10 failed at 11 tries.
- Mailbox writes the wrong destination tag above length 10: SP1 failed at
  `notes:a----`, length 11.
- Monitor emits an extra process.monitor span above ref length 10: PS1 failed
  at ref length 11.

## Limits

The comparison preserves reachable input ranges and required keys. It does not
prove identical distributions, shrinking, or exhaustive coverage. The two
fast-check fallbacks use an Effect-generated seed; they retain the old input
generator, while Effect shrinks that seed. Planted failures above check the
specific review gaps against real product code.

## Final checks

All eight files passed separately with one worker: 96 properties and four
format checks. The scoped libfabrika typecheck passed once. No Vitest command
remained running.

`pnpm format` and the one `pnpm lint` invocation found one new non-null
assertion in the shared helper. Replaced it with Schema's JSON decoder.
The helper's lint check then passed, as did the repository format check and
every remaining lint check: versions, layers, boundaries, browser, dead code,
compiler, design tokens and CSS. The two files using the changed JSON helper
passed again. The full lint command and typecheck were not repeated.
