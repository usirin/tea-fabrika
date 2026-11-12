// T714, next/. A4 and A6-A12 walk the real authenticated gateway and durable Jobs.
// The Node runner supplies its layers and scoped SQL; this module imports no driver or ledger.
// A4 and A6-A12 plant trials, including A-Kept's reconnect metadata, are in the tests-step report.
// Temporary edits are restored after each trial. A14 runs on the lead's host.
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Logger,
  Redacted,
  Result as R,
  Schema,
  type Scope,
  Semaphore,
  Tracer,
} from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { grantText, revokeText } from "../access/Text.ts";
import * as Id from "../Id.ts";
import { Job, State, type Request, Request as RequestSchema, Result as JobResult } from "../jobs/Job.ts";
import { Jobs } from "../jobs/Jobs.ts";
import type { Sql } from "../Sql.ts";
import { Chain } from "../telemetry/Trace.ts";
import { connection } from "../transport/Connection.ts";
import type { Answer } from "../transport/Wire.ts";
import { Attached } from "../transport/Wire.ts";
import { Gateway, type ConnectionId } from "./Gateway.ts";

export type Store = {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
  readonly gateway: (
    options: Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0],
  ) => Layer.Layer<Gateway | Jobs>;
};

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const URL = "https://fabrika.test/jobs";
const SENT = "2026-11-12T10:00:00.000Z";

const pick = <A>(values: ReadonlyArray<A>, n: number): A =>
  values[n % values.length] ?? expect.fail("a state-derived choice requires a candidate");

const text = (s: string) => new TextEncoder().encode(s);

const join = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;

  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }

  return out;
};

const u32 = (n: number) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);
  return a;
};

const field = (a: string | Uint8Array) => {
  const bytes = typeof a === "string" ? text(a) : a;
  return join(u32(bytes.length), bytes);
};

const fail = (cause: unknown) => new Error("test crypto failed", { cause });

const key = Effect.fnUntraced(function* () {
  const s = crypto.subtle;
  const ed = "Ed25519";
  const sign: KeyUsage[] = ["sign"];
  const uses: KeyUsage[] = ["sign", "verify"];
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto generates test keys
  const pair = yield* Effect.tryPromise({ try: () => s.generateKey(ed, true, uses), catch: fail });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the generated public key
  const raw = yield* Effect.tryPromise({ try: () => s.exportKey("raw", pair.publicKey), catch: fail });
  const bytes = new Uint8Array(raw);
  // WebCrypto exports only these generated test keys, never a key from a file or account.
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports a generated test key into Redacted
  const exported = yield* Effect.tryPromise({ try: () => s.exportKey("pkcs8", pair.privateKey), catch: fail });
  const stored = Redacted.make(Base64.encode(new Uint8Array(exported)));
  const blob = join(field("ssh-ed25519"), field(bytes));
  const fingerprint = Effect.fnUntraced(function* (value: Uint8Array) {
    const bytes = new Uint8Array(value);
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes a generated public key
    const hash = yield* Effect.tryPromise({ try: () => s.digest("SHA-256", bytes), catch: fail });
    return `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;
  });
  return {
    stored,
    raw: Base64Url.encode(bytes),
    line: `ssh-ed25519 ${Base64.encode(blob)}`,
    fingerprint: yield* fingerprint(bytes),
    sshFingerprint: yield* fingerprint(blob),
    sign: Effect.fnUntraced(function* (value: string) {
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes the signed test message
      const digest = yield* Effect.tryPromise({ try: () => s.digest("SHA-512", text(value)), catch: fail });
      const hash = new Uint8Array(digest);
      const body = join(text("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(hash));
      // oxlint-disable-next-line fabrika/no-redacted-value -- edge: the generated key-store value goes only to WebCrypto
      const bytes = new Uint8Array(R.getOrThrow(Base64.decode(Redacted.value(stored))));
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto imports the generated signing key
      const signer = yield* Effect.tryPromise({ try: () => s.importKey("pkcs8", bytes, ed, false, sign), catch: fail });
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs the test message
      const signature = yield* Effect.tryPromise({ try: () => s.sign(ed, signer, body), catch: fail });
      const signed = new Uint8Array(signature);
      const packed = join(
        text("SSHSIG"),
        u32(1),
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(join(field("ssh-ed25519"), field(signed))),
      );
      return `-----BEGIN SSH SIGNATURE-----\n${Base64.encode(packed)
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    }),
  };
});

