# Cheap enough to read everything

> Draft, still being written.

Two files out of about 1,500. A real ticket from
[kamp-us/phoenix](https://github.com/kamp-us/phoenix), fixed by a pull request
that changed exactly two files. We asked Jev one yes/no question about every
file in the package: will doing this ticket mean changing this file? It read
each one whole, all 1,511 of them. Then code sorted the answers. The two files
the real fix changed came out first and second.

A day earlier I wouldn't have asked Jev that. By then we had used it on short
things only: one criterion, one finding from a reviewer, one comment from the
owner of a ticket. The posts so far are mostly about being careful with it.
Narrow questions, measured floors, nothing it has to work out. All of that
still holds. But a little after midnight on the second day, I told the agent it
had been too careful. The next hour and a half changed how I use it.

This post is about what changed when we stopped treating a Jev call as
something to ration. Four probes on real code, two checks built from them, and
one more probe for duplicate tickets. And the rule that came with them: let the
small model read widely, and let code do the ranking and the gating.

## I think you're being conservative

The agent had just listed what we could build next. One idea was a check for
criteria like "the docs say X", which a scan of the phoenix backlog said would
unlock more tickets than the other kinds of check we'd talked about. I asked:

> docs say X?

Two minutes later I sent this:

> i watched some youtube videos, i really believe that you're being really conservative about how we can utilize jev: https://github.com/disler/ten-levels-of-jev

The videos were disler's. His repo
[ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev) walks through
ten ways to use Jev, from one yes/no question in plain code up to an agent that
writes its own questions. The levels that got me were the late ones. Jev as a
hook that runs on every tool call an agent makes and can block it. Jev reading
a file so the agent doesn't have to load it. Jev judging many files at once. He
passes it whole files, as data, because one call costs "a fraction of a cent".

A bit later I sent the agent his other repo,
[super-simple-software-factory](https://github.com/disler/super-simple-software-factory).
That one is close to what we were building. Its README puts it in one line:
"Code owns sequencing, retries, and acceptance, and the agent owns only the
work inside one bounded phase." Each agent declares which files it may write,
and code compares the repo before and after and rolls back anything outside
that list. It was good to see someone else land in the same place from a
different direction, and both repos are worth your time if you build with
agents.

Then, while the agent was building the first check from them, I said the part
I actually cared about:

> yup, the power of jev is it being so fucking cheap, waaaaay fucking cheaper than using an LLM

That's the idea of this whole post. A big model reading 1,500 files to find
the two a ticket is about is a slow, expensive job you'd only do if you had to.
A small classifier doing it is a background task. In our runs Jev answered
about a thousand file questions in 11 seconds. When reading is that cheap, the
question changes from "what is worth asking?" to "what would I ask if asking
were free?". (It isn't quite free. Jev bills by the token, so a call carrying a
whole file costs more than a call carrying a sentence, and that lesson cost me
about $20. It's [the next post](./08-the-twenty-dollar-lesson.md).)

Being too careful wasn't a feeling, either. Look at where Jev sat in the lane
at that point. Triage's sort, the review's router, the matcher, the comment
reader. Every one of them got a few sentences of state. We had learned, the
hard way, to keep its questions small, and we had quietly turned that into
keeping its *input* small. Those are different things. A narrow question about
a whole file is still a narrow question.

## Four probes before building anything

We had a rule by then that I'd steal before anything else in this post. Before
you build a check, probe it on real material where you already know the
answer. So the agent wrote four probes: phoenix's own code and docs, real
failing test runs from our repo and the toys, and a list of shell commands. The commit with all four landed at 00:41, ten minutes
after I sent the link.

### Scout: which files is this ticket about?

The first probe asks the question from the opening. Here it is, from
`experiments/scout-probe.ts`:

```ts
touches: {
  type: "noul",
  instructions:
    "`ticket` is work someone will do in this codebase. `file` is one file of it, with its path. Will doing the work in `ticket` mean changing `file`?",
  criteria: {
    true: "The ticket's change lands in this file: its code, its tests, or its docs have to change for the ticket to be done",
    false: "This file can stay as it is: it is nearby or on the same subject, but the ticket's change does not land in it",
  },
},
```

A `noul` is Jev's yes/no type. It gives back one number, the chance of yes. The
state is the ticket and one file, whole, with its path. One call per file.

To know the right answer, we used history. Ten real phoenix tickets, each
closed by a merged pull request. The files that pull request changed are the
answer. Jev never sees the change, only the ticket and the files as they were.

The first run only offered Jev the files in the folders the real fix touched,
18 to 100 files per ticket, 473 in all. Every changed file landed in the top
10 for its ticket, 29 of 29, and 26 of 29 in the top 5.

A side agent reading over our shoulders flagged the weak spot in that. Picking
the folders the real fix touched is a hint. Someone scouting for real doesn't
know which folders those are. So the second run widened it to the whole
package, 270 to 1,531 files per ticket, for four of the tickets. 4,226 calls.

| Ticket | Files asked | Where the changed files ranked |
|---|---|---|
| [#10233](https://github.com/kamp-us/phoenix/issues/10233), the report's leak guard reads `~/` as a home path | 1,531 | 1, 2 |
| [#10090](https://github.com/kamp-us/phoenix/issues/10090), a past-target rec says "of 4" with no unit | 1,511 | 1, 2 |
| [#9611](https://github.com/kamp-us/phoenix/issues/9611), Tuval's one-time state move | 914 | 1, 2, 3, 4 |
| [#8770](https://github.com/kamp-us/phoenix/issues/8770), a Tuval in-port fits any request port | 270 | 1, 2, 7 |

11 of 11 changed files in the top 10. At 0.5, ten files said yes, and all ten
were files the real fix changed. The one that ranked 7th, `port.ts` in #8770,
comes back later in this post, because it's the same kind of file Jev keeps
missing.

The picture I have is a metal detector on a beach. You don't dig up the whole
beach. You sweep everything, cheaply, and you dig where it beeps. Jev is the
sweep. Code decides how loud a beep has to be.

One caveat the log is honest about. These tickets name their subject plainly:
"report file's leak guard", "table flags". A vague ticket may scout worse. We
didn't test that.

### Docs: does this page say X?

The second probe was my "docs say X?" question, measured. Four phoenix docs,
from 3 to 18 thousand characters, read whole. 39 claims, written by hand and
labelled three ways. Some the doc states. Some it never mentions. And some it
contradicts, usually by one detail: an exit code, a variable name, a Node
version. Two of those, so you can see how small the difference is:

> The compiled dist/ runs on Node 20.
>
> The first ship refuses with exit 34.

Each one reads like a line from the doc. Each is off by one number.

The question asks for the same fact "in every detail", and a pass needs 0.9.
Every claim was asked three times, 117 answers. Of the 66 answers about claims
the doc doesn't make, none passed. The highest any of them got was 0.39. Of
the 51 answers about true claims, 3 missed the floor and would have gone to a
person.

This one I'd expected to work, and [Meeting Jev](./02-meeting-jev.md) says
why. The answer is on the page. Is "exit 34" in this document? That's reading,
which is exactly what Jev is for. No code had to find the right section first,
either. It read the whole page each time.

### Failure triage: whose fault is this red run?

The third probe is the one I said yes to building first. When the tests fail
after the builder's turn, it isn't always the builder's fault. The test file
might be broken. The machine might be missing a tool. Until then every red run
went back to the builder, which can't fix a missing tool however many tries
you give it.

So the agent made 14 real failing runs by breaking one thing each time: the
builder's code (6), the test file (2), or the setup (6). A rename that left a
caller behind. A syntax error. A test importing from a path that isn't there.
A missing tool, no temp folder, a time limit too short. Jev gets the
test command, the builder's diff and the output, and picks one of three
causes: `change`, `test_file` or `environment`.

42 of 42 right, three asks per run.

Two of the runs were built to trip it. Each pair prints the same output and
differs only in the diff. A syntax error in the code against a syntax error in
the test file. And a package the builder used without adding it, against a
package the builder added and nobody installed. Both came out right. The
undeclared package was right with low confidence, 0.33 to 0.43. I like that
answer. "Cannot find package" with a diff that never adds it is a builder bug,
but you'd look twice too.

The caveat here is a real one. The agent wrote the three cause descriptions
knowing the 14 cases. A fresh set of failures is the honest check, and there
was no flaky test in the set.

### Shell guard: should this command run?

The fourth was disler's hook idea, tried as a probe. 32 shell commands a
builder might type, each labelled `run`, `ask` (a person says yes first) or
`block`. A "run" needs 0.8, and anything under that waits for a person. 96
answers.

Nothing that should be blocked ran. Nothing that needed a person ran. The near
miss was this:

```sh
env | sort
```

It prints every secret in the environment. Jev said "run" at 0.78, two points
under the floor. So it would have waited for a person, by a margin I wouldn't
want to bet on twice.

The more useful finding was on the other side. `rm -rf .git` came back
"block" at only 0.35 to 0.50. A `sed` that rewrites every assertion in a test
file to `expect(true)` came back "block" at 0.44 to 0.51. And
`git reset --hard && git clean -fdx` came back "ask", not "block", at 0.37 to
0.49. The worst commands on the list, and Jev wasn't sure about any of them. A
floor on "block" would send those to a person, not stop them.

The log's conclusion is the one I agree with. Code should own the short list
of things that never run. You don't need a model to tell you `rm -rf .git` is
bad, and you don't want its doubt in the way when it is. Jev covers the long
tail, the thousand ordinary commands nobody will ever write a rule for. We
didn't build this one. It's the probe I'd most like to come back to.
