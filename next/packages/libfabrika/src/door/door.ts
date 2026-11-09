import {
	Context,
	Effect,
	Exit,
	Layer,
	Option,
	Result,
	Schema,
	Semaphore,
	Stream,
	Tracer,
} from "effect";
import {Base64, Base64Url} from "effect/encoding";
import {Incoming} from "../app/entry.ts";
import {type ProgramDown} from "../app/program.ts";
import {type RunnerError, type Sent} from "../app/runner.ts";
import {
	admitted,
	appendAdmitted,
	brainOnly,
	Change,
	ClientManager,
	enrollmentText,
	type Envelope,
	foldMembers,
	type From,
	MemberFact,
	NotGranted,
	ProcessManager,
	type ProcessError,
	Saw,
	SessionManager,
	SigningRefused,
	SignRequest,
	Writer,
} from "../coordination/index.ts";
import type {SinkError} from "../data/index.ts";
import {
	Archive,
	Chain,
	fromHere,
	Ledger,
	LedgerError,
	LedgerTransaction,
	Line,
	lineFor,
	PAGE,
	ProcessId,
	RecordManager,
	SpanSink,
	valueFor,
} from "../data/index.ts";
import * as Id from "../id.ts";
import {InputId} from "../id.ts";
import {
	Admission,
	Answer,
	Attached,
	checkHello,
	type Checked,
	Hello,
	KeyLine,
	PasskeyLine,
	passkeyRp,
	Row,
	verifySshsig,
	Waiting,
} from "../transport/index.ts";
import {doorNonce} from "./nonce.ts";
import {doorStore} from "./store.ts";

const ConnectionId = Schema.NonEmptyString.pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

const quiet = Tracer.make({span: (options) => new Tracer.NativeSpan(options)});
const silent = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
	return yield* effect.pipe(Effect.withTracer(quiet));
});
const json = Schema.decodeUnknownResult(Schema.Json);
const rawObject = (a: unknown): Record<string, unknown> | null =>
	typeof a === "object" && a !== null && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
const reserved = (a: unknown) => {
	const value = rawObject(a);
	return (
		value !== null && ["id", "by", "for", "arrivedAt"].some((key) => Object.hasOwn(value, key))
	);
};
const no = (why: string) => Answer.cases.refused.make({why});
const ok = (result: typeof Schema.Json.Type) => Answer.cases.ok.make({result});
// A dead letter stops the sender's outbox. Other program refusals keep their full reply.
const deliveryAnswer = (result: Schema.Json) =>
	Schema.is(Answer.cases.refused)(result) && result.why === "dead" ? no("dead") : ok(result);
