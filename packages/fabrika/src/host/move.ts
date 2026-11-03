// Moving a project: a laptop ledger's shared work, copied into a new shared ledger, every row
// keeping who wrote it and when (docs/direction/the-ledger-goes-to-cloudflare.md, section 6).
// Stop, copy in `pos` order, check by hash, switch.
//
//   planOf(rows, "github:7")        on the laptop: each row's writer mapped, or the move stops
//   importChunk(db, ...)            on the server: one chunk, in one transaction, idempotent
//   sealMove(db, ...)               on the server: its own hash of what it holds must match
//
// The server's half is a window on the door, with three states, kept on the ledger itself and
// never as a flag in memory:
//
//   fresh       founded, and nothing else: no invite, no row outside `door/`
//   importing   the founder sent a chunk, and nothing else came in since
//   open        an invite, an ordinary write, or the seal came. Nothing moves it back.
//
// Only the founder imports, as a person, while the ledger is `fresh` or `importing`. The import is
// the one way a row's writer comes from a request, and even here the request names no writer: it
// says `founder` or `agent <x>`, and the door writes `user:<founder>` or `agent:<x> for:<founder>`.
// Nobody else's name can be put on a row this way.
//
// workerd runs this file in the ledger's Worker (bundled with durable-object.ts); Node runs it in
// the tests and on the laptop side of the move. Web crypto only.
import {Option, Schema} from "effect";
import {isAgentName, isDoorStream, isPersonKind, MEMBERS, type Stamp, stampText} from "./door.ts";
import {
	type Db,
	importEvent,
	LEDGER_KINDS,
	readStream,
	type SqlRow,
	type Written,
	writeUnguarded,
} from "./rules.ts";

// ---------------------------------------------------------------- the wire

/**
 * Who wrote a moved row, as the import says it: the founder, or one of the founder's agents. The
 * door turns this into the writer (`writerFor`); there is no way to say anyone else.
 */
export const By = Schema.Union([
	Schema.Struct({kind: Schema.Literal("founder")}),
	Schema.Struct({
		kind: Schema.Literal("agent"),
		id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/)),
	}),
]);
export type By = typeof By.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One moved event: its place on the old ledger (`from`), and the row as it was there. */
export const Moved = Schema.Struct({
	from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	stream: Schema.String.check(Schema.isPattern(/^\S{1,512}$/)),
	rev: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	kind: Schema.String.check(Schema.isPattern(/^\S{1,128}$/)),
	at: Count,
	/** JSON text, as the old ledger kept it. */
	data: Schema.String.check(Schema.isMaxLength(2_000_000)),
	id: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\S{1,256}$/))),
	by: By,
});
export type Moved = typeof Moved.Type;

/** The most events one chunk carries. */
export const MAX_CHUNK = 500;

export const Chunk = Schema.Struct({
	events: Schema.Array(Moved).check(Schema.isMaxLength(MAX_CHUNK)),
});

/** A SHA-256, in hex. */
const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

/** The seal: how many events the move sent, and its hash of them. */
export const Seal = Schema.Struct({count: Count, hash: Hash});
export type Seal = typeof Seal.Type;

/** The import window's state, as the door keeps it on the ledger. */
export const MoveState = Schema.Union([
	Schema.Struct({kind: Schema.Literal("fresh")}),
	Schema.Struct({kind: Schema.Literal("importing")}),
	Schema.Struct({
		kind: Schema.Literal("open"),
		by: Schema.Literals(["invite", "write", "seal"]),
		/** The seal's hash, when the seal opened it. */
		hash: Schema.NullOr(Hash),
	}),
]);
export type MoveState = typeof MoveState.Type;

/** Where a move stands: the state, the last old `pos` that landed, and how many events did. */
export const Progress = Schema.Struct({state: MoveState, last: Count, count: Count});
export type Progress = typeof Progress.Type;

// ---------------------------------------------------------------- writers, both sides

/** The writer text a moved row gets on the new ledger: the door's, from `By`. */
export const writerFor = (by: By, founder: string): string =>
	stampText(
		by.kind === "founder" ? {kind: "user", id: founder} : {kind: "agent", id: by.id, for: founder},
	);

