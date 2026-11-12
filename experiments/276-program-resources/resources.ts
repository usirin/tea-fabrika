// Experiment 276: a program declares what should exist, and Alchemy's own engine applies it, with
// the ledger as its state store. This file names no platform: it runs on Node and inside workerd.
//
// - `Ledger` (made up) stands in for the ledger: an append-only list of entries, in memory on Node
//   and in a Durable Object's SQLite under workerd.
// - `LedgerState` is an Alchemy state store of our own, over that same ledger. Modeled on Alchemy's
//   `State/InMemoryState.ts`.
// - `ScheduledJob` and `ProcessSpec` (both made up) are two custom resources. Each writes its own
//   entries to the ledger; nothing runs a job or a process here.
// - `applyStack` runs Alchemy's engine (Stack.make, Plan.make, Apply.apply) the way its own test
//   harness's scratch stacks do (`alchemy-test/src/Core.ts`), with every service handed in by hand.
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Apply from "alchemy/Apply";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { CredentialsStore } from "alchemy/Auth/Credentials";
import { ProfileStore } from "alchemy/Auth/Profile";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { isResolved } from "alchemy/Diff";
import * as Plan from "alchemy/Plan";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as ResourceType } from "alchemy/Resource";
import * as Stack from "alchemy/Stack";
import { Stage } from "alchemy/Stage";
import { State, type PersistedState, type StateService } from "alchemy/State/State";
import { Context, Effect, FileSystem, Layer, Logger, Path } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

// ---- The ledger stand-in ----

/** One ledger entry. `state_*` entries are Alchemy's state; the rest are the resources' own. */
export type Entry =
  | {
      readonly _tag: "state_set";
      readonly stack: string;
      readonly stage: string;
      readonly fqn: string;
      readonly value: PersistedState;
    }
  | { readonly _tag: "state_removed"; readonly stack: string; readonly stage: string; readonly fqn: string }
  | { readonly _tag: "output_set"; readonly stack: string; readonly stage: string; readonly value: unknown }
  | { readonly _tag: "job_scheduled"; readonly job: string; readonly every: string; readonly input: string }
  | { readonly _tag: "job_unscheduled"; readonly job: string }
  | { readonly _tag: "process_wanted"; readonly process: string; readonly program: string; readonly restart: string }
  | { readonly _tag: "process_unwanted"; readonly process: string };

type Row = { readonly seq: number; readonly entry: Entry };

export class Ledger extends Context.Service<
  Ledger,
  {
    readonly append: (entry: Entry) => Effect.Effect<number>;
    readonly entries: Effect.Effect<ReadonlyArray<Row>>;
  }
>()("exp276/Ledger") {}

/** An in-memory ledger, for Node. */
export const memoryLedger = () => {
  const rows: Array<Row> = [];
  return Ledger.of({
    append: (entry) => Effect.sync(() => rows.push({ seq: rows.length + 1, entry })),
    entries: Effect.sync(() => rows.slice()),
  });
};

// ---- Alchemy's state store, over the ledger ----

const sameKey = (e: Entry, stack: string, stage: string) =>
  (e._tag === "state_set" || e._tag === "state_removed" || e._tag === "output_set") &&
  e.stack === stack &&
  e.stage === stage;

/** The latest state per fqn: the fold of `state_set` and `state_removed` entries. */
const fold = (rows: ReadonlyArray<Row>, stack: string, stage: string) => {
  const live = new Map<string, PersistedState>();

  for (const { entry } of rows) {
    if (!sameKey(entry, stack, stage)) {
      continue;
    }

    if (entry._tag === "state_set") {
      live.set(entry.fqn, entry.value);
    }

    if (entry._tag === "state_removed") {
      live.delete(entry.fqn);
    }
  }

  return live;
};

/** How many state reads and writes the engine made, so a no-change apply's cost shows. */
export const stateCalls = { get: 0, set: 0, delete: 0, list: 0, other: 0 };

