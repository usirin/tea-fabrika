import { it, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { rolldown } from "rolldown";

const contract = new URL("../../../../packages/libfabrika/src/access/ClientManager.ts", import.meta.url).pathname;
const forbidden = /\/(ClientManagerLedger|AccessFold|Referee|RefereeSql|LedgerTransactionSql|ledgerStore)\.ts$/;

const inspect = Effect.fnUntraced(function* (names: readonly string[] | null) {
  const loaded = new Set<string>();
  const bundle = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      rolldown({
        input: names === null ? contract : "contract-selection",
        platform: "browser",
        plugins: [
          {
            name: "contract-selection",
            resolveId(id) {
              return id === "contract-selection" ? "\0contract-selection" : null;
            },
            load(id) {
              loaded.add(id);
              return id === "\0contract-selection"
                ? `export { ${names?.join(", ")} } from ${JSON.stringify(contract)};`
                : null;
            },
          },
        ],
      }),
    ),
    (bundle) => Effect.promise(() => bundle.close()),
  );
  const result = yield* Effect.tryPromise(() => bundle.generate({ format: "esm" }));
  const kept = result.output.flatMap((chunk) => (chunk.type === "chunk" ? Object.keys(chunk.modules) : []));
  expect([...loaded].filter((id) => forbidden.test(id))).toEqual([]);
  expect(kept.filter((id) => forbidden.test(id))).toEqual([]);
});

// The direct entry takes no input, so one bundle of it serves every case.
let direct = false;

it.effect.prop(
  "the browser contract excludes the ledger implementation for every export selection",
  { names: Schema.Array(Schema.Literals(["Founder", "Written"])) },
  ({ names }) =>
    Effect.gen(function* () {
      if (!direct) {
        yield* inspect(null);
        direct = true;
      }

      yield* inspect(["ClientManager", ...new Set(names)]);
    }).pipe(Effect.scoped),
  { timeout: 60_000, arbitrary: { seed: 119120, runs: 100 } },
);
