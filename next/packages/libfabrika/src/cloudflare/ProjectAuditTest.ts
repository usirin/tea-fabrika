// P13 slice 2, next/. Project audit laws take scoped storage and RPC handles from their driver (0062).
import { createHash, generateKeyPairSync, sign } from "node:crypto"; // edge: Effect has no SSH Ed25519 key export or signing API
import { Machine } from "@demlik/tea/effect";
import { Effect, Layer, Schema, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import { expect, vi } from "vitest";
import { InputId } from "../Id.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import type { Entry } from "../ledger/Log.ts";
import { from } from "../processes/Process.test-support.ts";
import type * as IsolateUsage from "../runtime/IsolateUsage.ts";
import { Input } from "../runtime/Program.ts";
import { nth } from "../runtime/RepliesTest.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { Sql } from "../Sql.ts";
import { KeyLine, writeSshsig } from "../transport/Sshsig.ts";
import { programBox } from "./box.ts";
import { ProjectService, projectLayer, type ProjectOptions } from "./runtime.ts";
import { Props, receive } from "./tail.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const NAME = "counter:1";
const BUILD = "build-a";
// The counter as the build leaves it: named `pack/program`, its hash the SHA-256 of its source.
const PROGRAM = "test/counter";
const SOURCE = "";
const CODE = { hash: createHash("sha256").update(SOURCE).digest("hex"), source: SOURCE };
const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });
const StampedMsg = Schema.Struct({ ...Msg.fields, parent: InputId, body: Schema.String });
const Metadata = Schema.Struct({ ...Msg.fields, parent: InputId });
const Recorded = Schema.Struct({ input: Schema.optionalKey(Schema.Json) });
type Selector = "plain" | "default" | "custom";

const ProjectInput = Schema.Struct({
  type: Schema.String,
  n: Schema.optionalKey(Schema.Int),
  body: Schema.optionalKey(Schema.String),
});

/** Storage, Gateway wiring and platform handles belong to the module running this suite. */
export interface Harness {
  readonly open: Effect.Effect<Sql, never, Scope.Scope>;
  readonly door: (url: string, input: typeof ProjectInput) => ProjectOptions["door"];
  readonly tail: () => object;
  readonly environment: (
    box: InstanceType<ReturnType<typeof programBox>>,
    accept: () => number,
    usage: (object: string, rows: ReadonlyArray<typeof IsolateUsage.Usage.Type>) => void,
    loaded: (key: string, code: unknown) => void,
  ) => Omit<Parameters<typeof projectLayer>[1], "INSTANCE">;
}

/** The driver runs the generated Effect and checks coverage after all six walks. */
export type Register = (
  name: string,
  tape: fc.Arbitrary<Array<number>>,
  check: (tape: ReadonlyArray<number>) => Effect.Effect<void, unknown, Scope.Scope>,
  options: { readonly seed: number; readonly numRuns: number; readonly endOnFailure: boolean },
  reached: Set<string>,
  required: ReadonlyArray<string>,
) => void;

