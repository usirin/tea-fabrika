// A program's window and what a client records, next/ (Tier 1, P14): the typed contract a program's
// window meets, the Msg a key command sends, and the checked rows a client keeps and sends.
import { Schema } from "effect";
import type { Program } from "./Program.ts";

// --- A program's window -------------------------------------------------------------------------

type AnyProgram = Program<any, any, any, any, any>;

/** The data a program's window gets: what its view selector returns. */
export type WindowData<P extends AnyProgram> = Readonly<ReturnType<P["view"]["select"]>>;
/** The Msgs a program's window may send: the program's own, and nothing else. */
export type WindowMsg<P extends AnyProgram> = P["machine"]["msg"]["Type"];

/** What a program's window is given: its checked data, and `press` for one of its own Msgs. */
export type WindowProps<P extends AnyProgram> = {
  readonly data: WindowData<P>;
  readonly press: (m: WindowMsg<P>) => void;
  /** The key a command is bound to now, from the one table matching reads, or null. */
  readonly hint?: (command: WindowCommand<P>) => string | null;
};

/** A command name for one of the program's inputs, such as `counter.inc`. */
export type WindowCommand<P extends AnyProgram> = `${string}.${keyof P["inputs"] & string}`;

/** How a window is registered: the decoder its data must pass at runtime, the view, and the
 *  default key rows for its inputs. */
export type WindowRegistration<P extends AnyProgram, View = unknown> = {
  readonly data: Schema.Decoder<WindowData<P>>;
  readonly View: (props: WindowProps<P>) => View;
  readonly keys: Readonly<Partial<Record<WindowCommand<P>, ReadonlyArray<string>>>>;
};

/** Checks a window against its program at compile time, and hands the registration back. The
 *  registration is typed as the contract itself, not inferred, so a key row the program lacks is refused. */
export const defineWindow = <P extends AnyProgram, View>(
  _program: P,
  registration: WindowRegistration<P, View>,
): WindowRegistration<P, View> => registration;

/** The Msg a key command sends: the input named after the program's dot, with no fields. */
export const commandMsg = (command: string): { readonly type: string } | null => {
  const dot = command.indexOf(".");
  return dot <= 0 || dot === command.length - 1 ? null : { type: command.slice(dot + 1) };
};

// --- What a client records ----------------------------------------------------------------------

/** The class of a failure, from a fixed list of words. Never a message, a stack or a value. */
export const ErrorClass = Schema.Literals([
  "AbortError",
  "DataError",
  "InvalidAccessError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "TypeError",
  "UnknownError",
  "other",
]);
export type ErrorClass = typeof ErrorClass.Type;
const isErrorClass = Schema.is(ErrorClass);

const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * One checked observation. Ids, counts, durations and fixed words only: no program body, no key
 * material, no message text. Client clocks and durations are measurements, never authority.
 */
export const ClientRecord = Schema.TaggedUnion({
  key: { result: Schema.Literals(["created", "reused", "replaced"]) },
  connect: {
    dial: Count,
    result: Schema.Literals(["online", "waiting", "closed", "stalled", "removed"]),
    ms: Ms,
  },
  press: {
    command: Schema.String,
    via: Schema.Literals(["button", "key"]),
    pid: Schema.String,
    viewRev: Count,
    seen: Count,
    letter: Schema.String,
    depth: Count,
  },
  reply: {
    letter: Schema.String,
    result: Schema.Literals(["accepted", "refused", "unreachable", "unknown"]),
    attempts: Count,
    ms: Ms,
  },
  /** A view's start and end (plan A8): a `whole` view installed, an `asked` for one, and one `patch`
   *  row for a run of installed patches when it ends, never one per patch. */
  view: {
    pid: Schema.String,
    result: Schema.Literals(["whole", "patch", "asked"]),
    rev: Count,
    /** On a `patch` row only: how many patches the run installed. */
    patches: Schema.optionalKey(Count),
  },
  persist: { result: Schema.Literals(["granted", "refused", "failed"]) },
  failure: {
    op: Schema.Literals(["key", "connect", "request", "view", "persist", "record"]),
    error: ErrorClass,
  },
});
export type ClientRecord = typeof ClientRecord.Type;

/** A record as a client keeps and sends it: a stable row id, the tab, the build and its own time. */
export const ClientRow = Schema.Struct({
  id: Schema.String,
  tab: Schema.String,
  build: Schema.String,
  sentAt: Schema.String,
  record: ClientRecord,
});
export type ClientRow = typeof ClientRow.Type;

const named = (u: unknown): string | null => {
  if (typeof u !== "object" || u === null) {
    return null;
  }

  const name = "name" in u ? u.name : "_tag" in u ? u._tag : null;
  return typeof name === "string" ? name : null;
};

/** The class of `error` as a fixed word: a known platform name, else `other`. */
export const errorClass = (error: unknown): ErrorClass => {
  const name = named(error);
  return name !== null && isErrorClass(name) ? name : "other";
};

/** The record of a failure: its operation and its class, and nothing it carried. */
export const failureRecord = (
  error: unknown,
  op: (typeof ClientRecord.cases.failure.Type)["op"] = "request",
): ClientRecord => ClientRecord.cases.failure.make({ op, error: errorClass(error) });
