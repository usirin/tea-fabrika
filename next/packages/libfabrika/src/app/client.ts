// A program client's own rules, next/ (Tier 1, P14, laws p1 and p3). Pure data and pure steps, the
// same in a browser tab, in Electron and in a headless client: pending letters, checked views, the
// typed contract a program's window meets, and the checked rows a client records. It imports no
// transport and no window code; the window parent (Tuval) steps it by hand.
//
// A press reserves a numbered slot first and captures what the person saw: the view revision shown
// for that process and the ledger revision last read. Its time and letter id come later, from a
// Cmd, and fill that same slot. A letter keeps its id and body on every resend, and only its own
// terminal answer (accepted, or a program's refusal) removes it.
import {Option, Result, Schema} from "effect";
import {Entry} from "../data/log.ts";
import {applyPatch} from "./patch.ts";
import type {Program} from "./program.ts";
import {Sent} from "./runner.ts";

// --- Pending letters ----------------------------------------------------------------------------

/** One press on its way. `n` is the local queue position, never another letter id. `pid` is the
 *  tile's process: its id, or the registered name the client resolves on each dial. */
export const Pending = Schema.TaggedUnion({
	dating: {
		n: Schema.Int,
		pid: Schema.String,
		m: Schema.Json,
		seen: Schema.Int,
		viewRev: Schema.Int,
	},
	ready: {
		n: Schema.Int,
		pid: Schema.String,
		m: Schema.Json,
		seen: Schema.Int,
		viewRev: Schema.Int,
		letter: Schema.String,
		sentAt: Schema.String,
		traceId: Schema.optionalKey(Schema.String),
	},
});
export type Pending = typeof Pending.Type;

/** A checked view as installed: the revision it was made at, and the value. */
export const Shown = Schema.Struct({rev: Schema.Int, view: Schema.Json});
export type Shown = typeof Shown.Type;

/** Everything a program client keeps between messages: what it promised, and what it shows. */
export const Client = Schema.Struct({
	/** Presses made so far: the next slot's number. */
	written: Schema.Int,
	/** The highest ledger revision this client has actually read. Never a view revision. */
	seen: Schema.Int,
	pending: Schema.Array(Pending),
	views: Schema.Record(Schema.String, Shown),
});
export type Client = typeof Client.Type;

export const emptyClient: Client = Client.make({written: 0, seen: 0, pending: [], views: {}});

/** Reserves the next slot for a press on `pid`, with what this client showed and had read. */
export const press = (c: Client, input: {readonly pid: string; readonly m: unknown}): Client => {
	const m = Schema.decodeUnknownResult(Schema.Json)(input.m);
	const slot = Pending.cases.dating.make({
		n: c.written,
		pid: input.pid,
		m: Result.isSuccess(m) ? m.success : null,
		seen: c.seen,
		viewRev: c.views[input.pid]?.rev ?? 0,
	});
	return {...c, written: c.written + 1, pending: [...c.pending, slot]};
};

/** Fills slot `n` with its letter id and time. A missing slot or one already dated is unchanged: a
 *  second answer never rewrites a letter. */
export const dated = (
	c: Client,
	n: number,
	stamp: {readonly letter: string; readonly sentAt: string; readonly traceId?: string},
): Client => {
	const at = c.pending.findIndex((p) => p.n === n);
	const slot = c.pending[at];
	if (slot === undefined || slot._tag !== "dating") return c;
	const ready = Pending.cases.ready.make({
		n: slot.n,
		pid: slot.pid,
		m: slot.m,
		seen: slot.seen,
		viewRev: slot.viewRev,
		letter: stamp.letter,
		sentAt: stamp.sentAt,
		...(stamp.traceId === undefined ? {} : {traceId: stamp.traceId}),
	});
	return {...c, pending: c.pending.map((p, i) => (i === at ? ready : p))};
};

/** What came back for one letter: a decoded `Sent` (placed, or the program's refusal), a transport
 *  failure to retry, or an answer the client cannot read. */
export const Reply = Schema.TaggedUnion({
	accepted: Sent.cases.accepted.fields,
	refused: Sent.cases.refused.fields,
	unreachable: {},
	unknown: {},
});
export type Reply = typeof Reply.Type;

/** Settles `letter` only on its own terminal answer. Every other answer keeps it for a resend. */
export const reply = (c: Client, letter: string, answer: Pick<Reply, "_tag">): Client => {
	if (answer._tag !== "accepted" && answer._tag !== "refused") return c;
	const kept = c.pending.filter((p) => p._tag !== "ready" || p.letter !== letter);
	return kept.length === c.pending.length ? c : {...c, pending: kept};
};

type Ready = typeof Pending.cases.ready.Type;
const isReady = (p: Pending): p is Ready => p._tag === "ready";

/** The letters ready to go, in slot order, each with the id it first got. */
export const outbox = (c: Client): ReadonlyArray<Ready> => c.pending.filter(isReady);