/**
 * Who an old row's writer was, as the move maps it, or null when it cannot: then the move stops
 * with its name, and never guesses.
 *
 *   user:owner                    the founder: the one person at a laptop
 *   user:<founder>                the founder
 *   agent:<x>                     the founder's agent: before the door, agents worked for them
 *   agent:<x> for:<founder>       the founder's agent
 *   anything else                 null: another person, the ledger's own words, a host's holder
 */
export const byOf = (writer: string, founder: string): By | null => {
	if (writer === "user:owner" || writer === `user:${founder}`) return {kind: "founder"};
	const m = /^agent:(\S+?)(?: for:(\S+))?$/.exec(writer);
	const id = m?.[1];
	if (id === undefined || !isAgentName(id)) return null;
	return m?.[2] === undefined || m[2] === founder ? {kind: "agent", id} : null;
};

// ---------------------------------------------------------------- the hash, both sides

/** One moved event, as both sides hash it: its row on the new ledger, less its new `pos`. */
export type Line = {
	readonly stream: string;
	readonly rev: number;
	readonly writer: string;
	readonly kind: string;
	readonly at: number;
	readonly data: string;
	readonly id: string | null;
};

export const lineOf = (e: Line): string =>
	JSON.stringify([e.stream, e.rev, e.writer, e.kind, e.at, e.data, e.id]);

