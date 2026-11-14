---
state: "decided 2026-11-08, the five principles; other candidates proposed"
summary: "Both versions. A first draft of the principles page: multiplayer work with agents (agents sign their own work in your tiles), spend the person's attention well, talk where people are and then bring them in, and one shape, two readers (agent accessibility, a running list of rules each with its WCAG twin: tool parity for 2.1.1, the screen never the only place for 1.4.1), and unsure is a setting (a choice short of sure goes in `fabrika.toml` with a safe default and its use recorded, so data decides and nobody's belief is forced; an experiment flag comes out once decided, a preference stays, and a wall is never a setting an agent can turn off)."
---

# Principles: what fabrika is for, in five lines

**Decided 2026-11-08 (owner): the five principles, as written.** The principles page the design
language lacked ([design language](./design-language.md)). The owner named the first three on
2026-11-05, the fourth, agent accessibility, the same day, and the fifth, unsure is a setting, the
same evening. The "Other candidates" below stay proposed. Both versions.

```ts
// A sketch. Each principle as a check a design or a pull request can be read against.
const Principle = Schema.TaggedUnion({
	multiplayer: {test: Schema.Literal("does each agent sign its own work, in the person's tile?")},
	attention: {test: Schema.Literal("does it show only what needs the person, with context kept?")},
	where_they_are: {test: Schema.Literal("does it start where the person is, then bring them in?")},
	two_readers: {test: Schema.Literal("can an agent do and read all of it, through tools and data?")},
	unsure_is_a_setting: {test: Schema.Literal("if we are not sure, is it a setting with a safe default?")},
});
```

Ticket #7, the running example, read against all four:

```text
the owner works ticket #7 in t1 and summons claude there               1, 3: one tile, the person's
claude runs `pipeline --ticket 7 | ticket`; its rows say claude         1: the agent signs its own work
the lane asks "approve plan v1"; the inbox shows one ask, nothing more  2: only what needs the person
the owner selects the plan span, asks "why so slow?"; the span rides    2: no re-explaining
claude reads the same plan as typed data through a tool                  4: one shape, two readers
```

## 1. Multiplayer work with agents

Figma made design multiplayer. fabrika makes work with agents multiplayer. Agents are teammates in
your tiles, and they sign their own work.

- **Means:** one kind of tile, summoned agents, and each write signed by its sender
  ([shared tiles](./shared-tiles.md), [inputs carry their sender](./inputs-carry-their-sender.md)).
- **Why:** the known way is delegation, not impersonation (RFC 8693's `act`; Linear's delegate,
  where the person stays the owner).
