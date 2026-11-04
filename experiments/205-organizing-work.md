# Where does long-lived work live in our tracker, and where do bugs and follow-ups go?

Read 2026-11-03. **This is reading, not a measurement.** Nothing ran but read-only lists of
today's tracker. It is phase 1 of a guidelines study (steps 1 to 4 of the guidelines skill): the
settled check, one running example, the known way and the three tests. It will feed a note,
"Organizing work", and a Design canvas, "Organizing work guidelines". Neither exists yet. The
designs (step 5) wait for the owner's look at this draft.

**The answer.** The makers agree on a plain shape, and it is close to the lean this study was
handed, with three changes.

- **The shape they agree on:** a ticket has one small fixed **type** (bug, feature, chore). It
  has one long-lived **area** that never ends and names a part of the product, often with an
  owner who routes new work. And it may sit in a bounded **project** that ends. New work comes
  in through an intake inbox before anyone picks a project. Time (cycles) is a separate axis.
  Linear says outright that standing work fits its projects badly, and that it is "looking into
  better ways" [l1]. Kubernetes, a large open project that runs on labels, has exactly
  `area/`, `kind/` and an owning group (`sig/`) [g7]. Fields outside software have the same
  three levels: a ward, an episode of care and a visit [o7] [o8]; a station, a service and an
  order [o13] [k1].
- **The coding-agent tools do not help here.** Copilot, Devin, Factory, Cursor and Codex each
  take one ticket and make one session and one PR [f1] to [f5]. None documents filing its own
  follow-ups. Linear keeps work a machine starts in triage until a person takes it [f6].
- **Change 1: record where a ticket came from, now.** Tickets 186 to 191 were each filed from a
  pull request's review, a mutation step, a lane run or a walk. Today that lives only in prose
  in the body. Who filed is kept; from where is lost as data. Of everything here it is the one
  fact a later fold cannot get back.
- **Change 2: the type clashes with a decided point.** "No ticket-kind label enters the ledger"
  was decided on 2026-10-18 from experiment 88, which is from before experiment 107, and was
  about routing, not about people. The later decision that the tracker is like Linear plans a
  `labeled` fact that no stage reads. A type as a label for people fits both. A type the
  pipeline routes on does not.
- **Change 3: "project" already means two things.** In `next/`, the project is the whole
  ledger's object, one per repository. In the decided notes, a project is a parent plan. One of
  the two needs another word before a tracker in `next/` shows both.
- **Why they float is not only where.** 186 to 191 were filed by an agent and nothing has
  triaged them. An area gives them a home; it does not say whether each is worth doing. That
  is triage's job, and today it is skipped for agent-filed follow-ups.

Today's tracker follows the shape in one way and breaks it in three. It follows it: every
ticket's facts say who wrote them. It breaks it: the area exists, but only as a word typed at
the front of the title (79 of 129 open titles), in about 65 spellings; the type is a title word
too ("Flaky:", "follow-ups"); and v1's project is a title prefix ("v1 slice 9:") with no
parent.

```text
how each tool read groups work, one line each
Linear      team (one per issue) + label groups (Type, Component, one each) + project that ends + Triage inbox
Jira        component (long-lived, a lead, a default assignee, many per issue) + issue type + epic
GitHub      issue type (task, bug, feature) + sub-issues + Projects as views + labels
Kubernetes  area/ + kind/ + sig/ labels; a bot asks for the missing one
Plane       project (long-lived) + module (dated, ends) + required type + Intake
Asana       a project with no end date for ongoing work; goals and portfolios above
Shape Up    no backlog, no area; bugs wait for cool-down or a bet
Agents      Copilot, Devin, Factory, Cursor, Codex: one issue, one session, one PR; none files its own follow-ups
Kanban      a service is the standing unit; type and class of service are separate; a backlog is "options"
CMMS        a request against an asset, approved into a work order; a follow-up order points back at its source
Hospital    a ward is a place, an episode of care is bounded and optional, a visit is one act
Toyota      daily kaizen on the standing line is the norm; a kaizen event is the bounded exception
```

## Which version

- **Today's version:** the tracker program (`programs/tracker`), the ticket facts it shows
  (`packages/pipeline/src/tickets/ticket.ts`) and the writer on each row
  (`packages/fabrika/src/host/writer.ts`). All claims with a `file:line` are about main at
  `eb86cb5a`.
- **`next/`:** its ledger is one log of entries with `by`, `said`, `kind` and a body, in named
  streams (`next/src/data/log.ts` on the branch of PR 223, not on main). It has no tracker yet;
  the tracker is a later tier. So anything this study adds to `next/` is a shape for later, not
  a change to built code.
- **The scope, in one line:** the tracker's data and the tracker program in today's version,
  plus what `next/`'s ledger would hold for the same facts. The chassis, the desk and the
  pipeline's stages stay as they are.

## Step 1: what is settled

### Decided

