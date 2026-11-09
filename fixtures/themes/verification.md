# T343 tests handoff

Today's app only. This work is the first test packet for PR 1, not approval of
all PR 1 laws. Product code and generated outputs have not changed.

## Written checks

- T1/T2: generated complete themes, missing/extra/malformed fields, palette size,
  exclusive sources and repair destinations, including the cursor.
- T3/T4: settings defaults, floors and diagnostics, corrected top-level TOML,
  and rejection of the former key/table conflict through the product decoder.
- T5/T6: independent WCAG and signed APCA equations, composited layers, both
  polarities, independent floors and unrounded comparisons.
- T7: current built-in text pairs under both floors, including row backgrounds.
  The exhaustive 300-pick assertion belongs to the following picker work.
- T8: scale choices decode at build time. Faintest-candidate selection remains.
- T9/T10/T11/T12: deterministic repair, unchanged inputs/backgrounds/palette,
  lightness-only moves, independent neutral-color search, impossible pairs,
  generated cap boundaries, per-token fallback and unchanged `off` values.
- T13: exact source/license and mapped-input hashes, required measured cap/version,
  and equality of the checker output with reviewed reports, including the invented case.
- T14: generated real file operation orders and independent keybindings.
- T18: the actual Ghostty renderer must pass drawn colors to its callback after
  inverse, selection and faint processing. This defines the still-missing callback.
- T19/T24: generated replay/reset/attach/focus/switch/dispose orders. A DSR request
  is answered by the fake terminal, so replaying a response is observable.
- T22: CSS text roles through aliases, raw TS/TSX view colors, and Radix import plants.
- T23: closed global names and refusal of component color keys at compile time.
- T25: generated decoder refusals and settings failures, checking diagnostics and
  logs for invented values and their encoded forms. Other outputs still need coverage.

## Previous run

The design run had 95 existing checks passing, 13 new checks failing, and two
suites unable to collect because `theme.ts` and `theme-settings.ts` do not exist.
The new checker tests cannot execute their predicates until `measure`, `passes`
and `check` exist. Those are missing implementation, not observed math failures.

Actual behavior failures: current built-in text pairs fail APCA, the token decoder
rejects scale choices, the renderer does not call the correction callback, and
settings failure logs violate T25. T13 refuses to accept an unmeasured cap.
The two byte/hash format checks pass.

All 16 terminal tests pass. Three isolated copies of the real terminal code were
changed, one bug each: ignore RIS, listen before replay, and keep a disposed
listener. Each made the generated T19/T24 law fail with seed 119120. No live
product file was changed for these runs.

All 46 CSS lint tests pass. The raw-color/Radix plant passes its expected refusal
checks. The scan of current views found zero new raw-color hits; the three
shipped stylesheets produced zero text-role hits and zero CSS blocking results.
The T14 OS watcher run hit sandbox `EMFILE`; it is neither a product red nor green.

`pnpm format` ran first. `pnpm lint` ran once and found test-side issues, which
were corrected. Targeted oxlint and CSS checks then passed. The dead-export check
passed without changing its ledger. One `pnpm typecheck` ran. It reported missing
product modules/exports and test-side errors; the latter were corrected without
repeating the full typecheck. No full suite or Electron run was started.

## Restored run under the fixed plan

Restored the saved patch without redoing its laws. Moved the saved experiment to 239
and updated its references. All 41 changed files are exact `tests` entries in
the corrected plan. Product code, generated outputs and the lockfile are unchanged.

The final narrow checks have 229 passing checks and 19 failed checks across ten
files, plus two suites that cannot collect. The failures divide as follows:

- Four product behavior reds: T7 built-in APCA, T8 scale decoding, T18 renderer
  callback, and T25 settings logs. All use seed 119120.
- Ten checker checks cannot reach their predicates because `measure`, `passes`
  and `check` do not exist. T1/T2/T3/T4 and the decoder portion of T25 cannot
  collect because `theme.ts` and `theme-settings.ts` do not exist. These are
  missing product APIs, not observed failures of the color math or decoder rules.
