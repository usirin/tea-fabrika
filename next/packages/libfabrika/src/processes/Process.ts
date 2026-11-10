import { Equal, Option, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import type { From } from "./Mailbox.ts";

/**
 * Every text a client gives that lands in a brain line: at most 256 characters, counted as
 * `string.length`, so no brain line can reach the ledger's per-line limit.
 */
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(256));
const PROCESSES = "processes";
const CLIENTS = "client:";
/** Names that lead streams this layer or the door already owns. */
const RESERVED = `(?!(?:${PROCESSES}|door)$)`;

/**
 * A process name is a stream name: no `/`, so `<name>` and `<name>/inbox` never meet another's,
 * no `client:` lead, so it never meets a client's inbox, and never `processes` or `door`.
 */
const ProcessName = Text.check(Schema.isPattern(new RegExp(`^${RESERVED}(?!${CLIENTS})[a-z0-9][a-z0-9._:-]*$`)));

/** A client id has no `:`, the mark of a process name such as `counter:1`. */
const ClientId = Text.check(Schema.isPattern(new RegExp(`^(?!${PROCESSES}$)[a-z0-9][a-z0-9._-]*$`)));

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Code = Schema.Struct({ program: Text, hash: Text });
export const Owner = Schema.TaggedUnion({ brain: {}, process: { process: ProcessId } });

export const Recipient = Schema.TaggedUnion({
  process: { process: ProcessId },
  client: { client: Text, session: ProcessId },
});

export type Caller = { readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type };

export const Start = Schema.TaggedUnion({
  first: { id: Text, name: Text, code: Code },
  again: { id: Text, name: Text, code: Code, after: ProcessId, reason: Text },
});
export type Start = typeof Start.Type;

export const State = Schema.TaggedUnion({
  live: { process: ProcessId, code: Code },
  ended: { process: ProcessId, code: Code, reason: Text },
  down: { process: ProcessId, code: Code, reason: Text, crashes: Count, until: Schema.Int },
});

export const ProcessEvent = Schema.TaggedUnion({
  registered: { name: Text, program: Text, owner: Owner },
  started: { process: ProcessId, name: Text, program: Text, hash: Text },
  exited: { process: ProcessId, reason: Text },
  restarted: { process: ProcessId, after: ProcessId, name: Text, reason: Text, build: Text },
  down: { process: ProcessId, reason: Text, crashes: Count, until: Schema.Int },
  monitored: { ref: Text, process: ProcessId, to: Recipient },
  demonitored: { ref: Text, to: Recipient, reason: Schema.Literals(["canceled", "watcher_exited"]) },
});

/** Where a registered name's own lifecycle events live: `processes/<name>`. */
const eventStream = (name: string): string => `${PROCESSES}/${name}`;

/**
 * The one rule for who may write what: only the brain's ProcessManager writes `processes` or any
 * stream under `processes/`, any ProcessEvent case, or any id in the signal id space. The door and
 * the mailbox refuse every such write.
 */
export const brainOnly = (write: { readonly stream: string; readonly id: string; readonly tag: string }): boolean =>
  write.stream === PROCESSES ||
  write.stream.startsWith(`${PROCESSES}/`) ||
  write.stream.endsWith("/dead") ||
  write.tag === "dead" ||
  Object.hasOwn(ProcessEvent.cases, write.tag) ||
  inSignalSpace(write.id) ||
  inRunnerSpace(write.id);

/** Answer and alarm letters belong to the brain. Cmd write ids remain available to the signer. */
export const inRunnerSpace = (id: string): boolean =>
  /^process_[^/]+\/(?:due\/|[0-9]+\/[0-9]+\/answer(?:$|\/))/.test(id);

export const Down = Schema.TaggedStruct("DOWN", {
  ref: Text,
  process: ProcessId,
  reason: Text,
  to: Recipient,
});

const deadFields = {
  tries: Count,
  limit: Count,
  m: Text,
  build: Text,
  errors: Schema.Array(Text).check(Schema.isMaxLength(32)),
};

const oneErrorPerTry = Schema.makeFilter(
  (value: Schema.Struct.Type<typeof deadFields>) => value.errors.length === value.tries || "one error class per try",
);

export const DeadInput = Schema.Struct(deadFields).check(oneErrorPerTry);

export const Dead = Schema.TaggedStruct("dead", {
  ...deadFields,
  process: ProcessId,
  program: Code.fields.program,
  name: ProcessName,
}).check(oneErrorPerTry);

