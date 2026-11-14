---
date: "2026-11-06"
scripts: "none"
summary: "`next/`'s tracker; reading about 20 makers (Linear, GitHub, Jira, Kubernetes, Gmail, Notion, Shortcut, OmniFocus, Prometheus, a library, a hospital) plus read-only counts over kamp-us/phoenix's 3,000 newest issues, not a measurement. They agree: a label is a short, person-made list of words for finding work; typed values are fields, moving state is the system's, and a label that routes or has an owner becomes its own concept. Phoenix broke each: 1,463 of 2,158 closed issues still say triaged or ready, two priorities on one issue, 35 issues with two homes, 27 of 59 labels in use, and one shared login so no label says who wrote it. Six guidelines; Area is the first label group, pick-one and guessable (lean was 65%), decided 2026-11-06 with D1 and D4 built first. | $0"
---

# When is something a label on a ticket, and when must it be its own field or fact?

Read 2026-11-06. **This is reading, not a measurement,** plus read-only counts over the 3,000
newest issues of kamp-us/phoenix, where today's fabrika ran its pipeline on GitHub labels. It
feeds the note [label guidelines](../docs/direction/label-guidelines.md) and a Design canvas,
"Label guidelines", which is not drawn yet. Steps 1 to 4 of the guidelines skill are here; step
5's designs are listed at the end for the build agent. Dollars: $0 (no model ran; `gh` reads and
web pages only).

**Decided 2026-11-06.** The owner approved the note's six principles, its shape and its smaller
calls with their leans, Area as the first label group among them. D1 and D4 below are built
first; the note says why.

**The answer.** The makers agree on one plain rule: **a label is a word people put on things so
they can find them again; anything the system acts on, anything with a type, and anything that
changes by itself is something else.** Kubernetes says it outright: labels "do not directly imply
semantics to the core system" [k1], and state lives in `status`, "the most recent observations of
actual state" [k2]. GitHub built issue fields in 2026 because labels such as `priority/p0` have
"no types, no validation, no consistency across repositories, and no way to report on them" [g2].
Jira and Shortcut keep a controlled list beside the free one: Jira's components are made by
"space admins" and have owners [j1]; Shortcut's labels are "a lightweight, unstructured way to
organize your work" and its custom fields are for "a more structured process" [s1]. Linear keeps
one label system and adds groups, where "only one label from each group may be applied" [l1].

Phoenix shows what breaks when labels hold state, and every break is one of those rules
broken:

- **Labels went stale.** 1,463 of the 2,158 closed issues read still carry `status:triaged`,
  `ready-for:agent` or `status:needs-triage`. A label does not change when the work moves; a
  person or an agent has to remember.