const LedgerState = Layer.effect(
  State,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const service: StateService = {
      id: "fabrika-ledger",
      // STATE_STORE_VERSION at beta.85 (State/HttpStateApi.ts:198); a local store reports the CLI's.
      getVersion: () => Effect.succeed(5),
      listStacks: () =>
        ledger.entries.pipe(
          Effect.map((rows) => [...new Set(rows.flatMap(({ entry }) => ("stack" in entry ? [entry.stack] : [])))]),
        ),
      listStages: (stack) =>
        ledger.entries.pipe(
          Effect.map((rows) => [
            ...new Set(rows.flatMap(({ entry }) => ("stack" in entry && entry.stack === stack ? [entry.stage] : []))),
          ]),
        ),
      get: ({ stack, stage, fqn }) => {
        stateCalls.get++;
        return ledger.entries.pipe(Effect.map((rows) => fold(rows, stack, stage).get(fqn)));
      },
      getReplacedResources: ({ stack, stage }) => {
        stateCalls.other++;
        return ledger.entries.pipe(
          Effect.map((rows) =>
            [...fold(rows, stack, stage).values()].flatMap((s) =>
              "status" in s && s.status === "replaced" ? [s] : [],
            ),
          ),
        );
      },
      set: ({ stack, stage, fqn, value }) => {
        stateCalls.set++;
        return ledger.append({ _tag: "state_set", stack, stage, fqn, value }).pipe(Effect.as(value));
      },
      delete: ({ stack, stage, fqn }) => {
        stateCalls.delete++;
        return ledger.append({ _tag: "state_removed", stack, stage, fqn }).pipe(Effect.asVoid);
      },
      deleteStack: ({ stack, stage }) =>
        Effect.gen(function* () {
          const rows = yield* ledger.entries;

          for (const s of stage === undefined ? [] : [stage]) {
            for (const fqn of fold(rows, stack, s).keys()) {
              yield* ledger.append({ _tag: "state_removed", stack, stage: s, fqn });
            }
          }
        }),
      list: ({ stack, stage }) => {
        stateCalls.list++;
        return ledger.entries.pipe(Effect.map((rows) => [...fold(rows, stack, stage).keys()]));
      },
      getOutput: ({ stack, stage }) =>
        ledger.entries.pipe(
          Effect.map((rows) =>
            rows.reduce<unknown>(
              (out, { entry }) =>
                entry._tag === "output_set" && entry.stack === stack && entry.stage === stage ? entry.value : out,
              undefined,
            ),
          ),
        ),
      setOutput: ({ stack, stage, value }) =>
        ledger.append({ _tag: "output_set", stack, stage, value }).pipe(Effect.as(value)),
    };
    return Effect.succeed(service);
  }),
);

// ---- Two custom resources ----

/** The latest of a resource's own entries, so `read` can answer from the ledger. */
const latest = <T extends Entry["_tag"]>(
  rows: ReadonlyArray<Row>,
  tags: ReadonlyArray<T>,
  key: (e: Entry) => boolean,
) =>
  rows.reduce<Entry | undefined>(
    (last, { entry }) => (tags.includes(entry._tag as T) && key(entry) ? entry : last),
    undefined,
  );

type JobProps = { readonly every: string; readonly input: string };
type JobAttrs = { readonly job: string; readonly seq: number };
type ScheduledJob = ResourceType<"Fabrika.ScheduledJob", JobProps, JobAttrs>;
const ScheduledJob = Resource<ScheduledJob>("Fabrika.ScheduledJob");

const ScheduledJobProvider = Provider.effect(
  ScheduledJob,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return {
      read: Effect.fn(function* ({ fqn }) {
        const last = latest(
          yield* ledger.entries,
          ["job_scheduled", "job_unscheduled"],
          (e) => "job" in e && e.job === fqn,
        );
        return last?._tag === "job_scheduled" ? { job: fqn, seq: 0 } : undefined;
      }),
      diff: ({ olds, news }) =>
        Effect.succeed(
          isResolved(news) && (olds.every !== news.every || olds.input !== news.input)
            ? { action: "update" as const }
            : { action: "noop" as const },
        ),
      reconcile: Effect.fn(function* ({ fqn, news }) {
        const seq = yield* ledger.append({ _tag: "job_scheduled", job: fqn, every: news.every, input: news.input });
        return { job: fqn, seq };
      }),
      delete: Effect.fn(function* ({ fqn }) {
        yield* ledger.append({ _tag: "job_unscheduled", job: fqn });
      }),
    };
  }),
);

type ProcessProps = { readonly program: string; readonly restart: "always" | "on-failure" };
type ProcessAttrs = { readonly process: string; readonly seq: number };
type ProcessSpec = ResourceType<"Fabrika.ProcessSpec", ProcessProps, ProcessAttrs>;
const ProcessSpec = Resource<ProcessSpec>("Fabrika.ProcessSpec");