export const Activity = Schema.TaggedUnion({
  idle: { process: ProcessId },
  stepping: { process: ProcessId, letter: Text, build: Text },
});

const Recovered = Schema.TaggedUnion({
  idle: { process: Schema.optionalKey(ProcessId) },
  interrupted: {
    process: ProcessId,
    letter: Text,
    build: Text,
    reason: Schema.Literal("interrupted"),
  },
});

export const recoverActivity = (raw: unknown): Result.Result<typeof Recovered.Type, LedgerError> => {
  if (raw === undefined) {
    return Result.succeed(Recovered.cases.idle.make({}));
  }

  const saved = Schema.decodeUnknownResult(Activity)(raw);

  if (Result.isFailure(saved)) {
    return Result.fail(new LedgerError({ reason: "bad_row" }));
  }

  const value = saved.success;
  return Result.succeed(
    value._tag === "idle"
      ? value
      : Recovered.cases.interrupted.make({
          process: value.process,
          letter: value.letter,
          build: value.build,
          reason: "interrupted",
        }),
  );
};

export const canRestart = (times: ReadonlyArray<number>, now: number, period: number, intensity: number): boolean =>
  times.filter((at) => at >= now - period).length + 1 <= intensity;

export class ProcessError extends Schema.TaggedError<ProcessError>()("ProcessError", {
  reason: Schema.Literals([
    "not_parent",
    "name_taken",
    "alive",
    "stale",
    "id_reused",
    "id_collision",
    "ended",
    "bad_ref",
    "bad_name",
    "bad_text",
  ]),
}) {}

type Reservation = typeof ProcessEvent.cases.registered.Type;

type Life = {
  readonly name: string;
  readonly state: typeof State.Type;
  readonly request: Start;
  readonly from: From;
  readonly rev: number;
};

/** `round` counts this (recipient, ref)'s monitored events, so a monitor after a cancel is new. */
type Watch = typeof ProcessEvent.cases.monitored.Type & {
  readonly canceled: boolean;
  readonly round: number;
};

export type StartAnswer = { readonly process: string; readonly rev: number };

export type ProcessInfo = {
  readonly process: string;
  readonly name: string;
  readonly program: string;
  readonly build: string;
  readonly restarts: number;
};

const decodeEvent = Schema.decodeUnknownSync(ProcessEvent);
const decodeDown = Schema.decodeUnknownOption(Down);
const denied = (reason: ProcessError["reason"]) => Result.fail(new ProcessError({ reason }));
const isText = Schema.is(Text);

const canonical = (to: typeof Recipient.Type): typeof Recipient.Type =>
  to._tag === "process"
    ? Recipient.cases.process.make({ process: to.process })
    : Recipient.cases.client.make({ client: to.client, session: to.session });

const watchKey = (to: typeof Recipient.Type, ref: string): string => JSON.stringify([canonical(to), ref]);

/** A client's own inbox, `client:<id>/inbox`, where its DOWNs land; never a process's inbox. */
export const clientInbox = (client: string): string => `${CLIENTS}${client}/inbox`;

/** The one id a DOWN for (recipient, ref) in that watch's `round` is written under. */
export const signalId = (to: typeof Recipient.Type, ref: string, round: number): string =>
  JSON.stringify(["DOWN", canonical(to), ref, round]);

const SIGNAL_LEAD = JSON.stringify(["DOWN"]).slice(0, -1);

const decodeIdParts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)));

/** True for any id in the signal id space, a JSON array led by `"DOWN"`: only the brain writes one. */
export const inSignalSpace = (id: string): boolean =>
  id.startsWith(SIGNAL_LEAD) || Option.exists(decodeIdParts(id), (parts) => parts[0] === "DOWN");

/**
 * A disposable fold of the ledger. No process authority survives outside its events, and an event
 * counts only when `by` is the brain's own writer.
 */
export class ProcessTable {
  static readonly stream = PROCESSES;
  static readonly events = eventStream;
  readonly #by: string;
  readonly #names = new Map<string, Reservation>();
  readonly #lives = new Map<string, Life>();
  readonly #watches = new Map<string, Watch>();
  readonly #current = new Map<string, string>();
  readonly #restarts = new Map<string, Array<number>>();

