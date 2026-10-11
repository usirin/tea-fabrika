# 33. Ship

Ship is a third machine beside triage and the lane; the factory starts it when
a lane is done. A `Repo` service does the git work (local git first): it seals
the change as one commit on top of where the work started, without moving the
lane's branch, and the run parks for a person. The person reads what the lane
left on the record (attempts, builds, extra changes, filed and withdrawn
findings, settled comments) and the diff stat, and approves by naming the
commit. An approval naming any other commit changes nothing, and an agent
never gives one. Then the repo moves the base branch to that commit, but only
if the base is still where it was read.

If someone else's work landed in the base meanwhile, the change is merged with
the new base without touching any folder (`git merge-tree`), the merge runs on
a fresh copy, and it lands without a second approval: the change the person
approved did not move, only what it sits on. A conflict, or tests that fail
only on the merge, park for a person; a retry merges the approved commit again,
never an earlier merge.

`local.test.ts` runs it on real git: the lane's fix lands in `main` with the
lane's branch untouched; work committed to `main` from another folder merges,
passes on a fresh copy, and both land; an edit to the same lines names the
conflicted file and moves nothing. `ship.test.ts` kills ship after every step
of a moved-base landing and it ends the same. The demo ran slugify from the
ticket to `main`, stopping once for the approval.

**Took from it:** fabrika's ship steps, owner approval through landing. Not
built: the builder repairing a conflict (it parks instead), a GitHub `Repo`,
and cleaning up the lane's folder after it lands.
