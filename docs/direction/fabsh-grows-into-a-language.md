---
state: "proposed 2026-11-06; walked at Tier 5"
summary: "A vision: fabsh lines like `summon claude haiku as scout on cloud` already have a grammar, so highlighting and completion come from it and from the desk's searchable rows. Saved, not planned."
---

# fabsh grows into a language

**Proposed 2026-11-06, a vision note.** Walked when Tier 5 starts (owner, 2026-11-08): summon's grammar, completion and highlighting. Nothing here is planned for a tier. It is saved so it is not
lost, and tied to a real problem: lines like `summon claude haiku xhigh as scout on cloud` already have
a verb, values and keywords (`as`, `on`). That is a grammar, not a command with flags.

```text
fabsh> summon claude haiku xhigh as scout on cloud
fabsh> @scuot find the retry      # shown as unknown before Enter: no agent is named scuot
```

- **Highlighting from the grammar.** A name the person defined, a model, a place and a keyword each
  read as what they are, and an unknown name is marked before the line runs. fish does this as you
  type; Nushell is a shell built as a typed language. Both show people want it.
- **Completion and highlighting from the desk.** The shell knows `scout` exists because the desk
  does: the same `SearchableItem` rows programs hand the desk
  ([program guidelines](./program-guidelines.md), G7 R5).
- **Accessibility.** Color is never the only cue: an unknown name also gets a word, read by a
  screen reader (WCAG 1.4.1).

## What it cannot tell us

Whether a grammar beyond a few keywords pays for itself. The first real use is `summon`; a second
keyword-heavy command would be the sign to write a grammar.
