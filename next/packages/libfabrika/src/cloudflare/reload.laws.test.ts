// P15 slice 1, next/. The brain installs and selects a program's code: laws L8, L9 and L12 of the
// approved plan, on the real Project composition and SQLite. Only the platform's handles are
// supplied: storage over node:sqlite, each Process object as a recorder of what the brain pushed, and
// Worker Loader as a double that answers `describe()` from the candidate's source and counts every
// call made on each isolate. The door is a stub: no law here goes through it.
//
// Test contract (the plan's shapes): `ProjectService` gains
//   codeInstall({id, program, hash, source, from}) -> Installed   (`same`, `failed {reason}`, `loaded {processes}`)
//   codeFailed({program, hash: null, reason, path?, line?})      -> void, appends one `code.failed`
//   code(hash)                                                   -> {hash, source} | null
// both written on `gateway/code` by the brain, and each live process of the program is pushed
// `swap({load, program, hash})` on its Process object. `control.ts` allows `codeInstall` and
// `codeFailed` on the project target only. A source that does not hash to its name fails the call
// with nothing stored. The Project's own boot appends `code.loaded {from: "boot", was: null}` for a
// built-in program with no selection, and pushes the selected hash to every live process.
//
// Generator contract: every walk starts from a booted Project and reads what it has made so far (the
// selected spec, the hashes that failed, the live processes) to pick the next move and its
// parameters: an install generated from the current source, one of the five failures made from it,
// a repeat, a new process, or a Project restart.
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit, ManagedRuntime, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { expectTypeOf } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Start } from "../processes/Process.ts";
import { hash } from "../runtime/Built.ts";
import type { GatewayCalls } from "./bindings.ts";
import { control } from "./control.ts";
import { type Env, ProjectService, projectLayer } from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

const SEED = 119120;
const PROGRAM = "fabrika/counter";
const BRAIN_BUILD = "brain-build-test";
const TOKEN = "control-token-test";
/** Cloudflare's SQLite row limit, from the plan: a source over it is refused as too large. */
const MOST = 2 * 1024 * 1024;

// L12 (type): the door the Project hands its gateway has no code calls.
expectTypeOf<GatewayCalls>().not.toHaveProperty("codeInstall");
expectTypeOf<GatewayCalls>().not.toHaveProperty("codeFailed");

/** A candidate as Worker Loader would run it: its declared name and `v`, or a throw as it loads. */
type Fixture = { readonly name: string; readonly v: number; readonly k: number; readonly throws: boolean };

/** A fixture's source: plain module text that names its declaration; `pad` makes it as big as asked. */
const sourceFor = (f: Fixture, pad = 0) => `export default {};\n// fixture ${JSON.stringify(f)}\n${"/".repeat(pad)}`;

const readFixture = (source: string): Fixture =>
  Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ name: Schema.String, v: Schema.Int, k: Schema.Int, throws: Schema.Boolean })),
  )(source.split("\n")[1]!.slice("// fixture ".length));

const declaration = (f: Fixture) => ({
  name: f.name,
  v: f.v,
  writes: {},
  inputs: { inc: { write: true, personOnly: false } },
  cmds: [],
});

/** What the brain pushed to one Process object, and what that object answers. */
type Pushed = { readonly name: string; readonly load: string; readonly program: string; readonly hash: string };