- T13 still refuses the missing measured cap and report. No number was guessed.
- The one isolated T14 retry timed out after 60 seconds. No EMFILE appeared in
  this run. Three older watch checks also waited unsuccessfully for file changes.
  These four watch results remain unresolved, not proved product failures.
  The previous run's EMFILE remains recorded above. No limit was raised.

The 65 lint-plant checks and 46 CSS lint checks pass. Added the new raw-color
rule to the existing rule-coverage list; its actual planted source was already
present in the saved patch. All 16 terminal checks pass, including T19/T24.
The two T13 byte/hash checks pass.

`pnpm format` ran first. `pnpm lint` ran once: oxlint and formatting passed, then
the package-import check refused four design test imports of
`fixtures/themes/laws.ts`. A named fixture package needs its own
`fixtures/themes/package.json`, which is absent from the plan's files table.
No import check was bypassed and no allowance was added. Lint stopped there;
its later checks were not reached. The passing CSS tests are a separate run.

One `pnpm typecheck` ran at the end. It stopped in the design package on missing
product exports `measure`, `passes`, `check` and missing modules `theme.ts`,
`theme-settings.ts`, `theme-contract.ts`. A secondary `false`/`true` error came
from the missing Theme type becoming open. Replaced that redundant assertion
with a required-global-values assertion and kept the component-name refusal.
No second typecheck ran. Other package checks were canceled when this one failed.

Experiment 239 ran once without `--map`; the missing generated
`theme-contract.ts` stopped calibration before a report was written. The plan
also omits the future `fixtures/themes/calibration.json` from its exact files
table. Both that reviewed report and a named helper package need tests ownership
before the next tests run can complete them. No model calls or network were used.

## Still required from tests

The shared checker must exist before experiment 239 can measure the cap. Run it,
review the real-theme results and screenshots, pin `repair.toml` and the full
calibration report, and verify the future API tests against real implementations.
The output signatures used by these tests follow the plan's sketches; they have
not been proved against an implementation.

PR 1 also still needs the Ghostty patch, host theme-load/check no-write laws,
theme-file watch flows, startup/cache/forced-colors/frame/subscription laws,
T21 real-window scenarios and the remaining T25 outputs, including spans and URLs.
The final global token rename is still a shipping gate, as the plan says. This
packet uses the note's fifteen file names and does not authorize another format.

PR 2/3 picker/save/import laws have not started. The lead owns experiment/field
index updates. Calibration used no model calls or network and incurred $0 in
provider fees. The box's requested `../bin/stepcommit.sh` wrapper is absent;
the repo's step-commit script supplies its documented `--commit-only` route.

The previous run's commit was refused with `not_owner`: the saved plan used
placeholder experiment names and a fixture glob. The lead expanded the table to
the individual fixture files and experiment 239. This run restores that saved
work and checks it under the corrected plan without changing product code.

## Protected checker follow-up

Today's app, ticket 343. This is a new tests commit on the signed `faeb2415`
head. Earlier laws, fixture bytes and their hashes are kept.

The tests-owned checker now exports `measure`, `passes` and `check`. It compares
WCAG and signed APCA on composited bytes, resolves aliases, groups all backgrounds
for each token, and searches both lightness directions without clipping channels.
The search visits output-byte boundaries rather than a guessed lightness grid.
It keeps hue, chroma and alpha, applies per-token fallback from the correct look,
and reports final failures. `off` keeps the input and reports proposed changes.

The token decoder accepts the closed set of 31 Radix scales through
`colors.scale`. It refuses unknown scales and mixtures of scales with fixed steps.
The builder still must resolve scale choices rather than indexing per-look values.

