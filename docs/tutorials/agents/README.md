# Agents on two hosts

Part two of [two hosts, one ledger](../two-hosts/README.md). The same ledger and the same two
hosts, now running a program that asks a real agent for its work: a poet that asks Claude (haiku,
through the Agent SDK) for one line of verse per guest, and a book that keeps each line once. You
kill a host while its agent is mid-answer, and the book still holds one line per guest.

These are the finished files. `pnpm typecheck` checks them.

You need part one done, and a Claude login in your shell: `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`) or `ANTHROPIC_API_KEY`. A run of eight lines costs well under one cent.

## 1. Start the ledger from part one

```bash
node docs/tutorials/two-hosts/ledger.ts
```

## 2. Start two hosts

In two more terminals, the second once the first has printed its lines:

```bash
node docs/tutorials/agents/host.ts host-a
node docs/tutorials/agents/host.ts host-b
```

Each host registers `poet` and `book` (registering is idempotent) and serves both with a 3 s
lease: an agent takes seconds, and part one's 1 s lease is too short for that.

## 3. Order eight lines, and kill the host mid-answer

```bash
node docs/tutorials/agents/order.ts
```

host-a prints `asking for Ayşe`, then the line and its cost, one guest at a time. After two or
three lines, while it is asking for the next guest:

```bash
pkill -9 -f "agents/host.ts host-a"
```

host-b claims both names, finds the rest of the orders waiting in the poet's inbox, and asks for
the guest host-a was on **again**. That answer was paid for twice.

## 4. Read the book

```bash
node docs/tutorials/agents/read.ts
```

Eight guests, eight lines, none twice. The poet sends each line under a message id made from the
order's id, so if a host dies after sending and before saving, the second line for that order
lands nowhere. Agent work is at-least-once; what it leaves behind is once.

## Next

- [`experiments/101-real-agents-faults.md`](../../../experiments/101-real-agents-faults.md):
  120 real agent questions with hosts killed mid-question, and resuming a session instead of
  asking again.
