# The smallest ledger, and proof before it grows

Decided 2026-10-12, written down 2026-10-18.

## What was decided

- **The ledger starts with only:**
  - tickets, with an "approved to build" flag;
  - their criteria, each open or met, changed only through added, reworded
    and removed events ([done is per criterion](./done-is-per-criterion.md));
  - questions to the owner, with answers;
  - review results, with the commit they saw;
  - who is on a ticket now;
  - lanes (one ticket's trip to its one PR), with how each ended.
- **Left out until proven:** priority and order, ticket types and labels,
  tickets that depend on tickets, and a free comment thread.
- **Nothing is added without proof.** Proof is a real run that got stuck, or
  decided wrong, because the thing was missing. (Working wording.)
- **Shape:** a plain list of events, with state worked out from it, the same
  idea tea is built on.
- **Except what is costly to change later.** Ids of tickets and criteria, and
  how an edited criterion keeps its history, must be right on day one. The
  proof rule is for fields, which are cheap to add to an event list.
- **Every ledger entity has an id** (decided 2026-10-18). Anything the ledger
  keeps that stays the same thing through change (ticket, plan, story,
  criterion, task, question, answer, review verdict, lane) is built on one
  entity base with a typed id, and a test fails if a ledger shape has none.
  Values (a commit, a reason, a fixture, a route) have no id: equal content is
  the same thing. Agent answer forms, config and fact snapshots are not
  entities.
- **Ids are stable** (chosen 2026-10-18, built in `wip/src/ids.ts`). An id is
  a counter or a name, never a place in a list, so inserting a line moves no
  id. Each kind of id is its own type. Code gives ids; an agent never names one.

## Why

- Today's fabrika grew its board from opinion: labels, priorities and
  milestones that later steps barely read. A real lane in experiment 85 read
  only a ticket's state, title, body and one label.
- Adding a field to an event list later is cheap. Removing one that every stage
  learned to lean on is not.

## What it means for the work

- A proposal to add something to the ledger names the run that needed it.
- When a ticket type seems to need a field (urgency for a bug, an owner and a
  date for a decision), the proof is collected per type, not for every ticket.

## What would change it

A missing field that keeps costing runs while nobody can point at one in
particular, a sign the proof bar is too strict.
