---
date: "2026-11-04"
scripts: "none"
summary: "Today's version; reading, not a measurement, plus designs drawn on a private Design canvas and walked with the owner. About 30 tools, papers and specs agree: presence is a name or an avatar where the work is, takeover is one key, \"only a person\" lives on the server, and an agent is a delegate with both ids kept (RFC 8693). Talking at a spot has the best evidence (Anchored Conversations, AnchoredAI, a CHI 2026 field study); `@` in a live shell and per-input authorship in a terminal have none. Today no input carries its sender. Decided: one kind of tile, the cause carried in the data, a spot's reply kept at the spot. Leaned (proposed): an avatar plus a presence label, `@claude` in tsh. Rejected: the agent's own tile, follow, the one-shot job as the person, pairing a Cmd with its Msg. Leaned against: a word-only or edge presence, and a ring. Cost not measured: one research subagent, its tokens not logged."
---

# How does a person work with an agent in their own tile, and talk to it where they work?

Read 2026-11-04. **This is reading, not a measurement.** Nothing ran, and no agent was used on a
real ticket. Today's version only (`apps/fabrika`, `packages/fabrika`, `programs/`), main at
`ffa7056f`, with plan 185b's PR 3a read on its branch. It feeds four proposed notes:
[shared tiles](../docs/direction/shared-tiles.md),
[inputs carry their sender](../docs/direction/inputs-carry-their-sender.md),
[talk where you work](../docs/direction/talk-where-you-work.md) and
[principles](../docs/direction/principles.md). The designs were drawn on a private Design canvas,
"Shared tile guidelines", and walked with the owner the same day.

**The answer.** The makers agree on four things. Presence is a name or an avatar where the work is
(Zed, Figma), and an agent never passes as a person (Linear). Taking over is one key, and the work
so far is kept (Claude Code, Warp). "Only a person" lives on the server, never in a hidden button
(Linear, GitHub). And the data is delegation, not impersonation: both ids are kept (RFC 8693,
Linear's delegate). Talking at a spot has the strongest evidence of anything here (Anchored
Conversations, AnchoredAI, a CHI 2026 field study). Nobody addresses an agent by `@` inside a live
shell, and no terminal maker records who typed what. Those two parts are ours.

Today's example, ticket #7 in the owner's tile with claude summoned, breaks it in one place that
matters: no input carries its sender. The writer is the tile's, fixed when its tsh starts. That is
why PR 3a refuses the owner's Approve in claude's tile, and why PR 3b hid it.

```text
how each tool read does it, one line each
Zed            avatars in the title bar; a followed pane outlined in that person's color; "follow the agent"  [z1] [z3]
Figma          your name on your cursor; follow by avatar                                         [f1]
Google Docs    icons at the top right; Ctrl+Alt+M comments on a selection                         [g1] [g2]
Warp           the agent types live; Takeover stops it; a classifier guesses words or a command  [w1] [w2]
Claude Code    each command shown whole; Esc stops and keeps the work; `!` runs a shell line     [cc1]
Copilot CLI    `!COMMAND` runs in the shell; `@path` adds a file                                  [h3]
aider          `!` runs a command; "(aider)" added to the commit author                          [ai1]
Cursor         Cmd-K edits at the selection; Cmd-L sends it to the agent panel                   [c2]
Linear         agents are delegates; the person stays the assignee; a mention starts a session  [l1] [l2]
GitHub agent   it "cannot approve or merge"; @copilot on a PR opens a child PR                   [h1] [h2]
Liveblocks     an agent's presence holds `editing` and `status`; threads anchor to elements     [lb1]
tmux           every writable client types into the pane; no record of who typed                 [x1]
OTP            a message has no built-in sender; gen_server:call adds From                        [o1]
```

## What was read

