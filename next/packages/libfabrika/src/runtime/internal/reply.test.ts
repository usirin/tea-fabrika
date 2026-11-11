// P13 slice 1, next/. The reply machine is insert-only: empty + remember -> remembered(first reply),
// remembered + remember -> unchanged, and no move runs a Cmd. Each walk proposes its next reply from
// the state it has reached: a new reply while empty, then the stored reply with one field changed.
import { applyCell, type Machine } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { syncTest } from "../../Testing.ts";

const SEED = 119120;

type Reply = {
  readonly name: string;
  readonly id: string;
  readonly parent: string;
  readonly by: string;
  readonly for: string;
  readonly digest: string;
  readonly answer: { readonly _tag: "refused"; readonly reason: string; readonly now?: number; readonly most?: number };
};

type Model = { readonly _tag: "empty" } | { readonly _tag: "remembered"; readonly reply: Reply };
type Msg = { readonly type: "remember"; readonly reply: Reply };

type Subject = {
  readonly reply: Machine<Model, Msg, never, never, unknown>;
  readonly Model: Schema.Codec<Model, unknown>;
};

// The machine the plan names: runtime/internal/reply.ts, its Model and its update.
const subject = (): Promise<Subject> => import("./reply.ts");

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const text = fc.string({ minLength: 1, maxLength: 12 });

const inputId = fc
  .tuple(fc.constantFrom(...ALPHABET), fc.constantFrom(...ALPHABET))
  .map(([a, b]) => `input_0000000000e0080000000000${a}${b}`);

const answer = fc.record(
  {
    _tag: fc.constant("refused" as const),
    reason: fc.constantFrom("changed_elsewhere", "too_long", "bad_msg", "full"),
    now: fc.nat(1000),
    most: fc.nat(1000),
  },
  { requiredKeys: ["_tag", "reason"] },
);

const reply: fc.Arbitrary<Reply> = fc.record({
  name: fc.constantFrom("notes:1", "notes:2", "counter:1"),
  id: text,
  parent: inputId,
  by: text.map((k) => `SHA256:${k}`),
  for: text,
  digest: text,
  answer,
});

/** One move's entropy: which field of the stored reply to change, and the new value's seed. */
const Move = fc.tuple(fc.nat(), reply);
const Walk = fc.array(Move, { minLength: 1, maxLength: 40 });

const FIELDS = ["name", "id", "parent", "by", "for", "digest", "answer"] as const;

/** The next remember, read from the state the fold has reached. */
const next = (model: Model, [pick, fresh]: readonly [number, Reply]): Msg => {
  if (model._tag === "empty") {
    return { type: "remember", reply: fresh };
  }

  // Same machine, so the same key: change one bound field or the answer, or repeat it exactly.
  const field = FIELDS[pick % (FIELDS.length + 1)];
  const stored = model.reply;
  return {
    type: "remember",
    reply: field === undefined || field === "name" || field === "id" ? stored : { ...stored, [field]: fresh[field] },
  };
};

/** Folds the walk through the real machine and returns the msgs it chose. */
const fold = (machine: Subject["reply"], walk: ReadonlyArray<readonly [number, Reply]>) => {
  let [model, cmds] = machine.init(null, {});
  const msgs: Array<Msg> = [];
  let first: Reply | null = null;

  expect(model, "init(null) is the empty model").toEqual({ _tag: "empty" });
  expect(cmds).toEqual([]);

  for (const move of walk) {
    const msg = next(model, move);
    msgs.push(msg);
    first ??= msg.reply;
    [model, cmds] = applyCell(machine, model, msg);
    expect(cmds, "remember runs no Cmd").toEqual([]);
    // The independent record: only the first reply ever offered.
    expect(model).toEqual({ _tag: "remembered", reply: first });
  }

  return msgs;
};

describe("P13 reply machine", () => {
  it("R1: the first reply wins; every later remember leaves the model unchanged", async () => {
    const { reply: machine } = await subject();
    fc.assert(
      fc.property(Walk, (walk) => {
        fold(machine, walk);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("R12: every JSON save/load cut of a remember walk resumes to the same model and Cmds", async () => {
    const { reply: machine, Model } = await subject();
    fc.assert(
      fc.property(Walk, (walk) => {
        syncTest(
          machine,
          {},
          {
            msgs: fold(machine, walk),
            encode: Schema.encodeSync(Model),
            decode: Schema.decodeUnknownSync(Model),
            equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
            seed: SEED,
          },
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
