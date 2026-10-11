# 41. Enrichment in small steps: facts, a draft, vetting

Not an experiment, a redesign, step 1 of it. The same end result as before (a
rewrite with criteria as data, and the call nobody has made), but not one big
agent turn. Each part goes to what does it best:

| Part | Owner | Why |
|---|---|---|
| What the report mentions: backticked names, file paths, `#N` refs | Code (`mentionsOf`) | Exact. A pure function in the reducer |
| Facts: where each name is declared, its signature, its callers, which export subpaths publish it, whether each path is at HEAD | Code (`Facts` service: git, code-graph, a few lines by hand) | Exact, and cheap: 5.5 s on kamp-us/demlik#558. The enricher no longer digs for them |
| The rewrite: body, criteria, the open call | Agent, ending in typed data | Open-ended writing. It starts from the facts and may still read the code |
| Vetting the draft | Code (`Workspace.vet`, then `vetProblems`) | Running is exact: an example either loads, typechecks and fails, or it does not |
| Problems back to the writer | Code routes, agent fixes | In the same conversation, up to `vet_tries` drafts (3 by default), then a person |
| Sorting | Jev, unchanged | |

Triage now goes: fetching → gathering facts → enriching (a draft-and-vet
child) → the owner's call if one is open → sorting → triaged. Facts that cannot
be gathered only mean the enricher reads the code itself, as before. A draft
still failing vetting after its tries parks as `enrichment_unvetted` with
vetting's last word; a person grants more tries (same conversation), accepts
the draft as it is, or drops the issue.

**Draft and vet is a child machine of its own** (`src/refine.ts`), held by
triage with `applyCell` the way the lane holds review. It is made per use,
like tea's `createJevAsk({ name })`: `createRefine({ name: "enrich", brief,
draft, verdict, problemsOf })` makes the Cmds `enrich_write` and
`enrich_check`, so two uses in one parent never share a Msg. The checker's Cmd
hands back what it saw (`Vetted`: missing files, each example's verdict), and
whether that is a pass is `problemsOf`, pure, in the reducer, so a replay
reaches the same verdict. It stops for its parent when it is done, out of
tries, or when the writer or the checker failed; the parent decides who is asked.

The lane's builder → check loop stays its own. Its answers are richer (a
builder may answer contradiction, blocked or dispute; a failed run is read for
whose fault it is; a try can be given back), and it holds review as a child.
Folding it into the draft-and-vet child would grow the child to fit the lane.

**Vetting**, per example, on HEAD in a throwaway worktree with the workspace's
own test flavour: `broken` (does not load, does not typecheck, or throws
anything but its assertion), `holds_already` (passes on today's code) or
`fails` (its assertion fails, as it should before the change). A draft passes
with no broken example, none that holds already, and at least one that fails,
or no examples at all. Every file a criterion names must be at HEAD, and ids
must be unique. Unchecked rules now say what they are about: `type`, `doc` or
`other`. The cost, per draft: about 0.15 s on a toy (node:test), 6.7 s on
kamp-us/demlik (install from the store, `tsc` on the one file, vitest on it).

Run on run 2's own draft of #558 (`experiments/41-vet-probe.ts`, offline, on a
scratch clone), vetting would have sent it back at once: 6 of its 7 examples do
not typecheck on today's code, and the 7th holds already, so none fails. One of
the 6 is `expectCmdEmitted` with a plain object, "not assignable to type
'never'": the very example the builder later made compile by weakening
`NoInfer` (section 40). The other 5 are the bug itself (`ctx` left out), which
is a rule about types, and the feedback says so.

**What code-graph could and could not do.** Its call graph (`--graph --edges
--json`, run per package so its tsconfig is used) gave every function's
callers, with the line of each call; its resolver
(`loadInProcessGraph().resolveExportOrigin`) told which export subpath publishes
a name, following re-exports the way the compiler does, types included. What
it lacked, done here by hand: the graph holds functions only, so a type or an
interface (`CtxArg`) has no node, no callers and no line; no node carries its
declaration text, so the signature is read from the file; a bare name cannot
be looked up (`--blast` takes a unique name or an id), so declarations are
found with `git grep`; and the resolver only follows an `import` statement in
an existing file, so asking "does this entry export X" needs a probe file that
imports the entry. Its graph reads the folder as it is, not HEAD.

Open: no pitch yet (the problem, no-gos, rabbit-holes), the next step. Facts
do not read doc pages, so a call written in a doc (`replay(m, { ctx:
undefined })` in two of #558's pages) is not found (done in section 42). And
an example could dodge the typecheck with a cast; vetting does not look for one.
