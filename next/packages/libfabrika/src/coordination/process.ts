import {Equal, Option, Result, Schema} from "effect";
import {LedgerError} from "../data/ledger.ts";
import {type Entry, valueFor} from "../data/log.ts";
import {ProcessId} from "../data/trace.ts";
import type {From} from "./mailbox.ts";

const Text = Schema.NonEmptyString;
const PROCESSES = "processes";
const CLIENTS = "client:";
/**
 * A process name is a stream name: no `/`, so `<name>` and `<name>/inbox` never meet another's,
 * and no `client:` lead, so it never meets a client's inbox.
 */
const ProcessName = Schema.String.check(
	Schema.isPattern(new RegExp(`^(?!${PROCESSES}$)(?!${CLIENTS})[a-z0-9][a-z0-9._:-]*$`)),
);
/** A client id has no `:`, the mark of a process name such as `counter:1`. */
const ClientId = Schema.String.check(
	Schema.isPattern(new RegExp(`^(?!${PROCESSES}$)[a-z0-9][a-z0-9._-]*$`)),
);
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Code = Schema.Struct({program: Text, hash: Text});
export const Owner = Schema.TaggedUnion({brain: {}, process: {process: ProcessId}});
export const Recipient = Schema.TaggedUnion({
	process: {process: ProcessId},
	client: {client: Text, session: ProcessId},
});
export type Caller = {readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type};
export const Start = Schema.TaggedUnion({
	first: {id: Text, name: Text, code: Code},
	again: {id: Text, name: Text, code: Code, after: ProcessId, why: Text},
});
export type Start = typeof Start.Type;
export const State = Schema.TaggedUnion({
	live: {process: ProcessId, code: Code},
	ended: {process: ProcessId, code: Code, why: Text},
	down: {process: ProcessId, code: Code, why: Text, crashes: Count, until: Schema.Int},
});
export const ProcessFact = Schema.TaggedUnion({
	registered: {name: Text, program: Text, owner: Owner},
	started: {process: ProcessId, name: Text, program: Text, hash: Text},
	exited: {process: ProcessId, why: Text},
	restarted: {process: ProcessId, after: ProcessId, name: Text, why: Text, build: Text},
	down: {process: ProcessId, why: Text, crashes: Count, until: Schema.Int},
	monitored: {ref: Text, process: ProcessId, to: Recipient},
	demonitored: {ref: Text, to: Recipient, why: Schema.Literals(["canceled", "watcher_exited"])},
});
/** Only the brain's ProcessManager writes the `processes` stream and every ProcessFact case. */
export const brainOnly = (stream: string, tag: string): boolean =>
	stream === PROCESSES || Object.hasOwn(ProcessFact.cases, tag);
export const Down = Schema.TaggedStruct("DOWN", {
	ref: Text,
	process: ProcessId,
	why: Text,
	to: Recipient,
});
export const Dead = Schema.TaggedStruct("dead", {
	tries: Count,
	limit: Count,
	m: Text,
	build: Text,
	errors: Schema.Array(Text),
}).check(
	Schema.makeFilter((value) => value.errors.length === value.tries || "one error class per try"),
);
export const Activity = Schema.TaggedUnion({
	idle: {process: ProcessId},
	stepping: {process: ProcessId, letter: Text, build: Text},
});
const Recovered = Schema.TaggedUnion({
	idle: Activity.cases.idle.fields,
	interrupted: {process: ProcessId, letter: Text, build: Text, why: Schema.Literal("interrupted")},
});
export const recoverActivity = (
	raw: unknown,
): Result.Result<typeof Recovered.Type, LedgerError> => {
	const saved = Schema.decodeUnknownResult(Activity)(raw);
	if (Result.isFailure(saved)) return Result.fail(new LedgerError({why: "bad_row"}));
	const value = saved.success;
	return Result.succeed(
		value._tag === "idle"
			? value
			: Recovered.cases.interrupted.make({
					process: value.process,
					letter: value.letter,
					build: value.build,
					why: "interrupted",
				}),
	);
};
export const canRestart = (
	times: ReadonlyArray<number>,
	now: number,
	period: number,
	intensity: number,
): boolean => times.filter((at) => at >= now - period).length + 1 <= intensity;

export class ProcessError extends Schema.TaggedError<ProcessError>()("ProcessError", {
	why: Schema.Literals([
		"not_parent",
		"name_taken",
		"alive",
		"stale",
		"id_reused",
		"id_collision",
		"ended",
		"bad_ref",
		"bad_name",
	]),
}) {}

