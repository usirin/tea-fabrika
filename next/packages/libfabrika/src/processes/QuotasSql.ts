/** SQL-backed quota candidates commit with the data they charge.
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { LedgerError } from "../ledger/Ledger.ts";
import { Entry, encodedBytes, lineFor } from "../ledger/Log.ts";
import { accountingEntries } from "../ledger/RefereeSql.ts";
import { WritePolicy } from "../ledger/WritePolicy.ts";
import type { Sql } from "../Sql.ts";
import * as Quota from "./internal/quota.ts";
import { ProcessTable } from "./Process.ts";
import {
  BadRow,
  Quotas,
  QuotasError,
  RecoveryReserveExhausted,
  Storage,
  type Accounting,
  type Allowance,
  type Limits,
  type Use,
} from "./Quotas.ts";

const TABLES = [
  "CREATE TABLE IF NOT EXISTS quota_accounts (account TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_entries (rev INTEGER PRIMARY KEY, account TEXT NOT NULL, bytes INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_steps (name TEXT NOT NULL, letter TEXT NOT NULL, account TEXT NOT NULL, bytes INTEGER NOT NULL, settled INTEGER NOT NULL, PRIMARY KEY(name,letter))",
];

const encode = Schema.encodeSync(Schema.fromJsonString(Quota.Model));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Quota.Model));
const Stepped = Schema.TaggedStruct("stepped", { input: Schema.String, pos: Schema.Number, build: Schema.String });
const StepBody = Schema.Struct({ input: Schema.String, pos: Schema.Number, build: Schema.String });
const readStep = Schema.decodeUnknownOption(StepBody);
type Authority = { readonly channel: "program" | "recovery"; readonly process: string } | "infrastructure" | null;

const use = (model: Quota.Model): Use => ({
  writes: model.writes,
  bytes: model.channel === "program" ? model.bytes - model.ahead.bytes : model.bytes,
  ahead: model.ahead,
  total: model.total,
});

/** Install the Project's admission policy and account reads over one store.
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql, options: { readonly brain: string; readonly limits: Limits }) =>
  Layer.unwrap(Effect.map(Clock.Clock, (clock) => make(sql, options, clock)));

const make = (sql: Sql, options: { readonly brain: string; readonly limits: Limits }, clock: Clock.Clock) => {
  let authority: Authority = null;
  const limits = options.limits;
  const initialize = () => {
    for (const query of TABLES) {
      sql.exec(query);
    }
  };
  const machine = (account: string) =>
    Quota.make({
      account,
      channel: account.endsWith("/project") ? "recovery" : "program",
      limits: account.endsWith("/project")
        ? limits.recovery.project
        : {
            writes: limits.writes,
            bytes: limits.storage,
            letter: limits.recovery.project.letter,
          },
    });
  const load = (account: string) => {
    const [row] = sql.exec("SELECT value FROM quota_accounts WHERE account=?", account);
    return row === undefined ? machine(account).init(null, {})[0] : decode(row.value);
  };
  const save = (model: Quota.Model) =>
    sql.exec(
      "INSERT INTO quota_accounts (account,value) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET value=excluded.value",
      model.account,
      encode(model),
    );
  const propose = (account: string, entry: Entry, ahead = { writes: 0, bytes: 0 }) => {
    const m = machine(account);
    const next = applyCell(m, load(account), {
      type: "propose",
      at: entry.arrivedAt,
      operation: "ledger",
      writes: 1,
      bytes: encodedBytes(entry),
      ahead,
    })[0];

    if (next._tag === "reserve_fault") {
      throw new QuotasError({ reason: next.fault });
    }

    if (next.decision._tag === "refused") {
      return Result.fail("quota" as const);
    }

    save(next);
    sql.exec("INSERT INTO quota_entries (rev,account,bytes) VALUES (?,?,?)", entry.rev, account, encodedBytes(entry));
    return Result.succeed(undefined);
  };
  const table = (entries: ReadonlyArray<Entry>) => new ProcessTable(entries, options.brain);
  const owner = (entry: Entry, entries: ReadonlyArray<Entry>) => {
    const registry = table(entries);
    const live = registry.info.find((p) => entry.stream === `${p.name}/inbox` || entry.stream.startsWith(`${p.name}/`));

    if (live !== undefined) {
      return live;
    }

    const life = registry.life(entry.stream.split("/")[0] ?? "");
    return Option.isNone(life)
      ? undefined
      : {
          process: life.value.state.process,
          name: life.value.name,
          program: life.value.state.code.program,
          build: life.value.state.code.hash,
        };
  };
  const aheadFor = (entry: Entry, target: NonNullable<ReturnType<typeof owner>>) =>
    encodedBytes(
      Entry.make({
        ...entry,
        id: `step:${entry.id}`,
        stream: target.process,
        pos: 1,
        rev: entry.rev + 1,
        ...lineFor(
          { ...entry, by: options.brain, build: target.build },
          Stepped.make({
            input: entry.id,
            pos: entry.pos,
            build: target.build,
          }),
        ),
      }),
    );
  const charge = (entry: Entry, entries: ReadonlyArray<Entry>, trusted: Authority) => {
    if (trusted === "infrastructure") {
      return Result.succeed(undefined);
    }

    const registry = table(entries);
    const selected = trusted === null ? undefined : Option.getOrUndefined(registry.life(trusted.process));
    const target = owner(entry, entries);

    if (trusted !== null && selected === undefined) {
      return Result.fail("quota" as const);
    }

    const account =
      selected !== undefined && trusted !== null
        ? trusted.channel === "recovery"
          ? `${selected.name}/project`
          : selected.state.code.program
        : target?.program;

    if (account === undefined || (target === undefined && trusted === null)) {
      return Result.fail("quota" as const);
    }

    const step = entry._tag === "stepped" ? readStep(entry.body) : Option.none();

    if (target !== undefined && Option.isSome(step)) {
      const [held] = sql.exec("SELECT * FROM quota_steps WHERE name=? AND letter=?", target.name, step.value.input);

      if (held !== undefined && held.settled === 0) {
        const payer = String(held.account);
        const next = applyCell(machine(payer), load(payer), {
          type: "settle",
          bytes: encodedBytes(entry),
          ahead: { writes: 1, bytes: Number(held.bytes) },
        })[0];
        save(next);
        sql.exec("UPDATE quota_steps SET settled=1 WHERE name=? AND letter=?", target.name, step.value.input);
        sql.exec("INSERT INTO quota_entries (rev,account,bytes) VALUES (?,?,?)", entry.rev, payer, encodedBytes(entry));
        return Result.succeed(undefined);
      }
    }

    const inbox = target !== undefined && entry.stream === `${target.name}/inbox`;
    const ahead = inbox ? { writes: 1, bytes: aheadFor(entry, target) } : { writes: 0, bytes: 0 };
    const result = propose(account, entry, ahead);

    if (Result.isSuccess(result) && inbox) {
      sql.exec(
        "INSERT INTO quota_steps (name,letter,account,bytes,settled) VALUES (?,?,?,?,0)",
        target.name,
        entry.id,
        account,
        ahead.bytes,
      );
    }

    return result;
  };
  const restore = () => {
    initialize();
    const entries = accountingEntries(sql);

    for (const entry of entries) {
      if (sql.exec("SELECT rev FROM quota_entries WHERE rev=?", entry.rev).length !== 0) {
        continue;
      }

      // Existing lifecycle and door history precede accounting. Ordinary data must have an owner.
      if (
        entry.stream === ProcessTable.stream ||
        entry.stream.startsWith("processes/") ||
        entry.stream === "gateway" ||
        entry.stream.startsWith("gateway/")
      ) {
        continue;
      }

      const target = owner(entry, entries);

      if (target === undefined) {
        throw new QuotasError({ reason: new BadRow({ cause: null }) });
      }

      // Restore exact historical use even when it already exceeds a newly lowered wall.
      const original = machine(target.program);
      const unlimited = Quota.make({
        account: target.program,
        channel: "program",
        limits: {
          writes: Number.MAX_SAFE_INTEGER,
          bytes: Number.MAX_SAFE_INTEGER,
          letter: limits.recovery.project.letter,
        },
      });
      const ahead =
        entry.stream === `${target.name}/inbox`
          ? { writes: 1, bytes: aheadFor(entry, target) }
          : { writes: 0, bytes: 0 };
      const next = applyCell(unlimited, original.init(load(target.program), {})[0], {
        type: "propose",
        at: entry.arrivedAt,
        operation: "restore",
        writes: 1,
        bytes: encodedBytes(entry),
        ahead,
      })[0];
      save(next);
      sql.exec(
        "INSERT INTO quota_entries (rev,account,bytes) VALUES (?,?,?)",
        entry.rev,
        target.program,
        encodedBytes(entry),
      );

      if (ahead.writes !== 0) {
        sql.exec(
          "INSERT OR IGNORE INTO quota_steps (name,letter,account,bytes,settled) VALUES (?,?,?,?,0)",
          target.name,
          entry.id,
          target.program,
          ahead.bytes,
        );
      }
    }
  };
  const read = Effect.fnUntraced(function* (account: string) {
    return yield* Effect.try({
      try: () =>
        sql.transaction(() => {
          restore();
          const m = machine(account);
          return use(applyCell(m, load(account), { type: "advance", at: clock.currentTimeMillisUnsafe() })[0]);
        }),
      catch: (cause) => (cause instanceof QuotasError ? cause : new QuotasError({ reason: new Storage({ cause }) })),
    });
  });
  const within = <A>(next: Authority, step: () => A): A => {
    const before = authority;
    authority = next;

    try {
      return step();
    } finally {
      authority = before;
    }
  };
  const service = Quotas.of({
    program: read,
    recovery: (name) => read(`${name}/project`),
    ordinary: (process, step) => within({ channel: "program", process }, step),
    recovering: (process, step) => within({ channel: "recovery", process }, step),
    infrastructure: (step) => within("infrastructure", step),
  });
  return Layer.mergeAll(
    Layer.succeed(Quotas, service),
    Layer.succeed(WritePolicy, {
      admit: (entry) => {
        restore();
        return charge(entry, accountingEntries(sql), authority);
      },
    }),
  );
};

const LocalTables = [
  "CREATE TABLE IF NOT EXISTS quota_local (account TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_fault (name TEXT PRIMARY KEY,value TEXT NOT NULL)",
];

const Pending = Schema.Struct({ operation: Schema.String, writes: Schema.Number, bytes: Schema.Number });
const Fault = Schema.Struct({ ...Pending.fields, fault: RecoveryReserveExhausted });
const faultEncode = Schema.encodeSync(Schema.fromJsonString(Fault));
const faultDecode = Schema.decodeUnknownSync(Schema.fromJsonString(Fault));

class Stopped extends Schema.TaggedError<Stopped>()("Stopped", { pending: Pending, fault: RecoveryReserveExhausted }) {}

/** Account name-local writes in the same synchronous transaction as their rows.
 * @stability unstable
 * @category constructors
 */