type Key = Effect.Success<ReturnType<typeof key>>;

type Client = {
  readonly client: ConnectionId;
  readonly key: Key;
  readonly has: ReadonlyArray<string>;
  readonly build: string | undefined;
  readonly role: "hands" | "window" | "agent";
  live: boolean;
};

type Cell = {
  readonly move: number;
  readonly pick: number;
  readonly variant: number;
  readonly has: ReadonlyArray<string>;
  readonly build: string;
  readonly sentAt: string;
  readonly seen: number;
  readonly result: JobResult;
};

const Cell = Schema.Struct({
  move: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  variant: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  has: Schema.Array(Schema.Literals(["git", "node", "docker"])),
  build: Schema.NonEmptyString,
  sentAt: Schema.String,
  seen: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  result: JobResult,
});

const Tape = Schema.Struct({
  request: Schema.Struct({ ...RequestSchema.fields, process: Id.Process }),
  cells: Schema.Array(Cell).check(Schema.isMinLength(60), Schema.isMaxLength(100)),
  secret: Schema.String.check(Schema.isPattern(/^[a-z]{12,24}$/)),
});
type Tape = typeof Tape.Type;
const last = <A>(values: ReadonlyArray<A>): A => values.at(-1) ?? expect.fail("an accepted transition has an event");
const TakeReply = Schema.TaggedUnion({ idle: {}, refused: { reason: Schema.String } });

type Saved = { request: Request; job: Job; starts?: unknown; finish?: unknown };
const phase = (s: Saved) => s.job.state._tag;

const assignment = (s: Saved) => {
  const state = s.job.state;

  if (state._tag === "absent" || state._tag === "requested") {
    return expect.fail("a saved assignment is required");
  }

  return state.assignment;
};

const accepted = (answer: typeof Answer.Type) => {
  if (answer._tag !== "ok") {
    return expect.fail(`job call refused: ${JSON.stringify(answer)}`);
  }

  return answer.result;
};

const refused = (answer: typeof Answer.Type) => {
  expect(answer._tag).toBe("refused");
};

const jobReply = (answer: typeof Answer.Type) => Schema.decodeUnknownSync(Job)(accepted(answer));