Two repair-test inputs formerly put alpha colors at the bottom of a background
stack. They now name the solid terminal backdrop too; all generated alpha colors
remain covered. The original hue check incorrectly assumed that re-encoding a
rounded Oklab lightness differs by at most one RGB byte. For the generated
`#3bb5bb` focus color, a valid lightness-only move emits `#069aa0`, while that
round trip emits `#089aa0`. The replacement check bounds the Oklab coordinates of
the full output-byte rounding cell, independently of the production search.
It still rejects changed chroma, hue or alpha. A new property compares aliases
and alpha stacks with their independently flattened equivalents.

The six-file narrow run had 239 passing checks, two failing checks and one older
skip. Two suites could not collect because `theme.ts` and `theme-settings.ts` are
still absent. The two failures are T7's current built-in APCA values and T13's
explicitly unmeasured report. The last checker/decoder run had all 67 checks
passing. Seed 119120 was used throughout. No full suite ran.

Thirteen isolated source changes were all caught: skipping alpha, swapping APCA
polarity, rounding readings, accepting either floor, changing chroma, dropping
alpha, changing a background, stopping the search early, ignoring the cap,
hiding a failed replacement, ignoring `off`, ignoring aliases and opening scales.
The temporary source replacements never changed the working product files.

The fixture helper is now a named workspace package, and tests import it by name.
The standalone calibration script resolves that package from itself. The builder
must add `@kampus/themes-fixture` as a design-package test dependency, pin
`apca-w3` to 0.1.9, supply its narrow declaration and update the lockfile. Validation
used the maker's 0.1.9 source in a temporary local package. No dependency manifest
owned by build was edited here.

`calibration.json` and `tokens/repair.toml` both say `unmeasured`. Experiment 239
was run and stopped at the missing generated `theme-contract.ts`. It cannot
measure the cap until the final names, aliases, background pairs and floors exist.
No cap, repair version or fallback counts were invented. Screenshots and visual
cap review remain undone. After generating the contract, build must return T13
to tests for measurement and review.

`pnpm format` ran first. The full lint command stopped on new non-null assertions,
which were removed. Targeted lint and formatting then passed. The remaining lint
checks passed separately: exact versions, layers, package boundaries, browser
imports, dead exports, compiler, generated tokens and CSS. The dependency links
were restored from an installation matching this branch's lockfile after an
automatic install failed on network access. A temporary newer code-graph was
replaced with the pinned 0.12.0 before accepting its results. No ledger changed.

One compiler run of `pnpm typecheck` completed. It failed on missing product
modules and the APCA declaration, plus the builder's unhandled scale choice.
Test-side indexing and decoder-result inference errors were corrected afterward;
the full typecheck was not repeated. An earlier command attempt stopped in an
automatic install before reaching the compiler. No Electron or provider run
started. Provider fees remain $0.

## Build5 return, today's app, ticket 343

The decoder inputs and their type law now use all 21 global names from the generated
contract. The repair properties use those names too. This exposes six real fallback
failures: `themes.ts` still gives the shared checker the earlier 15 names. The builder
must update `themes.ts` and `theme-colors.ts` together with the generated full values.
No compatibility names were added to the file decoder or its inputs.

The expected dark steps now show each change: turn text indigo 11 to 12, done grass
11 to a11, stuck red 11 to 12, and hovered turn fill indigo 10 to 9. The last change
uses the nearest passing solid step and gives up a separate dark hover shade.
The old 4.28 exemption is removed from the pending token inputs and its law now
rejects the original pair. App text, white button labels, focus, default terminal
text and cursor are checked under both floors. ANSI palette bytes stay pinned;
T18 corrects drawn terminal text without altering those bytes. Token plants start
from freshly generated copies; a separate law still checks the real committed
outputs for drift. The five changed token inputs generate successfully in a
temporary copy. Generated files in this checkout remain the builder's work.