| Point | Source |
|---|---|
| A project is a parent plan: a success line plus child plans. It closes itself when its children are done and its check passes. | [a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md):47 |
| There are no epics. An epic is a plan with many tasks. | same note, :19 and :30 |
| Milestones leave the loop. A roadmap is a view built from plans. | same note, :49 |
| A tier is a project. | [free-form plan to planner](../docs/direction/free-form-plan-to-planner.md), [tiers](../docs/plan/tiers.md):10 |
| fabrika is project machinery first, with agents attached. | [built for projects](../docs/direction/built-for-projects.md) |
| Triage answers duplicate, decline, accept or escalate. No "later", no snooze, no priority. "Later" is a reopened "no". | [sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md) |
| No ticket-kind label (bug, feature, chore, ...) enters the ledger. From experiment 88, on routing. | same note, :96 |
| Bug urgency has no home in the core; it waits for an on-call pack. | same note, :106 |
| Labels never gate a build. The approved plan is the only go. | same note, "Who approves building" |
| The ledger starts small: priority, types, labels and links wait for a run that needed them. | [the smallest ledger](../docs/direction/smallest-ledger-proof-to-grow.md):16 |
| The tracker is like Linear, and grows toward Linear's model on purpose, "a run is not needed to justify each part". This replaces the smallest ledger's rule for the tracker's own fields. | [the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md):20 |
| Every ticket has an assignee, and the assignee's host runs its lane. | same note, "First piece" |
| A scheduled job never changes code; it files a ticket, as an agent writer. | [scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md):33 |
| A check too long for a pull request runs daily, and what it finds becomes a ticket. | [fast and daily mutation](../docs/direction/fast-and-daily-mutation.md):37 |
| Every fact says who wrote it. | [the ticket is the lane's one view](../docs/direction/the-ticket-is-the-lane-view.md) |
| The project object is the whole ledger in `next/`, one per repository. | [tea-host](../docs/direction/tea-host.md):23, [the cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md):315 |

### Leaned (proposed, not settled)

| Point | Source |
|---|---|
| Each tracker view is its own program (`ticket`, `board`, `list`). | [tracker views are programs](../docs/direction/tracker-views-are-programs.md), proposed 2026-10-28 |
| New facts in order: `linked`, `nested` (a parent, anyone may write it), `moved`, then `assigned`, `related`, and later `labeled`, `prioritized`, `due`. | same note, :48 and :600-619 |
| Priority, labels and project: "a person only, refused at the door". No stage reads them. | same note, :237 |
| No backlog state: "a 'later' pile clashes with sort answers yes or no". | same note, :234 |
| A milestone is a parent with a due date. 60% sure. | same note, :238 |

### Measured before

- [Experiment 60](./60-what-happens-to-filed-follow-ups.md) read 289 follow-ups that merged pull
  requests filed on two repos in today's fabrika: 35% were built (median 9.9 hours), 41.5%
  closed as not planned, 16% sat open at a median 25 days, "the same as any agent-filed issue".
  It is from before experiment 107 and from GitHub issues, not our tracker, but it says what a
  follow-up's life looks like: most are decided within days, and about one in six floats.

### Untouched

- A long-lived grouping of any kind: area, component, team. No note names one.
- A ticket's type for people, as opposed to a type the pipeline routes on.
- Where a ticket came from (`from`). Only `commented` records the live run (`during`,
  `packages/pipeline/src/tickets/ticket.ts:193`). `filed` records title and body only (:183).
- What happens to a follow-up an agent files. Nothing says it goes through triage.

### Open pull requests on the area

None is about grouping work. Two touch it:

- [PR 359](https://github.com/usirin/tea-fabrika/pull/359), ticket 185a: an agent's own ledger
  session, "who did what". It makes "who filed" true for agent writes on a connected home.
- [PR 332](https://github.com/usirin/tea-fabrika/pull/332), program guidelines (proposed): G1,
  one job per program, and G6, programs meet on typed pipes. Step 5's designs are measured
  against it. Ticket 191 came out of its walk.

## What was read

About 40 public pages, read on 2026-11-03, plus today's tracker and its code. Quotes are short
and checked against the page as fetched. A claim found only on a summary or community page is
marked **secondary**. One found nowhere is marked **guess**.

### Trackers

| Tag | What it says | What it teaches |
|---|---|---|
| [l1] Linear, projects | "a clear outcome or planned completion date"; for ongoing work, "consider creating a custom Maintenance project status"; "We're looking into better ways to manage this type of work" | A project ends. Standing work fits it badly, and Linear says so. |
| [l2] Linear, initiatives | "group projects around company objectives" | The long-lived thing above projects groups projects, not issues. A loose bug cannot sit in it. |
| [l3] Linear, teams | "groups of people who work together frequently"; "keeping everyone on one team is the simplest approach" | One team per issue. Areas can be teams, but for two people Linear says one team. |
| [l4] Linear, label groups (changelog; the labels page was 404) | "Internally we've created label groups such as Issue Type, Component, and Integrations"; "only one label from each group may be applied" | Linear's own team models type and area as single-choice label groups. The closest match to "one area at most". A "Type" group with Bug in it is **secondary**. |
| [l5] Linear, triage | "a special inbox for your team"; integration issues "default to Triage status" | New work lands in an inbox before anything else is set. |
| [l6] Linear, triage intelligence | suggests "teams, projects, assignees, and labels"; "can be configured to auto-apply" | An agent proposes the area and the project at intake; a person or a rule takes it. |
| [l7] Linear, sub-issues | "too large to be a single issue but too small to be a project" | A size between a ticket and a project. |
| [l8] Linear, cycles | "time-boxed periods" | Time is its own axis. |
| [l9] Linear, agents | "Delegate an issue to an agent while keeping a human teammate as the assignee" | The agent is a delegate; a person stays accountable. |
| [j1] Jira, components | "group work items in your space around product features, departments, or workstreams" | A native, long-lived area. |
| [j2] Jira, managing components | "The component lead is a Jira user who owns the component"; a default assignee "will override the project's default assignee" | An area has an owner and routes new work. Many per issue, so Jira needs a tiebreak. |
| [j3] Jira, issue types | Bug: "a problem which impairs or prevents the functions of a product"; epics are "bigger pieces of work" | Jira mixes type and level: an epic is a type one level up. |
| [j4] Jira, labels or components (**secondary**, community) | components for stable ownership, labels for free tags | No official page found. |
| [g1] GitHub, issue types | "up to 25 issue types"; defaults task, bug, feature | Type is its own org-wide field, with our three. |
| [g2] GitHub, sub-issues | "up to 100 sub-issues", "up to eight levels" | A parent with children is the bounded plan. No epic type. |
| [g3] GitHub, Projects | "an adaptable table, board, and roadmap" | A Project is a view with fields, not a thing that ends. A single-select field can be the area. |
| [g4] GitHub, iterations | "repeating blocks of time" | Time again its own field. |
| [g6] GitHub, issue forms | sets "The issue type that will be automatically added to issues created with this template" | The intake form sets type and fields at filing. |
| [g7] Kubernetes labels | `kind/bug`: "Categorizes issue or PR as related to a bug."; `area/boskos`: "Issues or PRs related to code in /boskos"; `needs-sig`: "lacks a `sig/foo` label and requires one" | Area, kind and an owning group, as labels. An area can name a folder of code. A bot asks for what is missing. |
| [p1] Plane, modules | "group related work items within a project, such as the work for a feature, release, or campaign" | A module has dates and ends, so it is our project. Plane's project is the long-lived part. |
| [p2] Plane, types | "Every work item in Plane has a type." | Type is required there. |
| [p3] Plane, intake | "accepted to move them to the Project's workflow" | Intake with accept, decline, snooze and duplicate, as Linear's triage. |
| [h1] Height (**secondary**, shut down 2025-09-24) | lists held teams and projects; a task on many lists | No area field. |
| [a1] Asana, hierarchy | "Goals are where you'll track your team's high-level objectives"; "Portfolios give you a bird's-eye view of multiple projects" | Ongoing work is a project with no end date (**secondary** for the "ongoing" part). |
| [s1] Shape Up, bets not backlogs | "Backlogs are a big weight we don't need to carry."; "Really important ideas will come back to you." | No central pile. |
| [s2] Shape Up, cool-down | "There is nothing special about bugs that makes them automatically more important than everything else." | A bug is not a lane of its own. Bugs get the cool-down, a bet, or a yearly bug cycle. No area at all. |

**Who has a native long-lived area:** Jira (components, many per issue), Linear (teams, or its
own single-choice Component label group), Kubernetes (`area/` labels), and a Plane or Asana
project used as a container. Shape Up has none. Plane's modules look like areas but are dated
and bounded: they are our project.

### Coding agents and agent factories

| Tag | What it says | What it teaches |
|---|---|---|
| [f1] GitHub Copilot coding agent | "can only work on one branch at a time and can open one pull request per task"; starts from issues, chat and "failing GitHub Actions runs" | One task, one branch, one PR. A red CI run is a way in, like our daily checks. |
| [f1c] Copilot drafting issues | "Copilot can break a task into a parent issue with sub-issues"; it "maps your prompt to the relevant fields" of an issue form | The only grouping is a parent and its children, drafted with a person. |
| [f2] Devin and Linear | uses "the default skill"; "Only trigger when a ticket reaches a specific status" | One ticket, one session. A label or status picks what runs. |
| [f2b] Devin, bulk planning (Spanish page) | scopes each selected ticket "en paralelo" and posts "un comentario estructurado" on each | It plans tickets that exist. It writes comments, not new tickets. |
| [f2c] Devin, MCP | can "bulk create Linear tickets" | Filing is a general tool, not a flow. |
| [f3] Factory and Linear | "Droid receives the issue title, description, labels, and comments"; it moves the issue "into a started state" and attaches PR links | The agent updates the ticket it was given. "Create issues" appears only on a marketing page (**secondary**). |
| [f4] Cursor cloud agents and Linear | labels on "issues or projects to specify which repository the Cloud Agent should work on" | A project or label is used only to route to a repository. |
| [f5] OpenAI Codex and Linear | "Linear assigns new issues that enter triage to Codex automatically" | The triage inbox can hand work to an agent. |
| [f6] Linear, agent best practices | "If an automation has delegated to an agent, keep it in triage state and leave assignment up to a human actor" | Machine-made work stays in triage until a person takes it. |

**What they do, in short.** Every tool takes one ticket and makes one session and one PR. They
group nothing beyond a Linear project or label, used to pick a repository or a playbook. None
documents filing its own follow-ups or bugs. Linear's answer for work a machine starts is the
triage inbox and a person's accept [f6]. So a software factory that files its own follow-ups,
as ours does (186 to 191, and the daily checks to come), is past what these tools document.
Where the follow-ups go is ours to design.

### Thinkers

| Tag | What it says | What it teaches |
|---|---|---|
| [k1] Kanban Method glossary | "Some people may refer to this as a backlog, but in the Kanban Method we prefer to call the things that may have value as options"; it "frequently results in discarding many of the options"; work item types include "incidents, software bugs, product features, whole products, or projects" | The standing unit is a service. Type and class of service (expedite, fixed date, standard, intangible) are two fields. A project is one type, not a container. |
| [k2] Kanban guide | "Customer requests flow through this network of services." | An organization is a network of long-lived services, each with its own rules. |
| [k3] DJAA blog | "An 'expedite' class of service means that you are already late." | Urgency in plain words. Our triage has no urgency, by decision. |
| [k4] DORA, small batches | "individual features take no more than a few days to develop" | Small tickets, one PR each. Nothing on grouping or backlogs. |
| [k5] Stale bot study (Khatoonabadi et al. 2023) | "can help deal with a backlog of unresolved PRs" but "a considerable decrease in their number of active contributors" | Closing old items by clock shrinks the pile and costs people. It studies PRs, not issues. |
| [k6] Blog, "Backlogs are useless" | "Backlogs never shrink."; "Do not maintain a backlog unless it's the backlog for your next few weeks of work." | A short horizon, deleted often. |

### Outside software

| Tag | What it says | What it teaches |
|---|---|---|
| [o1] UpKeep (CMMS) | "A work request is submitted by your staff or customers to request that work be performed on an asset"; "A work order ... is an authorization from your maintenance planner" | Intake in two steps: anyone files a request, a planner approves an order. Our triage then plan. |
| [o2] MaintainX | "a work request must first be approved"; "the request should indicate the specific plant or area that needs maintenance" | The area is named at filing, by the filer. |
| [o3] IBM Maximo | corrective "is created only after a fault"; preventive "follows a predefined schedule" | Corrective or preventive is a type, set apart from the asset. Our bug, and our daily checks. |
| [o4] Maximo follow-up orders (**secondary**, an expert blog) | creates "a follow-up work order or a linked service request", with rules that "copy some attributes from the source object" | The closest outside match to tickets 186 to 191: a follow-up points back at the job it came from and takes its asset. |
| [o5] EN 13306 (**secondary**, quoted by a vendor) | corrective maintenance "not immediately carried out after a fault detection but is delayed in accordance with given rules" | A bug that waits is normal when a rule covers the wait. |
| [o6] ISO 14224 (**secondary**) | a nine-level tree, reporting at one level | Pick one level for areas. Too deep a tree goes stale. |
| [o7] HL7 FHIR EpisodeOfCare | "the container that can link a series of Encounters together for problems/issues"; status "planned \| waitlist \| active \| onhold \| finished \| cancelled \| entered-in-error" | A bounded responsibility for one problem, with an owner and an end: our project. |
| [o8] HL7 FHIR Encounter | locations by "bed/ward/room/etc."; an encounter is "a part of a specific episode(s) of care" when it is | A ward is a standing place, an episode is bounded and optional, a visit is one act. Area, project, ticket. |
| [o9] ESI triage (**secondary**) | "stratification of patients into five groups" by urgency and resources | Triage at the door with a short fixed set of questions. Level is not ward. |
| [o10] Toyota, andon | "A visual aid that highlights where action is required"; the issues "are analysed as part of Toyota's programme of continual improvement" | Anyone raises the signal on the standing line; the counts feed later work. |
| [o11] Lean Enterprise Institute, kaizen events | "Kaizen's true north is really predominately daily kaizen" | The bounded event is the exception; small daily fixes on the standing line are the norm. |
| [o12] Kaizen newspaper (**secondary**, a lean training site) | an "action list format" posted "so that management will read it daily" | Each problem on the line gets a who and a when. A 30-day close rule is **secondary**. |
| [o13] Le Cordon Bleu, the brigade | "A chef de partie will be in charge of one particular station." | A station is a standing area with one owner; an order flows across stations. |
| [e1] Erlang/OTP, supervisor | "A `permanent` child process is always restarted"; "A `transient` child process is restarted only if it terminates abnormally" | The area and project split, in OTP's words. |

**What carries over.** Every field has the same three levels: a standing place (asset, ward,
station, Kanban service), a bounded responsibility (episode of care, kaizen event), and one act
(work order, visit, plate). The bounded level is optional in all of them. Type is separate from
place and from urgency. A follow-up found mid-job points back at its source and takes its
place [o4].

**What does not carry over.** An asset or a ward is physical and fixed; a part of the code
merges and splits, so an area list must be cheap to change. Preventive work runs on a calendar;
ours is closest to scheduled jobs. A hospital must see every patient; we may throw most options
away [k1]. A line has a steady beat; our work does not.

### The plain way they agree on

1. **Type is one small fixed field, one per ticket, with bug in it** [g1] [j3] [p2] [l4] [g7].
2. **A project ends; standing work sits somewhere else** [l1] [j3] [p1]. Linear admits the gap
   [l1]; Jira, Kubernetes and Linear's own team fill it with a component or area [j1] [g7] [l4].
3. **The long-lived area has an owner and routes intake** [j2] [l3] [l5] [g7]. A station has one chef de partie [o13]; a request names
   its area at filing [o2].
4. **New work, bugs first, comes through an inbox before a project is picked** [l5] [p3] [g6].
   Shape Up goes further: bugs are not special, and no pile is kept [s1] [s2].
5. **Time and breakdown are their own axes** [l7] [l8] [g2] [g4]. None of them is the area.

**Where it clashes with a goal of ours:** point 4's inbox is a backlog by another name, and
[sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md) has no "later". The way
through is that triage must still answer each ticket; the area only says where it sits while it
waits for its lane.

## Today's tracker: the running example

### What today has, and where

| What | Today | Where |
|---|---|---|
| A ticket | title, body, open or closed, its timeline of facts | `packages/pipeline/src/tickets/ticket.ts:496-501` |
| What a filing records | title and body, nothing else | `ticket.ts:183` |
| Who wrote each fact | a user, or an agent for a user | `ticket.ts:481-489`, `packages/fabrika/src/host/writer.ts:26-33` |
| Which run was live | only on a comment, `during` | `ticket.ts:193` |
| Writes a person makes | file, comment, close, reopen, answer, rate a duplicate | `programs/tracker/src/ticket.ts:63-70` |
| How the list filters | open, closed or all, and a title search | `programs/tracker/src/machine.ts:116`, `:436-450` |
| A parent, a label, a type, an area | none | the `Fact` union, `ticket.ts:439` |

### The tickets, as they are

Read with the tracker's own list and one-ticket read, on 2026-11-03. 129 tickets are open.

| Ticket | What | Came from (prose only) | Title word doing an area's job |
|---|---|---|---|
| 117 | the map takes a ticket on a pipe; the first ticket through the pipeline | a person's idea | `tracker \| ticket \| map:` |
| 141 | `runs` goes, `trace` becomes the ticket's view; holds 84, 86 and 126 by hand | seen live on 117's first run | `runs:` |
| 185 | an agent drives the app; plan approved, split by hand into 185a and 185b | follows 181 | `host:` |
| 186 | lane check worktrees: sweep, install, tests | the mutation step and review of PR 357 | `Lane check worktrees:` |
| 187 | agent host reads: README, `KeptLines`, tests | the mutation step and review of PR 352 | `Agent host reads:` |
| 188 | the mutation sandbox links `node_modules` to the real tree | PR 352's mutation step | `Mutation runner:` |
| 189 | `job` reads an unsettled job as no job | PR 352's review | `job tool:` |
| 190 | lane checks fail when the path has a space | 117's lane 6, red at `exam_review` | none |
| 191 | desk settings, to try both ways | the walk of PR 332 | `Desk settings:` |

What this shows:

- **The area is already there, as a title word.** 79 of 129 open titles start with a word and a
  colon. The same part is spelled many ways: `Lane:`, `Lane tests:`, `Lane check worktrees:`,
  `pipeline:`, `Mutation step:` and `Mutation runner:` are all the pipeline. Nothing can filter
  on them, since the list only searches titles (`machine.ts:430-434`).
- **The project is a title word too.** Fourteen open tickets read `v1 slice N:`. No parent
  holds them, since `nested` is not built.
- **Where it came from is prose.** 186 to 189 name a PR and a step, 190 names a lane run, 191 a
  walk. A question like "how many follow-ups did reviews file, and how many got done?" needs a
  person or an agent to read every body.
- **Who filed is kept, and is sometimes wrong.** 186 to 191 read `agent:claude` for a person.
  But on 117 the lane's own facts (`started`, `planned`, `ended`) read as `user`, since the host
  wrote them under the person's session. PR 359 is the fix in flight.
- **Folds happen by hand.** 141 says "Carries #126 too, closed into this one", and 185 split
  itself into 185a and 185b in a comment. Triage does not fold
  ([decided 2026-10-24](../docs/direction/sort-answers-yes-or-no.md)), so people and agents do
  it in prose.
- **Done is not read back.** 181 and 184 are still open, though PRs 352 and 357 merged. That is
  [what a ticket shows](../docs/direction/what-a-ticket-shows.md)'s rule not reaching
  hand-run tickets, not a grouping problem, but it makes every grouped view look fuller than it
  is.

### The same tickets under each shape

```text
shape A, today: flat, a word in the title
  #186 "Lane check worktrees: ..."     #188 "Mutation runner: ..."     #190 "Lane checks fail ..."

shape B, the lean: area + project + type
  area pipeline      186 chore, 188 bug, 190 bug        (from PR 357, PR 352, lane 117/6)
  area agent access  185 project: 185a, 185b; 187 chore (from PR 352)
  area host          189 bug                             (from PR 352)
  area desk          191 idea                            (from the PR 332 walk)
  area windows       141 bug that grew; 117 feature      (117 is a one-task plan, no project)

shape C, Linear's team per area (one team per ticket, its own triage inbox)
  team pipeline: 186 188 190     team host: 185 187 189     team desk: 191     team windows: 117 141
  two people, five inboxes, five workflows: Linear's own docs say one team [l3]

shape D, area as a place in the code (an asset, as a CMMS keeps one)
  packages/pipeline/src/lane/**   186 190     experiments/lib + mutation runner  188
  apps/fabrika host, door         185 187 189 desk                               191
  the area is folded from the plan's pointers, then the PR's files; a filer's guess can start it
```

Under shape B, every one of the nine has an area, three are bugs, and only 185 is a project.
The six loose follow-ups fall into two areas. Under shape D, 191 and 117 have no files yet, so
only the filer's guess or the planner can place them.

## Step 4: the leans tested three ways

The lean handed to this study: an optional **area** (one at most, never ends), a bounded
**project** (a parent plan), and a **type** (bug, idea, chore). Each part, then the data rule.

### Area

- **Linear as the builder, on our pieces.** Linear's own team used a single-choice Component
  group [l4]. Built as fabrika programs: the `list` view (today's `tracker`) takes `--area`, as
  it takes `--show`; `ticket` shows the area in its properties; a small `areas` program could
  own the list of areas, their owner and their count, and pipe one into `list`. The piece every
  program gets for free is the area's name as a typed value on the pipe, so `trace` or `board`
  can filter the same way. Linear would not make areas teams for two people [l3]. Where we
  differ: Linear has no "area" word and two answers (team or label group); we would have one.
- **Elm or OTP.** In Elm, the area is a field of the ticket's model, set by one Msg, and a
  view is a fold that groups by it. In OTP, the split is the supervisor's restart value: "A
  `permanent` child process is always restarted", and "A `transient` child process is restarted
  only if it terminates abnormally" [e1]. An area is permanent: it is never done. A project
  is transient: it ends normally once, and only a failure brings it back.
- **Accessibility.** An area shown as a colored chip must also show its name (WCAG 1.4.1, use
  of color). A list grouped by area needs real group headings, so a screen reader can jump
  between them (1.3.1, info and relationships). Setting it must work from the keyboard (2.1.1).
  A real screen reader run is needed for the grouped list.
- **The word.** `area` is Kubernetes' word [g7] and plain. `component` is Jira's and Linear's
  internal word [j1] [l4], but here it means a UI part, such as a React component (about 30 uses under
  `docs/direction/`). `area` is used once here, as a page message for a workspace's size
  (`fold-not-tabs.md:176`), a small clash. Lean: `area`, 70%.
- **Holds, with one add.** The makers give an area an owner who routes intake [j2] [l5] [g7].
  For two people, the owner is the default assignee, and the assignee's host runs the lane
  ([the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md)). So an area
  can say who gets its new tickets. That is a lean to test in step 5, not a rule.

### Project

- **Holds as decided.** A bounded parent plan is what Linear, Jira, GitHub and Plane all call
  the ending thing [l1] [j3] [g2] [p1]. Our decided shape needs `nested` to exist first; it is
  proposed and not built (`tracker-views-are-programs.md`, step 5 of its order).
- **Linear as the builder.** `ticket --ticket 185` shows its children and "1 of 2 done";
  `board --under 185` shows them by column. Both are already in the proposed tracker views.
- **Elm or OTP.** The parent plan folds its children's states, as a parent steps its children.
  It closes itself only by its success check, a supervisor whose children all exited normally.
- **The word clash.** In `next/`, "the project object" is the repository's whole ledger
  ([tea-host](../docs/direction/tea-host.md):23). Linear's word for that level is a workspace or
  a team. A `next/` tracker showing "project" for both breaks
  [use the industry's names](../docs/direction/use-the-industrys-names.md)'s one-meaning rule.
  No lean: the owner picks which side gets a new word.

### Type

- **Holds for people, not for the pipeline.** Every maker has it [g1] [j3] [p2] [l4] [g7]. But
  it clashes with "no ticket-kind label enters the ledger"
  ([sort answers](../docs/direction/sort-answers-yes-or-no.md):96). That decision came from
  experiment 88, which measured whether triage needs a kind label to route (it did not). It is
  from before experiment 107, so by AGENTS.md it is not trusted without a test, and it never
  asked whether a person needs one to scan the list. The later tracker decision plans a
  `labeled` fact that no stage reads. So a type is a single-choice label for people, as Linear
  does it, and no stage branches on it. 65% sure. A replay of 88 that also asks "would a type
  have changed the route?" on our own 129 tickets would lift it.
- **The values.** The lean says bug, idea, chore. GitHub's defaults are task, bug, feature [g1];
  Kubernetes uses bug, feature, cleanup [g7]. "Idea" is not a maker's type: an idea that is not
  accepted is a declined or not-yet-triaged ticket. Lean: bug, feature, chore, 60%.
- **The key.** It cannot be `type`: that word is the fact's tag in today's code, and `kind` is
  the tag on ledger entries in `next/`'s log until ticket 32 renames it. A label group named
  "type" on a `labeled` fact avoids both.
- **Who may set it.** The proposed tracker views say labels are a person's only, refused at
  the door (`tracker-views-are-programs.md`:237). But the agent is the filer of 186 to 191. If
  only a person may set area and type, every agent-filed ticket waits for a person to sort it.
  Linear's answer is an agent's suggestion a person accepts [l6]. No lean: the owner picks.
- **Accessibility.** A bug must not be red only (1.4.1).

### The data rule: what is lost forever if not recorded now

| Fact | Today | Lost if not written at filing? | Lean |
|---|---|---|---|
| Who filed it | kept on every row (`ticket.ts:481-489`) | no, kept; on a connected home it can name the person for an agent (PR 359) | keep; PR 359 fixes the wrong case |
| Where it came from: which PR, review, mutation step, lane run, job or walk | prose only | **yes.** Only the filer knows it at the moment of filing. A later reader must parse prose, and some bodies will not say. | record now, as a key on `filed`, 85% |
| Which commit a bug was seen on | prose, when the filer bothers (190 does) | **yes** for that ticket | record with `from` when it is a run, 70% |
| Area | a title word | no: it can be set later, by a person, by triage, or folded from the PR's files. Only the filer's first guess is lost. | optional, can come later, 70% |
| Type | a title word | mostly no: a person or triage can set it later | a label for people, 65% |

`from` is the industry's short word for origin, and it keeps the meaning it already has here:
a plan's story says which ticket it came from with `from`
([experiment 105](./105-the-plan-lane-dry-run.md)). A sketch, today's shapes:

```ts
// A sketch, not built. A filing says where it came from, as a comment says which run was live.
{type: "filed", title: "Mutation runner: sandbox links node_modules ...", body: "...",
 from: {_tag: "pr", url: "https://github.com/usirin/tea-fabrika/pull/352", step: "mutation"}}
{type: "filed", title: "Lane checks fail when the repo path has a space", body: "...",
 from: {_tag: "run", ticket: 117, run: "lane 6", head: "<sha>"}}
{type: "filed", title: "Desk settings: ...", body: "...", from: {_tag: "walk", pr: 332}}
// Missing `from`: a person filed it from nothing, or it was filed before the key.
```

## Four directions for step 5

Each starts with its pipe line. None is built; the owner picks which to build and shoot.

1. **Area and type as single-choice labels (Linear's own team).**
   `tracker --area pipeline --type bug | ticket`. A `labeled` fact with two groups; the list
   filters and groups by them.
2. **Area as an owned inbox that routes (Jira's component lead, Linear's team triage).**
   `triage --area pipeline | ticket`. Each area has an owner, who gets its new tickets; the
   triage view shows one area's untriaged tickets, so 186 to 191 never float unseen.
3. **Area as a place in the code (a CMMS asset, Kubernetes' `area/boskos`).**
   `areas | tracker | ticket`. An `areas` program reads the areas and their folders from the
   repo; a ticket's area is folded from its plan's pointers and its PR's files, with the
   filer's guess first.
4. **No area field: origin and saved views (Shape Up, the smallest ledger).**
   `tracker --from pr:352 | ticket`. Only `from` is added. Areas stay title words, and a saved
   view on a person's desk groups by them.

## What this tells us for fabrika

- The lean holds in shape: area, project, type is what the makers agree on [l4] [j1] [g7].
- Add `from` to a filing first. It is the only fact here that is lost forever, and it is
  cheap: one optional key, written by the code or the agent that files.
- Make type a label for people that no stage reads, unless a replay of experiment 88 on our
  tickets says the pipeline needs it.
- Give "project" one meaning before a `next/` tracker shows it.
- Make every agent-filed ticket go through triage, or the area only gives the pile a name.
  Maintenance does this with request then order [o1] [o2]; Linear keeps machine-made work in
  triage [f6].
- A follow-up should take its source's area, as a Maximo follow-up order copies its asset
  [o4]. With `from` recorded, that is a fold, not a field someone types.
- Keep areas few. A small kitchen merges stations (**secondary**, [o13]); ISO 14224 picks one
  level (**secondary**, [o6]).

## What it cannot tell us

- **Whether two people need areas at all.** Linear tells a small company to use one team [l3],
  and Shape Up keeps no backlog [s1]. Nobody has tried a week of areas on our tracker. A week of
  shape B on the 129 open tickets would show whether the owner filters by area.
- **Which areas.** The title words suggest about six (pipeline, host, desk, windows, agent
  access, tracker), but that list is a guess from one read of the open titles.
- **Whether an area folded from paths fits.** 191 and 117 have no files at filing. How often a
  ticket's area changes between filing and merge is unmeasured.
- **Whether a type changes anything a person does.** No data.
- **What Linear's labels and bug guide pages say today.** Both were 404 when fetched; the Type
  and Bug group details are **secondary**.
- **How other software factories file their own follow-ups.** No coding agent's docs say it
  does [f1] to [f6]. Factory's "create issues" is a marketing line (**secondary**). So there is
  no maker to copy for tickets an agent files from a review.
- **Primary text for the standards.** EN 13306, ISO 14224 and the ESI handbook were read only
  through summaries.
- **What the closed tickets look like.** The list read shows open tickets only, so 62 closed
  ones were not counted.

## Dollars

$0. Reading only: public pages, today's code, and read-only lists of today's tracker. No model
call, no Jev, no test run.

## Links

Trackers:

- [l1] https://linear.app/docs/projects
- [l2] https://linear.app/docs/initiatives
- [l3] https://linear.app/docs/teams
- [l4] https://linear.app/changelog/2022-11-10-label-groups
- [l5] https://linear.app/docs/triage
- [l6] https://linear.app/docs/triage-intelligence
- [l7] https://linear.app/docs/parent-and-sub-issues
- [l8] https://linear.app/docs/use-cycles
- [l9] https://linear.app/docs/agents-in-linear
- [j1] https://support.atlassian.com/jira-software-cloud/docs/what-are-jira-components/
- [j2] https://confluence.atlassian.com/adminjiraserver/managing-components-938847187.html
- [j3] https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/
- [j4] https://community.atlassian.com/forums/Jira-questions/When-to-use-labels-and-components/qaq-p/2850813
- [g1] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization
- [g2] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
- [g3] https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- [g4] https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-iteration-fields
- [g6] https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
- [g7] https://github.com/kubernetes/test-infra/blob/master/label_sync/labels.md
- [p1] https://docs.plane.so/core-concepts/modules
- [p2] https://docs.plane.so/core-concepts/issues/issue-types
- [p3] https://docs.plane.so/core-concepts/intake
- [h1] https://intercom.help/height/en/articles/4730716-how-to-track-projects-on-more-than-one-list
- [a1] https://help.asana.com/s/article/asana-hierarchy
- [s1] https://basecamp.com/shapeup/2.1-chapter-07
- [s2] https://basecamp.com/shapeup/2.2-chapter-08

Coding agents:

- [f1] https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- [f1c] https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-to-create-or-update-issues
- [f2] https://docs.devin.ai/integrations/linear
- [f2b] https://docs.devin.ai/es/use-cases/gallery/bulk-plan-backlog
- [f2c] https://docs.devin.ai/work-with-devin/mcp.md
- [f3] https://docs.factory.com/integrations/linear
- [f4] https://cursor.com/docs/integrations/linear
- [f5] https://learn.chatgpt.com/docs/third-party/linear
- [f6] https://linear.app/developers/agent-best-practices

Thinkers:

- [k1] https://kanban.university/wp-content/uploads/2023/04/The-Official-Kanban-Guide_Glossary.pdf
- [k2] https://kanban.university/kanban-guide/
- [k3] https://djaa.com/?p=13483
- [k4] https://dora.dev/capabilities/working-in-small-batches/
- [k5] https://arxiv.org/abs/2305.18150
- [k6] https://www.lucasfcosta.com/blog/backlogs-are-useless

Outside software:

- [o1] https://upkeep.com/learning/whats-the-difference-between-a-maintenance-work-request-and-a-work-order/
- [o2] https://www.getmaintainx.com/learning-center/work-request/
- [o3] https://www.ibm.com/support/pages/difference-between-corrective-and-preventive-maintenance-work-orders
- [o4] https://bportaluri.com/2024/03/how-to-create-follow-up-work-order-with-script.html
- [o5] https://maintmaster.com/maintenance-manual/corrective-maintenance
- [o6] ISO 14224, from search summaries only; no page fetched
- [o7] https://hl7.org/fhir/R4/episodeofcare.html
- [o8] https://hl7.org/fhir/R4/encounter.html
- [o9] ESI, from search summaries of the agency's text; its archive page came back empty
- [o10] https://mag.toyota.co.uk/andon-toyota-production-system/
- [o11] https://www.lean.org/the-lean-post/articles/kaizen-event-malpractice-and-what-to-do-about-it/
- [o12] https://blog.gembaacademy.com/?p=11247
- [o13] https://cordonbleu.edu/news/what-is-the-kitchen-brigade-system/en
- [e1] https://www.erlang.org/doc/apps/stdlib/supervisor.html
