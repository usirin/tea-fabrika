import { applyCell } from "@demlik/tea";
import { Equal, Option, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { ExitReason, sameReason } from "./ExitReason.ts";
import {
  Code,
  Count,
  type Life,
  type Model,
  Owner,
  ProcessEvent,
  processTableFor,
  Recipient,
  signalId,
  Start,
  State,
  Text,
  watchKey,
} from "./internal/processTable.ts";
import type { From } from "./Mailbox.ts";

export { Owner, ProcessEvent, Recipient, signalId, Start, State };

const PROCESSES = "processes";
const CLIENTS = "client:";
/** Names that lead streams this layer or the gateway already owns. */
const RESERVED = `(?!(?:${PROCESSES}|gateway)$)`;

/**
 * A process name is a stream name: no `/`, so `<name>` and `<name>/inbox` never meet another's,
 * no `client:` lead, so it never meets a client's inbox, and never `processes` or `gateway`.
 */
export const ProcessName = Text.check(Schema.isPattern(new RegExp(`^${RESERVED}(?!${CLIENTS})[a-z0-9][a-z0-9._:-]*$`)));

/** A client id has no `:`, the mark of a process name such as `counter:1`. */
const ClientId = Text.check(Schema.isPattern(new RegExp(`^(?!${PROCESSES}$)[a-z0-9][a-z0-9._-]*$`)));

export type Caller = { readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type };

/** Where a registered name's own lifecycle events live: `processes/<name>`. */
const eventStream = (name: string): string => `${PROCESSES}/${name}`;

/**
 * The one rule for who may write what: only the brain's ProcessManager writes `processes` or any
 * stream under `processes/`, any ProcessEvent case, or any signal, runner or notice id. The gateway and
 * the mailbox refuse every such write.
 */
export const brainOnly = (write: { readonly stream: string; readonly id: string; readonly tag: string }): boolean =>
  write.stream === PROCESSES ||
  write.stream.startsWith(`${PROCESSES}/`) ||
  write.stream.endsWith("/dead") ||
  write.tag === "dead" ||
  Object.hasOwn(ProcessEvent.cases, write.tag) ||
  inSignalSpace(write.id) ||
  inNoticeSpace(write.id) ||
  inRunnerSpace(write.id);

/** Answer and alarm letters belong to the brain. Cmd write ids remain available to the signer. */
export const inRunnerSpace = (id: string): boolean =>
  /^process_[^/]+\/(?:due\/|[0-9]+\/[0-9]+\/answer(?:$|\/))/.test(id);

/** What a monitor answers for a target that was never live; a monitor result, never an exit reason. */
export const NoProc = Schema.TaggedStruct("noproc", {});

export const Down = Schema.TaggedStruct("DOWN", {
  ref: Text,
  process: ProcessId,
  reason: Schema.Union([ExitReason, NoProc]),
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
    return Result.fail(new LedgerError({ reason: "bad_row", cause: saved.failure }));
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
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

/** A live watch as queries return it; `canceled` is always false and never stored. */
type Watch = typeof ProcessEvent.cases.monitored.Type & {
  readonly canceled: boolean;
  readonly round: number;
};

type Held = Model["watches"] extends ReadonlyMap<string, infer W> ? W : never;

const shown = (watch: Held): Watch => ({
  ...ProcessEvent.cases.monitored.make({ ref: watch.ref, process: watch.process, to: watch.to }),
  canceled: false,
  round: watch.round,
});

export type StartAnswer = { readonly process: string; readonly rev: number };

export type ProcessInfo = {
  readonly process: string;
  readonly name: string;
  readonly program: string;
  readonly build: string;
  readonly restarts: number;
};

const decodeDown = Schema.decodeUnknownOption(Down);
const denied = (reason: ProcessError["reason"]) => Result.fail(new ProcessError({ reason }));
const isText = Schema.is(Text);

/** A client's own inbox, `client:<id>/inbox`, where its DOWNs land; never a process's inbox. */
export const clientInbox = (client: string): string => `${CLIENTS}${client}/inbox`;

const decodeIdParts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)));

const led = (word: string) => {
  const lead = JSON.stringify([word]).slice(0, -1);
  return (id: string): boolean => id.startsWith(lead) || Option.exists(decodeIdParts(id), (parts) => parts[0] === word);
};

/** True for any id in the signal id space, a JSON array led by `"DOWN"`: only the brain writes one. */
export const inSignalSpace = led("DOWN");

/** Ids for what the brain tells a program. Only the brain writes one. */
export const inNoticeSpace = led("notice");
export const noticeId = (key: string): string => JSON.stringify(["notice", key]);

/**
 * A disposable fold of the ledger. No process authority survives outside its events, and an event
 * counts only when `by` is the brain's own writer.
 */
export class ProcessTable {
  static readonly stream = PROCESSES;
  static readonly events = eventStream;
  readonly #by: string;
  readonly #model: Model;

