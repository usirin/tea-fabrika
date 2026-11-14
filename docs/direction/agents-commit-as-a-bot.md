---
state: "proposed, direction decided 2026-11-05, the rest 2026-11-06; walked at Tier 5"
summary: "Both versions. An agent's commit is authored by a GitHub App's bot identity, never the person's account, and the person rides as `Co-authored-by`. One shared bot for everyone. The host writes which agent and the input that caused it; the agent never names itself, and pushes with the app's token, not the person's login. The bot is `fabrikalfa`, one for every project its owner runs fabrika on; its one key sits in the brain, and invited people get tokens through it. In the box a stand-in token is swapped at the network edge, so agents keep plain `git push` and `gh`. Verified on main through GitHub's squash; step proofs in git notes. Pull requests open as the person or the bot. The bot may change CI files; which folders an agent may edit is a `fabrika.toml` setting. Open: the edge to a remote brain, who writes the trailers."
---

# Agents commit as a bot, with the person as co-author

**Proposed 2026-11-05.** Walked when Tier 5 starts (owner, 2026-11-08): agent commits, token swaps and trailers. The owner decided the direction on 2026-11-05, marked decided below:

- **Decided, agents commit and push as a bot.** An agent's commit is authored by a GitHub App's
  bot identity (`fabrikalfa[bot]`, named 2026-11-06), never by the person's account. GitHub itself then
  shows a person's work apart from an agent's.
- **Decided, the person rides along.** The person the agent works for is named in a
  `Co-authored-by` trailer, so the commit still shows up as theirs too.
- **Decided, one shared bot.** *Narrowed 2026-11-06, below: one bot for every project its owner
  runs fabrika on, not one for everyone.* Which agent and whose it is ride in the commit, stamped by
  the host.

- **Decided 2026-11-06, a stand-in token in the box.** The app's key stays with the host (in
  `next/`, the brain), outside every box. In the box, `git` and `gh` see a fake token; a proxy at
  the box's network edge swaps it for a real 1-hour token limited to one repo and one branch.
  Agents keep plain `git push` and `gh`, so people whose agent skills already use them move over
  without change.
- **Decided 2026-11-06, Verified on main only, for the first version.** What lands on main is
  GitHub's squash commit, which GitHub signs. Commits on a pull request's branch carry no GitHub
  badge. Replaying pushes through GitHub's API was turned down, since it rewrites the agent's
  commits under new hashes; so was a machine user holding the keys, since every person would need
  a second GitHub account ([experiment 212](../../experiments/212-fabrika-bot-commits.md),
  calls 2 and 4).

- **Decided 2026-11-06, the bot is `fabrikalfa`,** owned by the kamp-us organization and public.
  It is one bot for every project its owner runs fabrika on, not one bot for everyone; this
  replaces "one shared bot" above. A self-hoster makes their own app.
- **Decided 2026-11-06, one key, in the brain.** The app's key sits in the brain, on Cloudflare in
  its Secrets Store, shared by every worker in one account. A person invited to a project gets a
  token through that project's brain, after it checks its member list. Nobody else holds a key.
- **Decided 2026-11-06, pull requests as me or as the bot.** A setting per person. Commits are
  always the bot's. "As me" opens the pull request with a sign-in token of the person's that the
  app gets once through GitHub's own sign-in, kept in the brain like the app's key.
- **Decided 2026-11-06, the repo's rules hold the bot to its own branches.** `main` only through a
  pull request; outside `fabrikalfa/*` only people may push. Any owner of kamp-us can make a key, so
  these rules are what limit a key.
- **Decided 2026-11-06, the bot may change CI files.** The app holds GitHub's `workflows`
  permission, so an agent's pull request can change `.github/workflows/`. Which folders an agent
  may edit is a setting in the repo's `.fabrika/fabrika.toml`, next to the network and hidden-file
  lists ([talk where you work](./talk-where-you-work.md), [principle 5](./principles.md)), not a
  wall in the app. A wall was weighed: a workflow runs with the repo's secrets, so an agent that
  edits one could reach them. It was turned down, since nothing merges without passing review and
  a wall would stop every ticket that touches CI. The app was first made without the permission;
  it was added on 2026-11-07.
