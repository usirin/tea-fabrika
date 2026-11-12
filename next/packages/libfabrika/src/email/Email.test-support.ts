// P36, next/ only. Test contracts, fixtures and observations. Nothing here decides whether an
// email request is allowed. P28/P24/P26 stand-ins return only the answers P36 consumes.
import { beforeAll, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Logger, Redacted, Schema, Semaphore, Tracer } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";
import { Add, MemberEvent, Signed } from "../access/Access.ts";
import { Written } from "../access/ClientManager.ts";

export const EPOCH = 1_800_000_000_000;
export const TEN_MINUTES = 600_000;

export const PURE = {
  arbitrary: { seed: 119120, runs: 100, size: 40, maxDiscards: 500, maxShrinks: 200, concurrency: 1 },
};

export const EFFECT = { arbitrary: { ...PURE.arbitrary, runs: 30 } };
export const INTEGRATION = { arbitrary: { ...PURE.arbitrary, runs: 10 } };
export const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const text = (minimum: number, maximum: number) =>
  Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

const list = <S extends Schema.Top>(item: S, minimum: number, maximum: number) =>
  Schema.Array(item).check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

export const Seed = list(integer(0, 255), 32, 32);
export const Boundary = Schema.Literals([-1, 0, 1]);
export const Role = Schema.Literals(["person", "window", "agent", "recovery", "email"]);
export const Edge = Schema.Literals(["store.read", "store.write", "store.commit", "send", "hash", "sign", "append"]);
export type Edge = typeof Edge.Type;
export const Operation = Schema.Literals(["issue", "wrong", "right", "replace", "reopen", "malformed", "refuse"]);

// Depth is constructed, not filtered. Every array/object has 0..8 items; text is 0..512.
const Json0 = Schema.Union([Schema.Null, Schema.Boolean, integer(-100, 100), text(0, 512)]);

const jsonLevel = <S extends Schema.Top>(child: S) =>
  Schema.Union([
    Json0,
    list(child, 0, 8),
    Schema.Struct({
      a: Schema.optionalKey(child),
      b: Schema.optionalKey(child),
      c: Schema.optionalKey(child),
      d: Schema.optionalKey(child),
      e: Schema.optionalKey(child),
      f: Schema.optionalKey(child),
      g: Schema.optionalKey(child),
      h: Schema.optionalKey(child),
    }),
  ]);

export const OutsideJson = jsonLevel(jsonLevel(jsonLevel(Json0)));

export const Flow = Schema.Struct({
  seed: Seed,
  code: Schema.Union([Schema.Literals([0, 1, 99999, 100000, 999999]), integer(0, 999999)]),
  malformed: text(0, 12),
  local: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,31}$/)),
  live: integer(1, 4),
  // Each of the five roles gets its own 0..3 pool, including hostile person keys.
  roles: Schema.Struct({
    person: integer(0, 3),
    window: integer(0, 3),
    agent: integer(0, 3),
    recovery: integer(0, 3),
    email: integer(0, 3),
  }),
  devices: integer(1, 4),
  requests: integer(1, 4),
  ops: list(Operation, 0, 40),
  attempts: integer(0, 6),
  replacements: integer(0, 3),
  reopens: integer(0, 4),
  label: text(0, 64),
  location: text(0, 128),
  capabilities: list(text(1, 16), 0, 4),
  time: integer(0, 172800001),
  boundary: Boundary,
  skew: integer(-604800000, 604800000),
  outside: OutsideJson,
  mutation: Schema.Literals(["id", "for", "to", "adds", "drops", "saw", "sentAt", "armor"]),
  armor: text(0, 2048),
  old: Schema.Literals(["lost", "kept"]),
  // A bit per edge means at most one failure at that edge per flow.
  failures: Schema.Struct({
    read: Schema.Boolean,
    write: Schema.Boolean,
    commit: Schema.Boolean,
    send: Schema.Boolean,
    hash: Schema.Boolean,
    sign: Schema.Boolean,
    append: Schema.Boolean,
  }),
  failureText: text(0, 160),
});
export type Flow = typeof Flow.Type;
export const flows = Arbitrary.schema(Flow);
export const CodeFlow = flows;
export const AttemptFlow = flows;
export const BindingFlow = flows;
export const SetupFlow = flows;
export const VerificationFlow = flows;
export const SignatureFlow = flows;
export const RecoveryFlow = flows;
export const RetryFlow = flows;
export const AuthorityFlow = flows;
export const MembershipFlow = flows;
export const NoticeFlow = flows;
export const SecretFlow = flows;
export const FailureFlow = flows;

