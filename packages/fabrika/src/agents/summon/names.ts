import { defineMachine } from "@demlik/tea";
import { run as runMachine } from "@demlik/tea/effect";
import { Effect, Schema } from "effect";
import type { Storage } from "../../program/storage.ts";

// The names a person summoned agents under, kept: a tea machine on the host's storage, so a
// host started again opens each agent again, in the same session. A name is one agent until it
// is dismissed: a taken name is refused here, in `update`, never in a view (S3), as Erlang's
// `register` fails on a taken name.
//
//   taken scout (acp:scout-1a2b, fake fake-large)   names: [scout]
//   taken scout (acp:scout-9f00, ...)               names: [scout], the first one still: refused
//   freed scout                                     names: []

/** What is kept of one name: enough to open its agent again, and what it meant when summoned. */
export const Name = Schema.Struct({
  name: Schema.String,
  agent: Schema.String,
  /** The acp run behind it: the same run id opens the same session after a restart. */
  run: Schema.String,
  model: Schema.Struct({
    typed: Schema.NullOr(Schema.String),
    resolved: Schema.NullOr(Schema.String),
  }),
  effort: Schema.Struct({ typed: Schema.NullOr(Schema.String), set: Schema.NullOr(Schema.String) }),
  folder: Schema.String,
  since: Schema.Finite,
  by: Schema.String,
});
export type Name = typeof Name.Type;

const Names = Schema.Struct({ names: Schema.Array(Name) });
type Names = typeof Names.Type;

type NamesMsg = { readonly type: "taken"; readonly name: Name } | { readonly type: "freed"; readonly name: string };

const names = defineMachine({
  types: { model: {} as Names, msg: {} as NamesMsg, ctx: undefined },
  cmds: [],
  init: (loaded) => [loaded ?? { names: [] }, []],
  update: {
    taken: (s, m) => (s.names.some((n) => n.name === m.name.name) ? [s, []] : [{ names: [...s.names, m.name] }, []]),
    freed: (s, m) => [{ names: s.names.filter((n) => n.name !== m.name) }, []],
  },
});

/** Where the names are kept in the host's storage: a run of their own. */
const KEPT = { run: "summon", machine: "names", key: "names" } as const;

/** The kept names, for as long as the caller's scope. */
export const openNames = (storage: Storage) =>
  Effect.gen(function* () {
    const home = yield* storage.open(KEPT.run, null).pipe(Effect.orDie);
    const booting = yield* runMachine(names, {
      ctx: undefined,
      store: home.store(KEPT.machine, KEPT.key, Names),
    });
    const runtime = yield* booting.ready.pipe(Effect.orDie);
    return {
      /** The names now. */
      now: (): Names => runtime.getState(),
      /** Take a name for an agent: `false` when it was taken already, and nothing changed. */
      take: (name: Name) =>
        runtime.dispatch({ type: "taken", name }).pipe(
          Effect.orDie,
          Effect.map(() => runtime.getState().names.some((n) => n.name === name.name && n.run === name.run)),
        ),
      free: (name: string) => runtime.dispatch({ type: "freed", name }).pipe(Effect.orDie),
    };
  });
