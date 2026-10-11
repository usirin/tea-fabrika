# The ship machine: a design in progress

Status: a draft being worked out in conversation. Nothing here is built. Each
line is marked **settled** or **open**. This file is updated as points settle.

It rebuilds today's shipper agent as a machine. It is a rethink, not a port:
see [`direction/rethink-do-not-port.md`](./direction/rethink-do-not-port.md).

## What today's shipper does

Eleven steps, read from its skill. Nine are a checklist or bookkeeping, one is
a long wait, one needs thinking, and the last is a two-line message.

1. Cancel any leftover "merge when ready".
2. Read the pull request's facts.
3. Check the owner's approval on protected files.
4. Check every required review passed.
5. Wait for the checks on this commit.
6. Decide on unresolved review comments. *The one judgment.*
7. Put it in the merge queue and watch.
8. Label flagged work "waiting for release".
9. Delete the ticket's working copies.
10. Write the ending in the ledger.
11. Tell the person what happened.

What 961 real shipper runs showed
([experiment 53](../experiments/53-lane-logs.md)): they end in one of seven
ways and no eighth. A run lasts about 8 minutes at the median, which is also
the length of its wait limit, and in about a third of runs the watch ran out
while the pull request was still in the queue.

## The sketch

No agent anywhere in it.

1. **Gather**: read everything about this pull request at this exact commit,
   in one go. Approval, reviews, checks, open comments.
2. **Check**: one gate over those facts. All good, go on. Otherwise the gate
   names the reason.
3. **Act**: put it in the merge queue.
4. **Listen**: wait for the queue to land it or throw it out. Nothing is paid
   to stand there.
5. **Act**: label, clean up, write the ending.

Elm shape: a small child machine with its own state. The parent steps it. The
queue wait is a subscription. Nothing new is needed.

## Settled

- **It reads fresh.** Right before it acts, it reads the facts again at the
  commit it is about to land, and the fresh read wins over anything remembered.
  See [`direction/read-fresh-run-alone.md`](./direction/read-fresh-run-alone.md).
- **It runs alone.** Its input is one pull request. It can be started by a
  parent machine or by hand, and behaves the same.
- **It tries to do the job in code and hands back one typed outcome.** The
  machine that started it reads that outcome and knows how to react. The ship
  machine does not decide what the pipeline does next.
- **Open comments, the simple way first.** A comment a person wrote or joined:
  the machine asks that person. A comment only a bot wrote: back to the
  builder, always. Nothing is closed silently, and no judgment is made. Count
  how often each case comes up on real tickets; if bot comments are common,
  "real problem or nit?" becomes a candidate question for Jev.

## Open

- **The set of outcomes.** A first list: landed; back to the builder (with the
  reason); back to the reviewer (a review is missing or out of date for this
  commit); waiting on a person (with who and for what); cannot tell (a read
  failed, so stop and never guess); not ours (the pull request belongs to
  someone outside the repository).
- **A branch that fell behind main.** The most common named stop in the real
  logs. Today's skill says a branch that is behind but merges cleanly ships as
  it is, because the merge queue tests it on top of main. Does the ship machine
  need to do anything here at all?
- **Thrown out of the queue, and a conflict with main.** Both go back to the
  builder today without costing the ticket a repair round. Keep that?
- **Does today's fabrika accept a "queued" fact written by code** instead of
  by a shipper agent? Unchecked.
- **The closing message to a person.** A template per outcome, or nothing
  beyond the ledger line?