export const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
export const LEDGER = "ledger_01m6v5270hf3c8x2q7w9z4k5mn";
export const input = (n: number) => `in-process_01m6v5270hf3c8x2q7w9z4k5mn-${n}`;
export const address = (flow: Flow) => `${flow.local}@example.test`;
export const code = (flow: Flow) => flow.code.toString().padStart(6, "0");
export const wrong = (value: string) => `${value[0] === "9" ? "8" : "9"}${value.slice(1)}`;

export const signed = (signer: string): typeof Signed.Type => ({
  signer,
  text: "checked by test door",
  armored: "test-only",
});

export type EmailAddition = typeof Add.Type & {
  readonly verified: string;
  readonly saw: typeof Add.Type.saw & { readonly label: string };
};

export const added = (flow: Flow, n = 0): EmailAddition => ({
  id: input(100 + n),
  for: PERSON,
  to: LEDGER,
  adds: Add.fields.adds.cases.person.make({
    key: `new-person-${n % flow.devices}`,
    window: `new-window-${n % flow.devices}`,
  }),
  drops: flow.old === "lost" ? ["person-0"] : [],
  verified: input(1),
  saw: {
    method: "email",
    label: flow.label,
    check: "touch",
    location: flow.location,
    has: flow.capabilities,
    typed: false,
    kept: null,
    old: flow.old,
  },
  sentAt: new Date(EPOCH + flow.skew).toISOString(),
});

// Every signed field is varied separately, including fields that still name the same device.
export const changedAdditions = (add: EmailAddition): ReadonlyArray<EmailAddition> => [
  { ...add, id: `${add.id}-changed` },
  { ...add, for: `${add.for}-changed` },
  { ...add, to: `${add.to}-changed` },
  { ...add, adds: Add.fields.adds.cases.person.make({ key: "another-person", window: "another-window" }) },
  { ...add, adds: Add.fields.adds.cases.person.make({ key: add.adds.key, window: "another-window" }) },
  { ...add, drops: [...add.drops, "another-root"] },
  { ...add, verified: `${add.verified}-changed` },
  { ...add, saw: { ...add.saw, old: add.saw.old === "lost" ? "kept" : "lost" } },
  { ...add, saw: { ...add.saw, location: `${add.saw.location}-changed` } },
  { ...add, saw: { ...add.saw, label: `${add.saw.label}-changed` } },
  { ...add, saw: { ...add.saw, method: "device" } },
  { ...add, saw: { ...add.saw, check: "click" } },
  { ...add, saw: { ...add.saw, has: [...add.saw.has, "another-capability"] } },
  { ...add, saw: { ...add.saw, typed: !add.saw.typed } },
  { ...add, saw: { ...add.saw, kept: "print" } },
  { ...add, sentAt: new Date(Date.parse(add.sentAt) + 1).toISOString() },
];

export const founded = (flow: Flow): MemberEvent =>
  MemberEvent.cases.founded.make({
    id: PERSON,
    name: "test home",
    keys: Array.from({ length: flow.live }, (_, n) => `person-${n}`),
    window: "window-0",
  });

export const initial = (flow: Flow): ReadonlyArray<MemberEvent> => [
  founded(flow),
  ...Array.from({ length: flow.live }, (_, n) =>
    MemberEvent.cases.granted.make({
      grant: {
        id: input(10 + n),
        for: PERSON,
        to: LEDGER,
        key: `agent-${n}`,
        as: "agent",
        sentAt: new Date(EPOCH).toISOString(),
        saw: {
          code: "",
          label: flow.label,
          location: flow.location,
          method: "command",
          check: "none",
          has: flow.capabilities,
        },
      },
      signed: signed(`person-${n}`),
    }),
  ),
];

export class Fault extends Schema.TaggedError<Fault>()("EmailTestFault", {
  reason: Schema.String,
  message: Schema.String,
}) {}

