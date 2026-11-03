# One review a plan, and the cloud host in v1

**Proposed 2026-10-27.** Three changes to the v1 plan
([a ticket runs from the app](./a-ticket-runs-from-the-app.md), PR 131). Each
task gets quick checks only, and the plan gets one review at the end. No
scheduled checks join v1. The lanes and the box move to the cloud host inside
v1, with the laptop as the twin.

```ts
// A sketch. What runs when, for one plan.
//
//   each task     build -> quick checks: typecheck, lint, the task's own tests go red to green -> local commit
//   end of plan   mutation step over the changed lines -> one review of the whole diff -> push -> PR
//
// The lane's `next`, with the per-task review gone. `built` now means every task is in and
// its quick checks passed at its commit.
if (!built(f)) return run("build"); // one task a round, quick checks inside the round
const m = mutated(f);
if (m === "not_yet") return run("mutation");
if (m === "lived") return run("test_writer");
if (!reviewed(f)) return run("review"); // one review, the whole diff, at the head
return run("ship");
```

## 1. One review a plan, quick checks a task

**Today:** [done is per criterion](./done-is-per-criterion.md) reviews each
task as it lands, against its own criteria, then reviews the whole plan once
every task is in. A plan of five tasks gets six reviews. That was decided
2026-10-18, before experiment 107, so it is tested here and not taken on trust.

**What changes:** the test writer now writes each criterion's tests before
build starts ([the test writer](./the-test-writer.md)). So a task's criteria
are already checked by code when its tests go from red to green. A per-task
review mostly checks the same thing again.

```ts
// A sketch. The quick checks a task round runs: a Check move, code only, no agent.
const TaskChecks = Schema.Struct({
	task: TaskId,
	head: Sha, // the task's local commit
	typecheck: Schema.Boolean,
	lint: Schema.Boolean,
	tests: Schema.Struct({red_on_base: Schema.Boolean, green_at_head: Schema.Boolean}), // the task's own
});
const taskChecks = check("task_checks", {input: TaskRef, ok: TaskChecks, err: ["unknown"]});

// The answers, in the five verbs.
// done                         every field true: the round ends and the next task starts
// send:builder:checks_red      one is false: the same task again, with what failed
// stuck:checks_did_not_run     the checks could not run at all: the box with "try again" and "stop"
```

- **The one review reads the whole diff at the head,** after the mutation
  step. It checks the plan's criteria and the tasks', as
  [done is per criterion](./done-is-per-criterion.md) asks: a criterion is met
  when a review saw it at the commit that merges. That rule stays as it is.
- **Its job is what tests cannot see:** design, scope that crept in,
  readability, security. A send back names the tasks it is about, and only
  those go round again.
- **Why:** reviews drop from one per task plus one to one. The reviewer sees the
  whole feature the way a person reads a pull request. Cheap checks run on
  every task, and the costly one runs once.
- **Industry practice:** GitHub reviews a pull request as a whole. Google's
  test system runs the tests a change touches before it lands and the wider
  set after
  ([What Breaks Google, 2023](https://research.google/pubs/what-breaks-google/)).
- **Cost:**
  - A wrong turn in the first task that later tasks build on is found late,
    and the rework costs more.
  - A big diff gets a weaker review. The often cited study of a Cisco team
    found reviewers catch less past about 400 lines at a time
    ([SmartBear](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/));
    the number comes from one team's code and is not a law.
- **A lean on size, 65%:** a plan whose diff passes about 400 changed lines
  splits into two plans. The doubt: the plan stage guesses size before any code
  exists, so the guess may be poor.
- **What would settle it:** slice 11 runs both ways on two or three tickets:
  one review a task, and one review a plan. Count what each review found that
  the tests did not, the dollars of rework, and the minutes. If the per-task
  reviews find real problems the end review misses, this note is wrong.
- **How sure: 70%.**

## 2. No scheduled checks in v1

- **No scheduled review.** The one review a plan already judges the code
  before it is pushed. A scheduled review would read the same code again.
- **Later, not in v1:** a mutation run over the whole repo, and audits. They
  wait until a run shows problems that span many merges.
- **A release canary comes after v1,** once new fabrika builds go out to the
  hosts: a new build goes to one host first, is watched, then goes to the rest.
  Google's SRE workbook calls a canary "a partial and time-limited deployment
  of a change" and its evaluation
  ([Canarying Releases](https://sre.google/workbook/canarying-releases/)).
  That needs more than one host running lanes, so it waits for the cloud host
  ([the cloud is one more host](./the-cloud-is-one-more-host.md)).
- **How sure: 75%.** The doubt: once agents land many pull requests a day,
  problems across several merges may come sooner. The field rows would show it.

## 3. The cloud host is in v1

**Today's plan:** lanes run on the assignee's laptop, and a ticket waits while
that laptop is closed. The cloud host comes after v1. A pipeline that builds
itself while its owners sleep cannot work that way.

**What makes it a deploy, not a rewrite:** every host is the same Durable
Object with a local twin ([the cloud is one more host](./the-cloud-is-one-more-host.md),
draft). The box's login is settled: the box holds it the way GitHub Actions
does, and our Worker never sees a real token
([agents behind one service](./agents-behind-one-service.md),
[programs run in a box](./programs-run-in-a-box.md)).

| Slice | Change |
|---|---|
| 7, the PR watcher | Deploys to the cloud host first. It needs no box, only GitHub reads. |
| new, after 6 | The box on Cloudflare: one container a job, open internet, the login the GitHub Actions way. |
| new, after 4 | Lanes on the cloud host: `lanes` runs there as well, and the claim picks one host. |

- **The laptop stays the twin** for $0 work and for debugging. Tests run there.
- **What experiment 148 showed:** a box made with `@cloudflare/containers` and
  open internet started on Cloudflare in both deploys. The boxes that failed had
  internet turned off, which the box no longer needs.
- **Cost:** container time on Cloudflare, measured in the box slice, and two
  more pull requests.
- **How sure: 75%.** The doubt: 148 started a handful of boxes. Many at once,
  for hours, is untried.

## What would change this

- Slice 11's two-way run finds real problems per-task reviews catch and the end
  review misses: go back to a review per task.
- Boxes on Cloudflare fail to start under load: lanes stay on the laptop for v1.

## What it cannot tell us

- Nothing here is built or run. The review counts and costs are not measured.
- The 400-line figure comes from one study of one team, years ago.
- What boxes on Cloudflare cost for a real lane.
