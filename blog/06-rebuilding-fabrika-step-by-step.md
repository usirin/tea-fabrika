# Rebuilding fabrika one step at a time

> Draft, still being written.

> question: are we testing new ideas here? or are we trying to rebuild fabrika with code?

I typed that at about half past nine on the first night. A minute earlier,
experiment 26 had come back tied. That's the one from [The agents had a
shell](./04-the-agents-had-a-shell.md) where three ways of answering a failed
hidden test all hit the ceiling. The agent's next offer was a new toy with a
hidden number in it, so the three ways would finally split. It was a good
experiment. It also had nothing to do with fabrika.

The agent's answer was honest:

> Both, and the last few steps drifted toward new ideas.

It sorted the day's work into three piles. Rebuilding fabrika: the lane that
survives a restart, parks with typed answers, the factory handing triage off to
the lane. New ideas: the test-first lane and criteria as data from [the last
post](./05-tests-decide.md). And a side quest: "Hidden tests are a measuring
tool for our toys, not part of fabrika. I shouldn't have offered another toy for
it."

Then I asked if we were almost done, and it said that depends on which finish
line. As proof that the loop can be code driven, nearly done. As a rebuild of
fabrika, "no, about a quarter."

That gap is what this post is about. About forty minutes later I said what I
wanted:

> yeah, before switching to the next thing, let's try to prove we can actually do each step fabrika counter part has

From that question to a ship step that landed a change in `main` took about
three hours and 12 commits. Experiments 27 to 33. Somewhere
in the middle I also gave the agent a rule that changed how it made every
decision after that, and I think that rule is the most useful thing in here.

## Which finish line?

Experiments are fun, and each one ends in a new question. That's the trap. The
hidden-number toy would have answered a real question, and the answer would
have raised another one, and I'd have spent the night measuring the measuring
tools.

The question that got me out was not "is this interesting". Everything was
interesting. It was "which thing are we doing", asked out loud, with two
answers to pick from. The agent couldn't pick for me, but once I asked, it could
say plainly where each pile stood. Nearly done on one finish line. A quarter of
the way on the other.

If you run long sessions with an agent, I'd steal this one first. Every hour or
so, ask which finish line you're on, and make it name how far along each one is.
An agent will happily follow you down a side road. It just won't stop to ask if
you meant to take it.

## The map

Fabrika has six steps: report, triage, plan, build, review, ship. By that night
the repo had triage and build. Review and ship were the next two, and review was
the big one.

So I asked what fabrika's review actually does and how we'd model it. The agent
read the skill and came back with six steps. Sort the diff by kind. Read the
contract, which is the ticket's criteria plus any rulings an owner added later.
Grade each criterion with evidence. Look for extra problems. Check the builder's
list of what it changed beyond the ticket. Post a verdict.

Our tests already did the grading, and an earlier check already caught edits to
the locked test file. Within half an hour the lane also checked scope in code:
every changed file a criterion doesn't name has to be on the builder's list,
with a reason, or the work goes back. Each listed reason went to a small `Router`
service with one question, "does this change serve the ticket's goal?", and Jev
was its first plug-in. That's experiment 27. [Meeting Jev](./02-meeting-jev.md)
has its numbers: 30 of 36 right, 0 wrong, and the 6 unsure ones were the cases a
person would argue about too.

Then the agent said "next: ship", and I asked:

> ok, why are we stopping review and switching to this again? please share me your knowledge along the way so i can actually understand what's going on

It had called review done when only the half that code can check was done. It
said so ("That's misleading, sorry") and drew the map it should have drawn
first, one row per thing fabrika's review checks, and who decides it:

| Review part | Then | Who decides |
|---|---|---|
| Each criterion is met | built, the tests | code |
| No edits to the locked tests | built | code |
| No changes outside the ticket | built | code |
| An honest list of extra changes | built | code and the router |
| Tests green on the real commit | half, the tests run in the builder's folder | code |
| Extra problems a reader spots | not built | an agent |
| Comments and docs gone stale | not built | an agent |
| Owner comments that change a rule | not built | Jev reads, a person rules |

Four rows to go. That table ran the rest of the night. Every time something got
built, the row changed, and I could see what was left without asking.

## What the lane already had

Two of fabrika's pieces were already in the repo before the question, and they
carry the rest of this post.

**A lane that survives a restart.** [The first post](./01-v4.md) told the short
version of experiment 23: a real build killed with SIGINT five seconds after
Claude Code started, the same command run again, and the build picking up in
the same Claude conversation. Claude's own log holds both turns, the killed one
at 03:41:57 and the new one at 03:42:05.

The detail I like is where the conversation id comes from. The host makes it
before the build starts and hands it to the machine in the `start` message, so
the reducer never makes anything up and stays pure. The comment on `LaneMsg`
says so: "the host makes both, so the reducer stays pure." When the run came
back, the saved state said `building`, with the id already in it, so the lane
knew which conversation to send the build to.

There's one case the real run didn't reach. If the kill lands before Claude has
saved anything, `--resume` finds no conversation, and the lane falls back to
starting one with `--session-id`. Only the unit tests cover that. And the unit
tests are the part I'd copy. `src/restart.test.ts` kills the lane after every
single step, boots it from what was saved, and checks it ends the same way. tea
saves the state after each step and before that step's commands run, so a kill
leaves the state holding commands whose answers never came. On boot the lane
asks for them again.

**Parks with typed answers.** When the lane needs a person, it parks, and the
park says why, from a closed list. Each cause takes its own kind of answer, and
nothing else. Here is a slice of `ParkAnswers` in `src/lane.ts`:

```ts
/**
 * What a person may answer to each park, and nothing else. An answer that
 * does not fit the park the lane is in leaves it parked.
 */
export interface ParkAnswers {
  readonly contradiction:
    | { readonly kind: "keep"; readonly note: string }
    | { readonly kind: "fix"; readonly result: string }
    | Drop;
  readonly finding_disputed:
    | { readonly kind: "stands"; readonly note: string }
    | { readonly kind: "withdraw" }
    | Drop;
  readonly out_of_attempts: { readonly kind: "more"; readonly attempts: number } | Drop;
  // ...
}
```

The lane has twelve park causes today, and review, triage and ship each have
their own. That sounds like a lot. In practice it means "why is this stuck?" is
a field you read, and "what can I say to it?" is a type you look up. A person
can't answer `withdraw` to a lane that is out of attempts, because that answer
doesn't exist there.
