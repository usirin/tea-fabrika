---
date: "2026-11-03, designs 2026-11-04"
scripts: "`205-organizing-work/designs.patch` (the four designs, on today's app at `d60a005e`, never pushed), `205-organizing-work/round-3.patch` (rounds 1 to 3, on top), `205-organizing-work/shots/` (today and four designs light, round 3 dark with `presses.json`)"
summary: "Today's version; reading plus four designs and three rounds shot on Electron, not a measurement. Phase 2: B1 groups by area, B2 adds an `areas` program, B3 narrows with a flag, a chip, `f` and view tabs, C saves title searches. B3 won (the owner's pick), with B1's grouping as a Display option; C's view found 28 by title words where the area found 21, and B2 cost a tile at 2x2. Three rounds fixed B3's area word said 21 times, its hover-only \"why\", and a wrapping keys line. Call 5 then made an area a person's data on the ledger, never read from folders, and a ticket's area a guess until a person picks. Linear's \"no labels\" filter takes several presses, against a draft that said one. Feeds [areas](../docs/direction/areas.md), proposed. Phase 1, reading only: About 40 public pages: Linear, Jira, GitHub, Kubernetes' labels, Plane, Asana, Shape Up, five coding-agent tools, Kanban, DORA, a stale-bot study, CMMS, HL7 FHIR, Toyota and a kitchen brigade. They agree on one small type per ticket, one long-lived area with an owner, a bounded project that is optional, and an intake inbox first; Linear admits standing work fits its projects badly. No coding-agent tool documents filing its own follow-ups. Today's tracker keeps the area as a title word (79 of 129 open titles, about 65 spellings) and where a ticket came from only in prose. Leans: record `from` on a filing now, 85%; an optional area, 70%; type as a label no stage reads, 65%, which clashes with \"no ticket-kind label\" (experiment 88, from before 107). \"Project\" means two things across today's notes and `next/`. Four directions for step 5. $0."
---

# Where does long-lived work live in our tracker, and where do bugs and follow-ups go?