/** The letters that may go now: ready ones ahead of the first slot still waiting for its time. */
export const sendable = (c: Client): ReadonlyArray<Ready> => {
	const out: Array<Ready> = [];
	for (const p of c.pending) {
		if (!isReady(p)) break;
		out.push(p);
	}
	return out;
};

/** Raises what this client has read to ledger revision `rev`. */
export const read = (c: Client, rev: number): Client => (rev > c.seen ? {...c, seen: rev} : c);

// --- Checked views ------------------------------------------------------------------------------

const Whole = Schema.Struct({type: Schema.Literal("whole"), rev: Schema.Int, view: Schema.Unknown});
const Step = Schema.Struct({
	type: Schema.Literal("patch"),
	base: Schema.Int,
	rev: Schema.Int,
	patch: Schema.Unknown,
});
const decodeNote = Schema.decodeUnknownResult(Schema.Union([Whole, Step]));

/** Runs the program's own decoder on a candidate, so a throw is a refusal and never escapes. */
const check = (decode: (u: unknown) => unknown, candidate: unknown) =>
	Result.flatMap(
		Result.try({try: () => decode(candidate), catch: () => "refused" as const}),
		(checked) => Schema.decodeUnknownResult(Schema.Json)(checked),
	);

const install = (c: Client, pid: string, shown: Shown): Client => ({
	...c,
	views: {...c.views, [pid]: shown},
});

/**
 * One view notification for `pid`. A whole view that decodes replaces the shown one, a lower
 * revision included (the data was reset). A patch must start at the shown revision and end one
 * past it; an older one does nothing, and a gap, a bad patch or a candidate the decoder refuses
 * keeps the last good view and asks for a whole one. Junk does nothing. It never throws.
 */
export const notice = (
	c: Client,
	pid: string,
	note: unknown,
	decode: (u: unknown) => unknown,
): {readonly client: Client; readonly ask: boolean} => {
	const same = {client: c, ask: false};
	const ask = {client: c, ask: true};
	const decoded = decodeNote(note);
	if (Result.isFailure(decoded)) return same;
	const n = decoded.success;
	if (n.type === "whole") {
		const view = check(decode, n.view);
		return Result.isSuccess(view)
			? {client: install(c, pid, {rev: n.rev, view: view.success}), ask: false}
			: ask;
	}
	const shown = c.views[pid];
	if (shown === undefined) return ask;
	if (n.rev <= shown.rev) return same;
	if (n.base !== shown.rev || n.rev !== shown.rev + 1) return ask;
	const next = Result.flatMap(applyPatch(shown.view, n.patch), (candidate) =>
		check(decode, candidate),
	);
	return Result.isSuccess(next)
		? {client: install(c, pid, {rev: n.rev, view: next.success}), ask: false}
		: ask;
};

// --- Resolving the fixed names ------------------------------------------------------------------

const decodeEntry = Schema.decodeUnknownOption(Entry);
const decodeLife = Schema.decodeUnknownOption(
	Schema.Struct({process: Schema.String, name: Schema.optionalKey(Schema.String)}),
);

/**
 * The live process a registered name points at, from its `processes/<name>` entries as read: the
 * newest start or restart by the brain's own writer, unless a later exit ended it. `by` is the
 * brain's writer, the one the client trusts for process facts.
 */
export const resolveName = (
	entries: ReadonlyArray<unknown>,
	name: string,
	by: (writer: string) => boolean,
): string | null => {
	let live: string | null = null;
	for (const raw of entries) {
		const entry = Option.getOrNull(decodeEntry(raw));
		if (entry === null || !by(entry.by)) continue;
		const life = Option.getOrNull(decodeLife(entry.body));
		if (life === null) continue;
		if (entry._tag === "started" || entry._tag === "restarted") {
			if (life.name === undefined || life.name === name) live = life.process;
		} else if (entry._tag === "exited" && life.process === live) live = null;
	}
	return live;
};

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

/** Checks a window against its program at compile time, and hands the registration back. */
export const defineWindow = <
	P extends AnyProgram,
	View,
	const R extends WindowRegistration<P, View>,
>(
	_program: P,
	registration: R & WindowRegistration<P, View>,
): R => registration;

/** The Msg a key command sends: the input named after the program's dot, with no fields. */
export const commandMsg = (command: string): {readonly type: string} | null => {
	const dot = command.indexOf(".");
	return dot <= 0 || dot === command.length - 1 ? null : {type: command.slice(dot + 1)};
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
	key: {result: Schema.Literals(["created", "reused", "replaced"])},
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
	view: {pid: Schema.String, result: Schema.Literals(["whole", "patch", "asked"]), rev: Count},
	persist: {result: Schema.Literals(["granted", "refused", "failed"])},
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
	if (typeof u !== "object" || u === null) return null;
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
): ClientRecord => ClientRecord.cases.failure.make({op, error: errorClass(error)});
