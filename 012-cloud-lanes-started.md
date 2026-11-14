FYI: the two cloud lanes are started as child sessions on Opus, "Cloud lane: e2e typecheck" and "Cloud lane: freeze today's version".

- **The sessions:** each runs on this repo's cloud environment, from `main`, with the model set to Opus. They are named as you asked, and their branches are `fabrikalfa/cloud-e2e-typecheck` and `fabrikalfa/cloud-freeze-today`.
- **Each child's prompt** is your lane brief plus:
  - **Steps:** plan, tests, build and one review, each by its own Opus subagent. The second send-back stops the lane.
  - **Models:** Opus for everything they start, never Fable.
  - **Setup:** Node 26.13.0.
  - **Commits:** plain commits with no trailers. e2e uses the subject "e2e typecheck <step>: <what>", and freeze uses "T937 <step>: <what>".
  - **Checks:** one of format, lint or typecheck at a time, and named tests only.
  - **Before the push:** the leak check on the diff and on every commit.
  - **Privacy:** nothing private anywhere.
  - **Never:** a pull request, a merge, a force-push or a deleted branch.
- **Reports:** each child sends its report to this session. I pass each lane on here as one REPORT, with the branch, head, review verdict and pull request description.
- **Tuval run main:** the review passed. My `pnpm typecheck` then found three type errors in the rewritten L11 of `next/apps/fabrika/src/build.test.ts`, and the tests step is fixing them now. Its REPORT follows once the type check is green.
