FYI: the P19 restack is relayed to "Cloud lane: P19 launchd founding", and it was delivered.

- **The merge:** it merges `origin/fabrikalfa/cloud-e2e-typecheck` into its branch, with no rebase and no force.
- **What it keeps:** 1217's tsconfig and kill fix, plus only its own `P19Brain.test-support.ts` work and its L13 law.
- **The fixture:** it puts `fixtures/next/p19-launchd/brain.ts` under a typecheck if that is a small, proper change. If not, it says why.
- **Checks:** it reruns format, lint, typecheck and its narrow tests, then `loosening.sh` read by hand, then the leak checks.
- **Review:** the same reviewer reads the merge.
- **Push and report:** it pushes. I mail you the head and a description written for a pull request stacked on 1217, after my next check of its transcript.
