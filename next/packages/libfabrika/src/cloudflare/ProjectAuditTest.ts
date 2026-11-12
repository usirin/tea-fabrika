// P13 slice 2, next/. Project audit laws take scoped storage and RPC handles from their driver (0062).
import { createHash, generateKeyPairSync, sign } from "node:crypto"; // edge: Effect has no SSH Ed25519 key export or signing API
import { Machine } from "@demlik/tea/effect";
import { Effect, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import { expect, vi } from "vitest";
import { from } from "../processes/Process.test-support.ts";
import { Input } from "../runtime/Program.ts";
import { nth } from "../runtime/RepliesTest.ts";
import type { Sql } from "../Sql.ts";
import { KeyLine, writeSshsig } from "../transport/Sshsig.ts";
import { programBox } from "./box.ts";
import { ProjectService, projectLayer, type ProjectOptions } from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const NAME = "counter:1";
const BUILD = "build-a";
const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });

const ProjectInput = Schema.Struct({
  type: Schema.String,
  n: Schema.optionalKey(Schema.Int),
  body: Schema.optionalKey(Schema.String),
});

/** Storage, Gateway wiring and platform handles belong to the module running this suite. */
export interface Harness {
  readonly open: Effect.Effect<Sql, never, Scope.Scope>;
  readonly door: (url: string, input: typeof ProjectInput) => ProjectOptions["door"];
  readonly environment: (
    box: InstanceType<ReturnType<typeof programBox>>,
    accept: () => number,
  ) => Parameters<typeof projectLayer>[1];
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

const projectWalk = Effect.fnUntraced(function* (harness: Harness, tape: ReadonlyArray<number>, reached: Set<string>) {
  const sql = yield* harness.open;
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
  const program = {
    name: "counter",
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (saved: typeof Model.Type | null) => [saved ?? { count: 0 }, []],
      update: {
        add: (s: typeof Model.Type, m: typeof Msg.Type) => [{ count: s.count + m.n }, []],
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: { add: Input.cases.write.make({ schema: Msg, description: "Add", personOnly: false }) },
    outputs: {},
    writes: {},
    wake: () => null,
  };
  const Box = programBox(program, BUILD);
  const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
  let accepted = 0;
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
    exports: {},
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
  const env = harness.environment(box, () => ++accepted);
  const url = "https://fabrika.test/p13-project";
  const project = yield* ProjectService.pipe(
    Effect.provide(
      projectLayer(ctx, env, {
        config: {
          name: "p13-project",
          person: from().for,
          founder: line,
          window: raw.toString("base64url"),
          port: 0,
          build: BUILD,
        },
        programs: { counter: { hash: BUILD, source: "" } },
        bootstrap: { name: NAME, id: "project-start", program: "counter" },
        door: harness.door(url, ProjectInput),
      }),
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

  for (const [n, entropy] of tape.entries()) {
    const moves = history.length === 0 ? ["valid"] : ["valid", "unknown", "retry"];
    const move = nth(moves, entropy);
    reached.add(move);
    const prior = move === "retry" ? nth(history, Math.floor(entropy / moves.length)) : undefined;
    const letter = prior?.letter ?? `project-${n}`;
    const m =
      prior?.m ??
      (move === "unknown"
        ? ProjectInput.make({ type: `unknown-${accepted}`, body: `BODY-${entropy}-${n}` })
        : Msg.make({ type: "add", n: accepted + 1 }));
    const answer = yield* project.route(client, "process.send", {
      pid: project.boot.process,
      letter,
      m,
      sentAt: from().sentAt,
      seen: 0,
    });

    if (prior !== undefined) {
      expect(answer).toEqual(prior.answer);
    } else {
      expect(answer).toHaveProperty("_tag", "ok");
      expect(answer).toHaveProperty("result._tag", move === "unknown" ? "refused" : "accepted");
      history.push({ letter, m, answer });
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
};