const world = Effect.fnUntraced(function* (open: Effect.Effect<Store, never, Scope.Scope>) {
  const store = yield* open;
  const root = yield* key();
  const backup = yield* key();
  const stranger = yield* key();
  const keys = yield* Effect.forEach([0, 1, 2, 3], () => key(), { concurrency: 1 });
  const turn = yield* Semaphore.make(1);
  const logs: Array<unknown> = [],
    spans: Array<Tracer.Span> = [],
    attachments: Array<unknown> = [];
  const logger = Logger.layer([
    Logger.map(Logger.formatStructured, (entry) => {
      logs.push(entry);
    }),
  ]);
  const urls: Array<string> = [URL];
  const notices: Array<unknown> = [],
    delivered: Array<unknown> = [],
    opened: Array<unknown> = [],
    frames: Array<string> = [];
  const controls: { pause: null | { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } } = {
    pause: null,
  };
  const options: Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0] = {
    sql: store.sql,
    founder: {
      name: "jobs-law",
      person: PERSON,
      keys: [root.line, backup.line],
      window: null,
      by: root.sshFingerprint,
      build: "gateway-build",
    },
    name: "jobs-law",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "gateway-build",
    waiting: { most: 64, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1_000_000,
    spentCap: 100_000,
    turn,
    write: (work) =>
      Effect.gen(function* () {
        const pause = controls.pause;

        if (pause !== null) {
          controls.pause = null;
          yield* Deferred.succeed(pause.entered, undefined);
          yield* Deferred.await(pause.release);
        }

        return yield* work.pipe(turn.withPermit);
      }),
    nextProcess: () => Effect.succeed("process_01m6v5270hetdrt4r8h9vvjwjs"),
    open: (process, client) =>
      Effect.sync(() => {
        opened.push({ process, client });
        return null;
      }),
    deliver: (_p, envelope) =>
      Effect.sync(() => {
        delivered.push(envelope);
      }),
    notify: (client, news) =>
      Effect.sync(() => {
        notices.push({ client, news });
      }),
    inputs: { schema: Schema.Json, log: Schema.Json, personOnly: [], raw: [] },
    events: { personOnly: [] },
  };
  let life = yield* Layer.build(store.gateway(options));
  const delegate = yield* Effect.tracer.pipe(Effect.provide(life));
  const tracer = Tracer.make({
    span: (init) => {
      const span = delegate.span(init);
      spans.push(span);
      return span;
    },
  });
  const trace = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.withTracer(tracer), Effect.provide(logger));
  const door = () => Gateway.pipe(Effect.provide(life));
  let d = yield* door();
  const j = <A, E>(f: (jobs: Jobs["Service"]) => Effect.Effect<A, E>) => Jobs.use(f).pipe(Effect.provide(life));
  const clients: Array<Client> = [];
  const grant = Effect.fnUntraced(function* (k: Key, role: Client["role"], id: string) {
    const value = grantText({
      id,
      key: k.raw,
      for: PERSON,
      to: "jobs-law",
      as: role,
      sentAt: SENT,
      saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: [] },
    });
    expect((yield* d.grant({ text: value, armored: yield* root.sign(value) }))._tag).toBe("applied");
  });
  const hello = Effect.fnUntraced(function* (
    k: Key,
    role: Client["role"],
    has: ReadonlyArray<string>,
    build: string | undefined,
  ) {
    const client = yield* d.connect();
    const nonce = yield* d.challenge(client);
    const tab = String(client);
    urls.push(`${URL}/client/${encodeURIComponent(k.fingerprint)}/${encodeURIComponent(tab)}`);
    const checked = yield* d.initialize(
      client,
      {
        versions: [1],
        has,
        ...(build === undefined ? {} : { build }),
        ping: "30s",
        key: k.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: SENT,
        signed: yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
      },
      { url: URL, tab, name: k.fingerprint },
    );
    expect(checked._tag).toBe("online");
    const c: Client = { client, key: k, role, has, build, live: true };
    clients.push(c);
    return c;
  });
  const revoke = Effect.fnUntraced(function* (c: Client, id: string, ancestor = false) {
    const value = revokeText({
      id,
      key: ancestor ? root.line : c.key.raw,
      for: PERSON,
      to: "jobs-law",
      sentAt: SENT,
      saw: { label: "test", location: "test", method: "command", check: "touch" },
    });
    // A second gateway over the same store takes the membership write before a held call.
    const b = yield* Gateway.pipe(Effect.provide(store.gateway(options)));
    expect((yield* b.grant({ text: value, armored: yield* (ancestor ? backup : root).sign(value) }))._tag).toBe(
      "applied",
    );

    for (const old of clients.filter((x) => ancestor || x.key.raw === c.key.raw)) {
      old.live = false;
    }
  });
  const tryGrant = Effect.fnUntraced(function* (c: Client, id: string) {
    const value = grantText({
      id,
      key: stranger.raw,
      for: PERSON,
      to: "jobs-law",
      as: "hands",
      sentAt: SENT,
      saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: ["git"] },
    });
    const answer = yield* trace(d.grant({ text: value, armored: yield* c.key.sign(value) }));
    expect(answer._tag).toBe("refused");
  });
  const route = Effect.fnUntraced(function* (c: Client, method: string, params: unknown) {
    // oxlint-disable-next-line fabrika/no-ledger-sql -- edge: this security law audits persisted input records
    const inputRows = () => store.sql.exec("SELECT * FROM entries WHERE stream='gateway/inputs'");
    const beforeInputs = inputRows();
    const answer = yield* trace(d.route(c.client, method, params));

    if (method.startsWith("jobs.")) {
      expect(inputRows()).toEqual(beforeInputs);
    }

    let saved = Attached.cases.online.make({
      client: c.client,
      identity: { key: c.key.fingerprint, person: PERSON, as: c.role },
      version: 1,
      waits: [],
      busy: false,
      watching: false,
      has: c.has,
      ...(c.build === undefined ? {} : { build: c.build }),
    });
    const transport = connection({
      reader: c.client,
      session: c.client,
      ping: () => 30_000,
      read: () => saved,
      save: (a) => {
        if (a._tag === "online") {
          saved = a;
          attachments.push(a);
        }
      },
      send: (f) => {
        frames.push(f);
      },
      close: () => {},
      wait: () => (answer._tag === "refused" ? Effect.fail(answer) : Effect.die("hands ledger.wait must be refused")),
      call: () => Effect.succeed(answer),
    });
    yield* trace(transport.frame(JSON.stringify({ jsonrpc: "2.0", id: frames.length, method, params })));
    return answer;
  });

  for (const [n, k] of keys.entries()) {
    yield* grant(k, n < 2 ? "hands" : n === 2 ? "window" : "agent", `grant-${n}`);
  }

  const primary = yield* hello(pick(keys, 0), "hands", ["git", "node", "docker"], "first-build");
  const other = yield* hello(pick(keys, 1), "hands", ["git", "node", "docker"], "other-build");
  yield* hello(pick(keys, 2), "window", ["git", "node", "docker"], "window-build");
  yield* hello(pick(keys, 3), "agent", ["git", "node", "docker"], "agent-build");
  return {
    store,
    root,
    privateKeys: [root.stored, backup.stored, stranger.stored, ...keys.map((key) => key.stored)],
    primary,
    other,
    clients,
    notices,
    delivered,
    opened,
    frames,
    urls,
    logs,
    spans,
    attachments,
    controls,
    grant,
    hello,
    revoke,
    tryGrant,
    route,
    j,
    reopen: Effect.gen(function* () {
      yield* store.reopen;
      life = yield* Layer.build(store.gateway(options));
      d = yield* door();
    }),
  };
});

