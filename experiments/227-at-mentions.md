---
date: "2026-11-07"
scripts: "none"
summary: "About `next/`'s text line; reading only, not a measurement, from vendor docs. VS Code deprecated its `@participant` and `#` split; Claude Code, Cursor and Zed use one `@` and tell kinds apart by the picked item. Lean: one `@`, the first `@name` is who answers, every later one a reference (75%). Decided by the owner the same day in [summon guidelines](../docs/direction/summon-guidelines.md#the--line-decided-2026-11-07). No model, $0."
---

# 227. Should one `@` both pick who a line talks to and point at things?

Read 2026-11-07. This is reading, not a measurement. About `next/`'s text line (fabsh and the
shared tile), from vendor docs fetched that day. No model, $0. In `@scout check @linear for what's
going on`, should `@` both pick the addressee and point at context? Tags: [primary] = fetched vendor
page, [secondary] = inferred from a fetched page, [guess] = not found in a page.

**Decided 2026-11-07:** one `@` sigil for agents, connectors and things, as the owner settled in
[summon guidelines](../docs/direction/summon-guidelines.md#the--line-decided-2026-11-07). The recommendation below is what fed
that call.

## Answer first

- Most tools now use one sigil, `@`, for context. VS Code, the one tool that split `@agent` from
  `#thing`, has deprecated `@participant`. [primary]
- Claude Code puts agents, files and MCP resources all under `@`, told apart by the picked item's
  type, not by a second sigil. [primary]
- No tool we read uses "first `@` is the addressee" as a parse rule. [secondary]
- Shells do exactly that with position: first word is the command. [primary]

## 1. VS Code / GitHub Copilot Chat

- `#` lists context: files, folders, symbols, tools. "Type the `#` symbol in the chat input field
  to see a list of available context items." [primary]
  https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context
- Tools go under `#` too: "use the `#fetch` tool". So tools share the context sigil. [primary] (same URL)
- `@participant` is going away: "Chat participants invoked with `@name` are deprecated and are not
  supported in the Copilot harness." [primary] (same URL; also
  https://code.visualstudio.com/api/extension-guides/ai/chat: "Do not use it for new Copilot integrations.")
- Ambiguity: the docs don't describe rules; you pick from a list, so the item is typed. [secondary]
- Lesson: the two-sigil split was tried by the biggest player and walked back toward "just ask". [secondary]

## 2. Claude Code

- Subagents: "Type `@` and pick the subagent from the typeahead, the same way you @-mention files."
  Typed form `@agent-<name>`. [primary] https://code.claude.com/docs/en/sub-agents
- "The @-mention controls which subagent Claude invokes, not what prompt it receives." [primary] (same URL)
- MCP resources: "Use the format `@server:protocol://resource/path`", e.g.
  `Compare @postgres:schema://users with @docs:file://database/user-model`. [primary]
  https://code.claude.com/docs/en/mcp
- So one `@`; the namespace inside the token says the kind (`agent-`, `server:`, a path). [primary]
- MCP tools have no sigil; the model calls them as `mcp__<server>__<tool>`. [primary] (mcp page)
- Position does not matter for `@agent-x`; it can sit anywhere. [secondary]
- Busy: subagents spawned from the main chat start in the background by default and run
  concurrently; cap of 20, then "Concurrent subagent limit reached". [primary] (sub-agents page)

## 3. Slack

- `app_mention` fires for "message events that directly mention your bot users". [primary]
  https://docs.slack.dev/reference/events/app_mention
- An app not in the channel gets no event until invited. [primary] (same URL)
- Two apps in one message: the page doesn't say. Likely each mentioned app gets its own event,
  and none is "the addressee"; every mention is a summons. [guess]
- Busy: Slack just delivers events; queuing is each app's job. [guess]

## 4. Linear

- People and agents are both `@mentioned`: "@mention them in comments or descriptions to trigger
  their functions." [primary] https://linear.app/docs/agents-in-linear
- Delegation is a separate act: assigning an issue to an agent. [primary] (same URL)
- Both start a session: "An `AgentSession` is created automatically when an agent is mentioned or
  delegated an issue." [primary] https://linear.app/developers/agent-interaction
- Issues are linked by ID/URL, not by the agent sigil. [guess, not fetched]
- Busy: a follow-up becomes a `prompted` event: "A user sent a new message into an existing Agent
  Session." The agent folds it into its history. Not refused. [primary] (agent-interaction)

## 5. Cursor and Zed

- Cursor: `@auth.ts`, `@Terminals`, `@Chats`, `@Browser`, git diffs; `/` invokes a skill. No `#`. [primary]
  https://cursor.com/docs/context/mentions
- Zed: `@` attaches files, dirs, symbols, threads, skills, diagnostics, diffs, URLs. [primary]
  https://zed.dev/docs/ai/agent-panel
- In both, the addressee is the panel itself; `@` is only context. [secondary]
- Busy, Zed: messages sent during generation "are queued by default"; each can be edited, marked
  "Steer" (interrupts at the next step) or "Send Now". [primary] (zed page)
- Busy, Cursor: not on the fetched page. [guess: queues, unverified]

## 6. Shell precedent

- POSIX: "the first field shall be considered the command name." The rest are arguments. [primary]
  https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html (2.9.1.1)
- Position, not a sigil, says who runs. The command name has no sigil at all. [primary]
- Arguments are just words; their meaning is the command's job. [secondary]

## Busy agent, side by side

| Tool | Message to a busy agent |
|---|---|
| Zed | Queued; can steer or send now [primary] |
| Linear | Delivered into the session as `prompted` [primary] |
| Claude Code subagents | New ones run in parallel, up to 20 [primary] |
| Slack | Delivered; app decides [guess] |
| VS Code, Cursor | Not found [guess] |

## Recommendation

One sigil, `@`, with position deciding the role. The first word of the line, if it is `@name`
and names an agent, is the addressee (like a shell's command word). Every later `@name` is a
reference, and its kind (agent, connector, file) comes from the registry, not the sigil.
`@linear` later in the line is context even though connectors and agents share `@`.

- Why: matches the shell (fabsh is a shell), matches Claude Code/Cursor/Zed, and VS Code's
  two-sigil split was deprecated. One sigil means one typeahead.
- Cost: a name used by both an agent and a connector is ambiguous. Fix: one namespace in the
  registry, names unique across kinds (or a typed prefix like Claude Code's `@server:`).
- Cost: "talk to two agents" (`@scout @builder ...`) needs a rule. Lean: only the first is the
  addressee; to send to both, write two lines. [guess]
- Busy agent: queue by default, with a steer/interrupt option, like Zed and Linear. Never refuse.
- Confidence: about 75%. Doubt: no vendor documents "first `@` = addressee" as a rule, so it is
  our own invention on top of the shell analogy. What would settle it: a short hand trial of
  ~20 real lines to see if people put the agent anywhere but first.

## What this cannot tell us

- Slack multi-app and Cursor queue behavior were not in the fetched pages.
- No usability data; the lean rests on precedent, not tests.