About 30 tools, papers and specs, by fetch, plus three trades outside software. A tag in brackets
points at [Links](#links). A claim from a summary page is marked **secondary**, and one found
nowhere **guess**.

## Tools for working together

- **Presence** is an avatar or a name in a bar, and a frame in that person's color while you follow
  them (Zed, Figma). Zed lets you follow the agent "as it reads and edits files", the same follow it
  uses for people [z3]. Liveblocks gives an agent a presence with `editing: "title-1"` and a status,
  and the app draws a cursor from it [lb1].
- **Takeover** is one key: Esc in Claude Code keeps the work done so far [cc1]; Warp's Takeover
  stops the agent from typing [w1]; Devin asks you to pause it "to avoid simultaneous, conflicting
  changes" [d1].
- **"Only a person"** is a role on the server. Linear agents cannot be assignees [l2]; GitHub's
  agent "cannot approve or merge a pull request" [h1]; two vendors (VS Code Copilot, Cursor) call
  their client allowlists "not a security boundary" [v2] [c1].
- **Who did it.** Linear gives every action an actor [l2]. Figma and Docs keep authors per version,
  not per edit [f1] [g1]. tmux keeps none [x1].

## Talking to an agent

| Where | What they do | What we take |
|---|---|---|
| A shell | Claude Code and Copilot CLI use `!` to run a shell line from a chat [cc1] [h3]. Warp guesses, labels its guess, and ships a denylist for commands taken for English [w2]. | `@claude` is `!` reversed: the shell stays home. An explicit address, never a guess. |
| A selection | Cursor's Cmd-K edits at the selection, Cmd-L sends it to a panel [c2]. Zed's inline assist replaces the selection [z3]. Claude Code keeps the selection you had when you pressed Enter [cc1]. | Freeze the spot at send. |
| A comment | Linear: a mention starts an agent session, a thread of typed activities; comments are editable, so rebuild history from activities [l1] [l3]. `@copilot` on a pull request opens a child pull request and never writes over the person's work [h2]. | The reply is a thread at the spot. The log, not the visible text, is the record. |

## Papers

- **Anchored Conversations** (Churchill, Trevor, Bly, Nelson, Cubranic; CHI 2000) [p1]. Chats
  pinned to a spot in a document, kept by a coordinator outside the apps, "uniform across different
  applications", with detach and reattach. Informal study, 6 teams of 3, no numbers. Our closest
  ancestor: the frame owns the box.
- **AnchoredAI** (Lou et al., 2025, 22 students) [p2]. Anchored AI comments beat a side chat on
  ownership (4.0 vs 2.3) and control (4.1 vs 3.5), at more effort (73.0 vs 41.4) and mental demand
  (80.7 vs 51.8). Chat users pasted about 6 times more words per paste. Anchors go stale after
  edits, and need an update step.
- **Collaborative editing with people and AI agents** (Lehmann, Shauchenka, Buschek; CHI 2026; 30
  people, 14 teams, one week) [p3]. People @-tag agents; agents reply only in threads and never
  edit text. Agent-started comments piled up and were ignored.
- **Codellaborator** (Pu et al., 2025, 18 people) [p4]. Presence indicators "alleviated disruptions
  and improved users' awareness of AI processes". The one direct test of agent presence found.
- **Mixed-initiative interfaces** (Horvitz, CHI 1999) [p5] and **Guidelines for Human-AI
  Interaction** (Amershi et al., CHI 2019) [p6]: time help by attention, efficient invocation and
  dismissal, make clear why the system did what it did (G11), global controls (G17).

## Data: who did it

- **Delegation, not impersonation.** RFC 8693 keeps the person in `sub` and the agent in `act`
  [s1]. AWS's agentic lens asks for separate agent identities so logs tell agent acts from a
  person's [s2].
- **The two public failures.** The Copilot coding agent becomes the main commit author on squash
  merge, and the person who asked disappears [h4]. An agent on a person's token shows in audit logs
  as the person [s3].
- **The makers carry the cause in data:** OTP keeps `From` in its State for a later reply [o1];
  event stores copy a causation id forward by hand [e1] [e2]; Datomic puts "the user who caused it"
  on the transaction [e3]; Zed gives each replica an id and counts its operations [z2].

## Accessibility

- ARIA 1.3's `role="comment"` with `aria-details` from the spot to its thread [a1]. A draft;
  screen reader support is not confirmed.
- WCAG 4.1.3: a status reaches assistive tech without focus; `role="log"` for a thread; never
  assertive for routine activity [a2]. Streaming tokens into a live region floods the reader;
  "announce once complete" is our inference.
- WCAG 2.1.1 and 1.4.1: select-then-key in every program; agent or person by a word and a shape,
  not only a color [a3] [a4].

## Outside software

| Trade | What it teaches | What does not carry over |
|---|---|---|
| A cockpit's two pilots [t1], **secondary** | Who flies is said aloud and said back: "You have the flight controls." | No voice here. The handover line in the tile is the read-back. |
| A rally co-driver [t2], **secondary** | Every note is read before the bend, not during it. | The co-driver never drives; our agent runs things in its own jobs. |
| A kitchen pass [t3], **secondary** | Every plate is checked at one place, whoever cooked it. | One expediter; two people on one desk is a later case. |

## The walk: what the owner picked and rejected

Four designs (A to D), four presence options (P1 to P4), `@claude` in tsh, and talking at a spot
were drawn on the canvas, at one tile filling the window and at a 2x2.

| Item | Outcome | Why |
|---|---|---|
| One kind of tile, any agent summoned into it | picked (decided) | The person acts where they are. The "agent's own tile" goes. |
| Today's split (PR 3a's own tile, PR 3b's hidden controls) | rejected | Two tiles for one ticket, and the person must leave to act. |
| "Only you can answer this. Open #7 in your own tile." | rejected everywhere (decided) | Never send the person to another tile to act. |
| B, follow the agent's tile | rejected (decided) | You watch in your tile and act only by leaving it; it also shows the same thing twice. |
| A's one-shot job as the person, for a press in claude's job | rejected (decided) | A hidden second `ticket` run behind the person; the answer shows one poll late. |
| D, the cause carried in the data | picked as the direction (decided) | The makers' way; the press stays in its own run; the agent never holds the person's authority for more than one write. |
| D, the host pairing each Cmd with its Msg | rejected | Wrong whenever a machine queues work, which the tracker does; tea would have to grow. |
| C, the agent's activity on the ticket | leaned, beside A | Linear's own shape; not decided. |
| P1, the word in the title bar | leaned against (proposed) | Too quiet; the same gray as every title in a 2x2. |
| P2, an avatar: an agent a rounded square with ✦, a person a circle | picked (proposed) | A shape that shows on an unfocused tile. |
| P3, the tile's edge and a name tab | leaned against (proposed) | The edge already means focus; one edge cannot hold two agents. |
| P4, a presence label on what the agent writes | picked with P2 (proposed) | It says where work happens. "Flag" was rejected as the word: a flag is a command option. |
| A ring or glow on the avatar | leaned against (proposed) | The presence label already says where. |
| Radix orange for agents, only in the avatar and the label | leaned, 65% | The widest free hue gap; close to amber and red, so a shot must settle it. |
| `@claude` in tsh, and no chat program | leaned in the walk (proposed) | Easy first day; agents learn to compose with programs. |
| A spot's reply copied into tsh | rejected (decided) | The reply stays at the spot. |

## Today's ticket #7

| What | Today, on main | Where |
|---|---|---|
| A key in the terminal | no sender kept; only the time | `apps/fabrika/src/messages.ts`, `host/serve.ts` |
| A line to tsh | a plain string, no sender | `packages/fabrika/src/shell/shell.ts` |
| A press in a window | no sender | `apps/fabrika/src/messages.ts`, `tsh.ts` |
| A job | `by` from the tsh's writer, not the line's | `packages/fabrika/src/host/jobs.ts` |
| A ledger row | the run's `Author`, not the press's | `programs/tracker/src/ledger.ts` |
| A row behind the door | stamped from the session's credential | `packages/fabrika/src/host/writer.ts` |

Checked against the rules: "every write says who" holds only while a tile has one sender. "Only a
person" holds on main and breaks in PR 3a, where the owner's Approve is refused in claude's tile.
"Presence apart from the program's name" breaks: PR 3b puts `claude · ticket #7` in the name slot.

## What this tells us for fabrika

- Record who sent each input now, before any shared tile ships. A field added later never reaches
  the rows written before it.
- Carry the cause in the data, and catch the program that forgets it with a test-kit law.
- Presence is a shape plus a name, and a label on the thing being written. No cursor.
- tsh is the chat, and a spot's thread stays at the spot. The frame owns the box.
- `next/`'s ledger entry needs `cause` now, and "a spot" needs a design.

## What it cannot tell us

- Nothing ran. Whether a person reads an agent's lines in their scrollback or tunes them out needs
  a week of use.
- Whether two writers in one scrollback is noise at 1024x700: only 1440x900 and a 2x2 were drawn.
- The studies are small (18 to 30 people), mostly students and writing tasks, not shells or traces.
- The terminal tools have docs, not usability data. Several product claims are from summaries and
  are marked.
- Square versus circle avatars, fading labels and `@` in a shell have no study.
- No screen reader run.
- Cost not measured. No agent ran on a ticket, but one research subagent (a model run) read the web
  on a subscription, and its tokens were not logged, so there is no list-price dollar figure.

## Links

- [z1] Zed, collaboration: https://zed.dev/docs/collaboration ,
  https://zed.dev/docs/collaboration/channels
- [z2] Zed, CRDTs: https://zed.dev/blog/crdts
- [z3] Zed, agent panel and inline assistant: https://zed.dev/docs/ai/agent-panel ,
  https://zed.dev/docs/ai/inline-assistant
- [f1] Figma:
  https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight ,
  https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history
- [g1] Google Docs: https://support.google.com/docs/answer/190843 ,
  https://support.google.com/docs/answer/6033474
- [g2] Google Docs, keyboard shortcuts: https://support.google.com/docs/answer/179738
- [w1] Warp: https://docs.warp.dev/agents/capabilities/full-terminal-use/ ,
  https://docs.warp.dev/agents/autonomy/agent-permissions
- [w2] Warp, universal input: https://docs.warp.dev/terminal/input/universal-input/
- [cc1] Claude Code, interactive mode: https://code.claude.com/docs/en/interactive-mode
- [c1] Cursor: https://cursor.com/docs/agent/tools/terminal ,
  https://cursor.com/docs/agent/security/run-modes
- [c2] Cursor, inline edit: https://cursor.com/docs/inline-edit/overview
- [v2] VS Code, Copilot agent tools and approvals:
  https://code.visualstudio.com/docs/copilot/agents/agent-tools ,
  https://code.visualstudio.com/docs/agents/approvals
- [d1] Devin, session tools: https://docs.devin.ai/work-with-devin/devin-session-tools
- [ai1] aider, git: https://aider.chat/docs/git.html
- [l1] Linear, agent interaction guidelines: https://linear.app/developers/aig ,
  https://linear.app/developers/agent-interaction
- [l2] Linear, agents: https://linear.app/developers/agents ,
  https://linear.app/docs/agents-in-linear
- [l3] Linear, agent best practices: https://linear.app/developers/agent-best-practices.md
- [h1] GitHub, Copilot coding agent:
  https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations
- [h2] GitHub, @copilot on a pull request:
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/make-changes-to-an-existing-pr
- [h3] GitHub, Copilot CLI reference:
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- [h4] GitHub community discussion 179983: https://github.com/orgs/community/discussions/179983
- [lb1] Liveblocks, humans and AI:
  https://liveblocks.io/blog/how-humans-and-ai-will-work-together-in-the-next-generation-of-apps
- [x1] tmux(1): https://man7.org/linux/man-pages/man1/tmux.1.html
- [o1] Erlang gen_server: https://www.erlang.org/doc/apps/stdlib/gen_server.html
- [e1] Causation id, DDD/CQRS list: https://groups.google.com/g/dddcqrs/c/qGYC6qZEqOI
- [e2] Axon, message correlation:
  https://docs.axoniq.io/axon-framework-reference/development/messaging-concepts/message-correlation/
- [e3] Datomic, transaction data:
  https://docs.datomic.com/transactions/transaction-data-reference.html
- [s1] RFC 8693: https://www.rfc-editor.org/rfc/rfc8693
- [s2] AWS agentic AI lens:
  https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03-bp02.html
- [s3] Ory, audit logs: https://www.ory.com/blog/audit-log-says-service-acount-did-it
- [p1] Anchored Conversations, CHI 2000: https://dl.acm.org/doi/10.1145/332040.332475
- [p2] AnchoredAI: https://arxiv.org/html/2509.16128v1
- [p3] Lehmann et al., CHI 2026: https://arxiv.org/html/2509.11826v2
- [p4] Codellaborator: https://arxiv.org/abs/2502.18658
- [p5] Horvitz, mixed-initiative: https://www.erichorvitz.com/chi99horvitz.pdf
- [p6] Amershi et al., HAX toolkit: https://www.microsoft.com/en-us/haxtoolkit/library/
- [a1] MDN, comment role:
  https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/Comment_role
- [a2] WCAG 4.1.3: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- [a3] WCAG 2.1.1: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- [a4] WCAG 1.4.1: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- [t1] Cockpit, positive exchange of flight controls (**secondary**):
  https://www.globalair.com/articles/tips-on-positive-exchange-of-flight-controls-in-pilot-training/5822
- [t2] Rally co-driver (**secondary**): https://en.wikipedia.org/wiki/Co-driver
- [t3] Kitchen pass (**secondary**):
  https://www.foodrepublic.com/1539644/what-is-expo-restaurant-kitchens/