  constructor(entries: Iterable<Entry>, by: string) {
    this.#by = by;

    for (const entry of entries) {
      if (!Object.hasOwn(ProcessEvent.cases, entry._tag) || entry.by !== by) {
        continue;
      }

      const event = decodeEvent(valueFor(entry));

      switch (event._tag) {
        case "registered":
          this.#names.set(event.name, event);
          break;
        case "started": {
          const code = { program: event.program, hash: event.hash };
          this.#lives.set(event.process, {
            name: event.name,
            state: State.cases.live.make({ process: event.process, code }),
            request: Start.cases.first.make({ id: entry.id, name: event.name, code }),
            from: entry,
            rev: entry.rev,
          });
          this.#current.set(event.name, event.process);
          break;
        }
        case "restarted": {
          const life = this.require(event.process);
          this.#lives.set(event.process, {
            ...life,
            request: Start.cases.again.make({
              id: life.request.id,
              name: event.name,
              code: life.state.code,
              after: event.after,
              reason: event.reason,
            }),
          });
          this.#restarts.set(event.name, [...(this.#restarts.get(event.name) ?? []), entry.arrivedAt]);
          break;
        }
        case "exited": {
          const life = this.require(event.process);
          this.#lives.set(event.process, {
            ...life,
            state: State.cases.ended.make({
              process: event.process,
              code: life.state.code,
              reason: event.reason,
            }),
          });
          break;
        }
        case "down": {
          const life = this.require(event.process);
          this.#lives.set(event.process, {
            ...life,
            state: State.cases.down.make({ ...event, code: life.state.code }),
          });
          break;
        }
        case "monitored": {
          const key = watchKey(event.to, event.ref);
          const round = (this.#watches.get(key)?.round ?? 0) + 1;
          this.#watches.set(key, { ...event, canceled: false, round });
          break;
        }
        case "demonitored": {
          const key = watchKey(event.to, event.ref);
          const watch = this.#watches.get(key);

          if (watch !== undefined) {
            this.#watches.set(key, { ...watch, canceled: true });
          }

          break;
        }
      }
    }
  }

  private require(process: string): Life {
    const life = this.#lives.get(process);

    if (life === undefined) {
      throw new LedgerError({ reason: "bad_row" });
    }

    return life;
  }

  static read(read: (stream: string, after: number) => Iterable<Entry>, by: string): ProcessTable {
    const control = [...read(ProcessTable.stream, 0)];
    const names = control
      .filter((entry) => entry._tag === "registered" && entry.by === by)
      .map((entry) => Schema.decodeUnknownSync(ProcessEvent.cases.registered)(valueFor(entry)).name);
    return new ProcessTable(
      [...control, ...names.flatMap((name) => [...read(eventStream(name), 0)])].sort((a, b) => a.rev - b.rev),
      by,
    );
  }

  start(request: Start, caller: Caller, from: From): Result.Result<Option.Option<StartAnswer>, ProcessError> {
    if (!Schema.is(ProcessName)(request.name)) {
      return denied("bad_name");
    }

    if (!Schema.is(Start)(request)) {
      return denied("bad_text");
    }

    const saved = [...this.#lives.values()].find((life) => life.request.id === request.id);

    if (saved !== undefined) {
      if (!Equal.equals(saved.request, request) || saved.from.for !== from.for || saved.from.parent !== from.parent) {
        return denied("id_reused");
      }

      const parent = this.parent(saved.state.process, caller.owner);
      return Result.isFailure(parent)
        ? Result.fail(parent.failure)
        : Result.succeed(Option.some({ process: saved.state.process, rev: saved.rev }));
    }

    const name = this.#names.get(request.name);

    if (request._tag === "first") {
      return name === undefined ? Result.succeed(Option.none()) : denied("name_taken");
    }

    if (name === undefined || !Equal.equals(name.owner, caller.owner)) {
      return denied("not_parent");
    }

    if (name.program !== request.code.program) {
      return denied("name_taken");
    }

    if (this.#current.get(request.name) !== request.after) {
      return denied("stale");
    }

    if (this.isLive(request.after)) {
      return denied("alive");
    }

    return Result.succeed(Option.none());
  }

  collision(process: string): boolean {
    return this.#lives.has(process);
  }

  isLive(process: string): boolean {
    return this.#lives.get(process)?.state._tag === "live";
  }

  status(
    name: string,
    owner: typeof Owner.Type,
  ): Result.Result<
    {
      readonly name: string;
      readonly state: typeof State.Type;
      readonly restarts: ReadonlyArray<number>;
    },
    ProcessError
  > {
    const process = this.#current.get(name);

    if (process === undefined) {
      return denied("ended");
    }

    const life = this.parent(process, owner);
    return Result.isFailure(life)
      ? Result.fail(life.failure)
      : Result.succeed({ name, state: life.success.state, restarts: this.#restarts.get(name) ?? [] });
  }

  life(process: string): Option.Option<Life> {
    return Option.fromUndefinedOr(this.#lives.get(process));
  }

  parent(process: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    const life = this.#lives.get(process);

    if (life === undefined) {
      return denied("ended");
    }

    return Equal.equals(this.#names.get(life.name)?.owner, owner) ? Result.succeed(life) : denied("not_parent");
  }

  exit(process: string, reason: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    if (!isText(reason)) {
      return denied("bad_text");
    }

    const parent = this.parent(process, owner);

    if (Result.isFailure(parent)) {
      return parent;
    }

    const state = parent.success.state;
    return state._tag !== "live" && state.reason !== reason ? denied("ended") : parent;
  }

  /** The life a supervisor gives up on; refused while that process still lives. */
  down(process: string, reason: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    if (!isText(reason)) {
      return denied("bad_text");
    }

    const parent = this.parent(process, owner);

    if (Result.isFailure(parent)) {
      return parent;
    }

    return parent.success.state._tag === "live" ? denied("alive") : parent;
  }

  /** The round to write for a new or renewed watch; none when this watch is already live. */
  monitor(ref: string, process: string, to: typeof Recipient.Type): Result.Result<Option.Option<number>, ProcessError> {
    if (!isText(ref)) {
      return denied("bad_text");
    }

    if (to._tag === "client" && !Schema.is(ClientId)(to.client)) {
      return denied("bad_name");
    }

    const watch = this.#watches.get(watchKey(to, ref));

    if (watch !== undefined && watch.process !== process) {
      return denied("bad_ref");
    }

    if (watch !== undefined && !watch.canceled) {
      return Result.succeed(Option.none());
    }

    if (to._tag === "process" && !this.isLive(to.process)) {
      return denied("ended");
    }

    return Result.succeed(Option.some((watch?.round ?? 0) + 1));
  }

  /** The caller's own live watch under `ref`, if any. Another recipient's ref is never touched. */
  demonitor(ref: string, to: typeof Recipient.Type): Option.Option<Watch> {
    return Option.filter(Option.fromUndefinedOr(this.#watches.get(watchKey(to, ref))), (watch) => !watch.canceled);
  }

  inbound(process: string): ReadonlyArray<Watch> {
    return [...this.#watches.values()].filter((watch) => !watch.canceled && watch.process === process);
  }

  outbound(process: string): ReadonlyArray<Watch> {
    return [...this.#watches.values()].filter(
      (watch) => !watch.canceled && watch.to._tag === "process" && watch.to.process === process,
    );
  }

  /**
   * How fresh delivery treats one letter. A DOWN is a signal only under its signal id, from the
   * brain, with a watch of that recipient, ref and target, live or canceled. A signal reaches only
   * its own recipient, and only while its watch is live. Anything else is plain mail.
   */
  deliver(entry: Entry, m: unknown, process: string): "mail" | "signal" | "drop" {
    if (typeof m !== "object" || m === null || !("_tag" in m) || m._tag !== "DOWN") {
      return "mail";
    }

    const down = decodeDown(m);

    if (Option.isNone(down)) {
      return "mail";
    }

    const { to, ref } = down.value;
    const watch = this.#watches.get(watchKey(to, ref));

    if (entry.by !== this.#by || watch === undefined || watch.process !== down.value.process) {
      return "mail";
    }

    const round = Array.from({ length: watch.round }, (_, n) => n + 1).find((n) => entry.id === signalId(to, ref, n));

    if (round === undefined) {
      return "mail";
    }

    // An earlier round's signal belongs to a watch already canceled.
    const current = round === watch.round && !watch.canceled;
    return current && to._tag === "process" && to.process === process ? "signal" : "drop";
  }

  get info(): ReadonlyArray<ProcessInfo> {
    return [...this.#lives.values()]
      .filter((life) => life.state._tag === "live")
      .map((life) => ({
        process: life.state.process,
        name: life.name,
        program: life.state.code.program,
        build: life.state.code.hash,
        restarts: this.#restarts.get(life.name)?.length ?? 0,
      }));
  }
}
