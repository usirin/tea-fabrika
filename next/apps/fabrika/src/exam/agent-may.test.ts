// P8, next/. Source: next/packages/libfabrika/src/door/revocation.test.ts at 9b48d622b5d4.
// Current checked-writer, forged-role, signer and revocation checks run on the real Door.
// The complete closed method list belongs to P25 and remains a separately named pending law.
import { DatabaseSync } from "node:sqlite";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { expect, it } from "@effect/vitest";
import { Door, Id, type Incoming } from "@kampus/libfabrika";
import {
  Adds,
  addText,
  Change,
  ClientManager,
  grantText,
  ProcessIdGenerator,
  revokeText,
  Writer,
} from "@kampus/libfabrika/coordination";
import { Archive, Doorbell, Ledger, LedgerTransaction, RecordManager, SpanSink } from "@kampus/libfabrika/data";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport";
import { Arbitrary, Cause, Effect, Exit, FileSystem, Layer, Schema, Stream } from "effect";
import { Base64, Base64Url } from "effect/encoding";

const options = { arbitrary: { seed: 119120, runs: 20, size: 4096, concurrency: 1 } };
const bounded = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));

const DoorCalls = Arbitrary.schema(
  Schema.Struct({
    name: bounded(1, 96),
    body: bounded(0, 4096),
  }),
);

type DoorCall = typeof DoorCalls extends Arbitrary.Arbitrary<infer C> ? C : never;

// WebCrypto owns ephemeral test key generation and signing. No machine key is read or printed.
const web = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: () => new Error("test crypto failed") });