type Reservation = typeof ProcessFact.cases.registered.Type;
type Life = {
	readonly name: string;
	readonly state: typeof State.Type;
	readonly request: Start;
	readonly from: From;
	readonly rev: number;
};
/** `round` counts this (recipient, ref)'s monitored facts, so a monitor after a cancel is new. */
type Watch = typeof ProcessFact.cases.monitored.Type & {
	readonly canceled: boolean;
	readonly round: number;
};
export type StartAnswer = {readonly process: string; readonly rev: number};
export type ProcessInfo = {
	readonly process: string;
	readonly name: string;
	readonly program: string;
	readonly build: string;
	readonly restarts: number;
};
const decodeFact = Schema.decodeUnknownSync(ProcessFact);
const decodeDown = Schema.decodeUnknownOption(Down);
const denied = (why: ProcessError["why"]) => Result.fail(new ProcessError({why}));
const canonical = (to: typeof Recipient.Type): typeof Recipient.Type =>
	to._tag === "process"
		? Recipient.cases.process.make({process: to.process})
		: Recipient.cases.client.make({client: to.client, session: to.session});
const watchKey = (to: typeof Recipient.Type, ref: string): string =>
	JSON.stringify([canonical(to), ref]);
/** A client's own inbox, `client:<id>/inbox`, where its DOWNs land; never a process's inbox. */
export const clientInbox = (client: string): string => `${CLIENTS}${client}/inbox`;
/** The one id a DOWN for (recipient, ref) is written under. */
export const signalId = (to: typeof Recipient.Type, ref: string): string =>
	JSON.stringify(["DOWN", canonical(to), ref]);
const SIGNAL_LEAD = JSON.stringify(["DOWN"]).slice(0, -1);
const decodeIdParts = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);
/** True for any id in the signal id space, a JSON array led by `"DOWN"`: only the brain writes one. */
export const inSignalSpace = (id: string): boolean =>
	id.startsWith(SIGNAL_LEAD) || Option.exists(decodeIdParts(id), (parts) => parts[0] === "DOWN");

/**
 * A disposable fold of the ledger. No process authority survives outside its facts, and a fact
 * counts only when `by` is the brain's own writer.
 */
export class ProcessTable {
	static readonly stream = PROCESSES;
	readonly #by: string;
	readonly #names = new Map<string, Reservation>();
	readonly #lives = new Map<string, Life>();
	readonly #watches = new Map<string, Watch>();
	readonly #current = new Map<string, string>();
	readonly #restarts = new Map<string, number>();