export type IO<A> = Effect.Effect<A, Fault | { readonly reason: string }>;
export const Challenge = Schema.Struct({ id: Schema.String, until: Schema.Number });
export type Challenge = typeof Challenge.Type;

export type Binding = {
  readonly for: string;
  readonly to: string;
  readonly person: string;
  readonly window: string;
};

export const binding = (n = 0): Binding => ({
  for: PERSON,
  to: LEDGER,
  person: `new-person-${n}`,
  window: `new-window-${n}`,
});

export type Redeemed = { readonly id: string; readonly add: typeof Add.Type };

export type Row = {
  readonly fact: unknown;
  readonly arrivedAt: number | null;
  readonly parent: string | null;
};

export type Mail = {
  readonly to: Redacted.Redacted<string>;
  readonly code: Redacted.Redacted<string>;
  readonly purpose: "setup" | "recovery";
  readonly device: string;
  readonly at: number;
};

export interface EmailSender {
  readonly send: (mail: Mail) => IO<void>;
}

export interface PrivateStorage {
  readonly read: (id: string) => IO<unknown>;
  readonly write: (id: string, value: unknown) => IO<void>;
  readonly transaction: <A>(body: Effect.Effect<A, Fault | { readonly reason: string }>) => IO<A>;
}

export interface Store {
  readonly snapshot: IO<ReadonlyArray<unknown>>;
}

export interface Recovery {
  readonly issueSetup: (device: Binding, to: Redacted.Redacted<string>) => IO<Challenge>;
  readonly verifySetup: (challenge: string, code: Redacted.Redacted<string>, fact: unknown) => IO<Written>;
  readonly issueRecovery: (device: Binding) => IO<Challenge>;
  readonly redeem: (
    challenge: string,
    code: Redacted.Redacted<string>,
    add: typeof Add.Type,
    proof: typeof Signed.Type,
  ) => IO<Redeemed>;
}

export interface Dependencies {
  readonly hash: (code: Redacted.Redacted<string>) => IO<string>;
  readonly store: Store;
  readonly sender: EmailSender;
  readonly entropy: { readonly bytes: (length: number) => IO<Uint8Array> };
  readonly key: {
    readonly public: string;
    readonly private: Redacted.Redacted<Uint8Array>;
    readonly sign: (text: string) => IO<string>;
  };
  readonly history: {
    readonly read: IO<ReadonlyArray<Row>>;
    readonly append: (row: Row) => IO<Written>;
  };
  readonly personCheck: IO<"touch">;
}

// These names are the tests' checked P36 contract. Assignments check against the real module as
// soon as it lands. No catch supplies a fake implementation or a passing answer.
export interface Domain {
  readonly EmailFact: Schema.Top;
  readonly verifiedText: (fact: unknown) => string;
}

// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the product module lazily so Vitest can register every law before build
export const loadDomain = Effect.tryPromise(() => import("./Email.ts"));
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the private store module at the test boundary
export const loadStore = Effect.tryPromise(() => import("./EmailSecrets.ts"));
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the recovery module at the test boundary
export const loadService = Effect.tryPromise(() => import("./EmailRecovery.ts"));

export const parentAnswers = (flow: Flow) => {
  const calls: string[] = [];
  return {
    calls,
    services: {
      device: Effect.succeed(binding()),
      oldDevice: Effect.sync(() => {
        calls.push("old");
        return flow.old;
      }),
      personCheck: Effect.sync(() => {
        calls.push("check");
        return "touch" as const;
      }),
    },
  };
};

export interface RecoveryParent {
  readonly Recovery: {
    readonly init: (input: {
      readonly cloud: boolean;
    }) => readonly [{ readonly email: unknown }, ReadonlyArray<unknown>];
    readonly update: (
      model: { readonly email: unknown },
      msg: unknown,
    ) => readonly [{ readonly email: unknown }, ReadonlyArray<unknown>];
  };
  readonly recoveryHandlers: (services: ReturnType<typeof parentAnswers>["services"]) => (command: unknown) => IO<void>;
}

// P28's parent path is reconciled when its own exam moves to main's modules.
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads P28 at the test boundary after its exam has moved
export const loadParent: Effect.Effect<RecoveryParent, unknown> = Effect.tryPromise(() => import("./Recovery.ts"));

