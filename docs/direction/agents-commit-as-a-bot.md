# Agents commit as a bot, with the person as co-author

**Proposed 2026-11-05.** The owner decided the direction on 2026-11-05, marked decided below:

- **Decided, agents commit and push as a bot.** An agent's commit is authored by a GitHub App's
  bot identity (a name such as `fabrika[bot]`), never by the person's account. GitHub itself then
  shows a person's work apart from an agent's.
- **Decided, the person rides along.** The person the agent works for is named in a
  `Co-authored-by` trailer, so the commit still shows up as theirs too.

Not walked yet: one app per person or one shared app, where the app's key lives, and the branch
rules a bot needs (all under Open, below).

Built from [experiment 211](../../experiments/211-started-claude-sandbox.md), which asked what the
claude `@claude` starts may do in the person's repo. It is not a measurement.

```text
A sketch, both versions. What one agent commit carries. The host writes every line below the
subject; the agent never names itself.

author     fabrika[bot] <APP_ID+fabrika[bot]@users.noreply.github.com>
subject    map: take a ticket from a pipe

Co-authored-by: <the person> <their noreply address>
Fabrika-Agent: agents/github:<member>/claude
Fabrika-Input: in-3f9a12c0-41
```

## Why

- **Nobody names themselves.** Today an agent commits as the person, and the only sign it was an
  agent is a `Co-Authored-By` line the agent writes itself. That is the same mistake
  [inputs carry their sender](./inputs-carry-their-sender.md) fixes for inputs: the host stamps
  who did what, from the connection it came on.
- **The industry's way.** GitHub's own coding agent commits as Copilot, with the person who asked
  as co-author. A GitHub App's bot identity is free.
- **It takes the person's login away from agents.** The host pushes with the app's own token. An
  agent no longer holds the person's `gh` login, so a steered agent cannot spend it.

## The data it keeps

A fact that exists only when the commit is written goes in now: which agent (`Fabrika-Agent`, its
registered name from [the ledger](./the-ledger-goes-to-cloudflare.md)), for whom
(`Co-authored-by`), and the input that caused it (`Fabrika-Input`, the envelope's id). The trailer
keys are a sketch until a plan checks them against git's trailer rules and the industry's words.

## What it undoes

- Every commit an agent has made in this repo so far is authored by the owner's account. They stay
  as they are; history is not rewritten.
- [Experiment 211](../../experiments/211-started-claude-sandbox.md)'s option A, "the person commits
  what they keep", does not match daily use: agents make the commits. The lean moves toward its
  option B, where code commits and pushes the agent's work to its own branch.

## Open

1. **One app per person, or one shared app.** Two people sharing a ledger each answer for their
   own agents, which points at one app each. A plan that reads GitHub's App docs settles it.
2. **Where the app's private key lives.** The host holds it, outside any agent's sandbox, the way
   it holds the person's login today.
3. **Branch rules.** A rule that blocks a bot's push or wants a review must let the bot through,
   and no agent approves (AGENTS.md).
4. **Signing.** Whether the bot's commits show as verified on GitHub, and how.

## What would change it

If GitHub's App setup needs a paid plan or a second app server, this goes back to the owner: no
new paid accounts, and nothing that needs a second server to start.

## What it cannot tell us

Nothing here was run. Whether `Co-authored-by` with the bot as author shows the person on the
commit the way the owner expects is a guess until one test commit shows it.