The final 12-file narrow run used seed 119120, one worker and the complete Ghostty
patch applied offline to a pristine 0.4.0 copy. It had **384 green, 15 red, four
native-watch checks excluded as blocked, and one older case-sensitive-filesystem
skip**. These counts include the five pending token-input edits below. The red
laws are six built-in color/pair checks, six repair properties blocked by old
built-in names, one generated-output drift check, host T25 and unmeasured T13.
The first 14 are build work; T13 also needs the missing mapping decision below.
The same T18 law fails on the currently installed bundle, whose patch hash has
not been refreshed. It passes with the new patch. Four isolated plants were
caught: omit the callback, pass the default background, correct before faint,
and correct emoji. The new patch applies with pnpm offline, including declarations
whose original file has CRLF endings. The lead must refresh the lockfile hash;
this step did not change `pnpm-lock.yaml` or the installed Ghostty bundle.

Ghostty 0.4.0 has no hook for correcting the colors of a drawn cell.
The patch adds optional `correctForeground(foreground, background)` on Terminal
and CanvasRenderer options, plus the renderer field and its declarations.
It passes composited 8-bit colors after inverse, selection and faint handling.
Emoji, palette entries, backgrounds, cell data and terminal bytes stay intact.

Host T25 is a product failure in `apps/fabrika/src/host/settings.ts`: both folder
creation failure and watch failure log the full folder, and watch failure also
logs the cause with source content. The existing generated law stays unchanged.
For T14, the native scenarios are still required. Earlier retries emitted sandbox
`EMFILE`; this run's isolated native T14 timed out at 60 seconds without that error.
Neither result proves a product bug. The added generated property supplies files,
read refusals and watch events to the real reader. It passes writes, replacement
notifications, decode refusal, deletion, permission refusal and key independence.
A planted mix-up of the key and theme file paths fails it immediately. The three
older native-save laws and the native T14 law need a run outside the box; they
have not been weakened, removed or counted green.

Experiment 239 was run. The pair list now exists, but the mapped inputs still use
15 old names. Renaming alone leaves six globals with no mapping rule in the
approved plan: surface-selected, border, border-strong, wire, scrim and
turn-fill-hover. `calibration.json` and `repair.toml` record the current failure
and remain unmeasured. No cap, repair version or repair count was invented.
No screenshot, visual cap review, VoiceOver or Electron run was performed.
Provider fees remain $0.

`pnpm format` ran first. Full lint passed its code and formatting checks, then
stopped at the three build-owned unused decoders. Targeted lint passed after the
last test edits. The remaining generated token drift is also build work. One
final typecheck is recorded below. Dependency auto-install tried to refresh the
changed patch and failed on network access. Dependency links were restored from
an installation with the identical lockfile, then auto-install was disabled for
local validation. No lockfile, dependency manifest or dead-export allowance changed.

The commit owner checker reads exact paths and does not expand the approved
`tokens/color/*.toml` row. It does not list these five test-owned inputs by name:

- `packages/fabrika-design/tokens/color/done.toml`
- `packages/fabrika-design/tokens/color/stuck.toml`
- `packages/fabrika-design/tokens/color/turn-fg.toml`
- `packages/fabrika-design/tokens/color/turn-fill-hover.toml`
- `packages/fabrika-design/tokens/color/turn-text.toml`

Their diff is preserved in the ignored `runs/themes-tests7-token-inputs.patch`.
These changes remain visible in the working tree for the lead to accept after
listing the five paths in the approved plan. All other changes are exact `tests`
entries. The source and mapped fixture bytes and their hash pins are unchanged.

The final compiler run passed across the workspace, including the renamed theme
type law and the controlled-watch property. An earlier command stopped before
any compiler started because a restored task-cache link pointed at itself. That
ignored local cache was removed before running the compiler. No code changed
between those attempts.

The requested full step-commit command refused before staging anything:
`not_owner: packages/fabrika-design/tokens/color/done.toml`. The owner check in
`.agents/skills/step-commit/scripts/stepcommit.sh` requires exact file entries.
The remaining exact-owned files are committed separately; the five token input
edits and their saved diff are left for the lead to resolve. No ownership check
was bypassed.