/** One booted Project over one SQLite file, with every platform handle recorded. */
const instance = async (builtIn: Fixture) => {
  const db = new DatabaseSync(":memory:");
  const sql = nodeSql(db);
  const values = new Map<string, unknown>();
  const storage = {
    sql: {
      exec: sql.exec,
      get databaseSize() {
        return sql.size();
      },
    },
    transactionSync: sql.transaction,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
  const ctx = { id: { name: "project-test" }, storage } as unknown as DurableObjectState;
  const source = sourceFor(builtIn);
  const builtHash = await Effect.runPromise(hash(source));
  const pushed: Array<Pushed> = [];
  const descriptors = new Map<string, { readonly id: string; readonly name: string; readonly build: string }>();
  /** Every call on every isolate, by its Worker Loader id. */
  const isolates = new Map<string, Array<string>>();
  const sources = new Map<string, string>([[builtHash, source]]);
  let project: ProjectService["Service"] | undefined;
  let runtime: ManagedRuntime.ManagedRuntime<ProjectService, unknown> | undefined;
  const run = <A, E>(work: Effect.Effect<A, E, ProjectService>) => runtime!.runPromise(work);
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    PROJECT: {
      getByName: () => ({
        codeInstall: (install: unknown) => run(Effect.flatMap(ProjectService, (p) => p.codeInstall(install as never))),
        codeFailed: (fact: unknown) => run(Effect.flatMap(ProjectService, (p) => p.codeFailed(fact as never))),
        processObject: (pid: string) => run(Effect.flatMap(ProjectService, (p) => p.processObject(pid))),
      }),
    },
    PROCESS: {
      getByName: (key: string) => {
        const [, name] = JSON.parse(key) as [string, string];
        return {
          configure: async (d: { id: string; name: string; build: string }) => {
            descriptors.set(name, d);
          },
          descriptor: async () => descriptors.get(name),
          msg: async () => ({ _tag: "accepted", rev: 1, pos: 1 }),
          swap: async (request: Omit<Pushed, "name">) => {
            pushed.push({ name, ...request });
            const was = descriptors.get(name)?.build ?? builtHash;
            return request.hash === was ? { _tag: "same" } : { _tag: "swapped", was };
          },
        };
      },
    },
    CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }) },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string, factory: () => { readonly modules: Readonly<Record<string, string>> }) => {
        const text = factory().modules["program.js"]!;
        const calls = isolates.get(id) ?? [];
        isolates.set(id, calls);
        const fixture = readFixture(text);
        const record =
          (method: string) =>
          async (..._args: ReadonlyArray<unknown>) => {
            calls.push(method);
            return null;
          };
        return {
          getEntrypoint: () => ({
            describe: async () => {
              calls.push("describe");

              if (fixture.throws) {
                throw new Error("a module that throws as it loads");
              }

              return declaration(fixture);
            },
            init: record("init"),
            step: record("step"),
            fold: record("fold"),
            upgrade: record("upgrade"),
            reply: record("reply"),
            admit: record("admit"),
            check: record("check"),
          }),
        };
      },
    },
  } as unknown as Env;
  const door = Object.fromEntries(
    [
      "connect",
      "challenge",
      "initialize",
      "target",
      "route",
      "knock",
      "grant",
      "disconnect",
      "sign",
      "append",
      "retire",
      "checkDelivery",
    ].map((method) => [
      method,
      () => (method === "retire" ? Effect.void : Effect.die(`the door is not under test: ${method}`)),
    ]),
  );
  const boot = async () => {
    // The real composition, as the app's brain wires it; only the door is stubbed.
    runtime = ManagedRuntime.make(
      projectLayer(ctx, env, {
        config: {
          name: "project-test",
          person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
          founder: // A public key line made from 32 fixed bytes: no private key exists for it.
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
          window: null,
          port: 18787,
          build: BRAIN_BUILD,
        },
        programs: { [PROGRAM]: { hash: builtHash, source } },
        bootstrap: { name: "counter:1", id: "counter:1", program: PROGRAM },
        door: () => Effect.succeed(door as never),
      }),
    );
    project = await run(ProjectService);
    return project;
  };
  await boot();
  return {
    db,
    env,
    builtHash,
    pushed,
    descriptors,
    isolates,
    sources,
    run,
    get p() {
      return project!;
    },
    /** The Project object restarts: its runtime is given back and built again on the same storage. */
    restart: async () => {
      await runtime!.dispose();
      await boot();
    },
    close: async () => {
      await runtime?.dispose();
      db.close();
    },
    /** `gateway/code` and every other stream, as the ledger holds them, in log order. */
    entries: () =>
      sql.exec("SELECT stream, id, rev, _tag, body, build FROM entries ORDER BY rev").map((row) => ({
        stream: String(row.stream),
        id: String(row.id),
        rev: Number(row.rev),
        tag: String(row._tag),
        build: String(row.build),
        body: JSON.parse(String(row.body)) as Readonly<Record<string, unknown>>,
      })),
  };
};

