// Unlisted: every branch, on the laptop or pushed, that holds commits not on main and has no open
// pull request (0134). It lists; it deletes nothing. Today's lead tooling, read through its module:
// `Unlisted.check`.
//
// Tools looked at first (0040), and what each cannot do here:
//   git branch --no-merged origin/main   a squash merge leaves every merged branch "not merged"
//                                         (https://git-scm.com/docs/git-branch), and it knows no PRs
//   git cherry origin/main <branch>      matches commit by commit on patch ids; a squash of several
//                                         commits matches none (https://git-scm.com/docs/git-cherry)
//   gh pr list --head <branch>           knows PRs by name only, and no branch that never had one
//                                         (https://cli.github.com/manual/gh_pr_list)
//   git-trim                             deletes merged branches by upstream; it lists no branch
//                                         that lacks a PR (https://github.com/foriequal0/git-trim)
// So it joins two reads: `gh pr list --state all` for PRs, and a trial merge
// (`git merge-tree --write-tree`, https://git-scm.com/docs/git-merge-tree) for work already on main.
//
// Each branch, in this order (each edge case has its law in Unlisted.test.ts):
//   1. main and origin's HEAD are not branches here
//   2. no commit that origin/main lacks: nothing to list
//   3. an open PR on the branch, or on its lane (`x` and its backup `x-wip` are one lane): listed
//      in the open PRs already
//   4. a MERGED PR on the same name, at this very tip: landed, safe to delete
//   5. a trial merge into origin/main that changes nothing: landed, whatever road it took
//   6. else no pull request; a MERGED PR on the name at an older tip, or a CLOSED one, is named, but
//      the commits after it are still not on main
//   7. local and origin are two lines: either can hold what the other lacks
//   8. a read that fails fails the whole check: it never reports "nothing there" it did not see
import { Effect } from "effect";
import { type Branch, Branches } from "./Branches.ts";
import { type PullRequest, PullRequests } from "./PullRequests.ts";

/** A branch whose work is on no open PR and not on main: the lead opens its draft. */
export type Unlisted = { readonly branch: Branch; readonly ahead: number; readonly earlier: PullRequest | null };

/** A branch whose work is on main already: safe to delete. */
export type Landed = { readonly branch: Branch; readonly merged: PullRequest | null };

export type Report = { readonly unlisted: ReadonlyArray<Unlisted>; readonly landed: ReadonlyArray<Landed> };

/** A branch's lane: its name without the `-wip` of a lane's backup branch. */
export const laneName = (branch: string): string => branch.replace(/(-wip)+$/, "");

export const check = Effect.fn("Unlisted.check")(function* () {
  const branches = yield* Branches;
  const prs = yield* PullRequests;
  yield* branches.refresh;
  const listed = yield* branches.list;
  const all = yield* prs.all;
  const lanes = new Set(all.filter((pr) => pr.state === "OPEN").map((pr) => laneName(pr.head)));
  const unlisted: Array<Unlisted> = [];
  const landed: Array<Landed> = [];

  for (const branch of listed) {
    const ahead = yield* branches.ahead(branch.tip);

    if (ahead === 0 || lanes.has(laneName(branch.name))) {
      continue;
    }

    const named = all.filter((pr) => pr.head === branch.name && pr.state !== "OPEN");
    const merged = named.find((pr) => pr.state === "MERGED" && pr.oid === branch.tip) ?? null;

    if (merged !== null || (yield* branches.landsEmpty(branch.tip))) {
      landed.push({ branch, merged });
      continue;
    }

    const earlier = named.toSorted((a, b) => b.number - a.number)[0] ?? null;
    unlisted.push({ branch, ahead, earlier });
  }

  return { unlisted, landed } satisfies Report;
});

const at = (b: Branch) => `${b.location} ${b.name}`;

/** One line per branch, the ones that need a draft first, then a count. */
export const lines = (r: Report): ReadonlyArray<string> => [
  ...r.unlisted.map(
    (u) =>
      `no pull request: ${at(u.branch)}, ${u.ahead} commit${u.ahead === 1 ? "" : "s"} not on main, at ${u.branch.tip.slice(0, 8)}${u.earlier === null ? "" : `; PR ${u.earlier.number} was ${u.earlier.state.toLowerCase()} at another head`}`,
  ),
  ...r.landed.map(
    (l) =>
      `safe to delete: ${at(l.branch)}, ${
        l.merged === null ? "its changes are on main already" : `PR ${l.merged.number} merged at this head`
      }`,
  ),
  `unlisted: ${r.unlisted.length} with no pull request, ${r.landed.length} safe to delete`,
];
