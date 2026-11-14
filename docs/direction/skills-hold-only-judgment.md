# Skills keep judgment; code checks the steps

**Decided 2026-11-08.** Today's hand-run tooling, used for work in either version.
K20's lint rule applies only to `next/` tests.

Its decided rules are in: [0408](../../.decisions/0408-skills-keep-only-judgment.md),
[0409](../../.decisions/0409-one-leak-check-for-push-and-plan.md),
[0410](../../.decisions/0410-the-machine-caps-live-in-code.md),
[0411](../../.decisions/0411-property-data-comes-from-schemas.md).

```text
skill: read the plan -> judge the work -> report what happened
code: check leaks -> cap workers -> share one typecheck lock -> choose a safe test home
```

## The rule

Remove a skill's mechanical instruction when code holds it. Keep reading, judgment and writing.
Do not remove an instruction whose check has not landed. Ticket 325 is slice 1b: K6, K9, K20
and the remaining repeated instructions. Slice 1a owns K19, K1 to K4 and K11.

- K6 uses one `leakgrep.sh` for added push text and plan text. Private words stay outside the repo.
  The script reports the kind and line number without printing the matched text.
- K9's test config caps workers and refuses broad local runs. Test setup chooses a home whose
  host socket fits under 103 bytes. `typecheck.sh` uses one fixed OS lock across shells, keeps it
  through patching and compiling, and releases it when its last holder exits, including a crash.
- K20 uses existing Schemas or their own Effect Arbitraries for new properties, with tea's
  machine-law tools kept. Keep fast-check for unsupported data and edge cases. The syntax-based
  lint rule blocks in every folder at zero, and advises only where a folder's warn line says so
  ([0523](../../.decisions/0523-advice-rules-block-where-clean.md)). A moved law keeps its old size, run count and real-limit coverage.

The approved plan's Amendment 1 sets these calls. The K20 wording is also in
[five steps for every check](./five-steps-for-every-check.md#effect-test-data-k20-2026-11-08).

## K6's replay

The driver replayed the last 20 merged hand-run PRs on 2026-11-08, from 545 down to 508.
After tests round 5, built-in shapes refused **0 of 20**. Shapes plus the private word list
also refused **0 of 20**. No private words were printed. Both runs had 20 known inputs,
0 true hits, 0 false hits and 0 unknowns. With zero findings there is no false-hit rate.

The PRs were 545, 543, 542, 541, 539, 537, 535, 534, 533, 529, 528, 527, 526, 525, 522,
519, 516, 512, 510 and 508. Before round 5, PRs 539 and 534 had four false hits: short key-like
prefixes and SSH key type names. Round 5 fixed both classes.

K9's Node-pin refusal is measured by construction, per the lead's 2026-11-08 answer: it compares
the local runtime with the exact installed pin and lets CI run. Its message names both versions
and the command that uses the pin. This is not a 20-PR replay of the other K9 checks.

## K20's census

The current rule scanned all 56 `next/` test files at PR 532's head, `1af180f6`, and all 71 at
this slice's caught-up head. Neither scan had a parse error. The old snapshot had zero hits,
so it has no false-hit rate. The current snapshot had six hits, all read against their schemas:

| File under `next/packages/libfabrika/src/` | Line | Schema | Reading |
|---|---:|---|---|
| `coordination/passkey.test.ts` | 89 | `Signed` | Useful: struct data decoded and encoded as that schema. |
| `coordination/passkey.test.ts` | 118 | `Adds` | Useful: person-case data decoded and encoded as that union. |
| `coordination/passkey.test.ts` | 144 | `Signed` | Useful: plain signed data decoded as that schema. |
| `transport/answer.test.ts` | 46 | `Attached` | Useful: data passed through the new-case maker. |
| `transport/answer.test.ts` | 47 | `Attached` | Useful: data passed through the waiting-case maker. |
| `transport/sshsig-webauthn.test.ts` | 199 | `PasskeyLine` | Useful reason request: keep the custom generator for encoded P-256 points. The schema has only a filter, with no matching Arbitrary. |

That is six useful messages, zero false hits and zero unknown messages, a 0% false-hit rate on
six hits. The last message asks for a nearby reason to keep fast-check; it is not evidence that
Effect can generate that encoding. The other schemas use structs, unions and supported checks.
Keep the properties' existing cases and reach when changing their data.

A separate text scan found 173 fast-check constructor calls in the old snapshot and 760 in the
current one, including nested calls. It followed default and namespace imports. A search for
schema annotations, makers and explicit checks found no additional direct match beyond these
six. Indirect matches through helpers, transformed values and unsupported data remain uncertain;
the constructor count is not a count of missed matching generators. This does not establish
complete recall, and the rule stays advice only.

## What this cannot tell us

The replay checks these 20 historical diffs. It cannot prove that every future safe phrase passes
or every secret is caught. A missing private list leaves only the built-in shapes. K20's syntax
check cannot discover every matching schema or prove that its Arbitrary reaches a real limit.
