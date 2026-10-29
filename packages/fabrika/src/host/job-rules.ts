import {apply, diff, type Json} from "../program/json-patch.ts";
import type {Db, SqlRow} from "./rules.ts";
import type {JobCall, Job, RecordRead, Span, Step} from "./traces.ts";

// A job's record, as SQL: the tables and every call on them. The Durable Object (./job-record.ts)
// runs these on its own SQLite; nothing here knows workerd.
//
//   job     one row: what was started, by whom, on which host, and how it ended
//   state   the runs' `Storage`, as a key-value table: each run's record and machine states
//   steps   one row per Msg a machine folded: the Msg, its Cmds, and the state after it, whole
//           every `keyframe` steps and as a JSON Patch (RFC 6902) of the one before in between
//   spans   one row per span of the job's trace, from any host
//
// Nothing is ever deleted. A key the storage removes keeps its row with no value, and a span sent
// twice (an exporter's retry) is kept once. `beats`, `summary` and `logs` come with their writers
// (./README.md says when).

/** A whole state every this many steps, and a patch in between, by default (experiment 166). */
export const KEYFRAME = 20;

export const migrateJob = (db: Db) => {
	db.all(`CREATE TABLE IF NOT EXISTS job (
		one INTEGER PRIMARY KEY CHECK (one = 1),
		n INTEGER NOT NULL, text TEXT NOT NULL, host TEXT NOT NULL, by TEXT NOT NULL,
		started REAL NOT NULL, how TEXT, ended REAL)`);
	db.all(`CREATE TABLE IF NOT EXISTS state (
		key TEXT PRIMARY KEY, value TEXT, by TEXT NOT NULL, at REAL NOT NULL)`);
	db.all(`CREATE TABLE IF NOT EXISTS steps (
		run TEXT NOT NULL, machine TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL,
		at REAL NOT NULL, msg TEXT NOT NULL, cmds TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('full', 'patch')), body TEXT NOT NULL, by TEXT NOT NULL,
		PRIMARY KEY (run, machine, id, n))`);
	db.all(`CREATE TABLE IF NOT EXISTS spans (
		span TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, service TEXT NOT NULL,
		start REAL NOT NULL, end REAL NOT NULL, status TEXT NOT NULL,
		tags TEXT NOT NULL, events TEXT NOT NULL, by TEXT NOT NULL)`);
};

/** Every table of a record, by name: what a law reads to look at every row. */
export const TABLES = ["job", "state", "steps", "spans"] as const;

const text = (row: SqlRow | undefined, key: string): string | null => {
	const v = row?.[key];
	return typeof v === "string" ? v : null;
};
const num = (row: SqlRow | undefined, key: string): number => Number(row?.[key] ?? 0);

/** One machine run's newest state, kept in memory beside the record so a patch needs no read. */
export type Heads = Map<string, {readonly n: number; readonly state: Json}>;
const headKey = (run: string, machine: string, id: string) => JSON.stringify([run, machine, id]);

/** A JSON value as JSON reads it back: what a patch is made from. */
const plain = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null)) as Json;

/** Every step of one machine run, its states whole, in order. */
const stepsOf = (rows: readonly SqlRow[]): Step[] => {
	const out: Step[] = [];
	const now = new Map<string, Json>();
	for (const r of rows) {
		const key = headKey(String(r.run), String(r.machine), String(r.id));
		const body = JSON.parse(String(r.body)) as unknown;
		const state = r.kind === "full" ? (body as Json) : apply(now.get(key) ?? null, body as never);
		now.set(key, state);
		out.push({
			run: String(r.run),
			machine: String(r.machine),
			id: String(r.id),
			n: num(r, "n"),
			at: num(r, "at"),
			msg: JSON.parse(String(r.msg)),
			state,
			cmds: JSON.parse(String(r.cmds)) as unknown[],
			by: String(r.by),
		});
	}
	return out;
};

/** The newest state of one machine run, from its last whole state and the patches after it. */
const headOf = (db: Db, run: string, machine: string, id: string) => {
	const from = db.all(
		`SELECT n FROM steps WHERE run = ? AND machine = ? AND id = ? AND kind = 'full' ORDER BY n DESC LIMIT 1`,
		run,
		machine,
		id,
	)[0];
	if (from === undefined) return null;
	const rows = db.all(
		`SELECT * FROM steps WHERE run = ? AND machine = ? AND id = ? AND n >= ? ORDER BY n`,
		run,
		machine,
		id,
		num(from, "n"),
	);
	const last = stepsOf(rows).at(-1);
	return last === undefined ? null : {n: last.n, state: last.state as Json};
};

/** The runs the `state` table holds a record for: its keys are `run/<run>/record/<slot>`. */
const runsOf = (db: Db): string[] =>
	db
		.all(`SELECT key FROM state WHERE key LIKE 'run/%/record/%' AND value IS NOT NULL ORDER BY key`)
		.map((r) => /^run\/([^/]+)\/record\/[ab]$/.exec(String(r.key))?.[1])
		.filter((r): r is string => r !== undefined)
		.map(decodeURIComponent)
		.filter((r, i, all) => all.indexOf(r) === i);