export function pureModule<A>(load: () => Promise<A>): () => A {
  let loaded: A | undefined;
  let failure: unknown;
  beforeAll(() => {
    // oxlint-disable-next-line fabrika/no-promises -- edge: module loading returns a Promise at the Vitest boundary
    const loading = Effect.tryPromise(load);
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest waits for its setup hook Promise
    return Effect.runPromise(
      loading.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            loaded = value;
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            failure = error;
          }),
        ),
      ),
    );
  });
  return () => {
    if (loaded === undefined) {
      throw failure ?? new Error("missing P36 export");
    }

    return loaded;
  };
}

// Plants are applied to product code once after build, never registered as tests.
export function pureLaw<A>(name: string, arb: Arbitrary.Arbitrary<A>, ready: () => void, check: (a: A) => void) {
  it.prop(
    name,
    { flow: arb },
    ({ flow }) => {
      ready();
      check(flow);
    },
    PURE,
  );
}

export function effectLaw(name: string, check: (h: Harness) => IO<void>, arb = flows) {
  it.effect.prop(
    name,
    { flow: arb },
    ({ flow }) =>
      Effect.gen(function* () {
        const h = yield* harness(flow);
        yield* check(h);
      }),
    EFFECT,
  );
}

export const OUTPUTS = [
  "ledger",
  "snapshots",
  "replies",
  "notices",
  "urls",
  "logs",
  "spans",
  "errors",
  "signed",
  "frames",
  "models",
  "health",
  "reopened",
] as const;

export type Output = (typeof OUTPUTS)[number];
export type Captures = Record<Output, unknown[]>;
type Observations = { readonly [K in Output]: ReadonlyArray<unknown> };

export const captures = (): Captures => ({
  ledger: [],
  snapshots: [],
  replies: [],
  notices: [],
  urls: [],
  logs: [],
  spans: [],
  errors: [],
  signed: [],
  frames: [],
  models: [],
  health: [],
  reopened: [],
});

export const encodings = (secret: string): ReadonlyArray<string> => [
  ...new Set([
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("base64url"),
  ]),
];

export function assertSecret(out: Observations, secret: string, outputs: ReadonlyArray<Output> = OUTPUTS) {
  for (const name of outputs) {
    const raw = JSON.stringify(out[name]);

    for (const form of encodings(secret)) {
      // A numeric timestamp/count equal to a code is public. A string containing it is not.
      const strings: string[] = [];
      const visit = (value: unknown): void => {
        if (typeof value === "string") {
          strings.push(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            visit(item);
          }
        } else if (value !== null && typeof value === "object") {
          for (const item of Object.values(value)) {
            visit(item);
          }
        }
      };
      visit(out[name]);
      expect(
        strings.some((value) => value.includes(form)),
        `secret in ${name}`,
      ).toBe(false);

      // JSON escaped text may only become visible in the serialized form.
      if (!/^\d{6}$/.test(form)) {
        expect(raw.includes(form), `encoded secret in ${name}`).toBe(false);
      }
    }
  }
}

export function assertPrivate(out: Observations, bytes: ReadonlyArray<number> | Uint8Array) {
  const sequence = [...bytes];

  for (const output of OUTPUTS) {
    const visit = (value: unknown): void => {
      if (value instanceof Uint8Array) {
        expect([...value], `private bytes in ${output}`).not.toEqual(sequence);
      } else if (Array.isArray(value)) {
        for (let n = 0; n + sequence.length <= value.length; n++) {
          expect(value.slice(n, n + sequence.length), `private byte array in ${output}`).not.toEqual(sequence);
        }

        for (const item of value) {
          visit(item);
        }
      } else if (value !== null && typeof value === "object") {
        for (const item of Object.values(value)) {
          visit(item);
        }
      }
    };
    visit(out[output]);
  }
}

