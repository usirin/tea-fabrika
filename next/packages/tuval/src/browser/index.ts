// The window in a browser tab, next/ (Tier 1, P14). The platform half: one scoped native WebSocket
// per dial, the profile's key, and the handlers for the window machine's Cmds. It decides nothing
// itself: every socket event becomes a typed Msg for the pure machines, and every answer settles
// the Cmd that asked. P18 keeps the shared socket for every platform; this is P14's one adapter.
//
// The wire is P12's as built: a `challenge`, a signed `initialize`, `door.knock` while not granted,
// `client.granted` to sign a fresh hello on the same socket, text `ping` and `pong`, and JSON-RPC
// calls for `ledger.read`, `ledger.wait`, `view.open` and `process.send`. A tile names a process by
// its registered name; the socket resolves it to the live process id for each dial.
import {run} from "@demlik/tea/effect";
import {Id, Keys, ProgramClient, Sent} from "@kampus/libfabrika";
import {helloText, writeSshsig} from "@kampus/libfabrika/transport";
import {
	DateTime,
	Deferred,
	Effect,
	Option,
	Queue,
	Result,
	Schema,
	type Scope,
	Stream,
} from "effect";
import type {Layout} from "../desktop/layout.ts";
import {
	type WindowChecks,
	type WindowCtx,
	windowMachineFor,
	type WindowMsg,
} from "../window/machine.ts";
import {type Identity, WindowKey} from "./key.ts";

export {WindowKey} from "./key.ts";

/** One JSON-RPC answer as the door sends it: a result, or an error with its reason. */
const Answer = Schema.Struct({
	id: Schema.Union([Schema.String, Schema.Number]),
	result: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(
		Schema.Struct({
			data: Schema.optionalKey(Schema.Struct({why: Schema.optionalKey(Schema.String)})),
		}),
	),
});
const Notification = Schema.Struct({
	method: Schema.String,
	params: Schema.optionalKey(Schema.Unknown),
});
const decodeFrame = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Union([Answer, Notification])),
);
const Admitted = Schema.Struct({
	ping: Schema.Number,
	who: Schema.Struct({person: Schema.String}),
});
const Waiting = Schema.Struct({code: Schema.String, until: Schema.Number});
const Nonce = Schema.Struct({nonce: Schema.String});
const Opened = Schema.Struct({rev: Schema.Int, view: Schema.Json});
const Entries = Schema.Struct({entries: Schema.Array(Schema.Unknown)});
const Rev = Schema.Struct({rev: Schema.Int});
const KeysBody = Schema.Struct({
	body: Schema.Struct({rows: Schema.Record(Schema.String, Schema.Array(Schema.String))}),
});
const FailedBody = Schema.Struct({body: Keys.KeyProblem});
/** An entry's case, read from what `ledger.read` sent. */
const caseName = (entry: unknown): unknown =>
	typeof entry === "object" && entry !== null && "_tag" in entry ? entry._tag : null;

/**
 * How a Cmd's handler fails, as the Cmd declares it. `unreachable`: the socket or the brain is gone
 * for now, so a later dial retries. `unknown`: an answer this client cannot use, with the door's
 * reason. `entropy`: the random source failed while dating a press. `failed` and `unsupported`:
 * the storage persistence ask. `closed`: the dial's socket is not open.
 */
const Failure = Schema.TaggedUnion({
	unreachable: {},
	unknown: {why: Schema.String},
	entropy: {},
	failed: {},
	unsupported: {},
	closed: {},
});
const F = Failure.cases;
type CallError = typeof F.unreachable.Type | typeof F.unknown.Type;
const unreachable = F.unreachable.make({});
/** A letter or a view call's failure as its Cmd declares it: "not now" reasons are retryable. */
const retryable = (error: CallError): CallError =>
	error._tag === "unknown" && RETRYABLE.has(error.why) ? unreachable : error;
/** Door reasons that mean "not now": the socket or the brain will be back. */
const RETRYABLE: ReadonlySet<string> = new Set([
	"unreachable",
	"not_granted",
	"no_hello",
	"storage",
]);

/** One dial's socket as the Cmd handlers use it. */
type Connection = {
	readonly call: (method: string, params: unknown) => Effect.Effect<unknown, CallError>;
	readonly text: (text: string) => boolean;
	/** A tile's name as its live process id on this dial. */
	readonly resolve: (name: string) => Effect.Effect<string, CallError>;
};

