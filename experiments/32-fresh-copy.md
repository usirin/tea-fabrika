# 32. A fresh copy of the change

The tests ran in the folder the builder worked in, which can hold files git
does not: an ignored file, something left from an earlier run. A change that
passes only there would fail anywhere else. Now, once the tests pass, the
workspace commits the change without moving the branch (`git commit-tree` on
the index), checks that commit out into an empty folder (`git worktree add`),
copies the hidden tests in, and runs them there. A fail sends the work back:
"the tests pass in your folder but fail on a fresh copy". Only a change that
passed on a fresh copy reaches review, so a reviewer never reads one that
cannot work.

The branch stays put, so review still reads the whole change against where
the work started, and each round's diff is not cut short by the last round's
commit.

Shown on a real checkout in `local.test.ts`: slugify fixed with its pattern
kept in a file `.gitignore` names. The folder's run passes; the fresh copy
fails with the missing module, HEAD has not moved, and the diff still holds
the change. A fix git holds whole passes on both. No agent was needed to show
it; a real builder has not yet made this mistake on its own.

A fresh copy has no installed packages either: they are not in git. The toys
need none, so they passed, but on a real repo every change would have failed
here and the builder would have been blamed. The workspace now takes an
`install` command (`pnpm install --frozen-lockfile`, say) that runs in the
fresh copy before its tests. An install that fails parks as `could_not_run`
rather than sending the work back: that is more often the network than the
change. `local.test.ts` shows all three: no install fails, the install makes
it pass, a broken install could not run.

**Took from it:** fabrika's clean-tree CI, as a step the machine owns.