export const privateFixture = () => {
  const data = new Map<string, unknown>();
  const failures = new Map<Edge, string>();
  const hit = (edge: Edge) =>
    Effect.suspend(() => {
      const message = failures.get(edge);
      failures.delete(edge);
      return message === undefined ? Effect.void : Effect.fail(new Fault({ reason: edge, message }));
    });
  const storage: PrivateStorage = {
    read: (id) => hit("store.read").pipe(Effect.map(() => structuredClone(data.get(id)))),
    write: (id, value) =>
      hit("store.write").pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            data.set(id, structuredClone(value));
          }),
        ),
      ),
    transaction: (body) =>
      Effect.gen(function* () {
        const before = new Map(data);
        return yield* body.pipe(
          Effect.tap(() => hit("store.commit")),
          Effect.tapError(() =>
            Effect.sync(() => {
              data.clear();

              for (const [id, value] of before) {
                data.set(id, value);
              }
            }),
          ),
        );
      }),
  };
  return {
    data,
    storage,
    hit,
    fail: (edge: Edge, message: string) => {
      failures.set(edge, message);
    },
  };
};

// In-memory sender only. Its constructor has no route to environment credentials.
export const memorySender = (mails: Mail[], hit: (edge: Edge) => IO<void>): EmailSender => ({
  send: (mail) =>
    hit("send").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          mails.push(mail);
        }),
      ),
    ),
});

export const testKey = (seed: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const field = (data: string | Uint8Array) => {
      const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, body.length);
      return new Uint8Array([...size, ...body]);
    };
    const join = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));
    // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
    const { KeyLine, writeSshsig } = yield* Effect.tryPromise(() => import("../transport/Sshsig.ts"));
    const raw = Uint8Array.from(seed);
    const pkcs8 = join(Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]), raw);
    // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
    const key = yield* Effect.tryPromise(() => crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]));
    // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
    const jwk = yield* Effect.tryPromise(() => crypto.subtle.exportKey("jwk", key));
    const publicBytes = Buffer.from(Schema.decodeUnknownSync(Schema.String)(jwk.x), "base64url");
    const line = Schema.decodeUnknownSync(KeyLine)(
      `ssh-ed25519 ${Buffer.from(join(field("ssh-ed25519"), field(publicBytes))).toString("base64")}`,
    );
    return {
      line,
      raw,
      sign: (text: string) =>
        writeSshsig({
          text,
          space: "fabrika-client",
          line,
          sign: (bytes) =>
            // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
            Effect.tryPromise(() => crypto.subtle.sign("Ed25519", key, new Uint8Array(bytes))).pipe(
              Effect.map((bytes) => new Uint8Array(bytes)),
            ),
        }).pipe(Effect.orDie),
    };
  }).pipe(Effect.orDie);