- **Step proofs go in git notes,** not in the commit's signature slot, so GitHub shows no
  "Unverified" (the Tier 1 plan's P32). [Experiment 212](../../experiments/212-fabrika-bot-commits.md)
  section 10 has what the first real app showed.

Its decided rules are in: [0401](../../.decisions/0401-agents-commit-as-the-fabrikalfa-bot.md),
[0402](../../.decisions/0402-one-bot-per-owner-key-in-brain.md),
[0403](../../.decisions/0403-a-stand-in-token-in-the-box.md),
[0404](../../.decisions/0404-only-mains-squash-is-verified.md),
[0405](../../.decisions/0405-pull-requests-open-as-person-or-bot.md),
[0406](../../.decisions/0406-the-bot-is-held-to-its-branches.md),
[0407](../../.decisions/0407-this-repos-agent-commits-are-the-bots.md).

Not walked yet: the branch rules on a repo other than this one (under Open, below).

Built from [experiment 211](../../experiments/211-started-claude-sandbox.md), which asked what the
claude `@claude` starts may do in the person's repo. It is not a measurement.

```text
A sketch, both versions. What one agent commit carries. The host writes every line below the
subject; the agent never names itself.

author     fabrikalfa[bot] <353269643+fabrikalfa[bot]@users.noreply.github.com>
subject    map: take a ticket from a pipe

Co-authored-by: <the person> <their noreply address>
Fabrika-Agent: agents/github:<member>/claude
Fabrika-Input: in-3f9a12c0-41
Fabrika-Input: in-3f9a12c0-44
```

The email's number is the bot user's id, not the app's id, and a commit made from two inputs
carries one `Fabrika-Input` line for each
([experiment 212](../../experiments/212-fabrika-bot-commits.md)).

**On Tier 1 pull requests** (owner, 2026-11-07, in use from 2026-11-08). From T246 and P10 on,
step commits are authored by `fabrikalfa[bot]`, with the person as `Co-authored-by`. The lead
pushes them to `fabrikalfa/<name>` with a token that lasts one hour. The pull request opens as the
person.

Decided by the owner, 2026-11-08: this covers every commit an agent makes in this repo, the lead
agent's own included, not only step commits. Each is authored by `fabrikalfa[bot]` with the owner
as `Co-authored-by`, on a `fabrikalfa/<name>` branch pushed with a 1-hour token. Pull requests
still open as the owner. A repo where the app is not installed is not covered.

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

1. **The box's edge and a remote brain.** The stand-in token is swapped at the box's edge, which
   asks the brain for a real token. How the edge reaches a brain on Cloudflare, and proves which
   agent asks, is not designed. Two runs show the swap itself works on a Cloudflare Container:
   in [experiment 148](../../experiments/148-remote-programs.md) the box's outbound handler
   (`interceptOutboundHttp`) sent each model call to a relay that added the starter's key on the
   way out, and in [experiment 157](../../experiments/157-login-stays-home.md)'s round 1 the same
   kind of handler (`interceptOutboundHttps`) added the person's Claude token on the way out, with
   0 copies in 18 boxes. 157's ruled round 2 put the Claude token in the box instead, so this is
   evidence for the swap, not a decided shape.
2. **Who writes the trailers.** With plain `git push`, the commit is made in the box, so
   `Fabrika-Agent` and `Fabrika-Input` are no longer written by the host when it builds the
   commit. How the host still stamps them, and checks them at the proxy, is open.
3. **Branch rules.** A rule that blocks a bot's push or wants a review must let the bot through,
   and no agent approves (AGENTS.md).
4. **Pull requests as the person.** Whether GitHub marks a pull request the app opens for a person
   with the app's name is not checked.

## What would change it

If GitHub's App setup needs a paid plan or a second app server, this goes back to the owner: no
new paid accounts, and nothing that needs a second server to start.

## What it cannot tell us

The first pushes with the real app ran on 2026-11-06 ([experiment 212](../../experiments/212-fabrika-bot-commits.md)
section 10). Whether `Co-authored-by` with the bot as author shows the person on the commit page
the way the owner expects was not looked at on the page yet.
