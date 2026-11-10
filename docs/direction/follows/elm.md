# Where we follow Elm

`@demlik/tea` is the Elm architecture in TypeScript, and every new shape names Elm's answer first
([Elm first](../elm-first.md)). This table is about `next/`. One row per behavior. Paths are under
`next/packages/libfabrika/src/` unless they start with `next/`. A pull request that changes one of
these behaviors updates its row in the same pull request
([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).

Seeded 2026-11-09 from [Elm first](../elm-first.md) and its named exceptions, checked against main
at `5b1171ed`. Elm's side is [the Elm guide][arch].

| Behavior | What Elm does | What we do | Same or differs |
|---|---|---|---|
| A program is model, Msg, `update` | `init`, `update` and `view` around one model ([arch]) | `Machine.make` with `model`, `msg`, `init` and `update` (`next/programs/counter/src/program.ts:14-24`) | same |
| `update` returns a new model and Cmds | `update : Msg -> Model -> (Model, Cmd Msg)` ([effects]) | Each case returns `[model, cmds]` (`app/supervisor.ts:100-136`) | same |
| A Cmd is data the runtime runs | A `Cmd` describes work; the runtime does it ([effects]) | `Cmd.make("exit" ...)`, `"down"`, `"start"` (`app/supervisor.ts:28-42`), run by the runner | same |
| `init` gets outside data | `init : flags -> (Model, Cmd Msg)` ([flags]) | `init` gets the saved model, or null (`app/program.ts:501-505`) | same: the saved model plays the part of flags |
| Ongoing waits are Subs | `subscriptions : Model -> Sub Msg`, a list ([effects]) | `wake: (model) => number \| null`, one time per program (`app/program.ts:235`), on the object's one alarm (`app/runner.ts:291-294`) | differs, because a Durable Object has one alarm; more Subs are not built |
| `view` draws from the model | `view : Model -> Html Msg`, pure ([arch]) | `view.select: (model) => V`, plain JSON data (`app/program.ts:227-230`); a window draws it, not built (P14) | differs, because the view crosses the wire to a window, a browser tab or an agent |
| Outside data is decoded before `update` | JSON decoders turn outside values into typed ones ([json]) | Each letter is checked against the program's Msg schema; a bad one is `refused {why: "bad_msg"}` (`app/program.ts:508-510`) | same |
| A program may say no | No refusal: Msgs come from the program's own view ([arch]) | A required `refuse(model, msg)`, run on fresh letters only (`app/program.ts:231`, `:511-513`) | differs, because our Msgs come from a window that may be out of date ([Elm first](../elm-first.md)) |
| Parents are written by hand | A parent holds its child's model and calls its `update`, with `Cmd.map` ([structure]) | No program has a child yet; the runner, not a machine, steps the supervisor machine (`app/runner.ts:310-431`) | differs, because nothing in Tier 1 nests programs; the factory as a parent is not built |
| No pipeline language | None: wiring is plain functions ([structure]) | `fabsh` lines are not built, a later tier ([tier 1](../../plan/tier-1.md), "Later tiers"); tsh lines are today's version | differs, because a person at a shell types one line that wires programs, the named exception ([Elm first](../elm-first.md#changed-2026-10-28-exceptions-are-named-with-their-reason)) |
| No late-bound dispatch | App code never holds the runtime's `send` ([arch]) | `Program` holds only pure functions: `view`, `refuse`, `wake` (`app/program.ts:220-236`) | same |
| All UI state lives in the model | Every piece of state is in the one model ([arch]) | No window in `next/` yet; a window will read its run through tea's `useRuntime` (P14, P18) | differs, because not built yet |

Count: 12 rows, 6 same, 6 differ. Of the 6, 3 are not built yet (a parent program, `fabsh`
lines, windows).

[arch]: https://guide.elm-lang.org/architecture/
[effects]: https://guide.elm-lang.org/effects/
[flags]: https://guide.elm-lang.org/interop/flags.html
[json]: https://guide.elm-lang.org/effects/json.html
[structure]: https://guide.elm-lang.org/webapps/structure.html
