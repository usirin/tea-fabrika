# Diagrams

For a pattern doc and for a decision file
([0005](../../../../.decisions/0005-patterns-and-decisions-are-visual.md)). The write-pattern and
adr skills both read this file.

**Rule one: diagrams are Mermaid wherever possible.** Only when Mermaid really cannot express the
thing may a doc or a decision use ASCII art or another form, and then it says in one line, right
above the picture, why Mermaid could not.

- The diagram shows the real mechanism, with real names from the code: the files, functions, Msgs,
  states and commands a reader will grep for. No decorative boxes, no "System" or "Service"
  placeholders.
- Dark-mode safe: no `style`, `classDef`, `linkStyle` or `%%{init}` theme lines. GitHub picks the
  colors for each theme.
- About 12 nodes at most. A bigger mechanism or idea gets two diagrams, each one part.
- At most one table per section (AGENTS.md).

Which diagram fits which idea. All of these render on GitHub:

| The idea | Mermaid type |
|---|---|
| who calls whom, in time order (a Cmd, a reply, a restart) | `sequenceDiagram` |
| a machine's states and the Msgs that move it | `stateDiagram-v2` |
| a route, a choice, a process or data flowing through steps | `flowchart TD` or `flowchart LR` |
| types and what holds or extends what | `classDiagram` |
| stored records and their keys | `erDiagram` |
| branches, merges, a stack of commits or pull requests | `gitGraph` |

Things that break on GitHub:

- Quote a label that holds punctuation: `a["act(name, spec)"]`, `a["gh stack merge --squash"]`.
  Write `<` and `>` in a label as `#lt;` and `#gt;`.
- A node id is one plain word. `end` as a lowercase id breaks a flowchart.
- `%%` starts a comment. Use it to name the source file a diagram was read from.
- In `stateDiagram-v2`, a transition label is the Msg's real `type`: `idle --> asking : ask_sent`.
