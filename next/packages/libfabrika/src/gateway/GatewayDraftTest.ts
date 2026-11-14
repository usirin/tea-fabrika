// fabsh in a tile, slice 1, next/: the door's draft laws L10, L11 and the door's half of L6 of the
// approved plan (docs/plan/lanes/fabsh-PLAN.md, "Laws"). The plan names one file,
// `gateway/GatewayDraft.laws.test.ts`; a gateway test may not open a driver, so the laws live here and
// `node/gateway/GatewayDraft.laws.test.ts` runs them on SQLite (0062), as `JobsTest` is run. They walk
// the real authenticated gateway: real keys, a real grant and a signed hello. Written before
// `process.draft`; until the build adds it, every draft answers `unknown_method` and spends the
// sender's main budget, so these laws fail for that reason.
//
// The shape these laws hold `Gateway.ts` to, from the plan's "The draft frame in the library" (the
// build may add more):
// - One new method, `process.draft`, params `{pid, m}`, beside `process.send`. It is checked like a
//   send's session and key, then routed to the process, never recorded: no input row, no binding,
//   no ledger entry, no span holding its text.
// - Its answer is the door's own `Answer`: `ok {result}` with the process's echo, or `refused
//   {reason}` with `not_granted` (no live session, or a key that no longer belongs), `ended` (the
//   process is not live, `isLive`), `no_draft` (its program declares none), `rate_limited`, or the
//   process's own refusal. `not_granted`, `ended` and `no_draft` come before any step.
// - Gateway options gain `draft(process, m)`, which reaches the process's runner and answers the
//   runner's `{ok} | {err, reason?}`, and `draftLimit`, the `gateway.draft-limit` budget, a
//   `{limit, window}` as `rateLimit` is. `policy(process)` also says `draft: boolean`, whether the
//   program declares a draft. These option names are what these laws add to the plan's sketch.
// - Draft frames spend `draftLimit` per key and never `rateLimit`.
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Result as R, Schema, type Scope, Semaphore } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { grantText, revokeText } from "../access/Text.ts";
import type { Sql } from "../Sql.ts";
import { Answer as AnswerSchema, type Answer } from "../transport/Wire.ts";
import { Gateway, type ConnectionId } from "./Gateway.ts";

/** What the module owning the driver gives: a fresh store, its reopen, and a gateway over it. */
export type Store = {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
  readonly gateway: (
    options: Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0],
  ) => Layer.Layer<Gateway>;
};

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const URL = "https://fabrika.test/drafts";
const SENT = "2026-11-14T10:00:00.000Z";
const PID = "process_01m6v5270hetdrt4r8h9vvjwjs";
const SEED = 119120;

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

// A shared suite is not a `*.test.ts` file, so its failures are tagged like product code's.
class CryptoFailed extends Schema.TaggedError<CryptoFailed>()("CryptoFailed", { cause: Schema.Defect() }) {}

const fail = (cause: unknown) => new CryptoFailed({ cause });

