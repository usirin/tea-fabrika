// P42 slice 1's test program, next/ (ticket 770): one tea machine, made by one factory per program
// name, that asks the host to start children with the built-in `start_child` and ends itself with the
// built-in `exit`, as `mailRequester.test-support.ts` does with `send`. A step may list Cmds before
// and after its `exit`, and an `extra` object rides beside a Cmd's operands, as a program could try:
// the host decodes strictly and binds the requester itself. Every Cmd answer is kept in the model,
// in order, so a law reads what the program was told from the process's saved checkpoint.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Program } from "../Program.ts";
import { exit, startChild } from "../StartChild.ts";

/** @internal */
export const Model = Schema.Struct({
  /** Letters this life stepped, Cmd answers excluded. */
  stepped: Schema.Int,
  /** Each Cmd answer, in order: the Cmd's type, and its `ok` value or its error's reason. */
  answers: Schema.Array(Schema.Json),
});
/** @internal */
export type Model = typeof Model.Type;

const Extra = Schema.optionalKey(Schema.Record(Schema.String, Schema.Json));

/** One child to ask for: a program and a name as plain strings, and an optional first letter. */
const Ask = Schema.Struct({
  program: Schema.Json,
  name: Schema.Json,
  input: Schema.optionalKey(Schema.Json),
  /** Fields beside the operands, or operands left out: what the host must refuse as `bad_cmd`. */
  extra: Extra,
  drop: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Start = Schema.Struct({
  type: Schema.Literal("start"),
  ask: Ask,
  parent: Schema.optionalKey(Schema.String),
});

const End = Schema.Struct({
  type: Schema.Literal("end"),
  /** Cmds this step lists before its `exit`, which the host performs first, in order. */
  before: Schema.Array(Ask),
  /** Cmds after it, which the host never performs; `twice` lists a second `exit` among them. */
  after: Schema.Array(Ask),
  twice: Schema.Boolean,
  /** Fields beside `exit`'s empty input, such as a `reason`: `bad_cmd`. */
  extra: Extra,
  parent: Schema.optionalKey(Schema.String),
});

const Ping = Schema.Struct({ type: Schema.Literal("ping"), parent: Schema.optionalKey(Schema.String) });

/** @internal */
export const Msg = Schema.Union([Start, End, Ping]);

/** The Cmd for one ask, with its extra fields beside and its dropped operands gone. */
const asked = (ask: typeof Ask.Type) => {
  const operands: Record<string, unknown> = {
    program: ask.program,
    name: ask.name,
    ...(ask.input === undefined ? {} : { input: ask.input }),
    ...ask.extra,
  };

  for (const key of ask.drop ?? []) {
    delete operands[key];
  }

  // A malformed Cmd on purpose: the host, not the type, refuses it.
  return startChild(operands as never);
};

const answer = (type: string, outcome: unknown) =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify({ type, outcome })));

const idle: Model = { stepped: 0, answers: [] };

/** @internal The test program named `name`. Without `declare`, its machine lists no Cmd, so the host
 *  must refuse the ones it emits as `bad_cmd`. */
export const childStarter = (config: { readonly name: string; readonly declare: boolean }) => {
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: config.declare ? [startChild, exit] : [],
    init: (loaded) => [loaded ?? idle, []],
    update: {
      start: (s: Model, m: typeof Start.Type) => [{ ...s, stepped: s.stepped + 1 }, [asked(m.ask)]],
      end: (s: Model, m: typeof End.Type) => [
        { ...s, stepped: s.stepped + 1 },
        [...m.before.map(asked), exit({ ...m.extra } as never), ...(m.twice ? [exit({})] : []), ...m.after.map(asked)],
      ],
      ping: (s: Model) => [{ ...s, stepped: s.stepped + 1 }, []],
      // An undeclared program has no answers to handle: the host refuses its Cmds before they run.
      ...(config.declare
        ? {
            start_child_ok: (s: Model, m: { value: unknown }) => [
              { ...s, answers: [...s.answers, answer("start_child_ok", m.value)] },
              [],
            ],
            start_child_err: (s: Model, m: { reason: string }) => [
              { ...s, answers: [...s.answers, answer("start_child_err", m.reason)] },
              [],
            ],
            exit_ok: (s: Model, m: { value: unknown }) => [
              { ...s, answers: [...s.answers, answer("exit_ok", m.value)] },
              [],
            ],
            exit_err: (s: Model, m: { reason: string }) => [
              { ...s, answers: [...s.answers, answer("exit_err", m.reason)] },
              [],
            ],
          }
        : {}),
    } as never,
  });
  return Program.make({
    name: config.name,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { start: "Ask for a child", end: "End this life", ping: "Count a letter" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};