- **Breaks it:** an agent that writes as the person, or a person sent to an agent's tile to act.
- **Not only tickets** (owner, 2026-11-05). fabrika is much more than agents fixing tickets. A
  ticket is one thing work can point at, never the frame every feature must fit. Talk between
  agents and people lives in its own thread, and may point at a ticket, a span, a file or nothing
  ([the ledger, section 10](./the-ledger-goes-to-cloudflare.md#10-how-agents-talk-to-each-other-across-two-people)).
  A feature that refuses to work without a ticket breaks it.

## 2. Spend the person's attention well

Show only what needs them. Let them jump in anywhere. Never make them re-explain context: the spot
carries it ([talk where you work](./talk-where-you-work.md)).

- **Why:** Horvitz's mixed-initiative factors (time help by attention; keep a memory of shared
  objects) and Amershi et al.'s guidelines G3, G11 and G17. In the CHI 2026 study, agent-started
  comments piled up and were ignored.
- **Breaks it:** an agent that speaks first often, a reply copied in two places, a person asked
  for a fact the ledger holds ([ask for decisions, not facts](../../.decisions/0415-ask-a-person-for-decisions.md)).

## 3. Talk where people are, then bring them in

Start where the person already talks: a chat, a terminal, a canvas. From there, the agent brings
them into fabrika, the way you share your screen with a coworker: it opens a tile on their desk.
Nobody has to move in first.

- **Means:** tsh is the chat; `@claude` works where a text box already is; an agent's work shows in
  the tile you are in.
- **Breaks it:** a new app or window you must open before you can work with an agent.

## 4. One shape, two readers (agent accessibility)

A program is accessible to people and agents alike. Agents that browse the web already lean on the
accessibility tree: Playwright's MCP server, for one, reads pages through it rather than pixels
([playwright-mcp](https://github.com/microsoft/playwright-mcp)). So the two jobs meet. This may grow
into agent accessibility guidelines, with fabrika as the testbed.

The running list. Each rule has its WCAG twin:

| Our rule | Its WCAG twin | What holds it |
|---|---|---|
| Tool parity: anything a person can do, an agent can do through tools | Keyboard parity, [2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) | A test-kit check: every input of a program has a tool, or is marked person-only |
| Person-only inputs are a permission, not a gap | none; WCAG has no actor types | The door's person-only kinds, and an agent's list with no `answer` |
| The screen is never the only place: everything shown exists as typed data | Color is never the only cue, [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) | A test-kit check: every output has a person form and a data form ([data first](./data-first-markdown-is-a-view.md)) |
| Every input is described, in words a model reads | Name, role, value, [4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) | A test-kit check, as an a11y linter is for people |
| A change says itself once, as a fact | Status messages, [4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | A program's outputs are facts on the ledger, never only pixels |

## 5. Unsure is a setting

When we are not sure of a choice, it goes in a setting, not in code everyone must live with. A
setting has a safe default, so we can try both ways, measure, and decide. Different people and
repos can choose differently, and we do not force our beliefs on them.

- **Means:** a choice short of sure lives in the repo's `fabrika.toml`
  ([one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)) or as a feature flag in it, with a
  default that is the safe side. Which value each person runs, and what came of it, is recorded
  ([record wide](../../AGENTS.md)), so the data can decide later. First use: the started claude's
  network allow list and hidden files ([talk where you work](./talk-where-you-work.md)).
- **Why:** the industry's way. Martin Fowler's
  [feature toggles](https://martinfowler.com/articles/feature-toggles.html) name four kinds:
  release, experiment, ops and permission. Claude Code's deny rules and Copilot's paths to exclude
  are settings for the same reason.
- **Two kinds, kept apart.** An experiment flag, which waits on a decision, comes out once the data
  decides: Fowler calls a flag left behind debt. A preference, where people truly differ, stays.
- **A wall is never a setting an agent can turn off.** A setting comes from a person: an agent
  cannot write `.fabrika/`. And a person-only wall (no agent answers or approves) is not a setting
  at all.
- **Breaks it:** a guess hard-coded for everyone, a setting with no default or an unsafe one, or a
  flag nobody records the use of.

## Decided rules

- **fabrika is for building, not enterprise security** (owner, 2026-11-08). An admin's invite is
  already trust, so recovery has no wait and no barrier.

## Other candidates

The design-language draft offers five lines for the design system itself, in fabrika's words. They
sit one level down from the four above, and the owner picks which stay:

1. Quiet, and accessible, and neither gives way ([color principles](./color-principles.md), 1).
2. Keys first, and the pointer never hits a dead end.
3. Every part that takes a key has a name, a role and a state, said in words.
4. A token says what it means, never how it looks.
5. One way to do each thing, and the code is its source.

## Why a page, and how sure

- **Why:** every later argument points at a line. The rules in AGENTS.md's "Changing the product"
  (the daily moment first, keep the platform's defaults, Linear as the builder) stay there as
  product rules; these five say what the product is for.
- **Cost:** this page, about 130 lines, and one test-kit check per row in principle 4 when built.
- **How sure:** 70% on the five. The doubt is whether "multiplayer" is the right first word for a
  product two people use today; a month of daily use says. On the fifth, the doubt is how many
  settings grow before they need their own page.

## What it cannot tell us

- Whether these five settle real arguments. Only the next few design walks show it.
- Whether "agent accessibility" holds as a set of rules. We found no published guidelines of this
  kind, and the twins above are our mapping, not a standard.
- Whether a test-kit check can tell a good description from a bad one. Words a model reads well are
  not measured.