type Instance = Awaited<ReturnType<typeof instance>>;

const code = (i: Instance) => i.entries().filter((e) => e.stream === "gateway/code");

const install = async (i: Instance, id: string, f: Fixture, pad = 0, from = "watch") => {
  const source = sourceFor(f, pad);
  const digest = await Effect.runPromise(hash(source));
  i.sources.set(digest, source);
  const answer = await i.run(i.p.codeInstall({ id, program: PROGRAM, hash: digest, source, from: from as never }));
  return { digest, answer };
};

const fixtures = fc.record({ k: fc.integer({ min: 1, max: 9 }), v: fc.integer({ min: 1, max: 3 }) });

/** A walk over one booted Project: installs, failures made from the current source, starts and restarts. */
const walk = async (g: fc.GeneratorValue, steps: number, presses: boolean) => {
  const builtIn: Fixture = { name: PROGRAM, v: 1, k: 1, throws: false };
  const i = await instance(builtIn);
  const failed = new Set<string>();
  const seen = new Set<string>();
  let selected = i.builtHash;
  let current = builtIn;
  let names = 1;

  try {
    for (let n = 0; n < steps; n++) {
      const moves = [
        "good",
        "good",
        "same",
        "bundle",
        "compiler",
        "load",
        "name",
        "too_large",
        "restart",
        ...(presses ? ["start", "start"] : []),
      ];
      const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
      seen.add(move);
      const before = code(i).length;
      const pushes = i.pushed.length;
      const next = { ...current, ...g(() => fixtures) };

      if (move === "good") {
        const { digest, answer } = await install(i, `install_${n}`, next);

        if (digest === selected) {
          expect(answer).toEqual({ _tag: "same" });
          continue;
        }

        expect(answer).toMatchObject({ _tag: "loaded" });
        const added = code(i).slice(before);
        expect(added.map((e) => [e.tag, e.body.hash, e.body.was, e.body.from])).toEqual([
          ["code.loaded", digest, selected, "watch"],
        ]);
        const live = [...i.descriptors.keys()];
        expect(i.pushed.slice(pushes).map((p) => [p.name, p.hash, p.program])).toEqual(
          live.map((name) => [name, digest, PROGRAM]),
        );
        selected = digest;
        current = next;
      } else if (move === "same") {
        const { answer } = await install(i, `install_${n}`, current);
        expect(answer).toEqual({ _tag: "same" });
        expect(code(i)).toHaveLength(before);
        expect(i.pushed).toHaveLength(pushes);
      } else if (move === "bundle" || move === "compiler") {
        // The watcher's own failures: no bytes reached the brain, so no hash.
        const line = g(fc.integer, { min: 1, max: 400 });
        await i.run(
          i.p.codeFailed({
            program: PROGRAM,
            hash: null,
            reason: move,
            path: "next/programs/counter/src/program.ts",
            line,
          }),
        );
        const added = code(i).slice(before);
        expect(added.map((e) => [e.tag, e.body.reason, e.body.hash])).toEqual([["code.failed", move, null]]);
      } else if (move === "restart") {
        await i.restart();
        // The boot pushes the selected hash to every live process again, and only it.
        expect(new Set(i.pushed.slice(pushes).map((p) => p.hash))).toEqual(
          i.descriptors.size === 0 ? new Set() : new Set([selected]),
        );
      } else if (move === "start") {
        const name = `counter:${++names}`;
        await i.run(
          i.p.start(Start.cases.first.make({ id: `start:${name}`, name, code: { program: PROGRAM, hash: selected } }), {
            by: "SHA256:brain",
            for: "brain",
            sentAt: "2026-11-11T00:00:00Z",
            seen: 0,
            parent: null,
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            build: BRAIN_BUILD,
          }),
        );
        // A new process starts on the selected code, never on a failed one.
        expect(i.descriptors.get(name)?.build).toBe(selected);
      } else {
        const bad: Fixture =
          move === "load" ? { ...next, throws: true } : move === "name" ? { ...next, name: "fabrika/other" } : next;
        const pad = move === "too_large" ? MOST + 1 : 0;
        const { digest, answer } = await install(i, `install_${n}`, bad, pad);
        expect(answer).toEqual({ _tag: "failed", reason: move });
        const added = code(i).slice(before);
        expect(added.map((e) => [e.tag, e.body.reason, e.body.hash])).toEqual([["code.failed", move, digest]]);
        expect(i.pushed, "a failed hash reaches no process").toHaveLength(pushes);
        failed.add(digest);

        if (move === "too_large") {
          expect(await i.run(i.p.code(digest)), "nothing stored").toBeNull();
        }
      }

      // Never selected, never pushed, never started on: a failed hash, also after a restart.
      for (const p of i.pushed) {
        expect(failed.has(p.hash), `pushed failed ${p.hash}`).toBe(false);
      }

      for (const d of i.descriptors.values()) {
        expect(failed.has(d.build), `${d.name} started on a failed hash`).toBe(false);
      }

      // The candidate check calls only describe(), never init, a step or a Cmd.
      for (const [id, calls] of i.isolates) {
        if (id.endsWith("/check")) {
          expect(
            calls.filter((c) => c !== "describe"),
            `${id} ran more than describe`,
          ).toEqual([]);
        }
      }
    }

    return { i, seen, selected, failed };
  } catch (error) {
    await i.close();
    throw error;
  }
};