const key = Effect.fnUntraced(function* () {
  const s = crypto.subtle;
  const ed = "Ed25519";
  const sign: KeyUsage[] = ["sign"];
  const uses = ["sign", "verify"] as const;
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

type Client = { readonly client: ConnectionId; readonly key: Key };

/** One world's switches: whether the process is live and whether its program declares a draft. */
type Controls = { live: boolean; declares: boolean };

const world = Effect.fnUntraced(function* (
  open: Effect.Effect<Store, never, Scope.Scope>,
  limits: { readonly main: number; readonly draft: number },
) {
  const store = yield* open;
  const root = yield* key();
  const backup = yield* key();
  const keys = yield* Effect.forEach([0, 1], () => key(), { concurrency: 1 });
  const turn = yield* Semaphore.make(1);
  const controls: Controls = { live: true, declares: true };
  /** Every call that reached the process's runner: a step. */
  const steps: Array<{ process: string; m: unknown }> = [];
  const delivered: Array<unknown> = [];
  const options = {
    sql: store.sql,
    founder: {
      name: "drafts-law",
      person: PERSON,
      keys: [root.line, backup.line],
      window: null,
      by: root.sshFingerprint,
      build: "gateway-build",
    },
    name: "drafts-law",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "gateway-build",
    waiting: { most: 64, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 1_000_000,
    spentCap: 100_000,
    rateLimit: { limit: limits.main, window: 60_000 },
    draftLimit: { limit: limits.draft, window: 60_000 },
    turn,
    nextProcess: () => Effect.succeed(PID),
    isLive: () => Effect.sync(() => controls.live),
    policy: () => Effect.sync(() => ({ inputs: [], events: [], draft: controls.declares })),
    open: () => Effect.succeed(null),
    deliver: (_p: string, envelope: unknown) =>
      Effect.sync(() => {
        delivered.push(envelope);
      }),
    draft: (process: string, m: unknown) =>
      Effect.sync(() => {
        steps.push({ process, m });
        return { ok: m };
      }),
    notify: () => Effect.void,
    inputs: { schema: Schema.Json, personOnly: [], raw: [] },
    events: { personOnly: [] },
  } as Parameters<typeof Gateway.layer<Schema.Json, never, never, never>>[0];
  const life = yield* Layer.build(store.gateway(options));
  const d = yield* Gateway.pipe(Effect.provide(life));
  const grant = Effect.fnUntraced(function* (k: Key, id: string) {
    const value = grantText({
      id,
      key: k.raw,
      for: PERSON,
      to: "drafts-law",
      as: "window",
      sentAt: SENT,
      saw: { label: "test", location: "test", code: "1234", method: "command", check: "touch", has: [] },
    });
    expect((yield* d.grant({ text: value, armored: yield* root.sign(value) }))._tag).toBe("applied");
  });
  const hello = Effect.fnUntraced(function* (k: Key) {
    const client = yield* d.connect();
    const nonce = yield* d.challenge(client);
    const tab = String(client);
    const checked = yield* d.initialize(
      client,
      {
        versions: [1],
        has: [],
        build: "window-build",
        ping: "30s",
        key: k.raw,
        tab,
        nonce,
        platform: "browser",
        os: "linux",
        sentAt: SENT,
        signed: yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
      },
      { url: URL, tab, name: k.fingerprint },
    );
    expect(checked._tag).toBe("online");
    return { client, key: k } satisfies Client;
  });
  const revoke = Effect.fnUntraced(function* (c: Client, id: string) {
    const value = revokeText({
      id,
      key: c.key.raw,
      for: PERSON,
      to: "drafts-law",
      sentAt: SENT,
      saw: { label: "test", location: "test", method: "command", check: "touch" },
    });
    expect((yield* d.grant({ text: value, armored: yield* root.sign(value) }))._tag).toBe("applied");
  });

  for (const [n, k] of keys.entries()) {
    yield* grant(k, `grant-${n}`);
  }

  const first = yield* hello(pick(keys, 0));
  const second = yield* hello(pick(keys, 1));
  return {
    store,
    controls,
    steps,
    delivered,
    first,
    second,
    revoke,
    disconnect: (c: Client) => d.disconnect(c.client),
    route: (c: Client, method: string, params: unknown) => d.route(c.client, method, params),
  };
});

type World = Effect.Success<ReturnType<typeof world>>;

const draft = (w: World, c: Client, m: unknown) => w.route(c, "process.draft", { pid: PID, m });

let letters = 0;

/** A press: one `process.send`, which spends the main budget. */
const press = (w: World, c: Client) =>
  w.route(c, "process.send", {
    pid: PID,
    letter: `letter-${letters++}`,
    m: Submitted.make({ line: "help" }),
    sentAt: SENT,
    seen: 0,
  });

/** The press's letter, tagged as the door names an input. */
const Submitted = Schema.TaggedStruct("submitted", { line: Schema.String });

const reason = (a: typeof Answer.Type) => (a._tag === "refused" ? a.reason : a._tag);

/** Every row of every table of `sql`, as text. */
const dump = (sql: Sql): string =>
  JSON.stringify(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((t) => [String(t.name), sql.exec(`SELECT * FROM "${String(t.name).replace(/"/g, '""')}"`)]),
  );

const Case = Schema.Struct({
  kept: Schema.Boolean,
  live: Schema.Boolean,
  session: Schema.Boolean,
  declares: Schema.Boolean,
  text: Schema.String.check(Schema.isMaxLength(40)),
});

const Budget = Schema.Struct({
  main: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  draft: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  drafts: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  presses: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  order: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(40)),
});

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  it.effect.prop(
    "L10: the door answers a draft only for a live session whose key still belongs and a live process whose program declares a draft, and answers not_granted, ended or no_draft before any step",
    { c: Case },
    ({ c }) =>
      Effect.gen(function* () {
        const w = yield* world(open, { main: 1000, draft: 1000 });
        w.controls.live = c.live;
        w.controls.declares = c.declares;

        if (!c.kept) {
          yield* w.revoke(w.first, "revoke-first");
        }

        if (!c.session) {
          yield* w.disconnect(w.first);
        }

        const m = { text: c.text, cursor: c.text.length, n: 1 };
        const answer = yield* draft(w, w.first, m);
        const expected = !c.kept || !c.session ? "not_granted" : !c.live ? "ended" : !c.declares ? "no_draft" : "ok";
        expect(reason(answer), JSON.stringify(c)).toBe(expected);

        if (expected === "ok") {
          expect(answer, "the echo is the process's answer").toEqual(AnswerSchema.cases.ok.make({ result: m }));
          expect(w.steps, "one step, for that process").toEqual([{ process: PID, m }]);
        } else {
          expect(w.steps, `${expected} came after a step`).toEqual([]);
        }

        expect(w.delivered, "a draft is never delivered as a letter").toEqual([]);
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 200 } },
  );

  it.effect.prop(
    "L6, the door's half: a draft leaves no trace in the door's database, input rows, bindings, ledger and spans included",
    {
      texts: Schema.Array(Schema.String.check(Schema.isMaxLength(30))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(8),
      ),
    },
    ({ texts }) =>
      Effect.gen(function* () {
        const w = yield* world(open, { main: 1000, draft: 1000 });

        for (const [n, t] of texts.entries()) {
          const text = `zq${n}~${t.replace(/zq/g, "")}`;
          const answer = yield* draft(w, w.first, { text, cursor: 0, n });
          expect(answer._tag, "the draft was echoed").toBe("ok");
        }

        expect(dump(w.store.sql).includes("zq"), "the door's database holds draft text").toBe(false);
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 200 } },
  );

  const budget = (b: typeof Budget.Type) =>
    Effect.gen(function* () {
      const w = yield* world(open, { main: b.main, draft: b.draft });
      let drafts = 0;
      let presses = 0;
      const total = b.drafts + b.presses;

      for (let i = 0; i < total; i++) {
        const asDraft = (b.order[i] ?? i % 2 === 0) ? drafts < b.drafts : presses >= b.presses;

        if (asDraft) {
          drafts++;
          const answer = yield* draft(w, w.first, { text: "help", cursor: 4, n: i });
          expect(reason(answer), `draft ${drafts} of a budget of ${b.draft}`).toBe(
            drafts <= b.draft ? "ok" : "rate_limited",
          );
          continue;
        }

        presses++;
        const answer = yield* press(w, w.first);
        expect(
          reason(answer) === "rate_limited",
          `press ${presses} of a budget of ${b.main}, after ${drafts} drafts`,
        ).toBe(presses > b.main);
      }

      // The other key's budgets are its own.
      expect(reason(yield* draft(w, w.second, { text: "h", cursor: 1, n: 0 }))).toBe("ok");
    }).pipe(Effect.scoped);

  it.effect.prop(
    "L11: drafts spend gateway.draft-limit and never gateway.limit: a press passes while its own budget has room, and a draft past its budget answers rate_limited",
    { b: Budget },
    ({ b }) => budget(b),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  // pinned: the plan's reason for a budget of its own: typing spends more than a press budget holds.
  it.effect("pinned: L11 ten drafts, then two presses under a press budget of two", () =>
    budget({
      main: 2,
      draft: 12,
      drafts: 10,
      presses: 2,
      order: [true, true, true, true, true, true, true, true, true, true],
    }),
  );
};