const key = Effect.fnUntraced(function* () {
  const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const raw = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const blob = new Uint8Array(51);
  new DataView(blob.buffer).setUint32(0, 11);
  blob.set(new TextEncoder().encode("ssh-ed25519"), 4);
  new DataView(blob.buffer).setUint32(15, 32);
  blob.set(raw, 19);
  const line = Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`);
  const fingerprint = `SHA256:${Base64.encode(new Uint8Array(yield* web(() => crypto.subtle.digest("SHA-256", raw)))).replace(/=+$/, "")}`;
  return {
    raw: Base64Url.encode(raw),
    line,
    fingerprint,
    sign: (text: string) =>
      writeSshsig({
        text,
        line,
        space: "fabrika-client",
        sign: (bytes) =>
          web(() => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes))).pipe(
            Effect.map((a) => new Uint8Array(a)),
          ),
      }),
  };
});

const person = "person_0000000000e008000000000001",
  pid = "process_0000000000e008000000000001";

const sentAt = "2026-11-09T01:00:00Z",
  url = "https://fabrika.test/p8";

const Input = Schema.TaggedStruct("save", { body: Schema.String });

const world = Effect.fnUntraced(function* () {
  const root = yield* key(),
    window = yield* key(),
    agent = yield* key();
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db),
    founder = {
      name: "P8",
      person,
      keys: [root.line],
      window: window.raw,
      by: root.fingerprint,
      build: "p8",
    };
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const ledger = Ledger.sql(sql, { reader: "p8-agent" }).pipe(Layer.provide(quiet));
  const env = Layer.mergeAll(
    ledger,
    LedgerTransaction.layer(sql).pipe(Layer.provide(quiet)),
    ClientManager.layer(founder).pipe(Layer.provide(ledger)),
    SpanSink.layer(sql, { object: pid }),
    RecordManager.memory(4 * 1024 * 1024),
    Archive.memory,
    Id.Generator.layer,
    ProcessIdGenerator.layer,
  );
  const delivered: Incoming[] = [];
  const layer = Door.layer({
    sql,
    founder,
    name: "p8",
    url,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "exam",
    build: "p8",
    waiting: { most: 20, ttl: 600000 },
    ping: { min: 10000, max: 60000 },
    inputCap: 4096,
    spentCap: 4096,
    nextProcess: () => Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.orDie),
    deliver: (_p, _envelope, _span, input) =>
      Effect.sync(() => {
        delivered.push(input);
      }),
    notify: () => Effect.void,
    inputs: { schema: Input, personOnly: [], raw: [], log: Schema.toCodecJson(Input) },
    events: { personOnly: [] },
  }).pipe(Layer.provide(env));
  const door = yield* Door.pipe(Effect.provide(layer));
  const log = yield* Ledger.pipe(Effect.provide(ledger));
  const hello = Effect.fnUntraced(function* (k: typeof agent, name: string, as: string) {
    const client = yield* door.connect(),
      nonce = yield* door.challenge(client),
      tab = `tab-${name}`;
    const params = {
      versions: [1],
      has: [],
      ping: "30s",
      key: k.raw,
      tab,
      nonce,
      platform: "browser",
      os: "ios",
      sentAt,
      as,
      signed: yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
    };
    return {
      client,
      result: yield* door.initialize(client, params, { url, tab, name: k.fingerprint }),
    };
  });
  expect((yield* hello(window, "founder", "window")).result._tag).toBe("online");
  const grant = grantText({
    id: "grant_0000000000e008000000000001",
    key: agent.raw,
    for: person,
    to: "p8",
    as: "agent",
    sentAt,
    saw: {
      code: "1234",
      label: "Exam agent",
      where: "exam",
      how: "compare",
      check: "touch",
      has: [],
    },
  });
  expect((yield* door.grant({ text: grant, armored: yield* root.sign(grant) }))._tag).toBe("applied");
  return { door, log, agent, root, hello, delivered };
});

type World = Effect.Success<ReturnType<typeof world>>;

const identity = (input: Incoming, fingerprint: string) => {
  expect(input.envelope.by).toEqual({ _tag: "agent", key: fingerprint, for: person });
  Schema.decodeUnknownSync(Id.InputId)(input.envelope.id);
};

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "NotGranted" });
  }
};

const request = (body: string) => ({
  pid,
  letter: "letter_0000000000e008000000000001",
  m: Input.make({ body }),
  sentAt,
  seen: 0,
});

it.effect.prop(
  "current Door: an ungranted key cannot enter by claiming a person, window or agent role",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(),
        stranger = yield* key();

      for (const role of ["person", "window", "agent"]) {
        const before = w.delivered.length;
        const hello = yield* w.hello(stranger, `${role}-${c.name.slice(0, 80)}`, role);
        expect(hello.result._tag).not.toBe("online");
        expect(yield* w.door.route(hello.client, "process.send", request(c.body))).toEqual({
          _tag: "refused",
          reason: "not_granted",
        });
        expect(w.delivered).toHaveLength(before);
      }
    }),
  options,
);

it.effect.prop(
  "current Door: a signed agent grant wins over every claimed hello role and client label",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world();

      for (const role of ["person", "window", "agent"]) {
        const { client, result } = yield* w.hello(w.agent, `${role}-${c.name}`, role);
        expect(result).toMatchObject({ _tag: "online", who: { as: "agent" } });
        const req = {
          ...request(c.body),
          letter: `letter_0000000000e00800000000000${role === "person" ? 1 : role === "window" ? 2 : 3}`,
        };
        expect(yield* w.door.route(client, "process.send", req)).toMatchObject({ _tag: "ok" });
        const input = w.delivered.at(-1);

        if (input === undefined) {
          return yield* Effect.die("door did not deliver");
        }

        identity(input, w.agent.fingerprint);
      }
    }),
  options,
);

it.effect.prop(
  "current Door: accept and signer preserve checked agent key/person and reject forged writers",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(),
        { client } = yield* w.hello(w.agent, c.name, "person");
      yield* w.door.route(client, "process.send", request(c.body));
      const input = w.delivered.at(-1);

      if (!input) {
        return yield* Effect.die("no checked delivery");
      }

      identity(input, w.agent.fingerprint);
      const placed = yield* w.door.accept(input);
      expect(placed._tag).toBe("placed");
      const rows = yield* Stream.runCollect(w.log.read(`${pid}/inbox`, 0));
      expect(rows[0]).toMatchObject({
        by: w.agent.fingerprint,
        for: person,
        parent: input.envelope.id,
      });
      const signed = yield* w.door.sign(pid, "cmd_0000000000e008000000000001", input.envelope.id, "saved");
      expect(signed.by).toEqual(input.envelope.by);

      for (const by of [
        { ...input.envelope.by, key: "SHA256:person" },
        { ...input.envelope.by, for: "person_0000000000e008000000000002" },
        Writer.cases.person.make({ key: input.envelope.by.key, for: input.envelope.by.for }),
      ]) {
        failure(yield* Effect.exit(w.door.accept({ ...input, envelope: { ...input.envelope, by } })));
      }
    }),
  options,
);

// Every kind of /grant change (coordination/text.ts Change: granted, revoked, added), each with generated labels.
const changes = Effect.fnUntraced(function* (w: World, c: DoorCall) {
  const joining = yield* key(),
    label = c.name.slice(0, 96);
  return {
    granted: grantText({
      id: "grant_0000000000e008000000000002",
      key: joining.raw,
      for: person,
      to: "p8",
      as: "window",
      sentAt,
      saw: { code: "1234", label, where: "exam", how: "command", check: "none", has: [] },
    }),
    revoked: revokeText({
      id: "revoke_0000000000e008000000000001",
      key: w.agent.raw,
      for: person,
      to: "p8",
      sentAt,
      saw: { label, where: "exam", how: "panel", check: "touch" },
    }),
    added: addText({
      id: "add_0000000000e008000000000001",
      for: person,
      to: "p8",
      adds: Adds.cases.person.make({ key: joining.line, window: joining.raw }),
      drops: [],
      saw: { how: "device", check: "touch", where: label, has: [], typed: false, kept: null, old: null },
      sentAt,
    }),
  };
});

type GrantDoor = Pick<World["door"], "grant">;

// p64: "/grant with grant, revoke or approval signed by an agent: refused; no membership change".
const agentSignedRefused = Effect.fnUntraced(function* (w: World, door: GrantDoor, c: DoorCall) {
  const kinds = yield* changes(w, c);
  const before = yield* Stream.runCollect(w.log.read("door/members", 0));

  for (const text of [kinds.granted, kinds.revoked, kinds.added]) {
    expect((yield* door.grant({ text, armored: yield* w.agent.sign(text) }))._tag).toBe("refused");
    expect(yield* Stream.runCollect(w.log.read("door/members", 0))).toEqual(before);
  }

  return kinds;
});

it.effect.prop(
  "current Door: agent-signed grant, revoke and add are refused with no membership change",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world();
      const kinds = yield* agentSignedRefused(w, w.door, c);

      // Clean control: the same three texts signed by the person key do change membership.
      for (const text of [kinds.granted, kinds.added, kinds.revoked]) {
        expect((yield* w.door.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
      }

      expect((yield* Stream.runCollect(w.log.read("door/members", 0))).length).toBeGreaterThanOrEqual(3);
    }),
  options,
);

it.effect.prop(
  "checker plant: a door that refuses agent signers only for granted and revoked fails the /grant law",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world();
      // The plant trusts an agent's signature on an added change, as if a person key had signed it.
      // A failed test-key signature is a broken harness, so it dies instead of joining the Door's errors.
      const planted: GrantDoor = {
        grant: (input) =>
          Effect.gen(function* () {
            const { text } = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }))(input);
            const change = Schema.decodeUnknownSync(Schema.fromJsonString(Change))(text);
            return change._tag === "added"
              ? yield* w.door.grant({ text, armored: yield* Effect.orDie(w.root.sign(text)) })
              : yield* w.door.grant(input);
          }),
      };
      const exit = yield* Effect.exit(agentSignedRefused(w, planted, c));
      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        // The law fails on the added change being applied, not on a broken plant.
        expect(Cause.pretty(exit.cause)).toContain("expected 'applied' to be 'refused'");
      }
    }),
  options,
);

it.effect.prop(
  "current Door: removal stops settled retries and signer",
  { c: DoorCalls },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(),
        { client } = yield* w.hello(w.agent, c.name, "agent");
      const { revoked: removal } = yield* agentSignedRefused(w, w.door, c);
      yield* w.door.route(client, "process.send", request(c.body));
      const input = w.delivered.at(-1);

      if (!input) {
        return yield* Effect.die("no delivery");
      }

      yield* w.door.accept(input);
      expect((yield* w.door.grant({ text: removal, armored: yield* w.root.sign(removal) }))._tag).toBe("applied");
      expect(yield* w.door.route(client, "process.send", request(c.body))).toEqual({
        _tag: "refused",
        reason: "not_granted",
      });
      failure(yield* Effect.exit(w.door.accept(input)));
      failure(yield* Effect.exit(w.door.sign(pid, "cmd_0000000000e008000000000002", input.envelope.id, "saved")));
    }),
  options,
);

const METHODS = [
  "process.send",
  "view.open",
  "ledger.read",
  "ledger.wait",
  "spans.read",
  "spans.content",
  "spans.deleteContent",
  "door.watch",
  "door.deny",
] as const;

const allowed = new Set(["view.open", "ledger.read", "process.send:notes:save", "process.send:notes:list"]);

const methodAnswer = (method: string, actual: { _tag: string; reason?: string }) => {
  expect(actual._tag).toBeTypeOf("string");

  if (method === "ledger.wait:parked") {
    expect(actual).toMatchObject({ _tag: "parked" });
  } else if (method === "ledger.wait") {
    expect(actual._tag).toBe("ok");
  } else if (allowed.has(method)) {
    expect(actual._tag).toBe("ok");
  } else {
    expect(actual).toEqual({ _tag: "refused", reason: "not_for_agents" });
  }
};

type Answer = { _tag: string; reason?: string; result?: unknown };

type PolicyDoor = {
  readonly call: (method: string, target?: string, input?: string, body?: string) => Effect.Effect<Answer>;
  // This installs into the real dispatch table, before its agent policy check.
  readonly install: (method: string, handler: () => Effect.Effect<Schema.Json>) => Effect.Effect<void>;
  readonly personCall: (method: string) => Effect.Effect<Answer>;
  readonly notesInputs: (
    inputs: ReadonlyArray<{ name: string; readOnly: boolean; personOnly: boolean }>,
  ) => Effect.Effect<void>;
  readonly parkedWait: Effect.Effect<Answer>;
  readonly knock: (as: "window" | "agent") => Effect.Effect<{
    readonly answer: Answer;
    readonly row: { readonly as: string };
    readonly admitted: boolean;
    readonly writes: ReadonlyArray<unknown>;
  }>;
};

const bindPolicy = (_w: World): PolicyDoor => {
  throw new Error("P25 agent policy started: bind trusted process records and declared notes inputs before its build");
};

const paths = [
  "../../../../packages/libfabrika/src/mcp",
  "../../../../packages/libfabrika/src/mcp.ts",
  "../../mcp.ts",
  "../mcp.ts",
  "../mcp",
];

const presence = (files: ReadonlySet<string>, load: () => PolicyDoor): PolicyDoor | null => {
  if (!paths.some((p) => files.has(p))) {
    return null;
  }

  const p = load();

  for (const name of ["call", "install", "personCall", "notesInputs", "knock"] as const) {
    if (typeof p[name] !== "function") {
      throw new Error(`missing policy binding: ${name}`);
    }
  }

  if (!Effect.isEffect(p.parkedWait)) {
    throw new Error("missing parked wait");
  }

  return p;
};

const knockAnswer = (actual: Effect.Success<ReturnType<PolicyDoor["knock"]>>, as: string) => {
  expect(actual.answer).toMatchObject({
    _tag: "ok",
    result: { code: expect.any(String), until: expect.any(Number) },
  });
  expect(actual.row.as).toBe(as);
  expect(actual.admitted).toBe(false);
  expect(actual.writes).toEqual([]);
};

const installedRefusal = Effect.fnUntraced(function* (policy: PolicyDoor, method: string, body: string) {
  let calls = 0;
  yield* policy.install(method, () =>
    Effect.sync(() => {
      calls++;
      return { body };
    }),
  );
  // A person actually reaches the new handler: an unknown method is not this plant.
  expect(yield* policy.personCall(method)).toEqual({ _tag: "ok", result: { body } });
  expect(calls).toBe(1);
  methodAnswer(method, yield* policy.call(method));
  expect(calls).toBe(1);
});

it.effect.prop(
  "not built: P25 agent policy / every current method, unknown method and process target follows the closed table",
  {
    c: Arbitrary.schema(Schema.Struct({ name: bounded(1, 96), body: bounded(0, 4096), unknown: bounded(1, 88) })),
  },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const found = new Set<string>();

      for (const p of paths) {
        if (yield* fs.exists(new URL(p, import.meta.url).pathname)) {
          found.add(p);
        }
      }

      if (!paths.some((p) => found.has(p))) {
        ctx.skip("not built: P25 agent policy");
      }

      const w = yield* world(),
        policy = presence(found, () => bindPolicy(w));

      if (policy === null) {
        return yield* Effect.die("present policy was skipped");
      }

      for (const as of ["window", "agent"] as const) {
        knockAnswer(yield* policy.knock(as), as);
      }

      yield* policy.notesInputs([
        { name: "save", readOnly: false, personOnly: false },
        { name: "list", readOnly: true, personOnly: false },
        { name: "person", readOnly: false, personOnly: true },
      ]);
      yield* installedRefusal(policy, `planted.${c.unknown}`, c.body);

      for (const method of [...METHODS, `unknown.${c.unknown}`]) {
        if (method === "process.send") {
          for (const target of ["notes", "counter", "chaos", "window", "unknown", `notes-looking-${c.name}`]) {
            for (const input of ["save", "list", "person", "undeclared"]) {
              methodAnswer(`${method}:${target}:${input}`, yield* policy.call(method, target, input, c.body));
            }
          }
        } else {
          methodAnswer(method, yield* policy.call(method));
        }
      }

      methodAnswer("ledger.wait:parked", yield* policy.parkedWait);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  options,
);

it.prop(
  "checker clean controls: closed agent method table",
  { unknown: Arbitrary.schema(bounded(1, 88)) },
  ({ unknown }) => {
    for (const method of [...METHODS, `unknown.${unknown}`, "planted.newHandler"]) {
      methodAnswer(
        method,
        allowed.has(method) || method === "ledger.wait"
          ? { _tag: "ok" }
          : { _tag: "refused", reason: "not_for_agents" },
      );
    }

    for (const input of ["save", "list"]) {
      methodAnswer(`process.send:notes:${input}`, { _tag: "ok" });
    }

    methodAnswer("ledger.wait:parked", { _tag: "parked" });

    for (const as of ["window", "agent"]) {
      knockAnswer(
        {
          answer: { _tag: "ok", result: { code: "123456", until: 1 } },
          row: { as },
          admitted: false,
          writes: [],
        },
        as,
      );
    }
  },
  options,
);

it.prop(
  "checker plants: default allow, unlisted handler, trusted label and cached admission fail",
  { unknown: Arbitrary.schema(bounded(1, 88)) },
  ({ unknown }) => {
    for (const method of [
      "spans.read",
      "door.watch",
      "planted.newHandler",
      `unknown.${unknown}`,
      "process.send:counter",
      "process.send:notes-looking-label",
      "process.send:notes:person",
      "process.send:notes:undeclared",
    ]) {
      expect(() => methodAnswer(method, { _tag: "ok" })).toThrow();
    }

    for (const reason of ["person_only", "not_allowed", "unknown_method"]) {
      expect(() => methodAnswer("spans.read", { _tag: "refused", reason })).toThrow();
    }

    expect(() => failure(Exit.succeed({ _tag: "accepted" }))).toThrow();
    expect(() => methodAnswer("ledger.wait:parked", { _tag: "ok" })).toThrow();
    const knock = {
      answer: { _tag: "ok", result: { code: "123456", until: 1 } },
      row: { as: "window" },
      admitted: false,
      writes: [],
    };

    for (const bad of [
      { ...knock, answer: { _tag: "refused" } },
      { ...knock, admitted: true },
      { ...knock, writes: [unknown] },
      { ...knock, row: { as: "agent" } },
    ]) {
      expect(() => knockAnswer(bad, "window")).toThrow();
    }
  },
  options,
);

it.effect.prop(
  "checker controls/plants: installed recognized handler still requires the closed agent list",
  { body: Arbitrary.schema(bounded(0, 4096)), name: Arbitrary.schema(bounded(1, 88)) },
  ({ body, name }) =>
    Effect.gen(function* () {
      const handler = new Map<string, () => Effect.Effect<Schema.Json>>();
      const dispatch = Effect.fnUntraced(function* (method: string) {
        const h = handler.get(method);
        return h ? { _tag: "ok", result: yield* h() } : { _tag: "refused", reason: "unknown_method" };
      });
      const clean: PolicyDoor = {
        install: (m, h) =>
          Effect.sync(() => {
            handler.set(m, h);
          }),
        personCall: dispatch,
        call: () => Effect.succeed({ _tag: "refused", reason: "not_for_agents" }),
        notesInputs: () => Effect.void,
        parkedWait: Effect.succeed({ _tag: "parked" }),
        knock: () => Effect.die("control only"),
      };
      yield* installedRefusal(clean, `planted.${name}`, body);
      expect(
        Exit.isFailure(yield* Effect.exit(installedRefusal({ ...clean, call: dispatch }, `planted.${name}`, body))),
      ).toBe(true);
    }),
  options,
);

it.prop(
  "presence controls: every P25 path calls the actual binding helper",
  { message: Arbitrary.schema(bounded(0, 128)) },
  ({ message }) => {
    const failed = (): PolicyDoor => {
      throw new Error(`failed import: ${message}`);
    };
    expect(presence(new Set(), failed)).toBeNull();

    for (const p of [
      "../../mcp.ts",
      "../mcp.ts",
      "../mcp",
      "../../../../packages/libfabrika/src/mcp",
      "../../../../packages/libfabrika/src/mcp.ts",
    ]) {
      expect(() => presence(new Set([p]), failed)).toThrow("failed import");
    }

    const clean: PolicyDoor = {
      install: () => Effect.void,
      personCall: () => Effect.succeed({ _tag: "ok" }),
      call: () => Effect.succeed({ _tag: "ok" }),
      notesInputs: () => Effect.void,
      parkedWait: Effect.succeed({ _tag: "parked" }),
      knock: () => Effect.die("control only"),
    };
    expect(presence(new Set(paths), () => clean)).toBe(clean);
    expect(() => presence(new Set(paths), () => ({ ...clean, install: undefined! }))).toThrow("missing policy binding");
  },
  options,
);