const osName = (): "macos" | "windows" | "linux" | "android" | "ios" | "unknown" => {
	const agent = navigator.userAgent.toLowerCase();
	if (agent.includes("iphone") || agent.includes("ipad")) return "ios";
	if (agent.includes("android")) return "android";
	if (agent.includes("mac")) return "macos";
	if (agent.includes("win")) return "windows";
	if (agent.includes("linux")) return "linux";
	return "unknown";
};

export type WindowOptions = {
	readonly layout: Layout;
	readonly ctx: Omit<WindowCtx, "layout">;
	readonly checks: WindowChecks;
	/** The label a knock shows in the waiting list, such as "Browser". */
	readonly label: string;
};

/** The highest page `ledger.read` answers; a shorter page is the end. */
const PAGE = 100;

/**
 * Starts the window machine in this tab with the browser's services: the socket Sub, the profile
 * key and the Cmd handlers. The run lives as long as the scope; React only reads it.
 */
export const startWindow = Effect.fn("window.start")(function* (options: WindowOptions) {
	const keys = yield* WindowKey;
	const ids = yield* Id.Generator;
	const tab = yield* ids.next(Id.Tab).pipe(Effect.orDie);
	const origin = location.origin;
	const connections = new Map<number, Connection>();
	const connection = (dial: number) =>
		Effect.fromNullishOr(connections.get(dial)).pipe(Effect.mapError(() => unreachable));

	/** The socket for one dial: its Msgs, from open to close. Closing the stream closes it. */
	const socket = (dial: number, rejected: string | null): Stream.Stream<WindowMsg> =>
		Stream.callback<WindowMsg>((queue) =>
			Effect.gen(function* () {
				const emit = (m: WindowMsg) => Queue.offerUnsafe(queue, m);
				const key = yield* Effect.result(keys.current(rejected));
				if (Result.isFailure(key)) return emit({type: "blocked", reason: "key_store"});
				yield* open(dial, key.success, emit);
				// The socket lives in this scope: it closes when tea stops the Sub, not before.
				return yield* Effect.never;
			}),
		);

	const open = Effect.fnUntraced(function* (
		dial: number,
		key: Identity,
		emit: (m: WindowMsg) => void,
	): Effect.fn.Return<void, never, Scope.Scope> {
		const url = `${origin.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(tab)}`;
		const pending = new Map<number, Deferred.Deferred<unknown, CallError>>();
		const names = new Map<string, string>();
		const back = new Map<string, string>();
		const work = yield* Queue.unbounded<Effect.Effect<void>>();
		let serial = 0;
		// The socket's events wait in a queue from the instant it exists, so the brain's first frame
		// (its challenge) is never lost while the handlers below are made.
		const inbox = yield* Queue.unbounded<
			| {readonly event: "open"}
			| {readonly event: "message"; readonly data: unknown}
			| {readonly event: "close"; readonly code: number}
		>();
		const ws = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const socket = new WebSocket(url);
				socket.addEventListener("open", () => Queue.offerUnsafe(inbox, {event: "open"}));
				socket.addEventListener("message", (e) =>
					Queue.offerUnsafe(inbox, {event: "message", data: e.data}),
				);
				socket.addEventListener("close", (e) =>
					Queue.offerUnsafe(inbox, {event: "close", code: e.code}),
				);
				return socket;
			}),
			(ws) =>
				Effect.sync(() => {
					connections.delete(dial);
					for (const waiting of pending.values())
						Deferred.doneUnsafe(waiting, Effect.fail(unreachable));
					ws.close(1000, "dial ended");
				}),
		);
		const opened = yield* Deferred.make<void>();
		const call = Effect.fn("client.request")(function* (method: string, params: unknown) {
			yield* Effect.annotateCurrentSpan("fab.method", method);
			yield* Deferred.await(opened);
			const id = ++serial;
			const answer = yield* Deferred.make<unknown, CallError>();
			pending.set(id, answer);
			if (ws.readyState !== WebSocket.OPEN) return yield* Effect.fail(unreachable);
			ws.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
			return yield* Deferred.await(answer);
		});
		const readAll = Effect.fnUntraced(function* (stream: string, after: number) {
			const out: Array<unknown> = [];
			let cursor = after;
			for (;;) {
				const page = yield* call("ledger.read", {stream, after: cursor}).pipe(
					Effect.flatMap((r) => Schema.decodeUnknownEffect(Entries)(r)),
					Effect.mapError(() => unreachable),
				);
				out.push(...page.entries);
				const last = Option.getOrNull(Schema.decodeUnknownOption(Rev)(page.entries.at(-1)));
				if (last === null || page.entries.length < PAGE)
					return {entries: out, cursor: last?.rev ?? cursor};
				cursor = last.rev;
			}
		});
		const resolve = Effect.fnUntraced(function* (name: string) {
			if (name.startsWith("process_")) return name;
			const known = names.get(name);
			if (known !== undefined) return known;
			const {entries} = yield* readAll(`processes/${name}`, 0);
			const pid = ProgramClient.resolveName(entries, name, (by) => by.startsWith("brain:"));
			if (pid === null) return yield* Effect.fail(F.unknown.make({why: "no_process"}));
			names.set(name, pid);
			back.set(pid, name);
			return pid;
		});
		connections.set(dial, {
			call,
			text: (t) => {
				if (ws.readyState !== WebSocket.OPEN) return false;
				ws.send(t);
				return true;
			},
			resolve,
		});

		/** The person's key settings: every page, then a wait past the cursor, for as long as the dial. */
		const settings = Effect.fnUntraced(function* (person: string) {
			const stream = `person/${person}/settings`;
			let cursor = 0;
			for (;;) {
				const read = yield* readAll(stream, cursor);
				const good = read.entries
					.filter((e) => caseName(e) === "keys")
					.flatMap((e) => Option.toArray(Schema.decodeUnknownOption(KeysBody)(e)))
					.at(-1);
				if (good !== undefined) emit({type: "keys", rows: good.body.rows});
				const last = read.entries.at(-1);
				const failed =
					caseName(last) === "keys_failed"
						? Option.getOrNull(Schema.decodeUnknownOption(FailedBody)(last))
						: null;
				if (failed !== null) emit({type: "keys_failed", error: failed.body});
				if (read.cursor > cursor) emit({type: "seen", rev: read.cursor});
				cursor = read.cursor;
				yield* call("ledger.wait", {stream, after: cursor});
			}
		});

		const hello = Effect.fnUntraced(function* (nonce: string) {
			const text = helloText({url: origin, tab, nonce});
			const signed = yield* writeSshsig({
				text,
				space: "fabrika-client",
				line: key.line,
				sign: key.sign,
			});
			const sentAt = DateTime.formatIso(yield* DateTime.now);
			const answer = yield* Effect.result(
				call("initialize", {
					versions: [1],
					has: [],
					ping: "5s",
					key: key.raw,
					tab,
					nonce,
					platform: "browser",
					os: osName(),
					sentAt,
					signed,
				}),
			);
			if (Result.isSuccess(answer)) {
				const admitted = Option.getOrNull(Schema.decodeUnknownOption(Admitted)(answer.success));
				if (admitted === null) return ws.close(4000, "bad answer");
				emit({type: "admitted", dial, ping: admitted.ping});
				return yield* settings(admitted.who.person).pipe(Effect.ignore);
			}
			if (answer.failure._tag !== "unknown" || answer.failure.why !== "not_granted")
				return ws.close(4000, "not admitted");
			const knocked = yield* call("door.knock", {label: options.label}).pipe(
				Effect.flatMap((r) => Schema.decodeUnknownEffect(Waiting)(r)),
				Effect.option,
			);
			if (Option.isSome(knocked))
				emit({type: "not_granted", dial, fingerprint: key.fingerprint, ...knocked.value});
		});

		const notice = (method: string, params: unknown): void => {
			if (method === "challenge" || method === "client.granted") {
				const nonce = Option.getOrNull(Schema.decodeUnknownOption(Nonce)(params));
				if (nonce === null) return;
				if (method === "client.granted") emit({type: "granted", dial});
				Queue.offerUnsafe(work, hello(nonce.nonce).pipe(Effect.ignore));
			} else if (method === "door.waiting") {
				const waiting = Option.getOrNull(Schema.decodeUnknownOption(Waiting)(params));
				if (waiting !== null)
					emit({type: "not_granted", dial, fingerprint: key.fingerprint, ...waiting});
			} else if (
				(method === "view.whole" || method === "view.patch") &&
				typeof params === "object" &&
				params !== null &&
				"pid" in params
			) {
				const {pid, ...note} = params;
				const name = typeof pid === "string" ? (back.get(pid) ?? pid) : null;
				if (name !== null) emit({type: "view", pid: name, note});
			}
		};

		const message = (data: unknown): void => {
			if (data === "pong") return emit({type: "pong", dial});
			const frame = Option.getOrNull(decodeFrame(String(data)));
			if (frame === null) return;
			if ("id" in frame) {
				const waiting = pending.get(Number(frame.id));
				if (waiting === undefined) return;
				pending.delete(Number(frame.id));
				const why = frame.error?.data?.why;
				Deferred.doneUnsafe(
					waiting,
					frame.error === undefined
						? Effect.succeed(frame.result ?? null)
						: Effect.fail<CallError>(F.unknown.make({why: why ?? "error"})),
				);
			} else notice(frame.method, frame.params);
		};
		const closed = (code: number): void => {
			for (const waiting of pending.values())
				Deferred.doneUnsafe(waiting, Effect.fail(unreachable));
			pending.clear();
			emit({type: "closed", dial, code, fingerprint: key.fingerprint});
		};
		yield* Stream.fromQueue(inbox).pipe(
			Stream.runForEach((e) =>
				Effect.sync(() =>
					e.event === "open"
						? Deferred.doneUnsafe(opened, Effect.void)
						: e.event === "message"
							? message(e.data)
							: closed(e.code),
				),
			),
			Effect.forkScoped,
		);
		yield* Stream.fromQueue(work).pipe(
			Stream.runForEach((task) => Effect.forkScoped(task)),
			Effect.forkScoped,
		);
	});

	const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
	const traceId = Effect.sync(() =>
		Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
			b.toString(16).padStart(2, "0"),
		).join(""),
	);

	return yield* run(windowMachineFor(options.checks), {
		ctx: {...options.ctx, layout: options.layout},
		interpret: {
			now: Effect.fn("client.now")(function* () {
				const letter = yield* ids.next(Id.Letter).pipe(Effect.mapError(() => F.entropy.make({})));
				return {letter, sentAt: yield* sentAt, traceId: yield* traceId};
			}),
			send: Effect.fn("client.send")(function* (cmd) {
				const conn = yield* connection(cmd.dial);
				const pid = yield* conn.resolve(cmd.pid).pipe(Effect.mapError(retryable));
				const answer = yield* conn
					.call("process.send", {
						pid,
						letter: cmd.letter,
						m: cmd.m,
						sentAt: cmd.sentAt,
						seen: cmd.seen,
						...(cmd.traceId === undefined ? {} : {traceId: cmd.traceId}),
					})
					.pipe(Effect.mapError(retryable));
				return yield* Schema.decodeUnknownEffect(Sent)(answer).pipe(
					Effect.mapError(() => F.unknown.make({why: "bad_answer"})),
				);
			}),
			open: Effect.fn("client.view")(function* (cmd) {
				const conn = yield* connection(cmd.dial);
				const pid = yield* conn.resolve(cmd.pid);
				const answer = yield* conn.call("view.open", {pid}).pipe(Effect.mapError(retryable));
				return yield* Schema.decodeUnknownEffect(Opened)(answer).pipe(
					Effect.mapError(() => F.unknown.make({why: "bad_view"})),
				);
			}),
			persist: Effect.fn("client.persist")(function* () {
				const claimed = yield* keys.claimPersist.pipe(Effect.mapError(() => F.failed.make({})));
				if (!claimed) return false;
				const st: StorageManager | undefined = navigator.storage;
				if (st?.persist === undefined) return yield* Effect.fail(F.unsupported.make({}));
				const failed = F.failed.make({});
				// oxlint-disable-next-line fabrika/no-promises -- edge: the Storage API asks for persistence through a Promise
				return yield* Effect.tryPromise({try: () => st.persist(), catch: () => failed});
			}),
			ping: (cmd) =>
				Effect.flatMap(connection(cmd.dial), (conn) =>
					conn.text("ping") ? Effect.succeed(null) : Effect.fail(F.closed.make({})),
				).pipe(Effect.mapError(() => F.closed.make({}))),
			knock: (cmd) =>
				Effect.flatMap(connection(cmd.dial), (conn) =>
					conn.call("door.knock", {label: options.label}),
				).pipe(
					Effect.as(null),
					Effect.mapError(() => F.closed.make({})),
				),
		},
		subscribe: {socket: (sub) => socket(sub.deps.dial, sub.deps.rejected)},
	});
});
