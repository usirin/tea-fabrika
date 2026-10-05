# Cheap enough to read everything

> Draft, still being written.

Two files out of about 1,500. A real ticket from
[kamp-us/phoenix](https://github.com/kamp-us/phoenix), fixed by a pull request
that changed exactly two files. We asked Jev one yes/no question about every
file in the package: will doing this ticket mean changing this file? It read
each one whole, all 1,511 of them. Then code sorted the answers. The two files
the real fix changed came out first and second.

A day earlier I wouldn't have asked Jev that. The posts so far are mostly about
being careful with it: narrow questions, measured floors, nothing it has to
work out. All of that still holds. But a little after midnight on the second
day, I told the agent it had been too careful, and the next hour and a half
changed how I use it. Four probes on real code, two checks built from them,
and a probe for duplicate tickets.

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
that list. Both repos are worth your time if you build with agents.

Then, while the agent was building the first check from them, I said the part
I actually cared about:

> yup, the power of jev is it being so fucking cheap, waaaaay fucking cheaper than using an LLM

That's the idea of this whole post. A big model reading 1,500 files to find
the two a ticket is about is a slow, expensive job you'd only do if you had to.
For a small classifier it's a background task. In our runs Jev answered about a
thousand file questions in 11 seconds. When reading is that cheap, the question
changes from "what is worth asking?" to "what would I ask if asking were
free?".

Look at the lane at that point and the caution is plain. Triage's sort, the
review's router, the matcher, the comment reader: every Jev question got a few
sentences of state. We had learned to keep its questions small, and we had
quietly turned that into keeping its *input* small. A narrow question about a
whole file is still a narrow question.

## Four probes before building anything

We had a rule by then that I'd steal before anything else in this post. Before
you build a check, probe it on real material where you already know the
answer. So the agent wrote four probes: phoenix's own code and docs, real
failing test runs from our repo and the toys, and a list of shell commands.
The commit with all four landed at 00:41, ten minutes after I sent the link.

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

A side agent reading over our shoulders flagged the weak spot. Picking the
folders the real fix touched is a hint nobody has for real. So the second run
widened it to the whole package for four of the tickets, 4,226 calls.

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

[Meeting Jev](./02-meeting-jev.md) says why this works. The answer is on the
page. Is "exit 34" in this document? That's reading, which is what Jev is for,
and no code had to find the right section first.

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

Two pairs were built to trip it. Each pair prints the same output and differs
only in the diff. A syntax error in the code against a syntax error in
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
0.49. Some of the most destructive commands on the list, and Jev wasn't sure
about any of them. A floor on "block" would send those to a person, not stop
them.

The log's conclusion is the one I agree with. Code should own the short list
of things that never run. You don't need a model to tell you `rm -rf .git` is
bad, and you don't want its doubt in the way when it is. Jev covers the long
tail, the ordinary commands nobody will ever write a rule for. This one isn't
built yet.

## Where unsure goes, again

Failure triage went into the lane first (experiment 35), with the probe's
question and a floor of 0.8. A sure `test_file` or `environment` parks the lane
as `run_failed`, with the output shown. A person answers `retry` (fixed it,
run again without charging a try), `rebuild` (it was the builder's after all)
or `drop`. A sure `change` goes back to the builder, as before.

The interesting part is everything else. In the agent's first draft, an
unsure reading parked too. It sounds careful: if Jev isn't sure whose fault it
is, ask a person.

A side agent read the draft and did the sum. In the probe, 1 of the 6 builder
mistakes had come back unsure, the undeclared package. So parking on unsure
would stop about one ordinary bug in six and wait for a person, for a bug the
builder could fix on its next turn.

So unsure goes back to the builder, and so does a reader that fails outright.
It's the cost reasoning from triage's sort in [Meeting
Jev](./02-meeting-jev.md). A wrong send-back costs one try, and the try limit
still catches a builder stuck on something it can't fix. A wrong park costs a
person's time, every time. When you aren't sure, take the cheap mistake.

The everyday picture is a mechanic who hears a strange noise. If she isn't
sure it's serious, she doesn't call you in from work. She drives it around the
block once more. If the noise is still there after three laps, then she calls.

Then the real plug-in ran over the same 14 saved failures, with one
difference. The probe had shown Jev the exact command that failed. The lane
shows it the workspace's plain test command. Every builder mistake went back,
6 of 6. 5 of the 8 setup and test-file failures parked. The other 3 came back
unsure and would have cost one try each. Nothing that was setup trouble got
called the builder's.

One case fell hard. `toy-env-bad-reporter` runs the tests with a reporter flag
that doesn't exist, and in the probe Jev called it `environment` at 0.97. In
the lane it dropped to 0.39. The bad flag was only visible in the probe's
command, and the lane never showed it. Same lesson as the title and the `goal`
key from [A judge that cannot add](./03-a-judge-that-cannot-add.md), from the
other side. Jev can only read what you put in the state. Leave out the line
that holds the answer and its confidence goes with it.

## The file a change forgot

Scout asks which files a ticket is about. The question I care about more lands
at review. The builder is done and the diff is in front of you. Is there a
file it should have touched and didn't?

Experiment 36 measured it the same way as scout, with history. Nine merged
phoenix pull requests, each closing one issue. For each trial, one file the
pull request changed is hidden, as if the builder had forgotten it. Jev sees
the ticket and the diff without that file. Then every other file, as it was
before the change, gets one question, from `experiments/missing-probe.ts`:

```ts
missed: {
  type: "noul",
  instructions:
    "`ticket` is the work. `diff` is the change made for it so far. `file` is a file the change did not touch, as it was before the change. Does finishing the ticket mean `file` has to change too?",
  criteria: {
    true: "The change is incomplete without editing this file: it calls, tests, documents or mirrors what the diff changed in a way the diff breaks or leaves out",
    false: "This file can stay as it is: it is unaffected by the change, or only on the same subject",
  },
},
```

Code ranks the files by their yes. If the hidden file comes out on top, the
check works. And a control run hides nothing, so the diff is whole and any
file at 0.5 or more is a false alarm.

28 trials, over two scopes:

| Run | Calls | Hidden file 1st | Top 5 | Top 10 |
|---|---|---|---|---|
| The pull request's folders, about 35 files | 1,076 in 11s | 24 of 28 | 27 | 28 |
| The whole package, 268 to 1,591 files | 36,171 in 367s | 22 of 28 | 26 | 27 |

Then read it as a gate, the way the lane would use it: flag any file at 0.5 or
more. Over whole packages, it caught 22 of the 28 forgotten files, each one
ranked first. It also made 5 wrong flags across the 28 trials, one extra file
in each of 5 trials. On the 9 complete changes, where nothing was missing, it
flagged nothing. Those 9 controls took 11,786 calls, and the highest any file
scored was 0.48.

That last part is the easy line to get wrong. "No false alarms" is true for
the complete changes only. When a file really was missing, Jev sometimes
flagged a second one beside it, so 5 wrong flags in 28 trials is the honest
number. For a flag that costs the builder one look at one file, I can live
with it.

### What it misses

The 6 misses have the same shape, and I think it's the most useful finding in
the post.

Take [#8770](https://github.com/kamp-us/phoenix/issues/8770), the Tuval port
ticket from the scout table. The fix changed `shape.ts`, its test, and
`port.ts`. Hide `shape.ts` and Jev puts it first at 0.91. Hide its test, first
at 0.90. Hide `port.ts` and it ranks 15th of 268, at 0.14. The same file that
came 7th in the scout run.

The other misses look the same. Two `signatures` files in
[#7288](https://github.com/kamp-us/phoenix/issues/7288) at about 0.2. A
`prep-verb` file and its test in
[#10088](https://github.com/kamp-us/phoenix/issues/10088), 2nd and 4th, under
0.5. `command.ts` in [#10500](https://github.com/kamp-us/phoenix/issues/10500),
6th. None of them is what the ticket is about. Each is a small knock-on edit,
the kind where something changed in one file and another file has to follow.

That's reading against tracing. Jev reads the ticket and the file and asks
whether they're about the same thing. It does not follow that a type changed
shape in one file and a function in another file still uses the old one. A
typechecker does that, and a reference search does the rest. So the log splits
it the way I'd split it now. Jev finds the file the ticket is about. The
typechecker finds the caller that has to follow.

### Built into review

It went into the lane at 01:26 that night, built by a side agent (`0f5fefb`,
`jevMissingReader` in `src/route.ts`, the probe's question word for word). It
runs beside the reviewer agent, at the same time, over the packages the change
touched. The Jev pass takes seconds and the reviewer takes minutes, so it adds
no wait.

A file at 0.5 or more goes back to the builder as a finding. The builder
either touches the file, which code counts as fixed, or disputes it, which
parks for a person like any other disputed finding. The check never parks the
lane on its own. Over 2,000 candidate files, or when the reader fails, it's
skipped, and the result says so. A follow-up commit put that on the record a
person approves at ship, so a skipped check reads "SKIPPED" with its reason
and never looks like a clean pass.

The first real run was [#9611](https://github.com/kamp-us/phoenix/issues/9611)
with `state-dir.ts` hidden. 911 files asked in 15 seconds. One flagged, the
hidden one, at 0.95.

## A duplicate at filing

The last probe (experiment 37) went to the other end of the pipeline. When
someone files an issue, is it a repeat of one that's already open?

Phoenix has the answer key for this. Its triage closes duplicates with a
comment, "Closing as a duplicate of #N". Searching closed issues for that
found 167 pairs. In 143 of them the original was still open when the duplicate
was filed, which is the only case a check at filing can catch. 30 pairs,
spread over the repo's history, each against every issue open at the time it
was filed, 63 to 714 of them. One `noul` per candidate:

> `new` is an issue just filed. `existing` is an issue that is already open. Is
> `new` a duplicate of `existing`: could `new` be closed, and `existing`
> worked, without losing anything `new` asks for?

I like that wording. It doesn't ask whether two issues are similar. It asks
whether you could close one without losing anything. That's the real decision
behind "duplicate", and it's a question about what's on the page.

The original ranked first in 26 of 30 and in the top 5 in all 30. The 4 that
came second lost to another twin: three to another issue closed as a duplicate
of the same original, and one to
[#5755](https://github.com/kamp-us/phoenix/issues/5755), an open issue with
the same title in other words, which the record never linked. So read as "is
this the same request", Jev's first pick was right 30 of 30.

Ranking is the easy half. A flag needs a floor, and a floor needs controls:
issues that are not duplicates, to count how often the check cries wolf. The
first 10 raised one flag, too few to trust. So a second run took 105 plain
issues, 70 spread over the repo's history and 35 each filed right next to a
duplicate, each against its own open pool.

| Floor | Duplicates flagged | Plain filings flagged (of 105) |
|---|---|---|
| 0.5 | 24 of 30 | 11 |
| 0.6 | 20 of 30 | 3 |
| 0.7 | 19 of 30 | 2 |
| 0.8 | 16 of 30 | 0 |
| 0.9 | 3 of 30 | 0 |

At 0.8, nothing plain is flagged and about half the duplicates are. At 0.7,
two of 105 plain filings get flagged, and both are close calls. One,
[#6995](https://github.com/kamp-us/phoenix/issues/6995), has the same title
word for word as the open issue it matched, and both were closed as done, a
twin nobody linked. The other is a task inside an epic it matched.

The log picks 0.7. A flag here doesn't close anything. It says "this looks
like a duplicate of #N, ask a person", and that costs one look. Catching 19
of 30 for about 2 looks per 100 filings is a good trade. Below the floor, the
top three still held the original every time, so triage can get them as
"related issues" for free.

In the 6 pairs under 0.5, the original still ranked first, and Jev just
wasn't sure. The closing comments on cases like these often argue for
paragraphs that a wide issue covers a narrow one. That's a judgment call, not
a match, and "not sure" is an honest answer to it.

The caveats are real. 30 pairs is small. The answer key is triage's own
closing comments, which missed at least two twins. And phoenix is written
mostly by agents, so its duplicates are often filed minutes apart in nearly
the same words. People filing in their own words will be harder. This one
isn't built yet either.

## What changed

Line the checks up and the floors are all different: 0.5 to flag a forgotten
file, 0.7 for a duplicate, 0.8 to run a command or blame the setup, 0.9 to say
a doc states something. Each comes from what a mistake costs at that spot. A
wrong "this file was missed" costs one look, so the floor is low. A wrong "the
doc says X" lets a false claim through, so it's high.

The bigger change is where I put Jev. Until then it sat at the
gates of the lane, making the one call that sends the work this way or that.
These checks put it at the edges, reading wide: every file in a package, every
open issue, every failure. Jev gives a number per item, and code ranks, takes
the top, compares with a floor and decides where the result goes.

And almost none of them let Jev wave work through. The missing-file check adds
a finding. Failure triage parks only when it's sure. A duplicate flag asks a
person. Scout, if we build it, hands over a short list. The cheap reader makes
things stricter or adds context. The shell guard is the exception, because a
sure "run" runs, and that's why it needs the code-owned "never" list most.

## What I'd steal

**Let the small model read whole things.** Keeping the question small doesn't
mean keeping the input small. Ours read up to 1,591 files per trial and put
the forgotten file first in 22 of 28.

**Sweep wide, then let code rank.** Ask one yes/no per candidate, sort by the
yes, take the top. A ranked list is useful even under the floor: the top three
held the original duplicate every time.

**Probe on your own history before you build.** Merged pull requests tell you
which files a ticket needed. Closed duplicates tell you which issues repeat.
Hide one piece and see if the check finds it. Then run a control with nothing
hidden, because a check is only as good as its false alarms.

**Set each floor by the cost of being wrong at that spot.** We ended up with
0.5, 0.7, 0.8 and 0.9 on one model. One floor for everything is the thing to
worry about.

**Send unsure down the cheap path.** For us that was back to the builder, not
to a person. A wrong send-back costs one try. A wrong park costs someone's
evening.

**Keep the short list of "never" in code.** Jev wasn't sure about
`rm -rf .git`. A rule doesn't hesitate. Let the model cover the long tail
nobody writes rules for.

**Hand tracing to a tracer.** A reader finds the file a ticket is about. A
typechecker finds the caller that has to follow.

## The question I still have

The scout and the missing-file probes ran on tickets that name their subject
plainly: "report file's leak guard", "table flags". That's partly how phoenix
is written, and partly why both checks look so good. I don't know yet how they
do on a ticket that says "slugs look wrong" and nothing else, which is how a
lot of real tickets start. My guess is that's triage's job again, the lesson
from the first afternoon. A better ticket makes every reader downstream better.

What I do know is that I'd been asking the wrong question. I was asking
whether a call was worth making. With a reader this cheap, the better question
was what I'd want read if reading were free.

It isn't free, though. The package-wide missing-file run cost about $20, and
most of it bought nothing new. That's [the twenty dollar
lesson](./08-the-twenty-dollar-lesson.md), next.
