// next/, W1 and W3: membership is control state, including at every saved cut.
import { applyCell } from "@demlik/tea";
import { foldEvents } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { syncTest } from "../../Testing.ts";
import { nth } from "../RepliesTest.ts";
import { Model, watchers } from "./watchers.ts";

const Client = Schema.Struct({
  client: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  at: Schema.Number,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const entropy = Arbitrary.schema(Client);

const Walk = Arbitrary.array(
  Arbitrary.all([Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))), entropy]),
  { minLength: 4, maxLength: 40 },
);

const clients = (model: typeof Model.Type) => (model._tag === "empty" ? [] : model.clients);

describe("saved view membership, next/", () => {
  it.prop(
    "W1: every saved cut keeps membership and order; end is idempotent",
    [Walk],
    ([walk]) => {
      let [state] = watchers.init(null, {});
      const msgs: Array<{ type: "open"; watch: typeof Client.Type } | { type: "end"; client: string }> = [];
      let expected: Array<typeof Client.Type> = [];

      for (const [pick, fresh] of walk) {
        const held = clients(state);
        const client = held.length > 0 && pick % 3 !== 0 ? nth(held, pick).client : fresh.client;

        if (pick % 3 === 2) {
          const msg = { type: "end" as const, client };
          msgs.push(msg, msg);
          [state] = applyCell(watchers, state, msg);
          const [again, cmds] = applyCell(watchers, state, msg);
          expect(again).toEqual(state);
          expect(cmds).toEqual([]);
          expected = expected.filter((c) => c.client !== client);
        } else {
          const watch = { ...fresh, client };
          const msg = { type: "open" as const, watch };
          msgs.push(msg);
          [state] = applyCell(watchers, state, msg);
          expected = [...expected.filter((c) => c.client !== client), watch].slice(-1024);
        }

        expect(clients(state)).toEqual(expected);
      }

      expect(foldEvents(watchers, {}, null, msgs).finalState).toEqual(state);
      syncTest(
        watchers,
        {},
        {
          msgs,
          encode: Schema.encodeSync(Schema.fromJsonString(Model)),
          decode: Schema.decodeUnknownSync(Schema.fromJsonString(Model)),
          equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
          seed: 119120,
        },
      );
    },
    { arbitrary: { seed: 119120, runs: 200 } },
  );

  // W1 proves saved cuts. Reuse one real cut so W3 spends its runs on churn,
  // rather than validating the same 1,026 opens and full drain 100 times.
  let bounded: typeof Model.Type | undefined;

  it.prop(
    "W3: churn at the bound refreshes order and evicts the oldest without tombstones",
    [Walk],
    ([walk]) => {
      if (bounded === undefined) {
        let [state] = watchers.init(null, {});
        const opened = Array.from({ length: 1026 }, (_, i) => ({ client: `client-${i}`, at: i, position: i }));

        for (const watch of opened) {
          [state] = applyCell(watchers, state, { type: "open", watch });
        }

        expect(state).toStrictEqual({ _tag: "watching", clients: opened.slice(2) });
        bounded = state;

        for (const c of clients(bounded)) {
          [state] = applyCell(watchers, state, { type: "end", client: c.client });
        }

        expect(state).toStrictEqual(Model.cases.empty.make({}));
      }

      let [state] = watchers.init(bounded, {});
      let expected = [...clients(bounded)];

      // Every run first evicts at the bound, refreshes a held client, then ends
      // a held client. Keep the entire generated walk after these guided moves.
      const guided = [0, 1, 2].map((pick) => [pick, nth(walk, pick)[1]] as const);

      for (const [pick, fresh] of [...guided, ...walk]) {
        const held = clients(state);
        let client = held.length && pick % 3 ? nth(held, pick).client : fresh.client;

        // A fresh move must really be absent, even if generated text collides.
        if (pick % 3 === 0) {
          let suffix = 0;

          while (held.some((c) => c.client === client)) {
            client = `fresh-${suffix++}`;
          }
        }

        if (pick % 3 === 2) {
          [state] = applyCell(watchers, state, { type: "end", client });
          expected = expected.filter((c) => c.client !== client);
        } else {
          const watch = { ...fresh, client };
          [state] = applyCell(watchers, state, { type: "open", watch });
          expected = [...expected.filter((c) => c.client !== client), watch].slice(-1024);
        }

        expect(clients(state)).toEqual(expected);
        expect(new Set(clients(state).map((c) => c.client)).size).toBe(clients(state).length);
        expect(clients(state).length).toBeLessThanOrEqual(1024);
        expect(state).toStrictEqual(expected.length ? { _tag: "watching", clients: expected } : { _tag: "empty" });
      }
    },
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