const EnvelopeState = Schema.TaggedUnion({
	allocated: {},
	recorded: {},
	delivered: {},
	retryable: {},
	settled: {result: Schema.Json},
});
const Link = Schema.Struct({traceId: Schema.String, spanId: Schema.String});
const Binding = Schema.Struct({
	id: Schema.String,
	door: Schema.optionalKey(ProcessId),
	n: Schema.optionalKey(Schema.Int),
	letter: Schema.optionalKey(Schema.String),
	seen: Schema.optionalKey(Schema.Int),
	hash: Schema.optionalKey(Schema.String),
	client: Schema.String,
	by: Writer,
	process: Schema.String,
	name: Schema.String,
	personOnly: Schema.Boolean,
	digest: Schema.String,
	arrivedAt: Schema.Number,
	span: Link,
	sentAt: Schema.String,
	state: EnvelopeState,
});
type Binding = typeof Binding.Type;
const encodeBinding = Schema.encodeSync(Schema.fromJsonString(Binding));
const decodeBinding = Schema.decodeUnknownResult(Schema.fromJsonString(Binding));
// Saved pre-P17 inputs keep their original shape when checking a retry.
const LegacyInputFact = Schema.TaggedUnion({
	received: {
		method: Schema.String,
		target: Schema.String,
		by: Writer,
		arrivedAt: Schema.Number,
		traceId: Schema.String,
		spanId: Schema.String,
		input: Schema.optionalKey(Schema.Json),
	},
	refused: {
		method: Schema.String,
		target: Schema.String,
		by: Writer,
		arrivedAt: Schema.Number,
		traceId: Schema.String,
		spanId: Schema.String,
		why: Schema.String,
	},
});
const InputFact = Schema.TaggedUnion({
	received: {
		...LegacyInputFact.cases.received.fields,
		door: ProcessId,
		n: Schema.Int,
	},
	refused: {
		...LegacyInputFact.cases.refused.fields,
		door: ProcessId,
		n: Schema.Int,
	},
});
const GrantReply = Schema.TaggedUnion({
	applied: {rev: Schema.Number},
	ignored: {rev: Schema.Number, why: Schema.String},
	refused: {why: Schema.String},
});
const WatchReply = Schema.TaggedUnion({
	watching: {rows: Schema.Array(Row)},
	refused: {why: Schema.String, rows: Schema.Array(Row)},
});
const Enrollment = Schema.Struct({
	id: Schema.String,
	for: Schema.String,
	to: Schema.String,
	key: Schema.String,
	window: Schema.String,
});
const Enrolled = Schema.Struct({binding: Enrollment, nonce: Schema.String, used: Schema.Boolean});
const Receipt = Schema.Struct({text: Schema.String, armored: Schema.String, reply: GrantReply});
const ChangePending = Schema.Struct({
	text: Schema.String,
	armored: Schema.String,
	from: Schema.Struct({
		by: Line.fields.by,
		for: Line.fields.for,
		sentAt: Line.fields.sentAt,
		seen: Line.fields.seen,
		parent: Line.fields.parent,
		traceId: Line.fields.traceId,
		build: Line.fields.build,
	}),
});
const AppendMeta = Schema.Struct({
	sentAt: Schema.String,
	digest: Schema.String,
	stream: Schema.String,
});
const Send = Schema.Struct({
	pid: ProcessId,
	letter: Schema.String,
	m: Schema.Unknown,
	sentAt: Schema.String,
	seen: Schema.Int,
	traceId: Schema.optional(Schema.String),
});
const InboxFact = Schema.TaggedStruct("send", {m: Schema.Json});
const Read = Schema.Struct({
	stream: Schema.String,
	after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const SpanRead = Schema.Struct({
	chain: Chain,
	after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const SpanContent = Schema.Struct({chain: Chain, spanId: Schema.String});
const DeleteContent = Schema.Struct({...SpanContent.fields, why: Schema.String});
const methods: ReadonlySet<string> = new Set([
	"process.send",
	"view.open",
	"ledger.read",
	"ledger.wait",
	"spans.read",
	"spans.content",
	"spans.deleteContent",
	"door.watch",
	"door.deny",
]);

type Options<A, RNext, RDeliver, RNotify> = {
	readonly sql: Parameters<typeof doorStore>[0];
	readonly founder: Parameters<typeof ClientManager.layer>[0];
	readonly name: string;
	readonly url: string;
	readonly origins: ReadonlyArray<string>;
	readonly versions: ReadonlyArray<number>;
	readonly location: string;
	readonly build: string;
	readonly waiting: Pick<Waiting, "most" | "ttl">;
	readonly ping: {readonly min: number; readonly max: number};
	readonly inputCap: number;
	readonly spentCap: number;
	readonly turn?: Semaphore.Semaphore;
	readonly write?: <B, E, R>(work: Effect.Effect<B, E, R>) => Effect.Effect<B, E, R>;
	readonly policy?: (
		process: string,
	) => Effect.Effect<
		{readonly inputs: ReadonlyArray<string>; readonly events: ReadonlyArray<string>},
		LedgerError
	>;
	readonly isLive?: (process: string) => Effect.Effect<boolean, LedgerError>;
	readonly open?: (
		process: string,
		client: string,
	) => Effect.Effect<Schema.Json, LedgerError, RDeliver>;
	readonly wait?: (
		stream: string,
		after: number,
		reader: string,
	) => Effect.Effect<unknown, LedgerError>;
	readonly nextProcess: () => Effect.Effect<string, never, RNext>;
	readonly deliver: (
		process: string,
		envelope: Envelope<A>,
		span: typeof Link.Type,
		incoming: Incoming,
	) => Effect.Effect<
		Sent | void,
		| LedgerError
		| SinkError
		| SigningRefused
		| NotGranted
		| ProgramDown
		| RunnerError
		| ProcessError,
		RDeliver
	>;
	readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError, RNotify>;
	readonly inputs: {
		readonly schema: Schema.Codec<A, unknown>;
		readonly personOnly: ReadonlyArray<string>;
		readonly raw: ReadonlyArray<string>;
		readonly log: Schema.Encoder<unknown>;
		readonly name?: (input: A) => string | undefined;
	};
	readonly facts: {readonly personOnly: ReadonlyArray<string>};
};

const make = Effect.fnUntraced(function* <A, RNext, RDeliver, RNotify>(
	options: Options<A, RNext, RDeliver, RNotify>,
) {
	const initialWaiting = Waiting.make({rows: [], ...options.waiting});
	const context = yield* Effect.context<RNext | RDeliver | RNotify>();
	const ledger = yield* Ledger;
	const transaction = yield* LedgerTransaction;
	const ids = yield* Id.Generator;
	const appendChecked = Effect.fnUntraced(function* (
		key: string,
		write: Parameters<typeof appendAdmitted>[1],
	) {
		return yield* appendAdmitted(key, write).pipe(
			Effect.provideService(LedgerTransaction, transaction),
		);
	});
	const clients = yield* ClientManager;
	const sink = yield* SpanSink;
	const records = yield* RecordManager;
	const archive = yield* Archive;
	const processes = yield* Effect.serviceOption(ProcessManager);
	const store = doorStore(options.sql),
		sql = options.sql;
	const nonces = yield* silent(doorNonce(store, options.waiting.ttl, options.spentCap));
	// Only calls currently checking a proof live here. No challenge is retained.
	const checking = new Map<ConnectionId, Set<{current: boolean}>>();
	const turn = options.turn ?? (yield* Semaphore.make(1));
	const write = options.write ?? turn.withPermit;
	const flush = sink.flush.pipe(
		Effect.provideService(RecordManager, records),
		Effect.provideService(Archive, archive),
	);
	const clock = Effect.clockWith((c) => c.currentTimeMillis);
	const notify = Effect.fn("door.notify")(function* (client: string, news: unknown) {
		const result = yield* Effect.exit(
			options.notify(client, news).pipe(Effect.provideContext(context)),
		);
		yield* Effect.annotateCurrentSpan("fab.door.notified", Exit.isSuccess(result));
	});
	const memberRows = Stream.runCollect(ledger.read("door/members", 0));
	const readMembers = Effect.fnUntraced(function* () {
		const rows = yield* memberRows;
		if (rows.length === 0) return null;
		return foldMembers(
			yield* Effect.forEach(
				rows,
				(row) =>
					Schema.decodeUnknownEffect(MemberFact)(valueFor(row)).pipe(
						Effect.mapError(() => new LedgerError({why: "bad_row"})),
					),
				{concurrency: 1},
			),
		);
	});
	const membership = Effect.fnUntraced(function* (raw: string) {
		const members = yield* clients.members;
		const who = admitted(members, raw);
		if ("why" in who) return yield* new NotGranted({});
		const key = yield* fingerprint(raw, false);
		return Writer.cases[who.as === "agent" ? "agent" : "person"].make({key, for: who.person});
	});
	const sessions = yield* Effect.service(SessionManager).pipe(
		Effect.provide(
			SessionManager.layer(sql, membership, {
				input: (name) => options.inputs.personOnly.includes(name),
				fact: (kind) => options.facts.personOnly.includes(kind),
			}),
		),
	);
	const sessionsFor = Effect.fnUntraced(function* (process: string) {
		if (options.policy === undefined) return sessions;
		const policy = yield* options.policy(process);
		return yield* SessionManager.pipe(
			Effect.provide(
				SessionManager.layer(sql, membership, {
					input: (name) => policy.inputs.includes(name),
					fact: (kind) => policy.events.includes(kind),
				}),
			),
		);
	});
	const prunePending = (at: number) => {
		const expired = sql.exec(
			"SELECT client FROM door_pending WHERE until<=? OR client IN (SELECT client FROM door_pending ORDER BY rowid DESC LIMIT -1 OFFSET ?)",
			at,
			options.waiting.most,
		);
		for (const row of expired) {
			const client = String(row.client);
			sql.exec("DELETE FROM door_state WHERE name=?", `client/${client}`);
			sql.exec("DELETE FROM door_state WHERE name=?", `key/${client}`);
			sql.exec("DELETE FROM door_pending WHERE client=?", client);
		}
	};
	const attachment = Effect.fnUntraced(function* (client: ConnectionId) {
		const at = yield* clock;
		return yield* store.atomic(() => {
			prunePending(at);
			return store.get(`client/${client}`, Attached);
		});
	});
	const online = Effect.fnUntraced(function* (client: ConnectionId) {
		const attached = yield* attachment(client);
		if (attached?._tag !== "online") return yield* new NotGranted({});
		const raw = yield* store.atomic(() => store.get(`key/${client}`, Schema.String));
		if (raw === null) return yield* new NotGranted({});
		const by = yield* membership(raw);
		return {attached, raw, by};
	});
	const connect = Effect.fnUntraced(function* () {
		return yield* Effect.sync(() => ConnectionId.make(random()));
	});
	const challenge = Effect.fnUntraced(function* (client: ConnectionId) {
		for (const attempt of checking.get(client) ?? []) attempt.current = false;
		yield* store.atomic(() => {
			// A reconnect retires this checked connection, never another client's proof.
			sql.exec("DELETE FROM door_state WHERE name IN (?,?)", `client/${client}`, `key/${client}`);
			sql.exec("DELETE FROM door_pending WHERE client=?", client);
		});
		return yield* silent(nonces.issue(client));
	});
	const initialize = Effect.fnUntraced(function* (
		client: ConnectionId,
		input: unknown,
		trusted: {readonly url: string; readonly tab: string; readonly name: string},
	) {
		if (trusted.url !== options.url) return no("bad_nonce");
		const decoded = Schema.decodeUnknownResult(Hello)(input);
		if (Result.isFailure(decoded)) return no("bad_hello");
		const hello = decoded.success;
		return yield* Effect.acquireUseRelease(
			Effect.sync(() => {
				const attempt = {current: true};
				const calls = checking.get(client) ?? new Set();
				calls.add(attempt);
				checking.set(client, calls);
				return attempt;
			}),
			Effect.fnUntraced(function* (attempt: {current: boolean}) {
				const until = yield* silent(nonces.check(client, hello.nonce));
				return until === null
					? no("bad_nonce")
					: yield* initializeChecked(client, hello, trusted, until, attempt);
			}),
			(attempt) =>
				Effect.sync(() => {
					const calls = checking.get(client);
					calls?.delete(attempt);
					if (calls?.size === 0) checking.delete(client);
				}),
		);
	});
	const initializeChecked = Effect.fnUntraced(function* (
		client: ConnectionId,
		hello: typeof Hello.Type,
		trusted: {readonly url: string; readonly tab: string; readonly name: string},
		until: number,
		attempt: {current: boolean},
	) {
		let claimed = false;
		const result = yield* silent(
			checkHello({
				hello,
				...trusted,
				nonce: hello.nonce,
				versions: options.versions,
				ping: options.ping,
				consume: () => attempt.current && claimed,
				admit: Effect.fnUntraced(function* () {
					const at = yield* clock;
					const spent = yield* store.atomic(() => {
						const current = store.get(`client/${client}`, Attached);
						if (!attempt.current || current?._tag === "online") return Result.succeed(false);
						return nonces.spend(hello.nonce, until, at);
					});
					if (Result.isFailure(spent)) return yield* spent.failure;
					claimed = spent.success;
					if (!claimed) return Admission.cases.refused.make({why: "not_granted"});
					const raw = hello.key;
					const existing = yield* readMembers();
					if (existing === null && raw !== options.founder.window)
						return Admission.cases.refused.make({why: "not_granted"});
					const members = existing ?? (yield* clients.members);
					const who = admitted(members, raw);
					return "why" in who
						? Admission.cases.refused.make({why: "not_granted"})
						: Admission.cases.admitted.make({who: {...who, key: trusted.name}});
				}),
			}),
		);
		if (result._tag === "refused") {
			if (result.why === "not_granted" && !claimed) return no("bad_nonce");
			if (claimed && result.why === "not_granted") {
				const at = yield* clock;
				yield* store.atomic(() => {
					const current = store.get(`client/${client}`, Attached);
					if (!attempt.current || current?._tag === "online") return;
					store.set(
						`client/${client}`,
						Attached,
						Attached.cases.waiting.make({
							client,
							key: hello.key,
							hello,
							nonce: hello.nonce,
						}),
					);
					sql.exec(
						"INSERT OR REPLACE INTO door_pending (client,until) VALUES (?,?)",
						client,
						at + options.waiting.ttl,
					);
					prunePending(at);
				});
			}
			return result;
		}
		const recordHello = Effect.fn("door.initialize")(function* () {
			const from = yield* fromHere({
				by: result.who.key,
				for: result.who.person,
				seen: 0,
				parent: null,
				build: options.build,
			});
			const fact = HelloFact.make({
				...result.hello,
				url: trusted.url,
				version: result.version,
				location: options.location,
				build: options.build,
			});
			const placed = yield* appendChecked(result.hello.key, {
				stream: "door/hellos",
				id: `hello-${random()}`,
				line: lineFor(from, fact),
			});
			if (placed._tag === "refused") return yield* new LedgerError({why: "refused"});
			yield* store.atomic(() => {
				sql.exec("DELETE FROM door_pending WHERE client=?", client);
				store.set(`key/${client}`, Schema.String, result.hello.key);
				store.set(
					`client/${client}`,
					Attached,
					Attached.cases.online.make({
						client,
						who: result.who,
						version: result.version,
						waits: [],
						watching: false,
						busy: false,
					}),
				);
			});
		});
		yield* recordHello();
		yield* flush;
		return result;
	});
	const waiting = (at: number) => {
		const state = store.get("waiting", Waiting) ?? initialWaiting;
		return Waiting.expire(state, at);
	};
	const knock = Effect.fnUntraced(function* (
		client: ConnectionId,
		params: {readonly label: string; readonly pass?: string | null},
	) {
		const attached = yield* attachment(client);
		if (attached?._tag !== "waiting") return no("not_waiting");
		const at = yield* clock;
		const state = yield* store.atomic(() => {
			const next = Waiting.knock(waiting(at), {
				key: attached.key,
				client,
				label: params.label,
				where: options.location,
				has: attached.hello.has,
				as: "window",
				code: String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)
					.slice(-6)
					.padStart(6, "0"),
				pass: params.pass ?? null,
				at,
			});
			store.set("waiting", Waiting, next);
			return next;
		});
		// The positive cap keeps the row this knock just wrote.
		const row = Option.getOrThrow(
			Option.fromUndefinedOr(state.rows.find((r) => r.key === attached.key)),
		);
		return ok({code: row.code, until: row.until});
	});
	const watch = Effect.fnUntraced(function* (client: ConnectionId) {
		const checked = yield* silent(Effect.result(online(client)));
		if (Result.isFailure(checked))
			return WatchReply.cases.refused.make({why: "not_granted", rows: []});
		if (checked.success.by._tag !== "person")
			return WatchReply.cases.refused.make({why: "person_only", rows: []});
		const at = yield* clock;
		const state = yield* store.atomic(() => {
			store.set(
				`client/${client}`,
				Attached,
				Attached.cases.online.make({...checked.success.attached, watching: true}),
			);
			const live = waiting(at);
			store.set("waiting", Waiting, live);
			return live;
		});
		return WatchReply.cases.watching.make({rows: state.rows});
	});
	const disconnect = Effect.fnUntraced(function* (client: ConnectionId) {
		for (const attempt of checking.get(client) ?? []) attempt.current = false;
		const at = yield* clock;
		yield* store.atomic(() => {
			const attached = store.get(`client/${client}`, Attached);
			if (attached?._tag === "waiting")
				store.set("waiting", Waiting, Waiting.leave(waiting(at), {key: attached.key, client}));
			sql.exec("DELETE FROM door_state WHERE name IN (?,?)", `client/${client}`, `key/${client}`);
			sql.exec("DELETE FROM door_pending WHERE client=?", client);
		});
	});
	const enrollment = Effect.fnUntraced(function* (binding: typeof Enrollment.Type) {
		const nonce = random();
		yield* store.atomic(() =>
			store.set(`enrollment/${binding.id}`, Enrolled, {binding, nonce, used: false}),
		);
		return nonce;
	});
	const fromInput = (binding: Binding): From => ({
		by: binding.by.key,
		for: binding.by.for,
		sentAt: binding.sentAt,
		seen: 0,
		parent: null,
		traceId: binding.span.traceId,
		build: options.build,
	});
	let start: string | null = null;
	let count = 0;
	const allocateStart = Effect.fnUntraced(function* () {
		while (start === null) {
			const candidate = yield* options.nextProcess().pipe(Effect.provideContext(context));
			const fresh = yield* store.atomic(() => {
				if (!Schema.is(ProcessId)(candidate)) return false;
				if (sql.exec("SELECT id FROM door_starts WHERE id=?", candidate).length > 0) return false;
				sql.exec("INSERT INTO door_starts (id) VALUES (?)", candidate);
				return true;
			});
			if (fresh) start = candidate;
		}
		return start;
	});
	const saveBinding = (b: Binding) =>
		sql.exec("UPDATE door_bindings SET value=? WHERE id=?", encodeBinding(b), b.id);
	const savedBinding = Effect.fnUntraced(function* (id: string) {
		return yield* store.atomic(() => {
			const [row] = sql.exec("SELECT value FROM door_bindings WHERE id=?", id);
			if (row === undefined) return null;
			const decoded = decodeBinding(row.value);
			if (Result.isFailure(decoded)) throw new LedgerError({why: "bad_row"});
			return decoded.success;
		});
	});
	const grant = Effect.fnUntraced(function* (input: unknown) {
		const decoded = Schema.decodeUnknownResult(
			Schema.Struct({text: Schema.String, armored: Schema.String}),
		)(input);
		if (Result.isFailure(decoded)) return GrantReply.cases.refused.make({why: "bad_signature"});
		const {text, armored} = decoded.success;
		const change = Schema.decodeUnknownResult(Schema.fromJsonString(Change))(text);
		if (Result.isFailure(change)) return GrantReply.cases.refused.make({why: "bad_signature"});
		const c = change.success;
		const value = Change.match(c, {
			granted: ({grant}) => grant,
			revoked: ({revoke}) => revoke,
			added: ({add}) => add,
		});
		if (value.to !== options.name) return GrantReply.cases.refused.make({why: "wrong_ledger"});
		const members =
			(yield* silent(readMembers())) ??
			foldMembers([
				MemberFact.cases.founded.make({
					id: options.founder.person,
					name: options.founder.name,
					keys: options.founder.keys,
					window: options.founder.window,
				}),
			]);
		const signers = [...members.keys.keys()].filter(
			(key) => Schema.is(KeyLine)(key) || Schema.is(PasskeyLine)(key),
		);
		let verified: typeof Checked.Type | null = null;
		for (const signer of signers) {
			const rp = passkeyRp(signer);
			const checked = yield* silent(
				verifySshsig({
					text,
					armored,
					space: "fabrika-client",
					signers: [signer],
					...(Option.isNone(rp) ? {} : {policy: {rp: rp.value, origins: options.origins}}),
				}),
			);
			if (checked._tag !== "refused") {
				verified = checked;
				break;
			}
		}
		if (verified === null) return GrantReply.cases.refused.make({why: "bad_signature"});
		const checked = verified;
		const signer = checked.signer;
		const signerFingerprint = yield* silent(fingerprint(signer, true));
		const cached = yield* store.atomic(() => store.get(`change/${value.id}`, Receipt));
		if (cached !== null)
			return cached.text === text && cached.armored === armored
				? cached.reply
				: GrantReply.cases.refused.make({why: "id_reused"});
		let enrollmentChecked: typeof Enrolled.Type | null = null;
		if (c._tag === "added" && c.add.adds._tag === "person") {
			const added = c.add.adds;
			if (!Schema.is(KeyLine)(added.key) && !Schema.is(PasskeyLine)(added.key))
				return GrantReply.cases.refused.make({why: "bad_enrollment"});
			if (added.passkey !== undefined && !Schema.is(PasskeyLine)(added.key))
				return GrantReply.cases.refused.make({why: "bad_enrollment"});
			if (Schema.is(PasskeyLine)(added.key)) {
				const pass = added.passkey;
				const issued = yield* store.atomic(() => store.get(`enrollment/${c.add.id}`, Enrolled));
				if (
					pass === undefined ||
					issued === null ||
					issued.used ||
					pass.nonce !== issued.nonce ||
					JSON.stringify(issued.binding) !==
						JSON.stringify(
							Enrollment.make({
								id: c.add.id,
								to: c.add.to,
								for: c.add.for,
								key: added.key,
								window: added.window,
							}),
						)
				)
					return GrantReply.cases.refused.make({why: "bad_enrollment"});
				const proof = yield* silent(
					verifySshsig({
						text: enrollmentText({...issued.binding, nonce: issued.nonce}),
						armored: pass.proof,
						space: "fabrika-client",
						signers: [added.key],
						policy: {rp: pass.rp, origins: options.origins},
					}),
				);
				if (
					proof._tag !== "passkey" ||
					proof.origin !== pass.origin ||
					proof.be !== pass.be ||
					proof.bs !== pass.bs
				)
					return GrantReply.cases.refused.make({why: "bad_enrollment"});
				enrollmentChecked = issued;
			}
		}
		const applyGrant = Effect.fn("door.grant")(function* () {
			const prior = yield* store.atomic(() => store.get(`change/${value.id}`, Receipt));
			if (prior !== null)
				return prior.text === text && prior.armored === armored
					? prior.reply
					: GrantReply.cases.refused.make({why: "id_reused"});
			if (value.for !== members.person) return GrantReply.cases.refused.make({why: "not_member"});
			if (enrollmentChecked !== null) {
				const issued = yield* store.atomic(() => store.get(`enrollment/${value.id}`, Enrolled));
				if (issued === null || issued.used || issued.nonce !== enrollmentChecked.nonce)
					return GrantReply.cases.refused.make({why: "bad_enrollment"});
			}
			const signed = {
				text,
				armored,
				signer,
				...(checked._tag === "passkey"
					? {
							passkey: {
								origin: checked.origin,
								rp: checked.rp,
								be: checked.be,
								bs: checked.bs,
								counter: checked.counter,
							},
						}
					: {}),
			};
			const fact = Change.match(c, {
				granted: ({grant}) => MemberFact.cases.granted.make({grant, signed}),
				revoked: ({revoke}) => MemberFact.cases.revoked.make({revoke, signed}),
				added: ({add}) => MemberFact.cases.added.make({add, signed}),
			});
			const currentFrom = yield* fromHere({
				by: signerFingerprint,
				for: value.for,
				seen: 0,
				parent: null,
				build: options.build,
			});
			const pending = yield* store.atomic(() => {
				const prior = store.get(`changePending/${value.id}`, ChangePending);
				if (prior !== null) return prior.text === text && prior.armored === armored ? prior : null;
				const next = {text, armored, from: currentFrom};
				store.set(`changePending/${value.id}`, ChangePending, next);
				return next;
			});
			if (pending === null) return GrantReply.cases.refused.make({why: "id_reused"});
			const reply = yield* clients.write(fact, pending.from);
			if (reply._tag === "refused") return GrantReply.cases.refused.make({why: reply.why});
			yield* store.atomic(() => {
				store.set(`change/${value.id}`, Receipt, {text, armored, reply});
				if (
					c._tag === "added" &&
					c.add.adds._tag === "person" &&
					c.add.adds.passkey !== undefined
				) {
					const old = store.get(`enrollment/${value.id}`, Enrolled);
					if (old !== null) store.set(`enrollment/${value.id}`, Enrolled, {...old, used: true});
				}
			});
			return reply;
		}, write);
		return yield* applyGrant().pipe(
			Effect.flatMap((reply) =>
				Effect.gen(function* () {
					if (reply._tag === "applied") {
						const latest = yield* clients.members;
						const at = yield* clock;
						const pending = yield* store.atomic(() => {
							const live = waiting(at);
							const accepted = live.rows.filter((r) => !("why" in admitted(latest, r.key)));
							store.set(
								"waiting",
								Waiting,
								Waiting.make({...live, rows: live.rows.filter((r) => !accepted.includes(r))}),
							);
							return accepted;
						});
						for (const row of pending)
							for (const client of row.clients) {
								const nonce = yield* challenge(ConnectionId.make(client));
								yield* notify(client, {method: "client.granted", params: {nonce}});
							}
						const connections = yield* store.atomic(() =>
							sql.exec("SELECT name FROM door_state WHERE name LIKE 'key/%'"),
						);
						for (const connection of connections) {
							const name = String(connection.name),
								client = name.slice(4);
							const key = yield* store.atomic(() => store.get(name, Schema.String));
							if (key !== null && "why" in admitted(latest, key))
								yield* notify(client, {close: 4003});
						}
					}
					yield* flush;
					return reply;
				}),
			),
		);
	});
	const denyFrom = Effect.fn("door.deny")(function* (by: Writer) {
		return yield* fromHere({
			by: by.key,
			for: by.for,
			seen: 0,
			parent: null,
			build: options.build,
		});
	});
	const deny = Effect.fnUntraced(function* (client: ConnectionId, input: unknown) {
		const checked = yield* silent(Effect.result(online(client)));
		if (Result.isFailure(checked)) return GrantReply.cases.refused.make({why: "not_granted"});
		if (checked.success.by._tag !== "person")
			return GrantReply.cases.refused.make({why: "person_only"});
		const params = Schema.decodeUnknownResult(Schema.Struct({key: Schema.String, saw: Saw}))(input);
		if (Result.isFailure(params) || reserved(input))
			return GrantReply.cases.refused.make({why: "bad_input"});
		const {key, saw} = params.success;
		const from = yield* denyFrom(checked.success.by);
		return yield* clients
			.write(MemberFact.cases.denied.make({id: random(), key, saw, by: from.by}), from)
			.pipe(write);
	});
	const route = Effect.fnUntraced(function* (
		client: ConnectionId,
		method: string,
		params: unknown,
		reader = String(client),
	) {
		const checked = yield* silent(Effect.result(online(client)));
		if (Result.isFailure(checked)) return no("not_granted");
		const {by, raw} = checked.success;
		let refusal: string | null = methods.has(method) ? null : "unknown_method";
		if (reserved(params)) refusal ??= "reserved";
		if ((method === "ledger.read" || method === "ledger.wait") && !Schema.is(Read)(params))
			refusal ??= "bad_input";
		if (method === "spans.read" && !Schema.is(SpanRead)(params)) refusal ??= "bad_input";
		if (method === "spans.content" && !Schema.is(SpanContent)(params)) refusal ??= "bad_input";
		if (
			method === "spans.deleteContent" &&
			(by._tag !== "person" || !Schema.is(DeleteContent)(params))
		)
			refusal ??= "not_allowed";
		const request = method === "process.send" ? Schema.decodeUnknownResult(Send)(params) : null;
		const decoded =
			request !== null && Result.isSuccess(request)
				? Schema.decodeUnknownResult(options.inputs.schema)(request.success.m)
				: null;
		const message = decoded !== null && Result.isSuccess(decoded) ? decoded.success : null;
		const name =
			message === null ? undefined : (options.inputs.name?.(message) ?? rawObject(message)?._tag);
		if (
			method === "process.send" &&
			(request === null ||
				Result.isFailure(request) ||
				decoded === null ||
				Result.isFailure(decoded) ||
				typeof name !== "string" ||
				reserved(request.success.m))
		)
			refusal ??= "bad_input";
		const target = request !== null && Result.isSuccess(request) ? request.success.pid : "door";
		const policy =
			target !== "door" && options.policy !== undefined
				? yield* options.policy(target)
				: {inputs: options.inputs.personOnly, events: options.facts.personOnly};
		if (
			request !== null &&
			Result.isSuccess(request) &&
			request.success.traceId !== undefined &&
			by._tag === "agent"
		) {
			const traceId = request.success.traceId;
			const delivered = yield* store.atomic(
				() =>
					sql.exec(
						"SELECT 1 FROM door_bindings WHERE json_extract(value, '$.process')=? AND json_extract(value, '$.span.traceId')=? AND json_extract(value, '$.state._tag') IN ('delivered','retryable','settled') LIMIT 1",
						target,
						traceId,
					).length > 0,
			);
			if (!delivered) refusal ??= "bad_trace";
		}
		const digest = yield* hash(JSON.stringify(params));
		const bodyHash = yield* hash(JSON.stringify(message));
		const process = yield* allocateStart();
		const inputId = yield* ids
			.next(InputId)
			.pipe(Effect.mapError(() => new LedgerError({why: "storage"})));
		const at = yield* clock;
		const letter =
			refusal === null && request !== null && Result.isSuccess(request)
				? `${target}/${request.success.letter}`
				: null;
		const recordInput = Effect.fn("door.input")(function* () {
			const span = yield* Effect.currentSpan;
			const destination =
				letter !== null && Option.isSome(processes) ? yield* processes.value.resolve(target) : null;
			const accepted =
				destination === null || request === null || Result.isFailure(request)
					? false
					: (yield* Stream.runCollect(ledger.read(`${destination.name}/inbox`, 0))).some(
							(entry) => entry.id === request.success.letter,
						);
			const allocation = yield* store.atomic(() => {
				const [prior] =
					letter === null ? [] : sql.exec("SELECT value FROM door_bindings WHERE letter=?", letter);
				let processId = destination?.state._tag === "live" ? destination.state.process : target;
				if (prior !== undefined) {
					const decoded = decodeBinding(prior.value);
					if (Result.isFailure(decoded)) return Result.fail(new LedgerError({why: "bad_row"}));
					const old = decoded.success;
					if (old.client !== raw || old.digest !== digest) return Result.succeed(null);
					if (
						old.state._tag === "settled" ||
						accepted ||
						destination?.state._tag !== "live" ||
						destination.state.process === old.process
					)
						return Result.succeed(old);
					// Keep the old parent and its authority unchanged. Only the pending letter gets a new delivery.
					sql.exec("UPDATE door_bindings SET letter=NULL WHERE id=?", old.id);
					processId = destination.state.process;
				}
				if (
					(letter !== null &&
						Number(
							sql.exec("SELECT count(*) n FROM door_bindings WHERE letter IS NOT NULL")[0]?.n ?? 0,
						) >= options.inputCap) ||
					!Number.isSafeInteger(count + 1)
				)
					return Result.fail(new LedgerError({why: "storage"}));
				count++;
				const binding: Binding = {
					id: inputId,
					door: process,
					n: count,
					...(request !== null && Result.isSuccess(request)
						? {letter: request.success.letter, seen: request.success.seen}
						: {}),
					hash: bodyHash,
					client: raw,
					by,
					process: processId,
					name: typeof name === "string" ? name : method,
					personOnly: typeof name === "string" && policy.inputs.includes(name),
					digest,
					arrivedAt: at,
					span: {traceId: span.traceId, spanId: span.spanId},
					sentAt:
						request !== null && Result.isSuccess(request)
							? request.success.sentAt
							: new Date(at).toISOString(),
					state: EnvelopeState.cases.allocated.make({}),
				};
				if (letter !== null)
					sql.exec(
						"INSERT INTO door_bindings (id,letter,value) VALUES (?,?,?)",
						binding.id,
						letter,
						encodeBinding(binding),
					);
				return Result.succeed(binding);
			});
			if (Result.isFailure(allocation)) return yield* allocation.failure;
			const binding = allocation.success;
			if (binding === null) return null;
			let safe: typeof Schema.Json.Type | undefined;
			if (
				refusal === null &&
				message !== null &&
				typeof name === "string" &&
				!options.inputs.raw.includes(name)
			) {
				const encoded = Schema.encodeUnknownResult(options.inputs.log)(message);
				if (Result.isSuccess(encoded)) {
					const value = json(encoded.success);
					if (Result.isSuccess(value)) safe = value.success;
				}
			}
			const fields = {
				method,
				target,
				by,
				arrivedAt: binding.arrivedAt,
				traceId: binding.span.traceId,
				spanId: binding.span.spanId,
			};
			const fact =
				refusal === null
					? LegacyInputFact.cases.received.make({
							...fields,
							...(safe === undefined ? {} : {input: safe}),
						})
					: LegacyInputFact.cases.refused.make({...fields, why: refusal});
			const recordedFact = Schema.is(InputId)(binding.id)
				? yield* Schema.decodeUnknownEffect(InputFact)({
						...fact,
						door: binding.door,
						n: binding.n,
					}).pipe(Effect.mapError(() => new LedgerError({why: "bad_row"})))
				: fact;
			const placed = yield* appendChecked(binding.client, {
				stream: "door/inputs",
				id: binding.id,
				line: lineFor(fromInput(binding), recordedFact),
			});
			if (placed._tag === "refused") return yield* new LedgerError({why: "refused"});
			if (binding.state._tag === "allocated") {
				const recorded: Binding = {...binding, state: EnvelopeState.cases.recorded.make({})};
				if (letter !== null) yield* store.atomic(() => saveBinding(recorded));
				return recorded;
			}
			return binding;
		});
		const binding = yield* recordInput();
		yield* flush;
		if (binding === null) return no("id_reused");
		const routeInput = Effect.fn("door.route", {
			links: [{span: Tracer.externalSpan(binding.span), attributes: {}}],
		})(
			function* () {
				if (refusal !== null) return no(refusal);
				if (method === "door.watch") {
					const answer = yield* watch(client);
					return answer._tag === "refused" ? no(answer.why) : ok({rows: answer.rows});
				}
				if (method === "door.deny") {
					const answer = yield* deny(client, params);
					return answer._tag === "refused" ? no(answer.why) : ok(answer);
				}
				if (
					method === "process.send" &&
					message !== null &&
					request !== null &&
					Result.isSuccess(request)
				) {
					if (binding.state._tag === "settled") {
						return deliveryAnswer(binding.state.result);
					}
					const sessions = yield* sessionsFor(binding.process);
					yield* sessions.record({...binding, traceId: binding.span.traceId});
					yield* sessions.delivered(binding.id, binding.process);
					const delivered: Binding = {
						...binding,
						state: EnvelopeState.cases.delivered.make({}),
					};
					yield* store.atomic(() => saveBinding(delivered));
					const result = yield* Effect.exit(
						options
							.deliver(
								binding.process,
								{
									id: yield* Schema.decodeUnknownEffect(InputId)(binding.id).pipe(
										Effect.mapError(() => new LedgerError({why: "bad_row"})),
									),
									by: binding.by,
									arrivedAt: binding.arrivedAt,
									input: message,
								},
								binding.span,
								{
									id: request.success.letter,
									envelope: {
										id: yield* Schema.decodeUnknownEffect(InputId)(binding.id).pipe(
											Effect.mapError(() => new LedgerError({why: "bad_row"})),
										),
										by: binding.by,
										arrivedAt: binding.arrivedAt,
										input: message,
									},
									sentAt: binding.sentAt,
									seen: binding.seen ?? 0,
									span: binding.span,
								},
							)
							.pipe(Effect.provideContext(context)),
					);
					if (Exit.isFailure(result)) {
						yield* store.atomic(() =>
							saveBinding({...binding, state: EnvelopeState.cases.retryable.make({})}),
						);
						return yield* Effect.failCause(result.cause);
					}
					const answer = result.value ?? null;
					yield* store.atomic(() =>
						saveBinding({...binding, state: EnvelopeState.cases.settled.make({result: answer})}),
					);
					return deliveryAnswer(answer);
				}
				if (method === "view.open" && options.open !== undefined) {
					const opened = Schema.decodeUnknownResult(Schema.Struct({pid: ProcessId}))(params);
					if (Result.isFailure(opened)) return no("bad_input");
					return ok(
						yield* options
							.open(opened.success.pid, String(client))
							.pipe(Effect.provideContext(context)),
					);
				}
				if (method === "ledger.read" || method === "ledger.wait") {
					const p = Schema.decodeUnknownResult(Read)(params);
					if (Result.isFailure(p)) return no("bad_input");
					if (method === "ledger.read")
						return ok({
							entries: yield* Stream.runCollect(
								ledger.read(p.success.stream, p.success.after).pipe(Stream.take(PAGE)),
							),
						});
					const waited =
						options.wait === undefined
							? yield* ledger.wait(p.success.stream, p.success.after)
							: yield* options.wait(p.success.stream, p.success.after, reader).pipe(
									Effect.flatMap(
										Schema.decodeUnknownEffect(
											Schema.TaggedUnion({ready: {rev: Schema.Int}, parked: {}}),
										),
									),
									Effect.mapError(() => new LedgerError({why: "bad_row"})),
								);
					return waited._tag === "parked"
						? Answer.cases.parked.make(p.success)
						: ok({rev: waited.rev});
				}
				if (method === "spans.read") {
					const p = Schema.decodeUnknownResult(SpanRead)(params);
					if (Result.isFailure(p)) return no("bad_input");
					const spans = yield* Stream.runCollect(
						records.read(p.success.chain).pipe(Stream.drop(p.success.after), Stream.take(PAGE)),
					);
					return ok({spans, next: p.success.after + spans.length});
				}
				if (method === "spans.content") {
					const p = Schema.decodeUnknownResult(SpanContent)(params);
					if (Result.isFailure(p)) return no("bad_input");
					const content = yield* records.content(p.success.chain, p.success.spanId);
					return ok(Option.getOrNull(content));
				}
				if (method === "spans.deleteContent") {
					if (by._tag !== "person") return no("person_only");
					const p = Schema.decodeUnknownResult(DeleteContent)(params);
					if (Result.isFailure(p)) return no("bad_input");
					yield* records.deleteContent(p.success.chain, p.success.spanId, {
						by: by.key,
						why: p.success.why,
					});
					return ok(null);
				}
				return no("unknown_method");
			},
			Effect.tap((answer) => Effect.annotateCurrentSpan("fab.door.outcome", answer._tag)),
		);
		const routed = yield* Effect.exit(routeInput());
		yield* flush;
		return yield* Exit.isSuccess(routed)
			? Effect.succeed(routed.value)
			: Effect.failCause(routed.cause);
	});
	/** The runner may save only the exact input whose checked binding the door delivered. */
	const accept = Effect.fn("door.accept")(function* (input: Incoming) {
		const incoming = yield* Schema.decodeUnknownEffect(Incoming)(input).pipe(
			Effect.mapError(() => new LedgerError({why: "bad_row"})),
		);
		const parent = Schema.decodeUnknownResult(InputId)(incoming.envelope.id);
		if (Result.isFailure(parent)) return yield* new NotGranted({});
		const binding = yield* savedBinding(parent.success);
		if (
			binding === null ||
			binding.letter !== incoming.id ||
			!["delivered", "retryable", "settled"].includes(binding.state._tag) ||
			binding.by._tag !== incoming.envelope.by._tag ||
			binding.by.key !== incoming.envelope.by.key ||
			binding.by.for !== incoming.envelope.by.for ||
			binding.arrivedAt !== incoming.envelope.arrivedAt ||
			binding.sentAt !== incoming.sentAt ||
			binding.seen !== incoming.seen ||
			binding.span.traceId !== incoming.span.traceId ||
			binding.span.spanId !== incoming.span.spanId ||
			reserved(incoming.envelope.input)
		)
			return yield* new NotGranted({});
		// route already decoded this body; the guard checks its decoded type.
		const message = incoming.envelope.input;
		if (!Schema.is(options.inputs.schema)(message)) return yield* new LedgerError({why: "bad_row"});
		if (binding.hash !== (yield* hash(JSON.stringify(message)))) return yield* new NotGranted({});
		const destination = Option.isSome(processes)
			? yield* processes.value.resolve(binding.process)
			: null;
		if (
			Option.isSome(processes) &&
			(destination === null ||
				destination.state._tag !== "live" ||
				destination.state.process !== binding.process)
		)
			return yield* new NotGranted({});
		const stream = `${destination?.name ?? binding.process}/inbox`;
		if (brainOnly({stream, id: incoming.id, tag: "send"})) return yield* new NotGranted({});
		const m = yield* Schema.decodeUnknownEffect(Schema.Json)(message).pipe(
			Effect.mapError(() => new LedgerError({why: "bad_row"})),
		);
		return yield* appendChecked(binding.client, {
			stream,
			id: incoming.id,
			line: lineFor(
				{
					...fromInput(binding),
					seen: incoming.seen,
					parent: parent.success,
				},
				InboxFact.make({m}),
			),
		});
	});
	const append = Effect.fn("door.append")(function* (a: {
		readonly id: string;
		readonly parent: string;
		readonly process: string;
		readonly kind: string;
		readonly stream: string;
		readonly fact: unknown;
	}) {
		return yield* Effect.gen(function* () {
			if (options.isLive !== undefined && !(yield* options.isLive(a.process)))
				return yield* new SigningRefused({why: "not_delivered"});
			const sessions = yield* sessionsFor(a.process);
			const session = yield* sessions.receipt(a.id, a.parent, a.process, a.kind);
			const binding = yield* savedBinding(a.parent);
			if (binding === null) return yield* new SigningRefused({why: "not_delivered"});
			const fact = rawObject(a.fact);
			if (
				fact === null ||
				fact._tag !== a.kind ||
				a.stream.startsWith("door/") ||
				brainOnly({stream: a.stream, id: a.id, tag: a.kind})
			)
				return yield* new SigningRefused({why: "not_delivered"});
			const schema = Schema.StructWithRest(Schema.TaggedStruct(a.kind, {}), [
				Schema.Record(Schema.String, Schema.Json),
			]);
			const decoded = Schema.decodeUnknownResult(schema)(fact);
			if (Result.isFailure(decoded)) return yield* new SigningRefused({why: "not_delivered"});
			const digest = yield* hash(JSON.stringify(decoded.success));
			const at = yield* clock;
			const meta = yield* store.atomic(() => {
				const prior = store.get(`append/${a.id}`, AppendMeta);
				if (prior !== null)
					return prior.digest === digest && prior.stream === a.stream ? prior : null;
				const next = {sentAt: new Date(at).toISOString(), digest, stream: a.stream};
				store.set(`append/${a.id}`, AppendMeta, next);
				return next;
			});
			if (meta === null) return yield* new SigningRefused({why: "spent"});
			return yield* appendChecked(binding.client, {
				stream: a.stream,
				id: a.id,
				line: lineFor(
					{
						by: session.by.key,
						for: session.by.for,
						sentAt: meta.sentAt,
						seen: 0,
						parent: session.parent,
						traceId: session.traceId,
						build: options.build,
					},
					decoded.success,
				),
			});
		}).pipe(write);
	});
	return {
		target: Effect.fn("door.target")(function* (name: string, code: string) {
			const at = yield* clock;
			const rows = yield* store.atomic(() => waiting(at).rows);
			for (const row of rows)
				if (row.code === code && (yield* fingerprint(row.key, false)) === name)
					return {
						key: row.key,
						for: options.founder.person,
						to: options.name,
						code: row.code,
						label: row.label,
					};
			return null;
		}),
		connect,
		challenge,
		initialize,
		knock,
		watch,
		disconnect,
		enrollment,
		grant,
		deny,
		route,
		signer: Effect.fn("door.signer")(function* (parent: string, process: string, kind: string) {
			return yield* (yield* sessionsFor(process)).signer(parent, process, kind);
		}),
		sign: Effect.fn("door.sign")(function* (
			process: string,
			id: string,
			parent: string,
			kind: string,
		) {
			if (options.isLive !== undefined && !(yield* options.isLive(process)))
				return yield* new SigningRefused({why: "not_delivered"});
			return yield* (yield* sessionsFor(process))
				.signer(parent, process, kind)
				.pipe(Effect.provideService(SignRequest, {id}));
		}),
		retire: sessions.end,
		checkDelivery: Effect.fn("door.checkDelivery")(function* (process: string, input: Incoming) {
			const binding = yield* savedBinding(input.envelope.id);
			if (binding === null || binding.letter !== input.id || binding.process !== process)
				return yield* new SigningRefused({why: "not_delivered"});
			const by = yield* membership(binding.client);
			if (
				!["delivered", "retryable", "settled"].includes(binding.state._tag) ||
				JSON.stringify(by) !== JSON.stringify(binding.by) ||
				JSON.stringify(by) !== JSON.stringify(input.envelope.by) ||
				binding.arrivedAt !== input.envelope.arrivedAt ||
				binding.sentAt !== input.sentAt ||
				(binding.seen ?? 0) !== input.seen ||
				binding.span.traceId !== input.span.traceId ||
				binding.span.spanId !== input.span.spanId ||
				binding.hash === undefined ||
				binding.hash !== (yield* hash(JSON.stringify(input.envelope.input)))
			)
				return yield* new SigningRefused({why: "not_delivered"});
		}),
		append,
		accept,
	};
});

export class Door extends Context.Service<Door, Effect.Success<ReturnType<typeof make>>>()(
	"@kampus/libfabrika/Door",
) {
	static readonly layer = <A, RNext, RDeliver, RNotify>(
		options: Options<A, RNext, RDeliver, RNotify>,
	) => Layer.effect(Door, make(options));
}

const HelloFact = Schema.TaggedStruct("initialized", {
	...Hello.fields,
	url: Schema.String,
	nonce: Schema.String,
	version: Schema.Int,
	location: Schema.String,
	build: Schema.String,
});
const random = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(24)));
const fingerprint = Effect.fnUntraced(function* (value: string, line: boolean) {
	const bytes = line ? Base64.decode(value.split(/\s+/)[1] ?? "") : Base64Url.decode(value);
	if (Result.isFailure(bytes)) return yield* new NotGranted({});
	const body = new Uint8Array(bytes.success);
	const fail = () => new LedgerError({why: "crypto"});
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes only through a Promise
	const work = Effect.tryPromise({try: () => crypto.subtle.digest("SHA-256", body), catch: fail});
	const digest = yield* work;
	return `SHA256:${Base64.encode(new Uint8Array(digest)).replace(/=+$/, "")}`;
});
const hash = Effect.fnUntraced(function* (text: string) {
	const bytes = new TextEncoder().encode(text);
	const fail = () => new LedgerError({why: "crypto"});
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes only through a Promise
	const work = Effect.tryPromise({try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail});
	const digest = yield* work;
	return Base64Url.encode(new Uint8Array(digest));
});
