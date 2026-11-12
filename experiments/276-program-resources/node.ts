// Experiment 276, part a and c on Node: apply, apply again with no change, change one prop,
// drop one resource, all through Alchemy's engine with the ledger stand-in as its state store.
//
// Run from the repo root (this folder's node_modules links to next/apps/fabrika/node_modules):
//   nice -n 19 node experiments/276-program-resources/node.ts [out.json]
// No account, no network, no key.
import { Effect, Layer } from "effect";
import { applyStack, Ledger, memoryLedger, stateCalls, touched, type Version } from "./resources.ts";

process.env.DO_NOT_TRACK = "1";

const ledger = memoryLedger();

const step = (label: string, version: Version) =>
  Effect.gen(function* () {
    const before = (yield* ledger.entries).length;
    const calls = { ...stateCalls };
    const started = performance.now();
    const result = yield* applyStack(version);
    const ms = performance.now() - started;
    const rows = yield* ledger.entries;
    return {
      label,
      version,
      ms: Math.round(ms * 100) / 100,
      actions: result.actions,
      output: result.output,
      newEntries: rows.slice(before).map(({ entry }) => entry),
      stateCalls: Object.fromEntries(
        Object.entries(stateCalls).map(([k, v]) => [k, v - calls[k as keyof typeof calls]]),
      ),
    };
  }).pipe(Effect.provideService(Ledger, ledger));

const program = Effect.gen(function* () {
  // One warm-up apply in a separate ledger, so the first timed apply does not pay module start-up.
  const warm = memoryLedger();
  yield* applyStack("v1").pipe(Effect.provideService(Ledger, warm));

  const steps = [];
  steps.push(yield* step("1 apply", "v1"));
  steps.push(yield* step("2 apply again, no change", "v1"));
  steps.push(yield* step("3 change one prop (every)", "v2"));
  steps.push(yield* step("4 drop the process", "v3"));
  steps.push(yield* step("5 apply again, no change", "v3"));
  steps.push(yield* step("6 remove the program", "gone"));

  // Timing: 50 no-change applies of the two resources, in a ledger of their own.
  const steady = memoryLedger();
  yield* applyStack("v1").pipe(Effect.provideService(Ledger, steady));
  const times: Array<number> = [];

  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    yield* applyStack("v1").pipe(Effect.provideService(Ledger, steady));
    times.push(performance.now() - t);
  }

  times.sort((a, b) => a - b);

  // Timing: 50 fresh applies of two resources, each into an empty ledger.
  const fresh: Array<number> = [];

  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    yield* applyStack("v1").pipe(Effect.provideService(Ledger, memoryLedger()));
    fresh.push(performance.now() - t);
  }

  fresh.sort((a, b) => a - b);

  // The same apply with no engine service at all: only the state store, the stage and the
  // providers' own ledger. Shows what the engine needs at run time, not what its types ask for.
  const bare = yield* Effect.exit(
    applyStack("v1", Layer.empty as never).pipe(Effect.provideService(Ledger, memoryLedger())),
  );

  const rows = yield* ledger.entries;
  const stateRows = rows.filter(({ entry }) => entry._tag === "state_set");
  const sizes = stateRows.map(({ entry }) => JSON.stringify(entry).length);
  const pct = (xs: Array<number>, p: number) => Math.round((xs[Math.floor((xs.length - 1) * p)] ?? 0) * 100) / 100;
  return {
    host: `node ${process.version}`,
    steps,
    noChange: { n: times.length, p50: pct(times, 0.5), p95: pct(times, 0.95) },
    freshTwo: { n: fresh.length, p50: pct(fresh, 0.5), p95: pct(fresh, 0.95) },
    ledger: {
      entries: rows.length,
      stateEntries: stateRows.length,
      stateEntryBytes: { min: Math.min(...sizes), max: Math.max(...sizes) },
      lastStateEntry: stateRows.at(-1)?.entry,
    },
    touched: [...new Set(touched)],
    bareServices: bare._tag === "Success" ? bare.value.actions : String(bare.cause),
  };
});

const out = process.argv[2];

Effect.runPromise(program).then(
  async (result) => {
    const text = JSON.stringify(result, null, 2);

    if (out) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(out, `${text}\n`);
    }

    console.log(text);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