describe("P15 slice 1: the brain installs and selects code", () => {
  // L8, p75. Plant: select before describe; call init on the candidate; keep a failed hash after a reopen.
  it("L8: each of the five failures writes one code.failed with its closed reason and is never selected, pushed or started on, also after a restart; the check calls only describe()", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const { i, seen: reached } = await walk(g, g(fc.integer, { min: 1, max: 10 }), false);
        await i.close();

        for (const move of reached) {
          seen.add(move);
        }
      }),
      { seed: SEED, numRuns: 50, endOnFailure: true },
    );

    for (const move of ["good", "same", "bundle", "compiler", "load", "name", "too_large", "restart"]) {
      expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
    }
  }, 300_000);

  // L9, p76. Plant: step before code.loaded is appended; stamp the brain's build on a process record.
  it("L9: every build a process starts on or is pushed has an earlier code.loaded, from boot or watch; the brain's own entries keep the brain's build", async () => {
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const { i } = await walk(g, g(fc.integer, { min: 1, max: 10 }), true);

        try {
          const entries = i.entries();
          const loaded = entries.filter((e) => e.stream === "gateway/code" && e.tag === "code.loaded");

          for (const e of loaded) {
            expect(["boot", "watch"]).toContain(e.body.from);
          }

          const earlier = (digest: string, rev: number) => loaded.some((l) => l.body.hash === digest && l.rev < rev);

          // The built-in program's first load is from the boot, with nothing before it.
          expect(loaded[0]?.body).toMatchObject({ program: PROGRAM, hash: i.builtHash, was: null, from: "boot" });

          for (const e of entries) {
            const start = e.body.code as { readonly hash?: string } | undefined;

            if (e.stream.startsWith("processes/") && typeof start?.hash === "string") {
              expect(earlier(start.hash, e.rev), `${e.stream} ${e.id} starts on ${start.hash}`).toBe(true);
            }

            if (e.stream.startsWith("gateway/")) {
              expect(e.build, `${e.stream} ${e.id} is the brain's own entry`).toBe(BRAIN_BUILD);
            }
          }

          for (const p of i.pushed) {
            expect(
              loaded.some((l) => l.body.hash === p.hash),
              `pushed ${p.hash} has a code.loaded`,
            ).toBe(true);
          }
        } finally {
          await i.close();
        }
      }),
      { seed: SEED, numRuns: 50, endOnFailure: true },
    );
  }, 300_000);

  // L12. Plant: trust the caller's hash; route `codeInstall` through the door.
  it("L12: install and failed answer only on the control socket's project target; a source that does not hash to its name stores nothing; a program's gateway write is refused; a repeated install id appends once", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const builtIn: Fixture = { name: PROGRAM, v: 1, k: 1, throws: false };
        const i = await instance(builtIn);

        try {
          const steps = g(fc.integer, { min: 1, max: 8 });

          for (let n = 0; n < steps; n++) {
            const moves = ["control", "wrong_target", "no_token", "mismatch", "gateway_write", "repeat"];
            const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
            seen.add(move);
            const fixture = { ...builtIn, ...g(() => fixtures) };
            const source = sourceFor(fixture);
            const digest = await Effect.runPromise(hash(source));
            const before = code(i).length;
            const body = { id: `install_${n}`, program: PROGRAM, hash: digest, source, from: "watch" };
            const ask = (target: string, method: string, bearer: string | null) =>
              Effect.runPromise(
                control(
                  new Request("http://127.0.0.1/control", {
                    method: "POST",
                    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
                    body: JSON.stringify({ target, project: "project-test", name: "", method, args: [body] }),
                  }),
                  i.env,
                  Redacted.make(TOKEN),
                  {},
                ),
              );

            if (move === "control") {
              const response = await ask("project", "codeInstall", TOKEN);
              expect(response.status).toBe(200);
              const answer = ((await response.json()) as { value: { _tag: string } }).value;
              expect(["loaded", "same"]).toContain(answer._tag);
            } else if (move === "wrong_target") {
              const target = g(() => fc.constantFrom("process", "record"));
              const method = g(() => fc.constantFrom("codeInstall", "codeFailed"));
              const response = await ask(target, method, TOKEN);
              expect(await response.json()).toEqual({ error: { reason: "unknown_method" } });
              expect(code(i)).toHaveLength(before);
            } else if (move === "no_token") {
              // A header value a client can send: printable token characters, or no header at all.
              const bearer = g(() =>
                fc.option(
                  fc.stringMatching(/^[A-Za-z0-9._~-]{1,40}$/).filter((s) => s !== TOKEN),
                  { nil: null },
                ),
              );
              expect((await ask("project", "codeInstall", bearer)).status).toBe(403);
              expect(code(i)).toHaveLength(before);
            } else if (move === "mismatch") {
              // A real hash from another source: the bytes do not hash to the name they carry.
              const other = await Effect.runPromise(hash(sourceFor({ ...fixture, k: fixture.k + 100 })));
              const exit = await i.run(Effect.exit(i.p.codeInstall({ ...body, hash: other, from: "watch" })));
              expect(Exit.isFailure(exit), "the install is refused").toBe(true);
              expect(await i.run(i.p.code(other)), "nothing stored").toBeNull();
              expect(code(i), "no fact").toHaveLength(before);
            } else if (move === "gateway_write") {
              const info = await i.run(i.p.info);
              const pid = info[0]!.process;
              const stream = g(() => fc.constantFrom("gateway/code", "gateway/brain", "gateway/x"));
              const exit = await i.run(
                Effect.exit(i.p.own(pid, `own_${n}`, stream, { _tag: "code.loaded", program: PROGRAM, hash: digest })),
              );
              expect(Exit.isFailure(exit), `a program's write to ${stream}`).toBe(true);
              expect(code(i)).toHaveLength(before);
            } else {
              await i.run(i.p.codeInstall({ ...body, id: "install_again", from: "watch" }));
              const after = code(i).length;
              expect(await i.run(i.p.codeInstall({ ...body, id: "install_again", from: "watch" }))).toEqual({
                _tag: "same",
              });
              expect(code(i)).toHaveLength(after);
            }

            // Whoever called, every entry on gateway/code is the brain's own.
            expect(code(i).filter((e) => e.build !== BRAIN_BUILD)).toEqual([]);
          }
        } finally {
          await i.close();
        }
      }),
      { seed: SEED, numRuns: 100, endOnFailure: true },
    );

    for (const move of ["control", "wrong_target", "no_token", "mismatch", "gateway_write", "repeat"]) {
      expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
    }
  }, 300_000);
});
