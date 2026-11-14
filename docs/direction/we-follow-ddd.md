---
state: "decided 2026-11-03; 2026-11-09: inside libfabrika a folder is a module, not a context ([0043](../../.decisions/0043-rooms-on-floors.md), named 2026-11-10 by [0091](../../.decisions/0091-modules-and-layers.md))"
summary: "Both versions. Bounded contexts and a ubiquitous language as Evans defines them: inside one context a word has one meaning; across two it may differ, and the glossary's context map names the boundary and how the word translates. First case: inbox is a stream others write to in the ledger and a person's list of things waiting in the tracker; the asks program is `inbox`. Replaces the 2026-10-24 two-domains softening. The eight contexts and the context map in `.glossary/TERMS.md` are decided too."
---

# We follow Domain-Driven Design

**Decided 2026-11-03 by the owner.** Both versions. The rule, the eight contexts drawn in
[the glossary](../../.glossary/TERMS.md) and its context map are all decided, in the same pull
request ([PR 362](https://github.com/usirin/tea-fabrika/pull/362)).

```text
ledger context    inbox   a stream others write to: build:7/inbox
tracker context   inbox   a person's list of things waiting: the inbox program

context map       inbox   the ledger's inbox is where a write comes in; the tracker's inbox is what
                          a person reads. An ask crosses as `asked` and `answered` facts, never as
                          the word.
```

One word, two meanings, two contexts, and one line that says how they meet. That is the whole idea.

## What was decided

- **We follow Domain-Driven Design without apology.** We use its bounded contexts and its
  ubiquitous language as Eric Evans defines them (Domain-Driven Design, 2003, part IV), with
  Vaughn Vernon's context maps (Implementing Domain-Driven Design, 2013, chapters 2 and 3).
- **Inside one bounded context, a word has exactly one meaning.** Two meanings inside one context
  is a bug to fix.
- **The same word may mean different things in two contexts.** That is normal, not a clash, as
  long as the context map names the boundary and says how the word translates across it.
- **The contexts and the map live in the glossary,** `.glossary/TERMS.md`: one section per
  context, then a context map section, then the clashes still open inside one context.
- **The glossary is `next/`'s language, split by version.** Its sections hold `next/`'s words,
  from the decided notes, and a word that means the same in both versions lives only there. Its
  last section, "Today's version says", is the anticorruption layer for today's code: one row per
  place where today's code says another word, deleted with that code. It is a section, not a
  file, because `fabrika glossary check` reads only `TERMS.md` and `LANGUAGE.md`.
- **First case: inbox keeps both meanings.** In the ledger context it is a stream others write to
  (`build:7/inbox`, the transactional inbox pattern). In the tracker context it is a person's list
  of things waiting (Linear's Inbox). The asks program is named `inbox`, and the owner's desk is
  the inbox. No `mailbox` rename.

## Why

- **It is the known way.** Evans says a model holds inside an explicit boundary, and only there.
  From his DDD Reference (2015), his own summary of the book's patterns, as fetched on
  2026-11-03 from domainlanguage.com:
  - Bounded Context: "Explicitly define the context within which a model applies." Keep "model
    concepts and terms strictly consistent within these bounds, but don't be distracted or
    confused by issues outside."
  - Ubiquitous Language: "Within a bounded context, use the same language in diagrams, writing,
    and especially speech."
  - Context Map: "Name each bounded context, and make the names part of the ubiquitous language.
    Describe the points of contact between the models, outlining explicit translation for any
    communication."
- **Vernon (secondary).** Implementing DDD, chapter 2, says a bounded context should be as big as
  it needs to be to express its whole ubiquitous language. This is from a summary of the
  publisher's preview, not checked against the book's own text.
- **Fowler (secondary).** His BoundedContext page names the problem: "Time and time again I see
  this confusion recur with polysemes like 'Customer' and 'Product'." (martinfowler.com, fetched
  2026-11-03.)
- **One meaning everywhere fought the industry's own words.** The ledger's inbox is the
  messaging world's word. A person's inbox is Linear's. A rename to keep one meaning everywhere
  would take a proper name away from one of them, which [use the industry's
  names](./use-the-industrys-names.md) forbids. Contexts let both keep theirs.

## What it replaces

- The 2026-10-24 rule in [use the industry's names](./use-the-industrys-names.md): a word "may
  lean a little differently in two domains", but "one meaning everywhere still comes first". Now
  one meaning holds inside a context, and the context map decides across contexts.
- The G8 lean on [PR 332](https://github.com/usirin/tea-fabrika/pull/332) (proposed) that ruled
  "inbox" out for the asks program over the stream clash. That clash is now a context map line.

## How a reader knows which context they are in

- **The path.** Each context's section in the glossary names the paths that belong to it.

  ```text
  packages/pipeline, programs/pipeline                    pipeline
  next/'s tracker programs (today: programs/tracker)      tracker
  next/'s app layer (layer 4), fabsh                      runtime
  next/'s data and coordination (layers 2 and 3)          ledger
  next/'s transport (layer 1), the hands                  clients
  next/'s Tuval (layer 5), @kampus/fabrika-design         frame
  docs/, experiments/, field/, replay/, singles/          records
  ```

  The borders follow `next/`'s layers where today's code draws them elsewhere: today's one
  `Ledger` service mixes layers 2 to 4, and `next/` splits it.

  *Changed 2026-11-09 (owner,
  [0043](../../.decisions/0043-rooms-on-floors.md)): inside `@kampus/libfabrika` a folder is
  not a context and not a layer. It is one subject, a module (`access/`, `processes/`, `ledger/`),
  Evans's Module, and the library's layers live only in the rule file. A module's words still have
  their rows in the context that owns them: `access/`'s under clients, `processes/`'s under ledger.
  The table above stays as the map from layers to contexts. Renamed 2026-11-10 (owner,
  [0091](../../.decisions/0091-modules-and-layers.md)): 0043 said room, which stays only as the
  analogy.*

- **The package.** A package belongs to one context, or to the shared names.
- **The glossary section.** A row sits in the section of the context that owns the word. A word
  used in two contexts has a row in each, and its context in parentheses in the key, such as
  `inbox (ledger)` and `inbox (tracker)`.

## What holds it

- **The glossary's sections and its context map.** `fabrika glossary check` refuses one key in
  two sections (`duplicate-key ... also declared in "<section>"`), so a word in two contexts must
  carry its context in its key. That is the glossary skill's own answer to a word with two
  senses: qualify both by namespace and keep the word.
- **Later, a drift check.** A weekly `fabrika glossary drift` run that files a ticket for each new
  word without a row. Not built; its own change.
- **Review.** Names are checked on every pull request, prose included (AGENTS.md, "Names").

## What it cannot tell us

- **Where the borders really are.** The contexts follow today's paths and `next/`'s notes, and
  `next/` is not on main. Evans draws borders by team, by part of the app and by code base; we are
  two people and their agents, so ours follow the code.
- **Whether a word is used in its context's meaning.** Nothing checks that yet. The verb checks the
  file's shape, not the prose around the repo.
- **Whether a reader picks the right context from a path.** Untested. A file that sits on a
  border, such as a pipeline step that writes ledger facts, may read as either.
