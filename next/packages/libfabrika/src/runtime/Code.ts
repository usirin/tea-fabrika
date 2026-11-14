/**
 * The code each program runs: which hash is selected per program, the facts that record a change, and
 * the machine that folds them. A `checked` Msg only asks for a `code.loaded` fact; only folding that
 * fact changes the selection and pushes a swap.
 *
 * @stability unstable
 */
import { Machine, Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { ProgramName } from "../packs/ProgramName.ts";
import { Hash } from "./Built.ts";
import { Swapped } from "./Runner.ts";

/**
 * Schema for where an install came from: `watch`, `deploy`, `boot` or `restart`.
 *
 * @stability unstable
 * @category schemas
 */
export const From = Schema.Literals(["watch", "deploy", "boot", "restart"]);

/**
 * Schema for the two code facts: `code.loaded` names a program's new hash and the one it replaced
 * (`was`, `null` for the first), and `code.failed` names why a candidate was refused.
 *
 * **Details**
 *
 * A `code.failed` fact carries `hash: null` when the source never bundled, and may carry the `path` and
 * `line` of the error.
 *
 * @stability unstable
 * @category schemas
 */
export const CodeEvent = Schema.TaggedUnion({
  "code.loaded": { program: ProgramName, hash: Hash, was: Schema.NullOr(Hash), from: From },
  "code.failed": {
    program: ProgramName,
    hash: Schema.NullOr(Hash),
    reason: Schema.Literals(["bundle", "compiler", "load", "name", "too_large"]),
    path: Schema.optionalKey(Schema.String),
    line: Schema.optionalKey(Schema.Int),
  },
});

/**
 * Schema for one install request: a program's compiled source, its hash and where it came from, under
 * the request's `id`.
 *
 * @stability unstable
 * @category schemas
 */
export const Install = Schema.Struct({
  id: Schema.String,
  program: ProgramName,
  hash: Hash,
  source: Schema.String,
  from: From,
});
export type Install = typeof Install.Type;

/**
 * Schema for an install's answer: `same` when the hash is already selected, `failed` with the
 * `code.failed` reason, or `loaded` with each live process's swap outcome.
 *
 * @stability unstable
 * @category schemas
 */
export const Installed = Schema.TaggedUnion({
  same: {},
  failed: { reason: CodeEvent.cases["code.failed"].fields.reason },
  loaded: { processes: Schema.Array(Schema.Struct({ name: Schema.String, outcome: Swapped })) },
});
export type Installed = typeof Installed.Type;

/**
 * Schema for the selection: each program's selected hash and the id of the install that loaded it.
 *
 * @stability unstable
 * @category schemas
 */
export const Selected = Schema.Record(ProgramName, Schema.Struct({ hash: Hash, load: Schema.String }));

const append = Cmd.make("append", {
  input: Schema.Struct({ id: Schema.String, event: CodeEvent.cases["code.loaded"] }),
  ok: Schema.Void,
  err: [],
});

const swap = Cmd.make("swap", {
  input: Schema.Struct({ load: Schema.String, program: ProgramName, hash: Hash }),
  ok: Schema.Void,
  err: [],
});

/**
 * Machine that holds the selection. A `checked` Msg for a hash other than the selected one emits an
 * `append` of a `code.loaded` fact; a `loaded` Msg selects the hash and emits a `swap` for it.
 *
 * **Details**
 *
 * A `checked` Msg for the selected hash does nothing. The model starts from the saved selection, or
 * empty, and `append` and `swap` answers leave it unchanged.
 *
 * @stability unstable
 * @category machines
 */
export const code = Machine.make({
  model: Selected,
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("checked"), id: Schema.String, program: ProgramName, hash: Hash, from: From }),
    Schema.Struct({ type: Schema.Literal("loaded"), id: Schema.String, program: ProgramName, hash: Hash }),
  ]),
  cmds: [append, swap],
  types: { ctx: {} as Record<string, never> },
  init: (saved) => [saved ?? {}, []],
  update: {
    checked: (m, msg) =>
      m[msg.program]?.hash === msg.hash
        ? [m, []]
        : [
            m,
            [
              append({
                id: msg.id,
                event: CodeEvent.cases["code.loaded"].make({
                  program: msg.program,
                  hash: msg.hash,
                  was: m[msg.program]?.hash ?? null,
                  from: msg.from,
                }),
              }),
            ],
          ],
    loaded: (m, msg) => [
      { ...m, [msg.program]: { hash: msg.hash, load: msg.id } },
      [swap({ load: msg.id, program: msg.program, hash: msg.hash })],
    ],
    append_ok: (m) => [m, []],
    append_err: (m) => [m, []],
    swap_ok: (m) => [m, []],
    swap_err: (m) => [m, []],
  },
});