export const harness = (flow: Flow, beforeAppend: IO<void> = Effect.void, afterAppend: IO<void> = Effect.void) =>
  Effect.gen(function* () {
    const storeModule = yield* loadStore;
    const serviceModule = yield* loadService;
    const domain = yield* loadDomain;
    yield* TestClock.setTime(EPOCH);
    const fixture = privateFixture();
    const lock = yield* Semaphore.make(1);
    const storage: PrivateStorage = {
      ...fixture.storage,
      transaction: (body) => lock.withPermits(1)(fixture.storage.transaction(body)),
    };
    const mails: Mail[] = [];
    const out = captures();
    const rows: Row[] = initial(flow).map((fact) => ({ fact, arrivedAt: EPOCH - 1, parent: null }));
    let checks = 0;
    let draw = 0;
    const key = yield* testKey(flow.seed);
    const signEntered = yield* Deferred.make<void>();
    const signRelease = yield* Deferred.make<void>();
    let pauseSign = false;
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const logger = Logger.make((options) => {
      out.logs.push(Logger.formatJson.log(options));
    });
    let store = storeModule.makeEmailStore(storage);
    const dependencies: Dependencies = {
      hash: (value) =>
        fixture.hit("hash").pipe(
          Effect.flatMap(() => {
            // oxlint-disable-next-line fabrika/no-redacted-value -- edge: hash only a generated test secret
            const bytes = new TextEncoder().encode(Redacted.value(value));
            // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto returns a Promise for its digest
            return Effect.tryPromise(() => crypto.subtle.digest("SHA-256", bytes));
          }),
          Effect.map((bytes) => Buffer.from(bytes).toString("hex")),
          Effect.mapError(() => ({ reason: "crypto" })),
        ),
      get store() {
        return store;
      },
      sender: memorySender(mails, fixture.hit),
      // Rejection sampling gets 0xffffffff first, then the target. This catches modulo bias.
      entropy: {
        bytes: (length) =>
          Effect.sync(() => {
            expect(length, "P36 code entropy is one uint32 per draw").toBe(4);
            const bytes = new Uint8Array(4);
            new DataView(bytes.buffer).setUint32(0, draw++ === 0 ? 0xffffffff : flow.code);
            return bytes;
          }),
      },
      key: {
        public: key.line,
        private: Redacted.make(key.raw),
        sign: (text) =>
          Effect.gen(function* () {
            yield* fixture.hit("sign");
            out.signed.push(text);

            if (pauseSign) {
              yield* Deferred.succeed(signEntered, undefined);
              yield* Deferred.await(signRelease);
            }

            return yield* key.sign(text);
          }),
      },
      history: {
        read: Effect.sync(() => structuredClone(rows)),
        // This is an append port, not a membership implementation. Integration laws below use
        // the real ClientManager and P10 door. Duplicate IDs are retained by the real writer.
        append: (row) =>
          Effect.gen(function* () {
            // Setup also appends. The caller selects which append to pause.
            yield* beforeAppend;
            yield* fixture.hit("append");
            const at = yield* Clock.currentTimeMillis;
            rows.push({ ...row, arrivedAt: at });
            out.ledger.push(rows.at(-1));
            yield* afterAppend;
            return Written.cases.applied.make({
              rev: Schema.decodeUnknownSync(Written.cases.applied.fields.rev)(rows.length),
            });
          }),
      },
      // P28 stand-in: no old-device policy, key creation or recovery decisions here.
      personCheck: Effect.sync(() => {
        checks++;
        return "touch" as const;
      }),
    };
    const make = () => serviceModule.makeEmailRecovery(dependencies) as IO<Recovery>;
    let recovery: Recovery = yield* make();
    const reopen = Effect.gen(function* () {
      store = storeModule.makeEmailStore(storage);
      recovery = yield* make();
      out.reopened.push(yield* dependencies.store.snapshot);
      return recovery;
    });
    const observe = Effect.gen(function* () {
      // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
      const { noticeView } = yield* Effect.tryPromise(() => import("./RecoveryEmail.ts"));

      for (const row of rows) {
        if (typeof row.fact === "object" && row.fact !== null && "_tag" in row.fact && row.fact._tag === "added") {
          // oxlint-disable-next-line fabrika/no-promises -- edge: Node module loading or WebCrypto returns a Promise at this test boundary
          const { MemberEvent } = yield* Effect.tryPromise(() => import("../access/Access.ts"));
          const event = Schema.decodeUnknownSync(MemberEvent.cases.added)(row.fact);
          out.notices.push(
            noticeView({
              added: event.add.id,
              label: Schema.decodeUnknownSync(Schema.Struct({ label: Schema.String }))(event.add.saw).label,
              location: event.add.saw.location,
              at: row.arrivedAt,
            }),
          );
        }
      }

      out.snapshots.push(yield* dependencies.store.snapshot);
      out.spans.push(
        ...spans.map((span) => ({
          name: span.name,
          attributes: [...span.attributes],
          status: span.status,
        })),
      );
    });
    return {
      flow,
      fixture,
      storage,
      dependencies,
      mails,
      out,
      rows,
      domain,
      key,
      tracer,
      logger,
      get recovery() {
        return recovery;
      },
      get checks() {
        return checks;
      },
      get draws() {
        return draw;
      },
      reopen,
      observe,
      signEntered,
      signRelease,
      pause: () => {
        pauseSign = true;
      },
    };
  });

export type Harness = Effect.Success<ReturnType<typeof harness>>;

const VerifiedFixture = Schema.TaggedStruct("verified", {
  verified: Schema.Struct({
    id: Schema.String,
    for: Schema.String,
    to: Schema.String,
    email: Schema.String,
    key: Schema.String,
    sentAt: Schema.String,
  }),
  signed: Signed,
});

export const verified = (h: Harness, signer = "person-0") =>
  VerifiedFixture.make({
    verified: {
      id: input(1),
      for: PERSON,
      to: LEDGER,
      email: "email_test-reference",
      key: h.key.line,
      sentAt: new Date(EPOCH + h.flow.skew).toISOString(),
    },
    signed: signed(signer),
  });