const ProcessSpecProvider = Provider.effect(
  ProcessSpec,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return {
      read: Effect.fn(function* ({ fqn }) {
        const last = latest(
          yield* ledger.entries,
          ["process_wanted", "process_unwanted"],
          (e) => "process" in e && e.process === fqn,
        );
        return last?._tag === "process_wanted" ? { process: fqn, seq: 0 } : undefined;
      }),
      // A new program is a new process: replace. A new restart rule is an update.
      diff: ({ olds, news }) =>
        Effect.succeed(
          !isResolved(news)
            ? undefined
            : olds.program !== news.program
              ? { action: "replace" as const }
              : olds.restart !== news.restart
                ? { action: "update" as const }
                : { action: "noop" as const },
        ),
      reconcile: Effect.fn(function* ({ fqn, news }) {
        const seq = yield* ledger.append({
          _tag: "process_wanted",
          process: fqn,
          program: news.program,
          restart: news.restart,
        });
        return { process: fqn, seq };
      }),
      delete: Effect.fn(function* ({ fqn }) {
        yield* ledger.append({ _tag: "process_unwanted", process: fqn });
      }),
    };
  }),
);

// ---- One program's declaration, in three versions ----

/** v1: both. v2: the job runs every 30 minutes. v3: the process is dropped. gone: the program is removed. */
export type Version = "v1" | "v2" | "v3" | "gone";

const program = (version: Version) =>
  Effect.gen(function* () {
    if (version === "gone") {
      return {};
    }

    const sweep = yield* ScheduledJob("sweep", { every: version === "v1" ? "1 hour" : "30 minutes", input: "sweep" });

    if (version === "v3") {
      return { job: sweep.job };
    }

    const watcher = yield* ProcessSpec("watcher", { program: "nightly-sweep", restart: "always" });
    return { job: sweep.job, process: watcher.process };
  });

// ---- The services the engine is handed, each by hand ----

/** Which tripwired services the engine touched. Empty means it never reached for them. */
export const touched: Array<string> = [];

/**
 * A service the engine's types ask for but that a program's apply should never use. Any property
 * read is recorded, and any call dies with the service's name, so a run shows what is really used.
 */
const tripwire = <I, S>(tag: Context.Key<I, S>, name: string) =>
  Layer.succeed(
    tag,
    new Proxy({} as object, {
      get: (_, prop) => {
        if (typeof prop === "symbol") {
          return undefined;
        }

        touched.push(`${name}.${prop}`);
        return () => Effect.die(new Error(`tripwire: ${name}.${prop}`));
      },
    }) as S,
  );

// The types of Stack.make's providers ask for these (alchemy/src/Stack.ts:35-50).

const engineServices = Layer.mergeAll(
  Layer.succeed(AlchemyContext, { dotAlchemy: ".alchemy-unused", dev: false, adopt: false }),
  Layer.succeed(ArtifactStore, createArtifactStore()),
  AuthProvidersLive,
  // Pure JS in Effect; works anywhere.
  Path.layer,
  SecureRandom.layerWebCrypto,
  Digest.layerWebCrypto,
  // Tripwires: asked for by the types, given nothing real.
  tripwire(FileSystem.FileSystem, "FileSystem"),
  tripwire(ChildProcessSpawner.ChildProcessSpawner, "ChildProcessSpawner"),
  tripwire(HttpClient.HttpClient, "HttpClient"),
  tripwire(CredentialsStore, "CredentialsStore"),
  tripwire(ProfileStore, "ProfileStore"),
);

const STACK = "nightly-sweep";
const STAGE = "brain";

/** One apply of one version, through Alchemy's own engine. Answers the stack output and what changed. */
export const applyStack = (version: Version, services: Layer.Layer<never> = engineServices as never) =>
  program(version).pipe(
    Stack.make({
      name: STACK,
      providers: Layer.mergeAll(ScheduledJobProvider, ProcessSpecProvider),
      state: LedgerState,
    }),
    Effect.flatMap((compiled) =>
      Plan.make(compiled).pipe(
        Effect.flatMap((plan) =>
          Apply.apply(plan).pipe(
            Effect.map((output) => ({
              output,
              actions: Object.fromEntries([
                ...Object.entries(plan.resources).map(([fqn, node]) => [fqn, node.action] as const),
                ...Object.keys(plan.deletions).map((fqn) => [fqn, "delete"] as const),
              ]),
            })),
          ),
        ),
        Effect.provide(compiled.services),
      ),
    ),
    Effect.provideService(Stage, STAGE),
    // The engine logs each plan and apply event at Trace and forces it through (Events.ts:231-235).
    // The brain would turn those into its own spans; here they are dropped.
    Effect.provide(Logger.layer([])),
    Effect.scoped,
    Effect.provide(services),
  );