/** SHA-256 over every line in order, one line each, as hex. */
export const hashLines = async (lines: readonly Line[]): Promise<string> => {
	const text = lines.map((l) => `${lineOf(l)}\n`).join("");
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

// ---------------------------------------------------------------- the plan, on the laptop

/** What the move will do with one writer: how many events it wrote, and what they become. */
export type Mapped = {readonly from: string; readonly to: string; readonly events: number};

/** The move, planned from the old ledger's rows, before anything is sent. */
export type Plan = {
	readonly founder: string;
	/** Every event to move, in the old `pos` order. */
	readonly events: readonly Moved[];
	readonly streams: number;
	readonly writers: readonly Mapped[];
	/** Writers the move cannot map, each once, oldest first. Any one stops the move. */
	readonly unmappable: readonly string[];
	/** Rows the door would refuse, in words: a ledger's own word, an agent's answer. */
	readonly refused: readonly string[];
};

const s = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

/** The plan for `rows`, the old ledger's events under the moved prefixes, in `pos` order. */
export const planOf = (rows: readonly SqlRow[], founder: string): Plan => {
	const events: Moved[] = [];
	const streams = new Set<string>();
	const writers = new Map<string, {to: string; events: number}>();
	const unmappable: string[] = [];
	const refused: string[] = [];
	for (const r of rows) {
		const writer = s(r.writer);
		const by = byOf(writer, founder);
		if (by === null) {
			if (!unmappable.includes(writer)) unmappable.push(writer);
			continue;
		}
		const kind = s(r.kind);
		const where = `${s(r.stream)} rev ${n(r.rev)}`;
		if (by.kind === "agent" && isPersonKind(kind))
			refused.push(`${where}: ${kind} by agent ${by.id}, and only a person writes it`);
		if (kind !== "registered" && LEDGER_KINDS.includes(kind))
			refused.push(`${where}: ${kind} is the ledger's own word`);
		const to = writerFor(by, founder);
		const w = writers.get(writer) ?? {to, events: 0};
		writers.set(writer, {to, events: w.events + 1});
		streams.add(s(r.stream));
		events.push({
			from: n(r.pos),
			stream: s(r.stream),
			rev: n(r.rev),
			kind,
			at: n(r.at),
			data: s(r.data),
			id: r.id === null || r.id === undefined ? null : s(r.id),
			by,
		});
	}
	return {
		founder,
		events,
		streams: streams.size,
		writers: [...writers].map(([from, w]) => ({from, to: w.to, events: w.events})),
		unmappable,
		refused,
	};
};

/** The lines a plan's events become on the new ledger: what the seal's hash is over. */
export const linesOf = (plan: Plan): Line[] =>
	plan.events.map((e) => ({...e, writer: writerFor(e.by, plan.founder)}));

// ---------------------------------------------------------------- the window, on the server

/** The import's own stream: the seal, once. Written only by the door. */
export const MOVE = "door/move";

const MIGRATION = [
	// Each moved event: its `pos` on the old ledger, and where it landed here.
	`CREATE TABLE IF NOT EXISTS door_imported (
		source INTEGER PRIMARY KEY,
		pos INTEGER NOT NULL UNIQUE
	)`,
];

/** The import's table, made once. The ledger's object calls it as it starts. */
export const migrateMove = (db: Db): void =>
	db.tx(() => {
		for (const stmt of MIGRATION) db.all(stmt);
	});

const OUTSIDE_DOOR = "stream != 'door' AND substr(stream, 1, 5) != 'door/'";

const progressOf = (db: Db): {last: number; count: number} => {
	const r = db.all(
		"SELECT coalesce(max(source), 0) AS last, count(*) AS count FROM door_imported",
	)[0];
	return {last: n(r?.last), count: n(r?.count)};
};

/**
 * The window's state, read from the ledger each time:
 *
 *   a `sealed` fact in `door/move`                     open, by the seal
 *   any fact in `door/members` but the one `founded`   open, by an invite
 *   a row outside `door/` the import did not write     open, by an ordinary write
 *   an imported row                                    importing
 *   none of these                                      fresh
 *
 * Every one of these is a row that is never taken back, so nothing moves the state back.
 */
export const moveStateOf = (db: Db): MoveState => {
	const sealed = readStream(db, MOVE).find((r) => r.kind === "sealed");
	if (sealed !== undefined) {
		const hash = Option.getOrNull(readSealed(s(sealed.data)));
		return {kind: "open", by: "seal", hash: hash?.hash ?? null};
	}
	if (readStream(db, MEMBERS).some((r) => r.kind !== "founded"))
		return {kind: "open", by: "invite", hash: null};
	const {count} = progressOf(db);
	const outside = n(db.all(`SELECT count(*) AS c FROM events WHERE ${OUTSIDE_DOOR}`)[0]?.c);
	if (outside > count) return {kind: "open", by: "write", hash: null};
	return count > 0 ? {kind: "importing"} : {kind: "fresh"};
};

const readSealed = Schema.decodeUnknownOption(Schema.fromJsonString(Seal));
// A key the wire does not have is refused, not dropped: a chunk that names a writer is a client
// that thinks it may, and the door says no to it, as `eventOf` does for an ordinary write.
const decodeChunk = Schema.decodeUnknownOption(Chunk, {onExcessProperty: "error"});
const decodeSeal = Schema.decodeUnknownOption(Seal, {onExcessProperty: "error"});

/** Where the move stands. Any credential may ask. */
export const moveProgress = (db: Db): Progress => ({state: moveStateOf(db), ...progressOf(db)});

type Refused = {readonly ok: false; readonly status: number; readonly why: string};
type Answer<T> = {readonly ok: true; readonly value: T} | Refused;
const refuse = (status: number, why: string): Refused => ({ok: false, status, why});

/** Only the founder, as a person, and only while the window is not open. */
const mayImport = (db: Db, founder: string | null, who: Stamp): Refused | null => {
	if (founder === null) return refuse(404, "only a shared ledger takes an import");
	if (who.kind !== "user" || who.id !== founder)
		return refuse(403, "only the ledger's founder imports, as a person");
	const state = moveStateOf(db);
	return state.kind === "open"
		? refuse(409, `the import window is closed: the ledger opened by ${state.by}`)
		: null;
};

// No parameter property here: Node runs this file by stripping its types, and cannot strip one.
class Stop extends Error {
	readonly refused: Refused;
	constructor(refused: Refused) {
		super(refused.why);
		this.refused = refused;
	}
}

/**
 * One chunk of moved events, in one transaction: all of it lands, or none. An event whose old
 * `pos` landed already is passed over, so a chunk sent again lands once. Events come in rising
 * `from` order, after the last that landed.
 */
export const importChunk = (
	db: Db,
	founder: string | null,
	who: Stamp,
	body: unknown,
): Answer<{readonly progress: Progress; readonly written: readonly Written[]}> => {
	const chunk = decodeChunk(body);
	if (Option.isNone(chunk)) return refuse(400, "not a chunk of moved events");
	// oxlint-disable-next-line fabrika/no-raw-try-catch -- a throw inside `db.tx` is how SQLite and the Durable Object roll the whole chunk back; it is caught right here and never leaves this function.
	try {
		return db.tx(() => {
			const no = mayImport(db, founder, who);
			if (no !== null) throw new Stop(no);
			const f = founder ?? "";
			const written: Written[] = [];
			let {last} = progressOf(db);
			let before = 0;
			for (const e of chunk.value.events) {
				if (e.from <= before) throw new Stop(refuse(400, "a chunk's events rise by their pos"));
				before = e.from;
				if (e.from <= last) {
					const landed = db.all("SELECT 1 FROM door_imported WHERE source = ?", e.from)[0];
					if (landed === undefined)
						throw new Stop(refuse(409, `pos ${e.from} comes after pos ${last}, which landed`));
					continue;
				}
				if (isDoorStream(e.stream)) throw new Stop(refuse(403, "only the door writes under door/"));
				if (e.by.kind === "agent" && isPersonKind(e.kind))
					throw new Stop(refuse(403, `only a person writes ${e.kind}`));
				if (!isJson(e.data)) throw new Stop(refuse(400, `pos ${e.from}: its data is not JSON`));
				const res = importEvent(db, {
					stream: e.stream,
					rev: e.rev,
					writer: writerFor(e.by, f),
					kind: e.kind,
					at: e.at,
					data: e.data,
					id: e.id,
				});
				if (!res.ok) throw new Stop(refuse(409, `pos ${e.from}: ${res.why}`));
				db.all("INSERT INTO door_imported (source, pos) VALUES (?, ?)", e.from, res.pos);
				written.push({stream: e.stream, rev: e.rev, pos: res.pos});
				last = e.from;
			}
			return {ok: true as const, value: {progress: moveProgress(db), written}};
		});
	} catch (e) {
		if (e instanceof Stop) return e.refused;
		throw e;
	}
};

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const isJson = (text: string): boolean => Option.isSome(decodeJson(text));

/** What landed, in the old `pos` order, as both sides hash it. */
const landed = (db: Db): Line[] =>
	db
		.all(
			"SELECT e.stream, e.rev, e.writer, e.kind, e.at, e.data, e.id FROM door_imported i JOIN events e ON e.pos = i.pos ORDER BY i.source",
		)
		.map((r) => ({
			stream: s(r.stream),
			rev: n(r.rev),
			writer: s(r.writer),
			kind: s(r.kind),
			at: n(r.at),
			data: s(r.data),
			id: r.id === null ? null : s(r.id),
		}));

/**
 * The seal: the server hashes what it holds, and only a match opens the ledger. A mismatch leaves
 * it `importing`, so the move can run again. A seal sent again with the same hash, once sealed,
 * answers as the first did.
 */
export const sealMove = async (
	db: Db,
	founder: string | null,
	who: Stamp,
	body: unknown,
	now: number,
): Promise<Answer<{readonly progress: Progress; readonly written: readonly Written[]}>> => {
	const seal = decodeSeal(body);
	if (Option.isNone(seal)) return refuse(400, "a seal is {count, hash}");
	const want = seal.value;
	const state = moveStateOf(db);
	if (
		state.kind === "open" &&
		state.by === "seal" &&
		state.hash === want.hash &&
		who.kind === "user" &&
		who.id === founder
	)
		return {ok: true, value: {progress: moveProgress(db), written: []}};
	const no = mayImport(db, founder, who);
	if (no !== null) return no;
	const before = progressOf(db);
	const hash = await hashLines(landed(db));
	// The hash took a turn of the event loop: anything that came in meanwhile is checked again here.
	return db.tx(() => {
		const again = mayImport(db, founder, who);
		if (again !== null) return again;
		const after = progressOf(db);
		if (after.count !== before.count || after.last !== before.last)
			return refuse(409, "the import moved while the seal was checked: seal again");
		if (after.count !== want.count || hash !== want.hash)
			return refuse(
				409,
				`the seal does not match: this ledger holds ${after.count} moved events, hash ${hash}`,
			);
		const res = writeUnguarded(db, now, MOVE, "any", {
			kind: "sealed",
			writer: stampText(who),
			data: want,
		});
		const written: Written[] = res.ok ? [{stream: MOVE, rev: res.rev, pos: res.pos}] : [];
		return {ok: true as const, value: {progress: moveProgress(db), written}};
	});
};