- **Pick-one was a hope, not a rule.** Re-prioritizing left two priority labels on one issue
  ([#3771](https://github.com/kamp-us/phoenix/issues/3771)). 35 issues carry both a milestone and
  an `axis:` label, which triage's own rule forbids
  ([#9075](https://github.com/kamp-us/phoenix/issues/9075)). 4 carry two `status:` labels.
- **The list sprawled.** 59 labels; 27 of them are on any of the 3,000 newest issues. Seven `area:`
  and `axis:` labels were made and are on none of them; one `axis:` label sits on 1,089 issues, a
  third of them. Two labels say the same thing (`wayfinder:map`, `wayfinding:map`), one is named
  `1`, and an orphan `p3` needed its own decision ticket
  ([#2413](https://github.com/kamp-us/phoenix/issues/2413)).
- **Who wrote a label is gone.** Every label event on the running example below has the same
  actor; agents and people shared one login
  ([#4780](https://github.com/kamp-us/phoenix/issues/4780)).

**On the question that started it,** "is an area its own concept or a label group?": the
makers split. Linear makes its own components a label group [l1]; Jira and Shortcut make them a
controlled field with an owner [j1] [s1]. The deciding question is whether an area will ever *do*
something (own a person, route new work, carry a strategy). Today none of that is decided, and
[sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md) holds that an area never
routes a build. So the lean is **one label system with groups, and Area is the first group:
pick-one, guessable, shipped with the tracker. 65% sure,** below the lead's 70%: the doubt is the
open question in [pipeline strategies](../docs/direction/pipeline-strategies.md), "does a
strategy belong to the ticket, the area or the step". If it lands on the area, the area has
outgrown a label, and guideline L6 says how it leaves.

```text
how each tool splits "label" from "field", one line each
Linear       one label system; groups make a dimension pick-one; workspace or team scope; priority, status, assignee are fields
GitHub       labels free per repo; issue types (2025) and typed issue fields (2026) took type, priority, effort, dates out of labels
Jira         labels free text, anyone; components controlled by admins, with owners and auto-assign; custom select fields for the rest
Kubernetes   labels to select (key=value, one value per key); annotations for tools; status for state the system observes
Gmail        labels replace folders; the system's own (SENT, DRAFT) are reserved and cannot be set by hand
Notion       select (one) and multi-select (many) are both "tags"; status is its own property with three fixed stages
Shortcut     labels anyone makes; custom fields admins control, "for categorical data"
OmniFocus    tags for "a person, place, thing, state of mind"; availability is derived, never set
Basecamp     no labels on to-dos; people type [Field:Value] into titles instead (secondary)
Prometheus   labels split one series; never "user IDs, email addresses, or other unbounded sets"
Library      facets "mutually exclusive, and collectively exhaustive", combined per item
Hospital     color wristbands meant different things in two hospitals; the fix: few colors, printed words
```

## Which version

- **`next/`:** the subject. Its tracker is not built; its ledger keeps `_tag`, `by`, `arrivedAt`
  and `sentAt` on every entry. Every shape here is a sketch for that tracker.
- **Today's version:** read for what exists. Areas PR 1 is on main
  ([PR 377](https://github.com/usirin/tea-fabrika/pull/377)): `area_made`, `area_renamed` and
  `area_merged` on their own stream (`packages/pipeline/src/tickets/area.ts:42-47`), person-only at
  the door (`packages/fabrika/src/host/door.ts:118-124`). Nothing here changes it.
- **Scope, in one line:** what a label is in `next/`'s tracker and which ticket facts are not
  labels. The chassis, the pipeline's steps and today's tracker stay as they are.

## Step 1: what is settled

| Point | Source |
|---|---|
| Labels never gate a build; the approved plan is the only go. Decided 2026-10-21. | [sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), "Who approves building" |
| No ticket-kind label (bug, feature, chore, ...) enters the ledger, from experiment 88, on routing. | same note, "What it means for the work" |
| The tracker is like Linear and grows toward its model; a label never gates. Decided 2026-10-27. | [0346](../.decisions/0346-the-tracker-is-built-like-linear.md) |
| Status, done included, is a fold of facts; `moved` cannot spell done. Decided 2026-11-06. | [tracker views are programs](../docs/direction/tracker-views-are-programs.md) |
| Priority, labels and project are a person's only, refused at the door; no stage reads them. | same note, section 4 |
| A person is the assignee, their agent the delegate; whose turn is a fold of asks and answers. Decided 2026-11-06. | [a ticket runs from the app](../docs/direction/a-ticket-runs-from-the-app.md) |
| An area is a person's data on the ledger, made, renamed, merged; never read from folders (call 5). Decided 2026-11-04. | [areas](../docs/direction/areas.md), A1 |
| A ticket's area is a guess until a person picks, and the guess says so. Decided 2026-11-04. | same note, A2 |
| Ids are stable: a counter or a name, never a place in a list. | [the smallest ledger](../docs/direction/smallest-ledger-proof-to-grow.md) |
| Before adding a field or label, ask: is it something we already have? | [reuse before special rules](../.decisions/0421-reuse-before-special-rules.md) |

**Leaned, not decided.** `labeled {add, drop}` with string labels, a person's, is a sketch in
tracker views (section 7). Areas' own "where this differs" says "an area is not a label in a
group: it is one per ticket, it carries a guess, and it merges by number". That line is part of
the proposed shape, not of A1 or A2, so this study may test it.

**Untouched.** Label groups, pick-one versus many, who may make a label, rename and merge for
labels in general, what a label's color means, and when a label must become a field.

**Open pull requests on the area:** none. The five open ones (223, 294, 347, 383, 412) do not
touch labels.

## Step 2: the running example

Phoenix issue [#7727](https://github.com/kamp-us/phoenix/issues/7727), "A running epic can't add,
drop, or reorder a task once it has started", today's fabrika, read-only on 2026-11-06. Its label
timeline:

```text
2026-09-04 02:23  labeled   status:needs-triage
2026-09-04 03:04  unlabeled status:needs-triage
2026-09-04 03:04  labeled   axis:pipeline-hardening, p1, ready-for:human, status:triaged, type:feature
2026-09-10 01:10  milestoned "Epic lanes"
2026-09-10 08:40  unlabeled ready-for:human; labeled ready-for:agent
2026-09-10 17:18  closed
today             still labeled status:triaged, ready-for:agent; still both an axis and a milestone
```

Every one of the nine label events has the same actor, a GitHub user, so which were an agent's
and which a person's cannot be told now. The same ticket, one label at a time, is the table in
"Today's example" below. For the area half, the example is today's tracker's ticket 193 as areas
traces it ([areas](../docs/direction/areas.md), the opening code block): filed by an agent with a
guess, picked by a person.

## Step 3: what was read

### The trackers

| Tag | Source | What it says | What it teaches |
|---|---|---|---|
| [l1] | Linear, label groups changelog | "only one label from each group may be applied"; groups "creates one level of nesting in workspace and team labels"; Linear's own groups are "Issue Type, Component, and Integrations" | Pick-one is a property of a group. Linear's area is a group. |
| [l2] | Linear, labels docs (**secondary**: the page renders in the browser only; read through a search summary) | labels at workspace or team level; archiving keeps a label on its issues but stops new uses; a workspace label of the same name offers to convert team labels | Archive, not delete. A merge path exists for duplicate names. |
| [l3] | Linear, triage intelligence (experiment 205's [l6], [l6b]) | suggests "teams, projects, assignees, and labels"; "Accept, decline, or view more information about why a suggestion was made" | A machine may guess a label; a person takes it. |
| [g1] | GitHub, managing labels | "Anyone with triage access to a repository can apply and dismiss labels"; "Deleting a label will remove the label from issues and pull requests" | Free labels per repo; delete loses data; no groups. |
| [g2] | GitHub changelog, issue fields (2026-03-12) | labels like "`priority/p0` or `severity/high`" have "no types, no validation, no consistency across repositories, and no way to report on them"; issue fields replace "label-based workarounds with typed, org-wide metadata"; "Single select, text, number, and date" | The largest label user moved typed values out of labels. |
| [j1] | Jira, components | group work "around product features, departments, or workstreams"; "Space admins can configure Jira components"; "assign component owners, and auto-assign people" | An area with an owner and routing is a controlled concept, not a free label. |
| [j2] | Jira labels versus components (**secondary**, community threads) | labels are free text anyone types; people "mistype the label ... and will add it as a new one"; components are a dropdown "so they cannot ... add a new one by accident" | Free text sprawls in spelling. |
| [s1] | Shortcut, custom fields | labels: "a lightweight, unstructured way to organize your work"; custom fields "help you establish a more structured process"; advanced ones "only Administrators can create, edit, or delete" | Two tiers: anyone's labels, controlled fields. |
| [n1] | Notion, database properties | Select: "Choose one option from a list of tags"; Multi-select: "Choose one or more"; Status: "categorized by To-do, In Progress, or Complete" | One-or-many is a setting of the same tags. Status is never a tag. |
| [b1] | Basecamp (**secondary**, a time tracker's help pages) | Basecamp to-dos have no labels; the workaround is typing `[Field1:Value1]` into the text | Leave labels out and people put them in titles, as 79 of 129 open titles in today's tracker do (experiment 205). |

### Systems and personal tools

| Tag | Source | What it says | What it teaches |
|---|---|---|---|
| [k1] | Kubernetes, labels and selectors | "identifying attributes of objects that are meaningful and relevant to users, but do not directly imply semantics to the core system"; "Non-identifying information should be recorded using annotations"; "Each Key must be unique for a given object" | A label is for selecting. Key=value makes pick-one structural. |
| [k2] | Kubernetes, API conventions | "Labels are intended for organizational purposes by end users"; "The `status` summarizes the current state of the object"; "fields in `status` should be the most recent observations of actual state" | State is written by the system that observes it, apart from labels. |
| [k3] | Kubernetes test-infra, `labels.md` | labels "intended to be produced or consumed by our automation"; `lgtm` added by "reviewers or members", `approved` by "approvers", `kind/bug` by "anyone" | When a label does gate (as there), who may write it is a rule per label. We avoid the need: our labels gate nothing. |
| [m1] | Gmail help, labels | "Labels are different from folders"; "Nest label under" | Many-per-item labels replaced one-folder filing for mail. |
| [m2] | Gmail API, labels | "reserved `SYSTEM` labels and custom `USER` labels"; `SENT` and `DRAFT` cannot be applied by hand | State as labels works only where the system reserves them and refuses a person's write. |
| [o1] | OmniFocus 3 glossary | a tag is "A person, place, thing, state of mind, or other factor"; Available: items that "aren't blocked, deferred, or on hold" | Availability is derived from tags and dates, never set. |
| [p1] | Prometheus, naming | "every unique combination of key-value label pairs represents a new time series"; never "user IDs, email addresses, or other unbounded sets of values" | A label value comes from a short, closed list. A person, a ticket or a date is not one. |

### Outside software

| Tag | Source | What it says | What it teaches | What does not carry over |
|---|---|---|---|---|
| [x1] | Clay Shirky, "Ontology is overrated" (2005) | categories work with a "Small corpus, Formal categories, Stable entities, Restricted entities, Clear edges" and "Expert catalogers, Authoritative source of judgment, Coordinated users, Expert users" | Two people sharing one project are coordinated users with a small corpus: a controlled list fits. Free tagging pays off only at scale. | Shirky argues for free tags on the open web; we are not the open web. |
| [x2] | Faceted classification (Wikipedia, **secondary**) | facets are "clearly defined, mutually exclusive, and collectively exhaustive aspects of a subject"; Ranganathan's PMEST | A group is a facet: one value per facet, several facets per item. | A library's facets are fixed by experts; ours are made by the people using them. |
| [x3] | Color-coded wristbands, Pennsylvania Patient Safety Authority advisory 2005 (**secondary**, trade press) | a yellow band meant DNR in one hospital and something else in another; "she inadvertently used the yellow wristband in the wrong facility"; fixes: fewer colors, "Printed instructions on wristbands" | A mark whose meaning lives in people's heads drifts when people move. Write the word; color is never the only cue. | Nothing here is life or death. |

### The plain way they agree on

A label is a short, closed, person-made list of words for finding work. One-or-many is a property
of a group of labels. A value with a type (a person, a date, a number, an ordered level, another
ticket) is a field. State that moves as work moves is the system's, folded or observed, never a
label a person or agent must remember to change. A label that starts to route work or carry an
owner becomes a controlled concept (Jira's component, GitHub's field). The plain way does not
clash with any goal of ours; it is closer to our settled notes than phoenix ever was.

## Step 4: the guidelines, each tested three ways

Six guidelines, written out in the note. In one line each, with the three tests:

| | Guideline | Linear as the builder | Elm or OTP | Accessibility |
|---|---|---|---|---|
| L1 | Nothing decides on a label. | Linear's workflow moves on status and the PR link; no page read shows a label moving an issue (**guess** from use). Our tracker owns labels, and no step imports their fold. | A label is model data that `view` reads and `update` never branches on outside the tracker. | none |
| L2 | State that moves is a fold, never a label. | Status is its own field with its own workflow; labels sit beside it. | A fold over the timeline, as `Column` is (tracker views). | The status line is words, WCAG 1.4.1. |
| L3 | A typed value is a field or a link. | Priority, assignee, estimate, due date and relations are each their own property. | Each its own case in the `Fact` union, with its own schema. | Each field has its own accessible name, WCAG 4.1.2. |
| L4 | Pick-one is a group, and the fold holds it. | Label groups [l1]. | The fold refuses a fact that leaves two in a one-group, into `problems`. | A one-group's menu is a radio group, many is checkboxes, WCAG 4.1.2. |
| L5 | A label is a number with a name; people make, rename and merge; agents guess. | Workspace labels made in settings or the picker; triage suggests [l2] [l3]. | Labels are a stream the tracker subscribes to; the door refuses an agent's make. | A label's color never alone, WCAG 1.4.1; text on a label's fill meets 1.4.3. |
| L6 | A label that grows behavior graduates to a concept. | No Linear answer: Linear has no area concept and puts ownership on teams. Jira's component is the model [j1]. | A new fact union, the old numbers kept, like OTP's `code_change` moving state across versions. | none |

## Today's example

Phoenix #7727's labels, one at a time, against the guidelines. "Where" is what `next/` would have.

| What | Today on #7727 | L1 to L6 | Where in `next/` |
|---|---|---|---|
| `status:triaged` | stays after close | breaks L2 | the status fold over `filed`, the triage step's answer, `moved` and the PR link |
| `ready-for:agent` | swapped from `ready-for:human` by hand; stays after close | breaks L1 and L2 | the delegate and whose turn, a fold of asks and answers (decided) |
| `p1` | one of a set held only by code at two writers (#2616) | breaks L3 | `prioritized {level}`, an ordered field |
| `type:feature` | set by triage, read by nothing (experiment 85) | breaks L1; a kind label is decided out | nothing, or a "Kind" group a person makes, for finding only |
| `axis:pipeline-hardening` plus milestone 49 | two homes, which the rule forbids (#9075) | breaks L4 | a parent plan (`nested`) or one pick in a group, never both |
| who wrote each | one shared login | breaks L5's record | `by` and `for` on every entry |

The area half, today's tracker on main: areas follow L4 (one per ticket), L5 (numbers, person
only, `packages/pipeline/src/tickets/area.ts:54-60`) and L1 (no stage reads them). They differ only
in living on their own stream with their own facts, which is what this study tests.

## Area: its own concept, or the first label group?

| | Area its own concept (areas' proposed shape) | Area the first label group |
|---|---|---|
| One per ticket | `area_picked {area}` | the group's `pick: "one"`, held by the fold |
| The guess | `guess` on `filed`; source's area through `from` | `guess` on `filed` names labels; groups marked `guess: true` inherit from the source |
| Merge and rename by number | areas only | every label, which phoenix's sprawl needed |
| Make, rename, merge, onboarding | its own facts, menu rows and tsh inputs | one set for all labels; onboarding makes the Area group's first labels |
| Filter door | `--area pipeline` | `--label area=pipeline`, with `--area` kept as a short form |
| An owner or a strategy later | fits: add a field | does not fit: graduate (L6) |
| Makers | Jira [j1], Shortcut [s1] | Linear [l1], Kubernetes `area/` [k3], Notion select [n1] |

Two things tip it toward the group. Labels are coming anyway (tracker views sketches `labeled`),
so a separate area makes two make-rename-merge flows, two pickers and two filter doors for the
same act, which [reuse before special rules](../.decisions/0421-reuse-before-special-rules.md)
asks us not to do. And area's best parts, numbers, merge and the guess, are what phoenix's labels
lacked. The one thing against it is behavior: Jira's component has an owner and routes work, and
our glossary already calls an area "the long-lived grouping with an owner" (the `project` row).
No owner field exists in any decided note. Since a label keeps its number, graduating later moves
no ticket. 65% sure.

## What this tells us for fabrika

- Labels stay cheap only because nothing reads them. Every phoenix failure here came from a
  label that something read or that had to stay true.
- The fold is the piece phoenix lacked. GitHub's label set is a bag; ours is folded, so pick-one,
  merges and refusals are code, not discipline.
- `by` on every fact turns "who labeled this" from lost into a column.
- The areas built in today's version are already a label group in all but name. `next/` can
  rethink them as one; today's version keeps them.

## What it cannot tell us

- Whether two people will make any group besides Area. If not, the general system is shape for
  later, and a lean of 65% is generous.
- Whether an area will need an owner or a strategy. That is the pipeline-strategies question,
  still open.
- Phoenix counts cover only the 3,000 newest issues (6649 to 10757), not all. A stale label on a
  closed issue hurt only where something read it; this study did not count reads.
- Linear's labels page did not render for a fetch, so [l2] is secondary. The wristband case is a
  trade-press summary of the advisory, which refused the fetch.
- No screen reader run: the radio-group picker and chip names need VoiceOver.

## Step 5, for the build agent: four designs for picking labels and the area

Each is one tsh line first, then what is on screen. All four use the same facts. The designs are
answers to one job: put a ticket's labels, its area included, where they need to be, and turn a
guess into a pick.

- **D1, the ticket's own menu.** `tracker | ticket`. In the ticket tile, `l` opens a popover over
  the Labels row: groups as sections, Area first as a radio list with the guess marked "pipeline?
  the filer's", groupless labels as checkboxes, a filter box on top, "New label ..." last. Linear's
  `L` key on an issue.
- **D2, triage in the list.** `tracker --area none | ticket`. Rows in the tracker take a
  selection (`x`, Shift-click); `l` applies a label to all selected; `a` accepts each selected
  row's guess. The guess is a "?" on the row's area word. Linear's multi-select with a label
  action.
- **D3, a labels program on a pipe.** `labels | tracker`. A tile lists groups and labels with
  counts; choosing a label sets the tracker's filter; `r` renames, `m` merges, `n` makes. Picking
  on a ticket stays D1's menu. Tests program guidelines G1 against the B2 design that lost in
  experiment 205.
- **D4, typed in tsh, chips in the tile.** `ticket 193`, then in tsh `label 193 area=pipeline
  +flaky -stale` with Tab completing names. The ticket tile shows chips with a remove button; no
  popover. Group settings (one or many, guessable) live in a sheet opened from `labels --edit`.

Shoot each at the five layouts with real ticket titles from today's tracker, and one row whose
area is a guess. Linear's closest screen for D1 and D2 is its issue label menu and list
multi-select.

**Picked 2026-11-06:** D1 plus D4 first; D2 as the second slice, once guessing at filing exists,
with Manti 0.13.0's `Checkbox` `indeterminate` prop for its half-checked "select all"; D3 is
mostly the decided filter. D1's searchable menu is Manti's `Combobox` (it takes
`multiple`) inside a `Popover`, patched with `pnpm patch` to take groups and custom row content
and sent to Manti by pull request, since 0.13.0's items take a string label only. The picker
needs the same change.

*Corrected 2026-11-06:* this first said no Manti pull request was needed. That was wrong: Manti
0.13.0's `ComboboxItem` is `{value, label: string, disabled?}`, with no groups and no custom row
content.

## Links

- [l1] https://linear.app/changelog/2022-11-10-label-groups
- [l2] https://linear.app/docs/labels (did not render; read through a search summary)
- [l3] https://linear.app/docs/triage-intelligence
- [g1] https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels
- [g2] https://github.blog/changelog/2026-03-12-issue-fields-structured-issue-metadata-is-in-public-preview/
- [j1] https://support.atlassian.com/jira-software-cloud/docs/what-are-jira-components/
- [j2] https://community.atlassian.com/t5/Jira-questions/Difference-between-Components-Vs-Labels-with-example/qaq-p/2270663
- [s1] https://www.shortcut.com/help/fields-and-features/custom-fields
- [n1] https://www.notion.com/help/database-properties
- [b1] https://support.everhour.com/article/306-how-to-use-labels-and-tags-with-basecamp
- [k1] https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
- [k2] https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md
- [k3] https://github.com/kubernetes/test-infra/blob/master/label_sync/labels.md
- [m1] https://support.google.com/mail/answer/118708
- [m2] https://developers.google.com/workspace/gmail/api/guides/labels
- [o1] https://support.omnigroup.com/documentation/omnifocus/mac/3.11/en/glossary/
- [p1] https://prometheus.io/docs/practices/naming/
- [x1] https://gwern.net/doc/philosophy/ontology/2005-04-shirky-ontologyisoverratedcategorieslinksandtags.html
- [x2] https://en.wikipedia.org/wiki/Faceted_classification
- [x3] https://www.infectioncontroltoday.com/view/use-color-coded-patient-wristbands-creates-unnecessary-risk
- Phoenix: [#7727](https://github.com/kamp-us/phoenix/issues/7727),
  [#3771](https://github.com/kamp-us/phoenix/issues/3771),
  [#9075](https://github.com/kamp-us/phoenix/issues/9075),
  [#4780](https://github.com/kamp-us/phoenix/issues/4780),
  [#2413](https://github.com/kamp-us/phoenix/issues/2413),
  [#2616](https://github.com/kamp-us/phoenix/issues/2616). Counts from
  `gh issue list -R kamp-us/phoenix --state all --limit 3000 --json number,state,labels,milestone`
  and `gh label list`, read 2026-11-06, not kept.