  constructor(entries: Iterable<Entry>, by: string) {
    this.#by = by;
    const machine = processTableFor(by);
    let model = machine.init(null, undefined)[0];

    for (const entry of entries) {
      model = applyCell(machine, model, { type: "recorded", entry })[0];
    }

    this.#model = model;
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

    const saved = Option.getOrUndefined(this.saved(request.id));

    if (saved !== undefined) {
      if (!Equal.equals(saved.request, request) || saved.from.for !== from.for || saved.from.parent !== from.parent) {
        return denied("id_reused");
      }

      const parent = this.parent(saved.state.process, caller.owner);
      return Result.isFailure(parent)
        ? Result.fail(parent.failure)
        : Result.succeed(Option.some({ process: saved.state.process, rev: saved.rev }));
    }

    const name = this.#model.names.get(request.name);

    if (request._tag === "first") {
      // A child's requester must still be live in the turn that would write its start (P42).
      if (request.requester?._tag === "process" && !this.isLive(request.requester.process)) {
        return denied("stale");
      }

      return name === undefined ? Result.succeed(Option.none()) : denied("name_taken");
    }

    if (name === undefined || !Equal.equals(name.owner, caller.owner)) {
      return denied("not_parent");
    }

    if (name.program !== request.code.program) {
      return denied("name_taken");
    }

    if (this.#model.current.get(request.name) !== request.after) {
      return denied("stale");
    }

    if (this.isLive(request.after)) {
      return denied("alive");
    }

    return Result.succeed(Option.none());
  }

  /** The life a start id saved, under whichever name it started. */
  saved(id: string): Option.Option<Life> {
    return Option.fromUndefinedOr([...this.#model.lives.values()].find((life) => life.request.id === id));
  }

  /** OTP's `whereis`: the name's program and its current life. Public, so it checks no owner. */
  whereis(name: string): Option.Option<{ readonly program: string; readonly state: typeof State.Type }> {
    const registered = this.#model.names.get(name);
    const life = this.#model.lives.get(this.#model.current.get(name) ?? "");
    return registered === undefined || life === undefined
      ? Option.none()
      : Option.some({ program: registered.program, state: life.state });
  }

  /** The registered name that asked for this name's first life, when a child start wrote one (P42). */
  starter(name: string): Option.Option<string> {
    const first = [...this.#model.lives.values()].find((life) => life.name === name);
    const requester = first?.request._tag === "first" ? first.request.requester : undefined;
    return requester?._tag === "process"
      ? Option.map(this.life(requester.process), (life) => life.name)
      : Option.none();
  }

  collision(process: string): boolean {
    return this.#model.lives.has(process);
  }

  isLive(process: string): boolean {
    return this.#model.lives.get(process)?.state._tag === "live";
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
    const process = this.#model.current.get(name);

    if (process === undefined) {
      return denied("ended");
    }

    const life = this.parent(process, owner);
    const restarts = this.#model.restarts.get(name) ?? [];
    return Result.isFailure(life)
      ? Result.fail(life.failure)
      : Result.succeed({ name, state: life.success.state, restarts });
  }

  life(process: string): Option.Option<Life> {
    return Option.fromUndefinedOr(this.#model.lives.get(process));
  }

  parent(process: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    const life = this.#model.lives.get(process);

    if (life === undefined) {
      return denied("ended");
    }

    const reserved = this.#model.names.get(life.name);
    return Equal.equals(reserved?.owner, owner) ? Result.succeed(life) : denied("not_parent");
  }

  /** The life a decoded exit ends; an ended process answers again only to the same reason. */
  exit(process: string, reason: ExitReason, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
    const parent = this.parent(process, owner);

    if (Result.isFailure(parent)) {
      return parent;
    }

    const { state, exited } = parent.success;
    return state._tag !== "live" && (exited === undefined || !sameReason(exited, reason)) ? denied("ended") : parent;
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

    const watch = this.#model.watches.get(watchKey(to, ref));

    if (watch !== undefined && watch.process !== process) {
      return denied("bad_ref");
    }

    if (watch !== undefined && watch._tag === "live") {
      return Result.succeed(Option.none());
    }

    if (to._tag === "process" && !this.isLive(to.process)) {
      return denied("ended");
    }

    return Result.succeed(Option.some((watch?.round ?? 0) + 1));
  }

  /** The caller's own live watch under `ref`, if any. Another recipient's ref is never touched. */
  demonitor(ref: string, to: typeof Recipient.Type): Option.Option<Watch> {
    const watch = this.#model.watches.get(watchKey(to, ref));
    return watch?._tag === "live" ? Option.some(shown(watch)) : Option.none();
  }

  inbound(process: string): ReadonlyArray<Watch> {
    return [...this.#model.watches.values()]
      .filter((watch) => watch._tag === "live" && watch.process === process)
      .map(shown);
  }

  outbound(process: string): ReadonlyArray<Watch> {
    return [...this.#model.watches.values()]
      .filter(({ _tag, to }) => _tag === "live" && to._tag === "process" && to.process === process)
      .map(shown);
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
    const watch = this.#model.watches.get(watchKey(to, ref));

    if (entry.by !== this.#by || watch === undefined || watch.process !== down.value.process) {
      return "mail";
    }

    const round = Array.from({ length: watch.round }, (_, n) => n + 1).find((n) => entry.id === signalId(to, ref, n));

    if (round === undefined) {
      return "mail";
    }

    // An earlier round's signal belongs to a watch already canceled.
    const current = round === watch.round && watch._tag === "live";
    return current && to._tag === "process" && to.process === process ? "signal" : "drop";
  }

  get info(): ReadonlyArray<ProcessInfo> {
    return [...this.#model.lives.values()]
      .filter((life) => life.state._tag === "live")
      .map((life) => ({
        process: life.state.process,
        name: life.name,
        program: life.state.code.program,
        build: life.state.code.hash,
        restarts: this.#model.restarts.get(life.name)?.length ?? 0,
      }));
  }
}