type Focus = "A4" | "A6" | "A7" | "A8" | "A9" | "A10" | "A11" | "A12";

const moves: Record<Focus, ReadonlyArray<string>> = {
  A4: ["advance", "take", "capabilities", "role", "reconnect"],
  A6: ["advance", "take", "add", "ambiguous", "reopen"],
  A7: ["advance", "take", "wrong", "reconnect"],
  A8: ["advance", "take", "revoke", "race", "reconnect"],
  A9: ["advance", "take", "forbidden", "grant"],
  A10: ["advance", "take", "retry", "reconnect", "reopen"],
  A11: ["advance", "take", "malformed", "reserved"],
  A12: ["advance", "take", "retry", "malformed", "reserved", "reconnect", "reopen", "forbidden", "role", "grant"],
};

const walk = (open: Effect.Effect<Store, never, Scope.Scope>, focus: Focus, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const w = yield* world(open);
    const saved: Array<Saved> = [];
    let current = w.primary;
    let sequence = 0;
    const said = (cell: Cell) => ({
      sentAt: cell.sentAt,
      seen: cell.seen % (Math.max(0, ...saved.flatMap((s) => s.job.events.map((event) => event.rev))) + 1),
    });
    const add = Effect.fnUntraced(function* (process: string, cell: Cell) {
      const request = {
        ...tape.request,
        process,
        id: `opaque-${sequence++}`,
        target: w.primary.key.fingerprint,
        needs: ["git"],
      };
      yield* w.j((j) =>
        j.request(request, {
          by: "trusted-program",
          for: PERSON,
          sentAt: cell.sentAt,
          seen: 0,
          parent: request.parent,
          traceId: request.traceId,
          build: request.build,
        }),
      );
      const job = yield* w.j((j) => j.read(request.id));
      expect(job.state).toEqual(State.cases.requested.make({ request }));
      saved.push({ request, job });
    });
    yield* add(tape.request.process, pick(tape.cells, 0));
    const beforeHello = JSON.stringify(saved.map((s) => s.job));
    expect(w.notices.filter((n) => JSON.stringify(n).includes("jobs."))).toEqual([]);
    expect(JSON.stringify(yield* w.j((j) => j.read(pick(saved, 0).request.id)))).toBe(
      JSON.stringify(pick(saved, 0).job),
    );
    expect(beforeHello).not.toBe("");
    const unchanged = Effect.fnUntraced(function* () {
      for (const s of saved) {
        expect(yield* w.j((j) => j.read(s.request.id))).toEqual(s.job);
      }
    });
    const snapshot = (s: Saved) => ({ process: s.request.process, job: s.request.id });
    const checkEvent = (s: Saved, c: Client, cell: Cell, seen: number) => {
      const event = last(s.job.events);
      expect(event.by).toBe(c.key.fingerprint);
      expect(event.for).toBe(PERSON);
      expect(event.sentAt).toBe(cell.sentAt);
      expect(event.seen).toBe(seen);
      expect(event.build).toBe(c.build);

      if (focus === "A10" && (event.event === "started" || event.event === "finished")) {
        expect(event).toMatchObject({ connection: c.client, has: c.has });
      }

      expect(s.job.state).toMatchObject({ request: s.request });
      expect(event.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(event.arrivedAt).toBeGreaterThanOrEqual(0);
    };
    const take = Effect.fnUntraced(function* (s: Saved, cell: Cell) {
      const before = s.job;
      const candidates = saved.filter(
        (other) => other.request.process === s.request.process && phase(other) !== "finished",
      );
      const metadata = said(cell);
      const answer = yield* w.route(current, "jobs.take", { process: s.request.process, ...metadata });
      const able = current.live && current.role === "hands" && current.build !== undefined;

      if (!able || (candidates.length === 1 && !current.has.includes("git"))) {
        refused(answer);
        return;
      }

      const result = accepted(answer);

      if (candidates.length === 0) {
        expect(result).toEqual(TakeReply.cases.idle.make({}));
        done.add("idle");
      } else if (candidates.length > 1) {
        expect(result).toEqual(TakeReply.cases.refused.make({ reason: "ambiguous" }));
        done.add("ambiguous");
      } else {
        const selected = pick(candidates, 0);
        const job = Schema.decodeUnknownSync(Schema.TaggedStruct("assigned", { job: Job }))(result).job;
        expect(job).toEqual(yield* w.j((j) => j.read(selected.request.id)));

        if (phase(selected) === "requested") {
          expect(job.state).toMatchObject({
            request: selected.request,
            assignment: {
              executor: {
                key: current.key.fingerprint,
                connection: current.client,
                has: current.has,
                build: current.build,
              },
            },
          });
          selected.job = job;
          checkEvent(selected, current, cell, metadata.seen);
          done.add("assigned");
        } else {
          expect(job).toEqual(selected.job);
          done.add(`take@${phase(selected)}`);
        }
      }

      if (candidates.length !== 1) {
        expect(s.job).toBe(before);
      }
    });

    for (const cell of tape.cells) {
      const s = pick(saved, cell.pick);
      const p = phase(s);
      const available = moves[focus].filter((move) =>
        move === "race"
          ? current.live && current.build !== undefined && current.has.includes("git") && p !== "requested"
          : move === "revoke"
            ? current.live && p !== "requested"
            : move === "retry"
              ? p === "started" || p === "finished"
              : move === "wrong"
                ? p !== "requested"
                : true,
      );
      const move = pick(available, cell.move);
      done.add(move);

      if (move === "add") {
        const process = yield* Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer));
        yield* add(process, cell);
      } else if (move === "ambiguous") {
        yield* add(s.request.process, cell);
      } else if (move === "take") {
        yield* take(s, cell);
      } else if (move === "advance") {
        if (p === "requested" || p === "finished") {
          yield* take(s, cell);
        } else {
          if (current.live && focus === "A10") {
            current = yield* w.hello(current.key, "hands", ["git", ...cell.has], `${cell.build}-${sequence++}`);
            expect(current.client).not.toBe(assignment(s).executor.connection);
            done.add(`reconnect@${p}`);
          } else if (current.live && (current.build === undefined || !current.has.includes("git"))) {
            current = yield* w.hello(current.key, "hands", ["git"], cell.build);
          }

          const method = p === "assigned" ? "jobs.started" : "jobs.finish";
          const params = {
            ...snapshot(s),
            execution: assignment(s).execution,
            ...said(cell),
            ...(method === "jobs.finish" ? { result: cell.result } : {}),
          };
          const answer = yield* w.route(current, method, params);

          if (!current.live || current.build === undefined || !current.has.includes("git")) {
            refused(answer);
          } else {
            const receipt = accepted(answer);
            const first = s.job;
            s.job = yield* w.j((j) => j.read(s.request.id));
            checkEvent(s, current, cell, params.seen);

            if (focus === "A10") {
              expect(assignment(s)).toEqual(assignment({ ...s, job: first }));
            }

            expect(s.job.events).toHaveLength(first.events.length + 1);
            expect(receipt).toMatchObject({ rev: last(s.job.events).rev, arrivedAt: last(s.job.events).arrivedAt });

            if (method === "jobs.started") {
              s.starts = receipt;
              done.add("started");
            } else {
              s.finish = receipt;
              expect(s.job.state._tag).toBe("finished");
              expect(s.job.state).toMatchObject({ result: cell.result });
              done.add("finished");
            }
          }
        }
      } else if (move === "reconnect" || move === "capabilities") {
        const has =
          focus === "A7" ? ["git"] : move === "capabilities" ? (cell.variant % 2 === 0 ? [] : ["git"]) : cell.has;

        if (current.live) {
          current = yield* w.hello(
            current.key,
            "hands",
            has,
            focus !== "A7" && cell.variant % 5 === 0 ? undefined : cell.build,
          );
          done.add(`hello:${current.build === undefined ? "old" : current.has.includes("git") ? "able" : "lacking"}`);
          yield* take(s, cell);
        }
      } else if (move === "role") {
        const c = pick(
          w.clients.filter((x) => x.role !== "hands"),
          cell.pick,
        );

        for (const method of ["jobs.take", "jobs.read", "jobs.started", "jobs.finish"]) {
          const params =
            method === "jobs.take"
              ? { process: s.request.process, ...said(cell) }
              : method === "jobs.read"
                ? snapshot(s)
                : {
                    ...snapshot(s),
                    execution: p === "requested" ? "unknown" : assignment(s).execution,
                    ...said(cell),
                    ...(method === "jobs.finish" ? { result: cell.result } : {}),
                  };
          refused(yield* w.route(c, method, params));
        }

        done.add(c.role);
      } else if (move === "wrong") {
        const params = { ...snapshot(s), execution: assignment(s).execution, ...said(cell) };
        const wrongProcess = yield* Id.Generator.use((g) => g.next(Id.Process)).pipe(
          Effect.provide(Id.Generator.layer),
        );
        const methods = ["jobs.read", "jobs.started", "jobs.finish"];

        for (const method of methods) {
          const base =
            method === "jobs.read"
              ? snapshot(s)
              : { ...params, ...(method === "jobs.finish" ? { result: cell.result } : {}) };
          refused(yield* w.route(w.other, method, base));
          refused(yield* w.route(current, method, { ...base, process: wrongProcess }));

          if (method !== "jobs.read") {
            refused(yield* w.route(current, method, { ...base, execution: `${params.execution}x` }));
          }
        }

        expect(jobReply(yield* w.route(w.primary, "jobs.read", snapshot(s)))).toEqual(s.job);
        done.add(`wrong@${p}`);
      } else if (move === "retry") {
        if (current.live && (current.build === undefined || !current.has.includes("git"))) {
          current = yield* w.hello(current.key, "hands", ["git"], cell.build);
        }

        const changed = { ...said(cell), sentAt: `${cell.sentAt}-retry` };
        const start = yield* w.route(current, "jobs.started", {
          ...snapshot(s),
          execution: assignment(s).execution,
          ...changed,
        });
        const able = current.live && current.build !== undefined && current.has.includes("git");

        if (able) {
          expect(accepted(start)).toEqual(s.starts);
        } else {
          refused(start);
        }

        if (p === "finished" && s.job.state._tag === "finished") {
          const finish = yield* w.route(current, "jobs.finish", {
            ...snapshot(s),
            execution: assignment(s).execution,
            ...changed,
            result: s.job.state.result,
          });

          if (able) {
            expect(accepted(finish)).toEqual(s.finish);
          } else {
            refused(finish);
          }
        }

        done.add(`retry@${p}`);
      } else if (move === "reopen") {
        yield* w.reopen;

        if (focus === "A10") {
          for (const kept of saved) {
            expect(jobReply(yield* w.route(w.primary, "jobs.read", snapshot(kept)))).toEqual(kept.job);
            done.add(`reopen@${phase(kept)}`);
          }
        }
      } else if (move === "revoke") {
        yield* w.revoke(current, `revoke-${sequence++}`);
      } else if (move === "race") {
        const entered = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();
        w.controls.pause = { entered, release };
        const method = pick(
          p === "finished"
            ? ["jobs.read", "jobs.finish"]
            : ["jobs.take", "jobs.read", "jobs.started", ...(p === "started" ? ["jobs.finish"] : [])],
          cell.variant,
        );
        const params =
          method === "jobs.take"
            ? { process: s.request.process, ...said(cell) }
            : method === "jobs.read"
              ? snapshot(s)
              : {
                  ...snapshot(s),
                  execution: assignment(s).execution,
                  ...said(cell),
                  ...(method === "jobs.finish"
                    ? { result: s.job.state._tag === "finished" ? s.job.state.result : cell.result }
                    : {}),
                };
        const pending = yield* Effect.forkScoped(w.route(current, method, params));
        yield* Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(pending).pipe(
            Effect.andThen(Effect.die("the queued call answered without entering the shared turn")),
          ),
        );
        yield* w.revoke(current, `race-${sequence++}`, cell.variant % 2 === 1);
        yield* Deferred.succeed(release, undefined);
        refused(yield* Fiber.join(pending));
        done.add(`race:${method}`);
      } else if (move === "grant") {
        yield* w.tryGrant(current, `hands-grant-${sequence++}`);
      } else if (move === "forbidden") {
        const method = pick(
          [
            "view.open",
            "process.send",
            "ledger.read",
            "ledger.wait",
            "gateway.watch",
            "gateway.deny",
            "spans.read",
            "spans.content",
            "spans.deleteContent",
            "jobs.request",
            "project.sign",
          ],
          cell.variant,
        );
        const before = [w.delivered.length, w.opened.length];
        refused(
          yield* w.route(current, method, {
            pid: s.request.process,
            stream: "gateway/access",
            after: 0,
            letter: `letter-${sequence++}`,
            m: { type: "input" },
            sentAt: SENT,
            seen: 0,
            key: w.other.key.raw,
            saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: [] },
            chain: Chain.cases.spans.make({}),
            spanId: "known",
            reason: "test",
          }),
        );
        expect([w.delivered.length, w.opened.length]).toEqual(before);
        done.add(`forbidden:${method}`);
      } else if (move === "malformed" || move === "reserved") {
        const method = pick(["jobs.take", "jobs.read", "jobs.started", "jobs.finish"], cell.pick);
        const base =
          method === "jobs.take"
            ? { process: s.request.process, ...said(cell) }
            : method === "jobs.read"
              ? snapshot(s)
              : {
                  ...snapshot(s),
                  execution: p === "requested" ? "unknown" : assignment(s).execution,
                  ...said(cell),
                  ...(method === "jobs.finish" ? { result: cell.result } : {}),
                };
        const field = pick(
          move === "reserved"
            ? ["id", "by", "for", "arrivedAt"]
            : ["target", "as", "has", "build", "connection", "extra"],
          cell.variant,
        );
        // oxlint-disable-next-line fabrika/no-ledger-sql -- edge: the security law audits raw output without granting hands ledger access
        const inputs = () => w.store.sql.exec("SELECT * FROM entries WHERE stream='gateway/inputs'");
        const beforeInputs = inputs();
        const storedRows = () =>
          ["entries", "measurements", "unsent"].map((table) => w.store.sql.exec(`SELECT * FROM "${table}"`));
        const beforeStored = move === "reserved" ? storedRows() : [];
        const answer = yield* w.route(current, method, { ...base, [field]: tape.secret });

        if (move === "reserved") {
          expect(inputs()).toEqual(beforeInputs);
          expect(storedRows()).toEqual(beforeStored);
          const sums = w.store.sql.exec("SELECT * FROM sums WHERE refused='reserved'");
          expect(sums.length).toBeGreaterThan(0);
          expect(new Set(sums.map((row) => JSON.stringify([row.piece, row.hour]))).size).toBe(sums.length);
          expect(sums.every((row) => Number(row.count) > 0)).toBe(true);
        }

        refused(answer);

        if (move === "reserved") {
          expect(answer).toMatchObject({ reason: "reserved" });
        }

        if (method === "jobs.finish") {
          refused(
            yield* w.route(current, method, {
              ...base,
              result: { ...JobResult.cases.exited.make({ code: 0, version: "x" }), code: "bad" },
            }),
          );
        }

        done.add(`${move}:${field}`);
      }

      yield* unchanged();
      expect(w.notices.filter((n) => JSON.stringify(n).includes("jobs."))).toEqual([]);
    }

    if (focus === "A12") {
      // These generated key-store sentinels never enter a protocol parameter.
      const sentinels = [`private-${tape.secret}-key`, `pass-${tape.secret}`, `recovery-${tape.secret}`];

      for (const privateKey of w.privateKeys) {
        // oxlint-disable-next-line fabrika/no-redacted-value -- edge: this test compares generated sentinels to public output without printing or sending them
        sentinels.push(Redacted.value(privateKey));
      }

      const outputs: Record<string, unknown> = {
        frames: w.frames,
        urls: w.urls.flatMap((url) => [url, encodeURIComponent(url), decodeURIComponent(url)]),
        logs: w.logs,
        spans: w.spans.map((span) => ({
          name: span.name,
          attributes: [...span.attributes],
          events: span.events,
          status: span.status,
        })),
        measurements: [],
        attachments: w.attachments,
        ledger: [],
      };
      const tables = w.store.sql
        .exec("SELECT name FROM sqlite_master WHERE type='table'")
        .map((row) => String(row.name));

      for (const table of tables) {
        const rows = w.store.sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`);

        if (table === "entries") {
          outputs.ledger = rows;

          for (const row of rows.filter((row) => row._tag === "initialized")) {
            const { url } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))(
              row.body,
            );
            outputs.urls = [outputs.urls, url, encodeURIComponent(url), decodeURIComponent(url)];
          }
        } else if (table === "gateway_state") {
          outputs.attachments = [w.attachments, rows];
        } else if (/measure|refusal|sums|summary/.test(table)) {
          outputs.measurements = [outputs.measurements, rows];
        } else if (table === "unsent" || /span|content/.test(table)) {
          outputs.spans = [outputs.spans, rows];
        }
      }

      for (const [name, value] of Object.entries(outputs)) {
        const encoded = JSON.stringify(value, (_key, item: unknown) =>
          typeof item === "bigint"
            ? String(item)
            : item instanceof Map
              ? [...item]
              : item instanceof Error
                ? { name: item.name, message: item.message, cause: item.cause }
                : item,
        );

        for (const sentinel of sentinels) {
          for (const form of [
            sentinel,
            encodeURIComponent(sentinel),
            encodeURIComponent(encodeURIComponent(sentinel)),
            Base64.encode(text(sentinel)),
            Base64Url.encode(text(sentinel)),
          ]) {
            expect(encoded.includes(form), name).toBe(false);
          }
        }
      }
    }
  });

const required: Record<Focus, ReadonlyArray<string>> = {
  A4: [
    "assigned",
    "started",
    "finished",
    "window",
    "agent",
    "hello:old",
    "hello:lacking",
    "take@assigned",
    "take@started",
  ],
  A6: ["assigned", "started", "finished", "idle", "ambiguous", "reopen"],
  A7: ["wrong@assigned", "wrong@started", "wrong@finished"],
  A8: ["race:jobs.take", "race:jobs.read", "race:jobs.started", "race:jobs.finish"],
  A9: [
    "grant",
    "forbidden:view.open",
    "forbidden:process.send",
    "forbidden:ledger.read",
    "forbidden:ledger.wait",
    "forbidden:gateway.watch",
    "forbidden:gateway.deny",
    "forbidden:spans.read",
    "forbidden:spans.content",
    "forbidden:spans.deleteContent",
    "forbidden:jobs.request",
    "forbidden:project.sign",
  ],
  A10: [
    "assigned",
    "started",
    "finished",
    "retry@started",
    "retry@finished",
    "reopen",
    "reconnect",
    "reconnect@assigned",
    "reconnect@started",
    "reopen@started",
    "reopen@finished",
  ],
  A11: [
    "assigned",
    "started",
    "finished",
    "reserved:id",
    "reserved:by",
    "reserved:for",
    "reserved:arrivedAt",
    "malformed:target",
    "malformed:as",
    "malformed:has",
    "malformed:build",
    "malformed:connection",
    "malformed:extra",
  ],
  A12: ["assigned", "started", "finished", "retry", "malformed", "reserved", "reconnect", "reopen"],
};

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  for (const focus of Object.keys(moves) as Array<Focus>) {
    it.effect(
      `${focus}${focus === "A12" ? " [secrets]" : ""}: authenticated job histories preserve authority and durable facts`,
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = walk(open, focus, done);
          const result = yield* Arbitrary.checkEffect(
            Arbitrary.schema(Tape),
            (tape) =>
              Effect.scoped(law(tape)).pipe(
                Effect.as(true),
                Effect.catchCause((cause) => Effect.fail(cause)),
              ),
            { seed: 119120, runs: focus === "A12" ? 40 : focus === "A8" || focus === "A10" ? 60 : 100, concurrency: 1 },
          );
          expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
          expect([...done]).toEqual(expect.arrayContaining([...required[focus]]));
        }),
      120_000,
    );
  }
};