export const accounting = (sql: Sql, options: { readonly name: string; readonly limits: Allowance }): Accounting => {
  const machine = (channel: "local" | "recovery") =>
    Quota.make({
      account: `${options.name}/process`,
      channel,
      limits: options.limits,
    });
  const initialize = () => {
    for (const query of LocalTables) {
      sql.exec(query);
    }

    sql.exec("INSERT OR IGNORE INTO quota_fault (name,value) VALUES (?,?)", options.name, "");
  };
  const load = (channel: "local" | "recovery") => {
    const [row] = sql.exec("SELECT value FROM quota_local WHERE account=?", channel);
    return row === undefined ? machine(channel).init(null, {})[0] : decode(row.value);
  };
  const save = (channel: string, next: Quota.Model) =>
    sql.exec(
      "INSERT INTO quota_local (account,value) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET value=excluded.value",
      channel,
      encode(next),
    );
  const fault = () => {
    const [row] = sql.exec("SELECT value FROM quota_fault WHERE name=?", options.name);
    return row?.value === "" || row === undefined ? null : faultDecode(row.value);
  };
  const error = (cause: unknown) =>
    cause instanceof QuotasError ? cause : new QuotasError({ reason: new Storage({ cause }) });
  const protect = <A>(step: () => A): A => {
    initialize();

    try {
      return step();
    } catch (cause) {
      if (!(cause instanceof Stopped)) {
        throw cause;
      }

      // This write is after the data transaction rolled back. A storage failure stays loud.
      sql.exec(
        "UPDATE quota_fault SET value=? WHERE name=?",
        faultEncode({ ...cause.pending, fault: cause.fault }),
        options.name,
      );
      throw new QuotasError({ reason: cause.fault });
    }
  };
  return {
    protect,
    check: Effect.try({
      try: () => {
        initialize();
        const stopped = fault();

        if (stopped !== null) {
          throw new QuotasError({ reason: stopped.fault });
        }
      },
      catch: (cause) => new LedgerError({ reason: "storage", cause }),
    }),
    change: (operation, writes, bytes, at, recovery = false) => {
      initialize();
      const channel = recovery ? "recovery" : "local";

      if (writes === 0 && bytes === 0) {
        return;
      }

      const stopped = fault();

      if (stopped !== null) {
        throw new QuotasError({ reason: stopped.fault });
      }

      const next = applyCell(machine(channel), load(channel), {
        type: "propose",
        at,
        operation,
        writes,
        bytes,
        ahead: { writes: 0, bytes: 0 },
      })[0];

      if (next._tag === "reserve_fault") {
        throw new Stopped({ pending: { operation, writes, bytes }, fault: next.fault });
      }

      save(channel, next);
    },
    status: Effect.clockWith((clock) =>
      Effect.try({
        try: () => {
          initialize();
          const local = load("local");
          const recovery = applyCell(machine("recovery"), load("recovery"), {
            type: "advance",
            at: clock.currentTimeMillisUnsafe(),
          })[0];
          return { program: local.total, recovery: use(recovery), fault: fault()?.fault ?? null };
        },
        catch: error,
      }),
    ),
    resume: Effect.clockWith((clock) =>
      Effect.try({
        try: () =>
          sql.transaction(() => {
            initialize();
            const stopped = fault();

            if (stopped === null) {
              return;
            }

            const m = machine("recovery");
            const ready = applyCell(m, load("recovery"), { type: "resume", at: clock.currentTimeMillisUnsafe() })[0];
            const trial = applyCell(m, ready, {
              type: "propose",
              at: clock.currentTimeMillisUnsafe(),
              ...stopped,
              ahead: { writes: 0, bytes: 0 },
            })[0];

            if (trial._tag === "reserve_fault") {
              throw new QuotasError({ reason: trial.fault });
            }

            save("recovery", ready);
            sql.exec("UPDATE quota_fault SET value='' WHERE name=?", options.name);
          }),
        catch: error,
      }),
    ),
  };
};