	constructor(entries: Iterable<Entry>, by: string) {
		this.#by = by;
		for (const entry of entries) {
			if (!Object.hasOwn(ProcessFact.cases, entry._tag) || entry.by !== by) continue;
			const fact = decodeFact(valueFor(entry));
			switch (fact._tag) {
				case "registered":
					this.#names.set(fact.name, fact);
					break;
				case "started": {
					const code = {program: fact.program, hash: fact.hash};
					this.#lives.set(fact.process, {
						name: fact.name,
						state: State.cases.live.make({process: fact.process, code}),
						request: Start.cases.first.make({id: entry.id, name: fact.name, code}),
						from: entry,
						rev: entry.rev,
					});
					this.#current.set(fact.name, fact.process);
					break;
				}
				case "restarted": {
					const life = this.require(fact.process);
					this.#lives.set(fact.process, {
						...life,
						request: Start.cases.again.make({
							id: life.request.id,
							name: fact.name,
							code: life.state.code,
							after: fact.after,
							why: fact.why,
						}),
					});
					this.#restarts.set(fact.name, (this.#restarts.get(fact.name) ?? 0) + 1);
					break;
				}
				case "exited": {
					const life = this.require(fact.process);
					this.#lives.set(fact.process, {
						...life,
						state: State.cases.ended.make({
							process: fact.process,
							code: life.state.code,
							why: fact.why,
						}),
					});
					break;
				}
				case "down": {
					const life = this.require(fact.process);
					this.#lives.set(fact.process, {
						...life,
						state: State.cases.down.make({...fact, code: life.state.code}),
					});
					break;
				}
				case "monitored": {
					const key = watchKey(fact.to, fact.ref);
					const round = (this.#watches.get(key)?.round ?? 0) + 1;
					this.#watches.set(key, {...fact, canceled: false, round});
					break;
				}
				case "demonitored": {
					const key = watchKey(fact.to, fact.ref);
					const watch = this.#watches.get(key);
					if (watch !== undefined) this.#watches.set(key, {...watch, canceled: true});
					break;
				}
			}
		}
	}

	private require(process: string): Life {
		const life = this.#lives.get(process);
		if (life === undefined) throw new LedgerError({why: "bad_row"});
		return life;
	}

	static read(read: (stream: string, after: number) => Iterable<Entry>, by: string): ProcessTable {
		const control = [...read(ProcessTable.stream, 0)];
		const names = control
			.filter((entry) => entry._tag === "registered" && entry.by === by)
			.map((entry) => Schema.decodeUnknownSync(ProcessFact.cases.registered)(valueFor(entry)).name);
		return new ProcessTable(
			[...control, ...names.flatMap((name) => [...read(name, 0)])].sort((a, b) => a.rev - b.rev),
			by,
		);
	}

	start(
		request: Start,
		caller: Caller,
		from: From,
	): Result.Result<Option.Option<StartAnswer>, ProcessError> {
		if (!Schema.is(ProcessName)(request.name)) return denied("bad_name");
		const saved = [...this.#lives.values()].find((life) => life.request.id === request.id);
		if (saved !== undefined) {
			if (
				!Equal.equals(saved.request, request) ||
				saved.from.for !== from.for ||
				saved.from.parent !== from.parent
			)
				return denied("id_reused");
			const parent = this.parent(saved.state.process, caller.owner);
			return Result.isFailure(parent)
				? Result.fail(parent.failure)
				: Result.succeed(Option.some({process: saved.state.process, rev: saved.rev}));
		}
		const name = this.#names.get(request.name);
		if (request._tag === "first")
			return name === undefined ? Result.succeed(Option.none()) : denied("name_taken");
		if (name === undefined || !Equal.equals(name.owner, caller.owner)) return denied("not_parent");
		if (name.program !== request.code.program) return denied("name_taken");
		if (this.#current.get(request.name) !== request.after) return denied("stale");
		if (this.isLive(request.after)) return denied("alive");
		return Result.succeed(Option.none());
	}

	collision(process: string): boolean {
		return this.#lives.has(process);
	}
	isLive(process: string): boolean {
		return this.#lives.get(process)?.state._tag === "live";
	}
	life(process: string): Option.Option<Life> {
		return Option.fromUndefinedOr(this.#lives.get(process));
	}
	parent(process: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
		const life = this.#lives.get(process);
		if (life === undefined) return denied("ended");
		return Equal.equals(this.#names.get(life.name)?.owner, owner)
			? Result.succeed(life)
			: denied("not_parent");
	}
	exit(process: string, why: string, owner: typeof Owner.Type): Result.Result<Life, ProcessError> {
		const parent = this.parent(process, owner);
		if (Result.isFailure(parent)) return parent;
		const state = parent.success.state;
		return state._tag !== "live" && state.why !== why ? denied("ended") : parent;
	}
	/** The round to write for a new or renewed watch; none when this watch is already live. */
	monitor(
		ref: string,
		process: string,
		to: typeof Recipient.Type,
	): Result.Result<Option.Option<number>, ProcessError> {
		if (to._tag === "client" && !Schema.is(ClientId)(to.client)) return denied("bad_name");
		const watch = this.#watches.get(watchKey(to, ref));
		if (watch !== undefined && watch.process !== process) return denied("bad_ref");
		if (watch !== undefined && !watch.canceled) return Result.succeed(Option.none());
		if (to._tag === "process" && !this.isLive(to.process)) return denied("ended");
		return Result.succeed(Option.some((watch?.round ?? 0) + 1));
	}
	/** The caller's own live watch under `ref`, if any. Another recipient's ref is never touched. */
	demonitor(ref: string, to: typeof Recipient.Type): Option.Option<Watch> {
		return Option.filter(
			Option.fromUndefinedOr(this.#watches.get(watchKey(to, ref))),
			(watch) => !watch.canceled,
		);
	}
	inbound(process: string): ReadonlyArray<Watch> {
		return [...this.#watches.values()].filter(
			(watch) => !watch.canceled && watch.process === process,
		);
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
		if (typeof m !== "object" || m === null || !("_tag" in m) || m._tag !== "DOWN") return "mail";
		const down = decodeDown(m);
		if (Option.isNone(down)) return "mail";
		const {to, ref} = down.value;
		const watch = this.#watches.get(watchKey(to, ref));
		if (
			entry.by !== this.#by ||
			entry.id !== signalId(to, ref) ||
			watch === undefined ||
			watch.process !== down.value.process
		)
			return "mail";
		return to._tag === "process" && to.process === process && !watch.canceled ? "signal" : "drop";
	}
	get info(): ReadonlyArray<ProcessInfo> {
		return [...this.#lives.values()]
			.filter((life) => life.state._tag === "live")
			.map((life) => ({
				process: life.state.process,
				name: life.name,
				program: life.state.code.program,
				build: life.state.code.hash,
				restarts: this.#restarts.get(life.name) ?? 0,
			}));
	}
}
