NEEDS ANSWER: the runtime fill stopped at its second send-back, unpushed; the one fix left is 8 category tags, and my send-back brief caused them.

- **Branch:** `fabrikalfa/cloud-fill-runtime`, local only, not pushed. Commits: `a01e2b75f` (doc blocks for runtime) and `7028ee7f4` (fixes).
- **Where it stands:** the rule is at zero for `runtime/` (0 0 0 0). The comments-only proof holds for all 20 changed files: the `oxc-parser` trees match, the `esbuild` output matches, and a planted literal was detected. Every truth fix from round 1 landed and reads true against the code.
- **Round 1, send back:**
  - 7 blocks were untrue: the `Audit.ts` module block, `defaultPolicy`, `StartRefusal`, `resolveName`, `WatchersSql.layer`, `WatcherManager` and `ChaosMachine.refuse`.
  - 15 Schema values were tagged `models`, where nearby code tags Schema values `schemas`.
  - One paragraph needed rewrapping.
  - All fixed in `7028ee7f4`, plus `ChaosMachine.wake` and `Audit.failure`/`restore` tagged `constructors`.
- **Round 2, send back:**
  - **What is wrong:** 8 type twins were moved from `@category models` to `@category schemas`: `ProcessStore.Checkpoint` and `Placed`; `Program.Refusal`, `EventPolicy`, `Write`, `Step` and `Admission`; `Runner.Sent`. On main, all 50 `export type X = typeof X.Type` aliases in libfabrika are `models`, and seven of these eight were `models` on main.
  - **Why it happened:** my send-back message to the writer said "their type twins' blocks, if any, follow the same category", and the writer did what I said. The checker never asked for it.
- **What I need from you:** push as it is under 0176, with the 8 mixed tags named in "Known, and left"; or allow one bounded round in which only those 8 tags go back to `models`, and the same checker rechecks only those 8 lines. I lean to the bounded round. It is 8 one-word changes, the error is mine, and pushing would leave each file mixing the two tags.
- **Counts:**
  - Blocks: 2 module blocks added (`Audit.ts`, and `Client.ts`, whose `//` header it replaces, with plan codes dropped and 0046 kept); 4 export blocks added; 77 blocks reshaped.
  - The checker's truth count: about 85 blocks read, about 75 true and useful, 3 true but empty, and the 7 wrong ones now fixed.
- **Format and lint:** not run on runtime yet. They run after your answer.
- **A possible code gap the checker found, outside this task:** `start_child` does not list `bad_cmd` among its declared errors, but the runner answers a malformed start with it (`Runner.ts:1482`, `:1499`). A client decoding with `StartRefusal` would fail on it.
