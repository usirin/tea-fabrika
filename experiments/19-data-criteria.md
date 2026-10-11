# 19. Criteria as data: a rule, a call and its result

The idea from the Open list: triage writes each criterion as a rule plus
examples, each a JavaScript call and its exact result. Code turns every example
into `assert.deepStrictEqual(<call>, <result>)`. No agent writes the visible
tests and no judge checks they fit. Two things could break it: rules that are
not one call and a result, and results triage gets wrong, since it reads the
code but cannot run anything.

`19-data-criteria.ts` runs triage three times on each toy, with and without the
toy's tests, and runs every example against the correct code, the starting
code and every broken version. `SET=demlik` runs it on seven closed demlik
issues at the commit before each fix and only counts which rules fit.

| | Triage may read the toy's tests | Triage has only the ticket |
|---|---|---|
| Criteria written | 50 | 23 |
| Criteria with an example | 50 | 23 |
| Examples wrong on the correct code | 0 of 54 | 0 of 23 |
| Broken versions caught | 33 of 33 | 11 of 33 |
| Experiment 13's agent-written tests caught | 33 of 33 | 18 of 33 |

On the toys the shape works. Every rule fit, and every result was right. That
first column proves less than it looks: the toy's tests hold every hard result
(`"1.5h" -> 5400`, `"héllo, wörld 42!" -> "hllo-wrld-42"`), and triage could
copy them. So `SPEC=rules` hides the tests and states every rule in the ticket
in words, with no example values. Triage then wrote 52 criteria, all with an
example, 0 of 54 results wrong, and the examples caught 33 of 33 broken
versions. It worked its results out itself (`"1h2m3s" -> 3723`,
`"café" -> "caf"`), but it chose easy inputs: one or two steps of sum, short
strings. A result that takes real working out is still untested; the toys
never asked for one. The examples that hold on the starting code are all
"returns null" rules, which a stub follows by accident; they are still the
rule.

The thin ticket is worse as data, not better: 11 of 33 caught against 18. Two
slugify runs wrote examples like `typeof slugify("Hello World") -> "string"`
and `encodeURIComponent(s) === s`, true of nearly any slug. With no rules to
read, triage reached for what it could say for sure, and that is weak.

On real issues most rules do not fit. 36 of 130 criteria over seven demlik
issues carried an example:

| Issue | Fit |
|---|---|
| #576 createJevAsk name (a pure function) | 11 of 22 |
| #516 mistyped process door | 18 of 32 |
| #565 readAllowance | 7 of 22 |
| #568 spawn's notify step | 0 of 15 |
| #567 run.stop() and the host's table | 0 of 16 |
| #529 wrangler config loader | 0 of 15 |
| #569 docs links | 0 of 8 |

Triage said why for each one that did not fit, and the reasons fall into a few
kinds: types only the compiler sees, async Effect runs over time, a CLI run
over files on disk, docs and wording, and process rows (a changeset, CI green).
None of the demlik examples were run, so whether their results are right is
not known.

**Took from it:** a call and its result is the right shape for a pure function,
and there it removes the test-writer and the fit judge with nothing lost. It is
not the shape of most real criteria. A criterion needs a kind, and each kind
its own check: an example for code to run, a type test, a fixture test an agent
writes and Jev checks against the rule, a file or docs check. And the data
shape does nothing for a thin ticket; only more rules do.