const jobOf = (db: Db): Job | null => {
	const r = db.all(`SELECT * FROM job`)[0];
	if (r === undefined) return null;
	const how = text(r, "how");
	return {
		n: num(r, "n"),
		text: String(r.text),
		by: String(r.by),
		host: String(r.host),
		started: num(r, "started"),
		ended: how === null ? null : {how: how as "done", at: num(r, "ended")},
	};
};

const spansOf = (db: Db): Span[] =>
	db.all(`SELECT * FROM spans ORDER BY start, span`).map((r) => ({
		span: String(r.span),
		parent: text(r, "parent"),
		name: String(r.name),
		service: String(r.service),
		start: num(r, "start"),
		end: num(r, "end"),
		status: String(r.status) as Span["status"],
		tags: JSON.parse(String(r.tags)) as Span["tags"],
		events: JSON.parse(String(r.events)) as Span["events"],
		by: String(r.by),
	}));

/** Keep each span once, by its id: a span sent again is the same span. */
export const keepSpans = (db: Db, spans: readonly Omit<Span, "by">[], by: string) =>
	db.tx(() => {
		for (const s of spans)
			db.all(
				`INSERT OR IGNORE INTO spans (span, parent, name, service, start, end, status, tags, events, by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				s.span,
				s.parent,
				s.name,
				s.service,
				s.start,
				s.end,
				s.status,
				JSON.stringify(s.tags),
				JSON.stringify(s.events),
				by,
			);
		return {kept: spans.length};
	});

/**
 * One call, as one transaction. `by`: who the door said sent it. `now`: the record's clock.
 * `keyframe`: a whole state every this many steps of one machine run.
 */
export const callJob = (
	db: Db,
	heads: Heads,
	call: JobCall,
	by: string,
	now: number,
	keyframe: number,
): unknown =>
	db.tx((): unknown => {
		switch (call.op) {
			case "get": {
				const r = db.all(`SELECT value FROM state WHERE key = ?`, call.key)[0];
				return {value: text(r, "value")};
			}
			case "set":
				db.all(
					`INSERT INTO state (key, value, by, at) VALUES (?, ?, ?, ?)
					 ON CONFLICT (key) DO UPDATE SET value = excluded.value, by = excluded.by, at = excluded.at`,
					call.key,
					call.value,
					by,
					now,
				);
				return null;
			case "remove":
				// Kept with no value: the record deletes nothing.
				db.all(`UPDATE state SET value = NULL, by = ?, at = ? WHERE key = ?`, by, now, call.key);
				return null;
			case "size":
				return {
					size: num(db.all(`SELECT count(*) AS c FROM state WHERE value IS NOT NULL`)[0], "c"),
				};
			case "step": {
				const key = headKey(call.run, call.machine, call.id);
				const head = heads.get(key) ?? headOf(db, call.run, call.machine, call.id);
				const n = (head?.n ?? 0) + 1;
				const state = plain(call.state);
				const whole = JSON.stringify(state);
				const patch =
					head === null || (n - 1) % keyframe === 0
						? null
						: JSON.stringify(diff(head.state, state));
				// A patch no smaller than the state itself is not worth its undoing.
				const [kind, body] =
					patch !== null && patch.length < whole.length ? ["patch", patch] : ["full", whole];
				db.all(
					`INSERT INTO steps (run, machine, id, n, at, msg, cmds, kind, body, by)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					call.run,
					call.machine,
					call.id,
					n,
					call.at,
					JSON.stringify(call.msg ?? null),
					JSON.stringify(call.cmds),
					kind,
					body,
					by,
				);
				heads.set(key, {n, state});
				return {n};
			}
			case "began":
				db.all(
					`INSERT OR IGNORE INTO job (one, n, text, host, by, started) VALUES (1, ?, ?, ?, ?, ?)`,
					call.n,
					call.text,
					call.host,
					by,
					call.at,
				);
				return null;
			case "ended":
				db.all(`UPDATE job SET how = ?, ended = ? WHERE how IS NULL`, call.how, call.at);
				return null;
			case "read":
				return {
					job: jobOf(db),
					runs: runsOf(db),
					spans: spansOf(db),
					steps: stepsOf(db.all(`SELECT * FROM steps ORDER BY run, machine, id, n`)),
				} satisfies RecordRead;
		}
	});

/** How many bytes the steps table holds, whole and as patches: what experiment 166 measures. */
export const stepBytes = (db: Db) =>
	db
		.all(
			`SELECT kind, count(*) AS rows, sum(length(body)) AS body, sum(length(msg) + length(cmds)) AS rest FROM steps GROUP BY kind`,
		)
		.map((r) => ({
			kind: String(r.kind),
			rows: num(r, "rows"),
			body: num(r, "body"),
			rest: num(r, "rest"),
		}));