const projectWalk = Effect.fnUntraced(function* (
  harness: Harness,
  tape: ReadonlyArray<number>,
  reached: Set<string>,
  selector: Selector = "plain",
  usage: boolean = false,
) {
  const sql = yield* harness.open;
  const ledger = yield* Ledger.pipe(
    Effect.provide(
      LedgerSql.layer(sql, { reader: "project-audit-test" }).pipe(
        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
      ),
    ),
  );
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const field = (bytes: Uint8Array) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(bytes.length);
    return Buffer.concat([n, bytes]);
  };
  const line = Schema.decodeUnknownSync(KeyLine)(
    `ssh-ed25519 ${Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]).toString("base64")}`,
  );
  const fingerprint = `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`;
  const message = selector === "plain" ? Msg : StampedMsg;
  const program = {
    name: "counter",
    machine: Machine.make({
      model: Model,
      msg: message,
      cmds: [],
      init: (saved: typeof Model.Type | null) => [saved ?? { count: 0 }, []],
      update: {
        add: (s: typeof Model.Type, m: typeof Msg.Type) => [{ count: s.count + m.n }, []],
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: message,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: { add: Input.cases.write.make({ schema: message, description: "Add", personOnly: false }) },
    outputs: {},
    writes: {},
    wake: () => null,
    ...(selector === "custom"
      ? {
          audit: {
            data: Metadata,
            select: (m: typeof StampedMsg.Type) => Metadata.make({ type: m.type, n: m.n, parent: m.parent }),
          },
        }
      : {}),
  };
  const Box = programBox(program, BUILD);
  const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
  let accepted = 0;
  const bound = new Map<unknown, typeof Props.Type>();
  // The driver wires Gateway; project routing, audit and box calls stay real.
  const unused = vi.fn((): never => {
    throw new Error("unused platform call");
  });
  const ctx: Parameters<typeof projectLayer>[0] = {
    id: { name: "p13-project", equals: unused, toString: unused },
    storage: {
      sql: { exec: vi.fn().mockImplementation(sql.exec), databaseSize: 0, Cursor: unused, Statement: unused },
      transactionSync: sql.transaction,
      get: unused,
      list: unused,
      put: unused,
      delete: unused,
      deleteAll: unused,
      transaction: unused,
      getAlarm: unused,
      setAlarm: unused,
      deleteAlarm: unused,
      sync: unused,
      getCurrentBookmark: unused,
      getBookmarkForTime: unused,
      onNextSessionRestoreBookmark: unused,
      kv: { get: unused, list: unused, put: unused, delete: unused },
    },
    waitUntil: unused,
    exports: {
      IsolateTail: ({ props }: { props: typeof Props.Type }) => {
        const tail = harness.tail();
        bound.set(tail, props);
        return tail;
      },
    },
    props: undefined,
    facets: { get: unused, delete: unused, abort: unused, clone: unused },
    blockConcurrencyWhile: unused,
    acceptWebSocket: unused,
    getWebSockets: unused,
    setWebSocketAutoResponse: unused,
    getWebSocketAutoResponse: unused,
    getWebSocketAutoResponseTimestamp: unused,
    setHibernatableWebSocketEventTimeout: unused,
    getHibernatableWebSocketEventTimeout: unused,
    getTags: unused,
    abort: unused,
  };
  const loads = new Map<string, unknown>();
  const reported: Array<{ object: string; rows: ReadonlyArray<typeof IsolateUsage.Usage.Type> }> = [];
  const env = harness.environment(
    box,
    () => ++accepted,
    (object: string, rows: ReadonlyArray<typeof IsolateUsage.Usage.Type>) => {
      reported.push({ object, rows });
    },
    (key: string, code: unknown) => {
      // Worker Loader reuses the first code and tail for this isolate key.
      if (!loads.has(key)) {
        loads.set(key, code);
      }
    },
  );

  const url = "https://fabrika.test/p13-project";
  const instance = StartsTest.fixture(
    {
      name: "p13-project",
      person: from().for,
      founder: line,
      window: raw.toString("base64url"),
      port: 18787,
      build: BUILD,
    },
    (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
  const project = yield* ProjectService.pipe(
    Effect.provide(
      projectLayer(
        ctx,
        { ...env, INSTANCE: JSON.stringify(instance) },
        {
          programs: { [PROGRAM]: CODE },
          bootstrap: [{ name: NAME, id: "project-start", program: PROGRAM }],
          door: harness.door(url, ProjectInput),
        },
      ),
    ),
  );
  const client = yield* project.connect();
  const nonce = yield* project.challenge(client);
  const tab = "project-test";
  const signed = yield* writeSshsig({
    text: `fabrika-hello\n${url}\n${tab}\n${nonce}`,
    line,
    space: "fabrika-client",
    sign: (bytes: Uint8Array) => Effect.sync(() => sign(null, bytes, pair.privateKey)),
  });
  expect(
    yield* project.initialize(
      client,
      {
        versions: [1],
        has: [],
        ping: "30s",
        key: raw.toString("base64url"),
        tab,
        nonce,
        signed,
        platform: "headless",
        os: "linux",
        sentAt: from().sentAt,
      },
      { url, tab, name: fingerprint },
    ),
  ).toHaveProperty("_tag", "online");
  const history: Array<{ letter: string; m: typeof ProjectInput.Type; answer: unknown }> = [];
  const records = new Map<string, ReadonlyArray<Entry>>();

  if (usage) {
    expect(loads.has(`${CODE.hash}/${project.boot.process}`)).toBe(false);
  }

  for (const [n, entropy] of tape.entries()) {
    const moves =
      history.length === 0 ? ["valid"] : selector === "plain" ? ["valid", "unknown", "retry"] : ["valid", "retry"];
    const move = nth(moves, entropy);
    reached.add(move);
    const prior = move === "retry" ? nth(history, Math.floor(entropy / moves.length)) : undefined;
    const letter = prior?.letter ?? `project-${n}`;
    const m =
      prior?.m ??
      (move === "unknown"
        ? ProjectInput.make({ type: `unknown-${accepted}`, body: `BODY-${entropy}-${n}` })
        : selector === "plain"
          ? Msg.make({ type: "add", n: accepted + 1 })
          : ProjectInput.make({ type: "add", n: accepted + 1, body: `BODY-${entropy}-${n}/雪\n` }));
    const answer = yield* project.route(client, "process.send", {
      pid: project.boot.process,
      letter,
      m,
      sentAt: from().sentAt,
      seen: 0,
    });

    if (usage) {
      const key = `${CODE.hash}/${project.boot.process}`;
      const loaded = Schema.decodeUnknownSync(Schema.Struct({ tails: Schema.Array(Schema.Unknown) }))(loads.get(key));
      expect(loaded.tails).toHaveLength(1);
      const props = Schema.decodeUnknownSync(Props)(bound.get(loaded.tails[0]));
      expect(props).toEqual({ project: "p13-project", name: NAME, process: project.boot.process });
      const cpuMs = accepted + (entropy % 100);
      const wallMs = cpuMs + 1;
      const before = reported.length;
      yield* receive(env, props, [
        {
          event: { rpcMethod: "audit" },
          eventTimestamp: null,
          logs: [],
          exceptions: [],
          diagnosticsChannelEvents: [],
          scriptName: null,
          outcome: "ok",
          executionModel: "stateless",
          truncated: false,
          cpuTime: cpuMs,
          wallTime: wallMs,
        },
      ]);
      expect(reported.slice(before)).toEqual([
        {
          object: JSON.stringify(["p13-project", NAME]),
          rows: [{ process: project.boot.process, method: "audit", outcome: "ok", cpuMs, wallMs }],
        },
      ]);
      reached.add("usage");
    }

    if (prior !== undefined) {
      expect(answer).toEqual(prior.answer);
    } else {
      expect(answer).toHaveProperty("_tag", "ok");
      expect(answer).toHaveProperty("result._tag", move === "unknown" ? "refused" : "accepted");
      history.push({ letter, m, answer });
    }

    if (selector !== "plain") {
      const binding = Schema.decodeUnknownSync(Schema.Struct({ id: InputId }))(
        sql.exec("SELECT id FROM gateway_bindings WHERE letter=?", `${project.boot.process}/${letter}`)[0],
      );
      const rows = (yield* Stream.runCollect(ledger.read("gateway/inputs", 0))).filter(
        (entry: Entry) => entry.id === binding.id,
      );
      expect(rows).toHaveLength(1);

      if (prior !== undefined) {
        expect(rows).toEqual(records.get(letter));
      } else {
        const recorded = Schema.decodeUnknownSync(Recorded)(rows.at(0)?.body);

        if (move === "valid") {
          expect(recorded.input).toEqual(
            selector === "default" ? { type: "add" } : { type: "add", n: m.n, parent: binding.id },
          );
        }

        records.set(letter, rows);
      }
    }
  }
});

/** Registers A13's project walk without choosing a database driver. */
export const suite = (harness: Harness, register: Register) => {
  const reached = new Set<string>();
  register(
    "A13: project routing keeps unknown message types as normal refusals through the real audit callback",
    fc.array(fc.noBias(fc.nat()), { minLength: 12, maxLength: 24 }),
    (tape: ReadonlyArray<number>) => projectWalk(harness, tape, reached),
    { seed: 119120, numRuns: 6, endOnFailure: true },
    reached,
    ["valid", "unknown", "retry"],
  );

  for (const selector of ["default", "custom"] as const) {
    const selected = new Set<string>();
    register(
      `A13: ${selector} audit selection decodes the gateway parent and keeps recorded retries body-free`,
      fc.array(fc.noBias(fc.nat()), { minLength: 12, maxLength: 24 }),
      (tape: ReadonlyArray<number>) => projectWalk(harness, tape, selected, selector),
      { seed: 119120, numRuns: 6, endOnFailure: true },
      selected,
      ["valid", "retry"],
    );
  }

  const usage = new Set<string>();
  register(
    "A13: a process first loaded for audit still reports usage on fresh sends and recorded retries",
    fc.array(fc.noBias(fc.nat()), { minLength: 12, maxLength: 24 }),
    (tape: ReadonlyArray<number>) => projectWalk(harness, tape, usage, "default", true),
    { seed: 119120, numRuns: 6, endOnFailure: true },
    usage,
    ["valid", "retry", "usage"],
  );
};
