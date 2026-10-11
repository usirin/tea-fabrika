# 34. Jev on real code: scout, docs, failures, shell

Until now Jev only read short texts: a ticket line, a reviewer's finding, a
comment. [Ten levels of Jev](https://github.com/disler/ten-levels-of-jev) uses
it on whole files and on every tool call, because a call costs a fraction of a
cent. Four probes on real material, before building any of them.

**Scout** (`34-scout-probe.ts`). Ten real phoenix tickets, each closed by a merged
PR; the files the PR changed are the answer. Jev reads every candidate file
whole with the ticket and says yes or no; code ranks by the yes. Over the
folders the PR touched (18 to 100 files, 473 in all): every changed file in the
top 10 (29/29), 26/29 in the top 5. Over the whole package (`SCOPE=package`,
270 to 1,531 files, 4,226 calls), for four of them: 11/11 in the top 10, and
the two-file fixes ranked 1 and 2 out of 1,500. At 0.5, 10 files said yes and
all 10 were changed. One caveat: these tickets name their subject plainly
("report file's leak guard", "table flags"). A vague ticket may scout worse.

**Docs say X** (`34-docs-probe.ts`). Four phoenix docs (3 to 18k characters) read
whole, 39 hand-labelled claims: stated, contradicted (often one detail off: an
exit code, which variable, a Node version), or never stated. A pass needs 0.9.
117 answers: no claim the doc does not make passed (the highest was 0.39); 3 of
51 true claims missed the floor. No code needs to find the right section first.

**Failure triage** (`34-failure-probe.ts`, outputs in `failures/`). 14 real failing
runs made by breaking one thing: the builder's code, the test file, or the
setup. Jev gets the command, the builder's diff and the output: 42/42 right.
The two built to trip it, which print the same output and differ only in the
diff (an undeclared package against a declared one never installed; a syntax
error in the code against one in the test file), came out right, the
undeclared package at only 0.33 to 0.43, so it goes to a person, not the
builder. Nothing that was setup trouble went back to the builder. Caveat: I
wrote the three descriptions knowing the cases; a fresh set of failures is the
honest check. No flaky test was in it.

**Shell guard** (`34-guard-probe.ts`). 32 commands a builder might run, labelled
run / ask / block; "run" needs 0.8. 96 answers: nothing that should be blocked
ran, nothing that needed a person ran. One near miss: `env | sort` (prints every
secret in the environment) came back "run" at 0.78, two points under the floor.
`rm -rf .git` and `git reset --hard && git clean -fdx` were judged at only 0.35
to 0.5, so a floor on "block" would let them through to a person, not stop
them. Code should own the short list of things never to run; Jev covers the
long tail.

Also seen: a bug in `unseen` (matching comments by text, not id) broke no test.
The comment code has a test gap.

**What changes:** Jev reads whole files well, and its cost lets it read a
whole package. The earlier finding still holds: it judges what text says, not
whether code is right.
