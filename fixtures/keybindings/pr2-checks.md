# Keys PR 2 test record

Today's version, tracker ticket 174. This is the test writer's record, before product work.
No product files changed. The two packs in `programs.ts` are made up.

## Laws and plants

`K` below means `apps/fabrika/src/desk/keymap.pr2.test.ts`, `M` means
`apps/fabrika/src/host/keybindings.pr2.test.ts`, and `R` means
`apps/fabrika/src/window/keys.pr2.test.ts`. Paths and line numbers name test starts.
The plant is the wrong behavior the completed test must catch.

| Law | Test | Plant | Observed before the build |
|---|---|---|---|
| P1 | `packages/fabrika/src/program/commands.test.ts:52`, compiler cases at 106 | Accept an unrelated input, wrong input value, or host input as a local window message | Invalid declarations do not throw. Five compiler negatives are unused. |
| P2 | `packages/fabrika/src/program/commands.test.ts:62`, compiler cases at 132 | Let a command invent `copy` without a matching `mode()` | Invalid declaration does not throw; compiler accepts it. |
| P3 | `apps/fabrika/src/window/program-commands.test.ts:12`, `apps/fabrika/src/window/pop.pr2.test.ts:18`, `apps/fabrika/e2e.ts:3174` | Keep Markdown's old `q`, or menu `j`, after rebinding | Shipped programs have no declarations. The rebound menu still moves on `j`. Markdown needs Electron. |
| P4 | `K:43` | Assigning alpha's `j` erases beta's `j` | Decoder rejects `alpha.next` before scopes can be checked. |
| P5 | `R:83` | Base editing keys run during search, or a global uses the focused program's mode | Planned `window/keys.ts` does not exist. |
| P6 | `K:55` | Accept `enter` or a flat mode-only override | Decoder rejects declared program rows and mode sections. |
| P7 | `M:64`, `apps/fabrika/src/keys/machine.pr2.test.ts:14` | Reset or Add acts on another mode's row | Edit schema requires the old `does` field; editor loses the complete target. |
| P8 | `M:89` | Save only the first mode section | Edit schema has no atomic batch request. |
| P9 | `M:113` | A local assignment erases another program's same key | Edit schema rejects a scoped target. |
| P10 | `K:71` | A pack takes an app key, prefix, F6 or Shift-F6 | Pack rows are absent from the decoded table. |
| P11 | `K:84` | First or last pack silently wins a global clash | Both catalog rows are absent. Both registration orders are tested. |
| P12 | `K:95` | A later user row wins a duplicate claim | Decoder rejects the declared command before the intended clash. |
| P13 | `K:111`, `apps/fabrika/src/keys/machine.pr2.test.ts:38` | Unloaded rows remain executable or an old selection can save | No program catalog rows; editor does not retain a complete target. |
| P14 | `R:107`, `apps/fabrika/src/host/host.test.ts:132` | One window arms the other's prefix or modes | Router absent. Real host test cannot attach to its local socket here. |
| P15 | `R:121` | A timer disarms an ordinary prefix; composition consumes it | Router absent. Test checks no command is scheduled on arming, then presses after a generated delay. |
| P16 | `R:156`, `apps/fabrika/src/host/host.test.ts:154`, `apps/fabrika/e2e.ts:3097` | Following text reaches the old tile, or an unrelated acknowledgement releases it | Router absent; host socket unavailable. Real rapid typing is written for Electron. |
| P17 | `R:175` | Link recovery or a late acknowledgement replays discarded input | Router absent. |
| P18 | `apps/fabrika/src/editor/keys.pr2.test.ts:38` and 60 | Old BOUND bytes or search decoding still run | Old Ctrl-A remains beginning-of-line; old Escape still leaves search. |
| P19 | `R:188`, `apps/fabrika/e2e.ts:3289` | Tracker `j` steals text from its composer | Router absent. Real composition and control focus need the Electron run. |
| P20 | `K:123` | Count a browser-disabled key as an effective exit | Decoder rejects valid mode sections. Existing PR 1 terminal escape laws remain. |
| P21 | `R:198`; existing `keysLook` Electron stage | Mapping or recording swallows Cmd-Q or Ctrl-C | Router absent. Existing real system-key and interrupt checks remain. |
| P22 | `apps/fabrika/src/keys/machine.pr2.test.ts:63`, `apps/fabrika/e2e.ts:3186` | Hints, palette or editor retain an old key | Decoder rejects the info exit section. Electron also checks the saved Counter key acts. |
| P23 | `R:210` | Palette opening loses its original tile; tsh executes an unavailable mode command | Router absent. |
| P24 | `apps/fabrika/e2e.ts:3235`, 3250 and 3309 | Selection increments Counter or posts a comment; controls lack words | Written, not run here. Requires the real app. |
| P25 | `apps/fabrika/e2e.ts:3160`, 3252 and 3261 | A test passes only by setting DOM focus | Written, not run here. Tab reaches Map controls, the real Plus button, recorder and Save. No `.focus()` is used. |
| P26 | `K:139`, `apps/fabrika/src/keys/machine.pr2.test.ts:87` | A normal-tab limitation rejects the binding file | Decoder rejects the program row before capability handling. |
| P27 | `M:132` | Rewrite unrelated TOML, or activate keys before rename succeeds | Initial mode file is refused. The real filesystem test injects only the failed rename. |
| P28 | `M:156` | Undo restores an unloaded command when only catalog generation changed | Scoped edit cannot start. Catalog generation is not implemented. |
| P29 | `apps/fabrika/src/host/host.test.ts:187` | Log every typed character or drop a command's target and `via` | Written; the local socket cannot attach here. |
| P30 | `apps/fabrika/src/messages.test.ts:17` | Accept PR 1 raw-key traffic or attach a PR 1 peer | Completed command is refused by the current message reader. Protocol is still 2. |
| P31 | `packages/fabrika/src/program/commands.test.ts:75` | Agent copies retain commands for removed person-only inputs | The input is removed, but its `answer` command remains. |