Read 2026-11-03; designs built and shot 2026-11-03 and 2026-11-04. **This is reading, plus four
designs and three rounds built on a local branch of today's app and shot on Electron. It is not a
measurement.** Phase 1 (steps 1 to 4 of the guidelines skill) is the reading below. Phase 2 (step
5) is [the designs](#step-5-four-designs-then-three-rounds). It feeds the note
[areas](../docs/direction/areas.md) and a Design canvas, "Area guidelines", which is not published
yet.

**The owner's picks, 2026-11-03,** after the walk's steps 1 to 4: record `from` now, and keep
tickets without a type label for now ([a ticket says where it came from](../docs/direction/a-ticket-says-where-it-came-from.md)).
Area and project wait for step 5.

**The owner's picks after step 5:**

- **2026-11-03:** design B3 is the default (narrow the list by an `--area` flag, a filter chip, the
  `f` menu and view tabs), with B1's grouping kept as a Display option inside it.
- **2026-11-04, call 5:** an area is data in the project's ledger, made, renamed and merged in the
  app or tsh, as Linear labels or Jira components are. It is never a list in the program and
  never read from folders. The app suggests areas (from folders, pull request files, past tickets)
  but never sets one, and picking the first areas is a step of the tracker's onboarding. Which
  area a ticket is in stays a guess, shown as a guess, and a person's pick wins.
- **2026-11-04:** ship round 3, with call 5 and [two fixes](#two-fixes-found-in-the-walk).
- Project is untouched by the designs. It stays as decided, a parent plan that ends, and the
  glossary settled the word on 2026-11-03: a project ends, an area does not.

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
- **Phase 2: one filter with three doors won.** Four designs ran in today's tracker, each from its
  own tsh line: B1 groups the list by area, B2 adds an `areas` program on a pipe, B3 narrows the
  list with a flag, a chip, the `f` menu and view tabs, and C keeps no area and saves title
  searches. B3 won: it is the closest to Linear's filters and view tabs, and it keeps the tracker
  to one job. Three rounds then fixed what B3 broke: the area word said 21 times under its own
  view, the "how we know it" in a hover title only, a keys line that wrapped.
- **Call 5 moved where an area is defined.** The designs worked areas out from a fixed list of
  folders in the program. The owner's call 5 made an area a person's data on the ledger, as
  Linear's labels and Jira's components are. Jira shows the shape for a merge: deleting a
  component in use offers to "select any other active component to substitute the one you're
  deleting" [j2]. A ticket's area is then a guess (the filer's, or its source's) until a person
  picks, as Linear's triage suggestions are accepted or declined [l6].

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
Linear UI   filters by F or a menu; grouping and shown properties are Display options; views save filters
Jira admin  a component is renamed in place; deleting one in use substitutes another or clears it
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
| fabrika is project machinery first, with agents attached. | [built for projects](../.decisions/0223-built-for-projects.md) |
| Triage answers duplicate, decline, accept or escalate. No "later", no snooze, no priority. "Later" is a reopened "no". | [sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md) |
| No ticket-kind label (bug, feature, chore, ...) enters the ledger. From experiment 88, on routing. | same note, :96 |
| Bug urgency has no home in the core; it waits for an on-call pack. | same note, :106 |
| Labels never gate a build. The approved plan is the only go. | same note, "Who approves building" |
| The ledger starts small: priority, types, labels and links wait for a run that needed them. | [the smallest ledger](../docs/direction/smallest-ledger-proof-to-grow.md):16 |
| The tracker is like Linear, and grows toward Linear's model on purpose, "a run is not needed to justify each part". This replaces the smallest ledger's rule for the tracker's own fields. | [0346](../.decisions/0346-the-tracker-is-built-like-linear.md) |
| Every ticket has an assignee, and the assignee's host runs its lane. | same note, "First piece" |
| A scheduled job never changes code; it files a ticket, as an agent writer. | [scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md):33 |
| A check too long for a pull request runs daily, and what it finds becomes a ticket. | [fast and daily mutation](../docs/direction/fast-and-daily-mutation.md):37 |
| Every fact says who wrote it. | [the ticket is the lane's one view](../docs/direction/the-ticket-is-the-lane-view.md) |
| The project object is the whole ledger in `next/`, one per repository. | tea-host:23, [the cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md):315 |

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
| [l10] Linear, filters (read 2026-11-04) | "Open the filter menu or type `F` shortcut to choose the criteria you want to apply."; "To filter for no labels, you'll have to select all labels and then switch the operator to does not include." | A filter has a key and a menu. "No label" is not one press in Linear: our "No area yet" goes past it. |
| [l11] Linear, display options (read 2026-11-04) | "No grouping removes all categorization and is especially useful when applying ordering and filters."; "Choose what issue properties are displayed on individual issues on lists or the board." | Grouping and which properties a row shows are display choices of one list, not other screens. |
| [l6b] Linear, triage intelligence (read again 2026-11-04) | "Accept, decline, or view more information about why a suggestion was made before making a decision." | A suggestion says why, and a person takes it or not. It does not say how a suggestion looks beside a set value. |
| [j1] Jira, components | "group work items in your space around product features, departments, or workstreams" | A native, long-lived area. |
| [j2] Jira, managing components | "The component lead is a Jira user who owns the component"; a default assignee "will override the project's default assignee"; read again 2026-11-04: "You can change the component's name, lead, description, and default assignee."; on delete, "select any other active component to substitute the one you're deleting in the issues", or "remove the component you're deleting from all issues that have it" | An area has an owner and routes new work. Many per issue, so Jira needs a tiebreak. A rename is an edit in place, and a merge is a delete that substitutes. |
| [g8] Kubernetes `label_sync` README (read 2026-11-04) | for a renamed label, "previous labels should be migrated to it"; a retired label "will be deleted after" a date | Even a labels-as-code setup keeps the old name and moves its items, rather than losing them. |
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
  ([the tracker is like Linear](../.decisions/0346-the-tracker-is-built-like-linear.md)). So an area
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
  (tea-host:23). Linear's word for that level is a workspace or
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

## Step 5: four designs, then three rounds

Today's version. Built on a local branch of `programs/tracker`, `programs/ticket` and
`apps/fabrika` at `d60a005e`, never pushed. Kept as two patches in `205-organizing-work/`:
`designs.patch` (the four designs, on `d60a005e`) and `round-3.patch` (rounds 1 to 3 of B3, on top
of the first). Both apply in that order. The shots are in `205-organizing-work/shots/`: today, B1,
B2, B3 and C in the light look, and round 3 in dark (`r3-dark/`, with `presses.json`: which press
reached which state, at which size). Rounds 1 and 2, round 3's light shots, and the saved page of
each state stay outside the repo.

The designs' working shape, before call 5: one area per ticket, worked out from the code. Its own
pull request's files said it first, then the filer's guess, then its source's area through `from`.
The 14 areas came from a fixed list of top folders in the program (`FOLDERS` and `AREAS` in the
patch). Call 5 replaced that shape; [areas](../docs/direction/areas.md) has the new one.

| Design | Its tsh line | Closest Linear screen | Why it lost, or won |
|---|---|---|---|
| Today | `tracker \| ticket` | none: a title search | A title search misses 18 of the 21 tickets B3 counts as pipeline, and finds one that is not (on the made-up guesses). No filter, no "no area". |
| B1 | `tracker --group area \| ticket` | Display options, grouping [l11] | Grouping is a display choice, not a way to narrow: a pipe cannot say "only pipeline". 13 groups is a long walk by keyboard. Kept as a Display option. |
| B2 | `areas \| tracker \| ticket` | a view's side panel with counts | A whole tile for 13 words. At 2x2 and at 1024x700 it squeezes the ticket; its 2x2 shot needs three program tiles plus a shell. |
| B3 | `tracker --area pipeline \| ticket` | filters [l10] and view tabs | **Won.** One filter with three doors, and the tracker keeps one job. As built it said "Pipeline" on 21 rows under the Pipeline view, and kept "how we know it" in a hover title only (WCAG 2.1.1). |
| C | `tracker --saved pipeline \| ticket` | a saved custom view | Title words, not areas: its Pipeline view finds 28 where the area finds 21, and nobody can check a word match. Its tabs live on, over B3, as saved filters. |

### The rounds on B3

- **Round 1:** a row drops the area word when the view names the area. The Filter and Display
  buttons are menu buttons with arrow keys, as the ARIA authoring practices give them. "How we know
  it" moved from a hover title into the row's accessible name, and into words on the ticket.
  Still off: on All open (134 rows) the view tabs, the filter row and the keys line scrolled away;
  "Area" alone in the Display menu was unclear; a focused group heading drew a ring box inside the
  list, a box in a box.
- **Round 2:** the tabs, the filter row and the keys line stay put on a long list. The Display item
  says "Group by area", with "Fold all" and "Unfold all" under it and their keys (Opt+Left,
  Opt+Right). A focused heading takes the row fill, no ring. Still off: in a half-width tile the
  keys line wrapped to two lines.
- **Round 3:** the keys line never wraps. Under 680px the fold-all hint goes (the Display menu still
  shows it), and under 560px the view hint goes. This is the round the owner said yes to.

### What still looks off in round 3

- The tab "Pipeline" and the chip "Area is pipeline" say the same thing. Kept on purpose: a view
  shows the filter it stands for (the note's A7).
- Zoom (`C-b z`) rebuilds the window and drops the picked row and the folds, in every design.
  Tracker ticket 197; not fixed here.
- A row's "how we know it" reaches only a screen reader. No screen reader has run.
- Once focus leaves the list, nothing marks which row's ticket the ticket tile shows.

### Two fixes found in the walk

1. **The status bar names a filter that is not on.** On the "All open" and "No area yet" views the
   job item still says `%1 tracker --area pipeline | ticket`, the line as typed
   (`shots/r3-dark/all-open-one.jpg`, `no-area-yet-one.jpg`).
2. **The menu's area names are a fixed list in the program** (`AREAS` in the patch's `ticket.ts`).
   Call 5 replaces it with the ledger's areas.

### Today and round 3 against the area principles

| Principle ([areas](../docs/direction/areas.md)) | Today | Round 3 |
|---|---|---|
| A1: an area is a person's data on the ledger | breaks: no area; a title word | breaks: a fixed list in the program (fix 2) |
| A2: a guess until a person picks, shown as a guess | breaks: no area | half: the ticket says "the filer's guess"; a row does not mark it; no pick |
| A3: one filter, three doors, "no area" one of its values | breaks: a title search only | follows, but the status bar names the typed line (fix 1) |
| A4: grouping is a Display option | half: nothing to group | follows |
| A5: don't say it twice | half: no area word | follows |
| A6: the area picker is a menu, not a program | follows: no extra program | follows |
| A7: a saved view is a named filter | half: no saved views | follows, on a made-up list of tabs |

### Guesses that were wrong

- **"No label" is a filter value in Linear.** The draft principles said so. Linear's filters page
  says the opposite: "select all labels and then switch the operator to does not include" [l10].
  So "No area yet" as one press goes past Linear, not with it.
- **Folding groups in Linear.** The draft cited T, a double-click and Opt to fold groups, from a
  2025 changelog entry. The display options page read on 2026-11-04 does not mention folding, and
  the changelog was not read again: **secondary**.

### Made up in the builds

- 37 `from` values read from filing bodies, 50 area guesses from title words, 4 `pr` facts, and a
  baked-in table of pull request files (`pr-files.ts` in the patch).
- The flags `--area`, `--group` and `--saved`, the `areas` program and its "shown" mark, the view
  tabs' list (`AREA_VIEWS`) and C's saved views (`SAVED`).
- Today's shots were taken on the branch, so their status bar says "takes area". Main does not.

### How the designs were checked

Each design was pressed through every key and click it takes, with Playwright on Electron as
`apps/fabrika/e2e.ts` drives the app, at five layouts: one tile, two side by side, two stacked, a
2x2 grid and 1024x700. Each state's page and the built `window.css` were saved. A draft page
lifted from those saved pages and shot again matched every one of 107 frames in words, boxes and
sizes. In 13 of them a line sat up to about 1px lower, the known drift of a newer Chromium. The
page and the canvas are not published yet.

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
- From the designs: narrow with one filter that a flag, a chip, a key and a tab all set (B3), and
  keep grouping as a display choice of the same list (B1). A third program for a list of names
  (B2) costs a tile and earns nothing yet. A view of title words (C) cannot be checked.
- From call 5: an area is a person's data with a stable number, so a rename touches no ticket and
  a merge moves every ticket at once, as Jira's substitute does [j2]. The app may suggest, never
  set. The filer's guess is the one fact here lost if not written at filing.

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
- **Whether the designs' counts hold.** "21 in pipeline", "28 by title words" and "misses 18"
  rest on 50 made-up area guesses from title words. Under call 5 a person sets the areas, so the
  numbers change.
- **How a guess should look in a row.** Round 3 marks a guess only on the ticket page. Linear's
  docs do not say how a suggestion looks beside a set value [l6b]. A shot of the build settles it.
- **Whether onboarding's suggestions are good.** No suggestion was built or shown. How many of
  the folder and title suggestions a person takes is unmeasured.
- **Whether the owner filters by area day to day.** One person looked at shots and pressed a draft
  page. A week of use on the real build answers it.
- **No screen reader ran** on the menus, the group headings or a row's accessible name.

## Dollars

$0. Reading, public pages, today's code, read-only lists of today's tracker, and a design branch
shot on Electron on this laptop. No model call beyond the session's plan, no Jev. The designs'
branch itself is not kept; only the patches and the shots are.

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
- [l10] https://linear.app/docs/filters
- [l11] https://linear.app/docs/display-options
- [l6b] https://linear.app/docs/triage-intelligence, read again on 2026-11-04
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
- [g8] https://github.com/kubernetes/test-infra/blob/master/label_sync/README.md
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