const lastMail = (h: Harness) => {
  const mail = h.mails.at(-1);

  if (mail === undefined) {
    throw new Error("Stand-in sender received no mail");
  }

  return mail;
};

export const setup = (h: Harness) =>
  Effect.gen(function* () {
    const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
    const fact = verified(h);
    const answer = yield* h.recovery.verifySetup(
      challenge.id,
      // oxlint-disable-next-line fabrika/no-redacted-value -- edge: read only a generated test secret to exercise the real hash or recovery input
      Redacted.make(Redacted.value(lastMail(h).code)),
      fact,
    );
    expect(answer._tag).toBe("applied");
    return fact;
  });

export const recover = (h: Harness, n = 0) =>
  Effect.gen(function* () {
    const challenge = yield* h.recovery.issueRecovery(binding(n % h.flow.devices));
    // oxlint-disable-next-line fabrika/no-redacted-value -- edge: read only a generated test secret to exercise the real hash or recovery input
    const value = Redacted.value(lastMail(h).code);
    const receipt = yield* h.recovery.redeem(
      challenge.id,
      Redacted.make(value),
      added(h.flow, n),
      signed(binding(n % h.flow.devices).person),
    );
    h.out.replies.push(challenge, receipt);
    return { challenge, value, receipt };
  });

export const tags = (h: Harness, tag: string) =>
  h.rows.filter(
    (row) => typeof row.fact === "object" && row.fact !== null && "_tag" in row.fact && row.fact._tag === tag,
  );

export const expectRefused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(effect);
    expect(Exit.isFailure(result)).toBe(true);
  });

// Full generated flows, including successful setup, refusals, ordering, injected failures,
// retries and durable reopens. Captures are filled by the real dependencies.
export const fullFlow = (h: Harness) =>
  Effect.gen(function* () {
    yield* setup(h);

    for (let n = 0; n < h.flow.requests; n++) {
      const { challenge, value } = yield* recover(h, n);

      for (const operation of h.flow.ops) {
        const action: IO<unknown> =
          operation === "reopen"
            ? h.reopen
            : operation === "issue" || operation === "replace"
              ? h.recovery.issueRecovery(binding())
              : h.recovery.redeem(
                  challenge.id,
                  Redacted.make(
                    operation === "right" ? value : operation === "malformed" ? h.flow.malformed : wrong(value),
                  ),
                  added(h.flow),
                  signed("unknown"),
                );
        const result = yield* Effect.exit(action);
        h.out.replies.push(Exit.isSuccess(result) ? result.value : "refused");

        if (Exit.isFailure(result)) {
          h.out.errors.push(result.cause);
        }
      }
    }

    const failures: ReadonlyArray<readonly [Edge, boolean]> = [
      ["store.read", h.flow.failures.read],
      ["store.write", h.flow.failures.write],
      ["store.commit", h.flow.failures.commit],
      ["send", h.flow.failures.send],
      ["hash", h.flow.failures.hash],
      ["sign", h.flow.failures.sign],
      ["append", h.flow.failures.append],
    ];

    for (const [edge, active] of failures) {
      if (active) {
        h.fixture.fail(edge, `${h.flow.failureText}${address(h.flow)}${code(h.flow)}`.slice(0, 160));
      }
    }

    const capture = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(effect);

        if (Exit.isSuccess(result)) {
          h.out.replies.push(result.value);
        } else {
          h.out.errors.push(result.cause);
        }

        return result;
      });

    // Each named edge can fail once. Keep attempting real operations until every injected
    // send, storage, hash, signing and append failure has had a chance to reach an output.
    for (const _edge of failures) {
      const issued = yield* capture(h.recovery.issueRecovery(binding()));

      if (Exit.isSuccess(issued)) {
        yield* capture(
          h.recovery.redeem(
            issued.value.id,
            // oxlint-disable-next-line fabrika/no-redacted-value -- edge: read only a generated test secret to exercise the real hash or recovery input
            Redacted.make(Redacted.value(lastMail(h).code)),
            added(h.flow),
            signed(binding().person),
          ),
        );
      }

      yield* capture(h.reopen);
    }

    for (let n = 0; n <= h.flow.reopens; n++) {
      yield* capture(h.reopen);
    }

    yield* TestClock.setTime(EPOCH + h.flow.time);
    yield* h.observe;
  });