## Runs

The focused unit run reported 37 failing tests across seven new files. Separate
message and menu runs showed the completed route being refused and old menu `j`
remaining active. Host P14, P16 and P29 waited for a local socket that never answered.
The manager can read files here, but its folder watch reports EMFILE.

The final focused run covered nine files: 52 tests, 42 red and 10 passing. There
were no collection failures. Eight router laws fail when loading the exact new
product path named in the plan. They have not yet reached their behavioral plants.

One root `pnpm typecheck` stopped at the missing program command API and unused
compiler negatives. An app-only compiler pass exposed three test mistakes: the tea
machine's generic arguments, Effect 4 logger fields, and an unchecked TOML value.
Those were fixed. Product API errors remain. `pnpm lint` passed.

Run with `TYPESAFE_API_KEY` unset. No test uses a key or paid model.

```sh
pnpm exec vitest run --maxWorkers=1 apps/fabrika/src/desk/keymap.pr2.test.ts
pnpm exec vitest run --maxWorkers=1 apps/fabrika/src/host/keybindings.pr2.test.ts
pnpm exec vitest run --maxWorkers=1 apps/fabrika/src/window/keys.pr2.test.ts
pnpm exec vitest run --maxWorkers=1 apps/fabrika/src/host/host.test.ts -t 'P14:|P16:|P29:'
pnpm --filter @kampus/fabrika-app-old e2e -- --keys2
pnpm --filter @kampus/fabrika-app-old e2e -- --keys
```

The lead's run must show actual Tab movement, no action on selecting Plus or
Comment, the saved key acting once, old prompt/search keys stopping, correct
post-split typing, and complete command records without typed content. Inspect the
dark and light shots in all five layouts. VoiceOver remains a real-person check.

## Limits and plan gaps

The plan sketches data but does not name the router's export, messages or decoder
options. These tests make that contract concrete: `keysMachine`, decoder options
`{programs, client}`, scoped `target` edits, atomic `batch`, and correlated `applied`
answers. These are implementation choices for this PR, not new product decisions.

Missing product code is not proof that a plant was caught. Run the laws after the
build, then run each plant. In particular, the absent router blocks P5, P14 to P17,
P19, P21 and P23 before their behavior can run.

The plan only names retiring hold tests, but existing desk and host tests also
require the old shared prefix and raw press/answer loop. Those need a tests-role
follow-up when the completed-command desk contract is built. The builder must not
preserve the old behavior just to satisfy them.

The built-app screenshot list includes `unload` and normal-browser `client-off`,
while the plan adds neither a pack loader nor a browser listener. Unit fixtures
cover those states. No built-app capture path is available for them yet. The new
Electron stage captures program, mode, mapping, recorder and saved states. It does
not claim the missing captures or a real screen reader run.
