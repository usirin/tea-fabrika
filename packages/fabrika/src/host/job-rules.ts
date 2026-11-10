import {apply, diff, type Json} from "../program/json-patch.ts";
import {CONTENT} from "./otlp.ts";
import type {Db, SqlRow} from "./rules.ts";
import type {Content, Job, JobCall, Opened, RecordRead, Span, Step} from "./traces.ts";
import {writerOf} from "./writer.ts";

// A job's record, as SQL: the tables and every call on them. The Durable Object (./job-record.ts)
// runs these on its own SQLite; nothing here knows workerd.
//
//   job     one row: what was started, by whom, on which host, and how it ended
//   state   the runs' `Storage`, as a key-value table: each run's record and machine states
//   steps   one row per Msg a machine folded: the Msg, its Cmds, and the state after it, as a
//           JSON Patch (RFC 6902) of the one before, or whole once the patches since the last
//           whole one would outweigh it (or after `keyframe` of them)
//   spans   one row per span of the job's trace, from any host
//   opened  one row per span a run's work hangs under, written as it opens: a span reaches
//           `spans` only once it ends, and a child run started meanwhile must nest under it
//   content one row per span that carried an agent's content (its Langfuse input and output),
//           taken off the span as it is kept (docs/direction/an-agent-run-keeps-its-content.md)
//
//   keepSpans(db, [{span: "7f2c…", name: "execute_tool Read", tags: {"langfuse.observation.output": "…"}}], by)
//   // spans    {span: "7f2c…", name: "execute_tool Read", tags: {}}
//   // content  {span: "7f2c…", input: null, output: "…"}
//   callJob(db, heads, {op: "deleteContent", span: "7f2c…", why: "a key in .env was read"}, "user:owner", now, k)
//   // content  {span: "7f2c…", deleted: {by: "user:owner", at: now, why: "a key in .env was read"}}
//
// Nothing else is ever deleted. A key the storage removes keeps its row with no value, and a span
// sent twice (an exporter's retry) is kept once. Content is the one exception, and only a person
// deletes it: its row stays, and says who, when and why. `beats`, `summary` and `logs` come with
// their writers (./README.md says when).

/**
 * At most this many patches after a whole state, by default (experiment 166). The bytes rule in
 * `step` below most often comes first.
 */
export const KEYFRAME = 100;

export const migrateJob = (db: Db) => {
	// `ended_by` and `why`: who asked the job to stop, and why. Both null: it ended on its own, or
	// the record was made before they were kept, so who is not known.
	db.all(`CREATE TABLE IF NOT EXISTS job (
		one INTEGER PRIMARY KEY CHECK (one = 1),
		n INTEGER NOT NULL, text TEXT NOT NULL, host TEXT NOT NULL, by TEXT NOT NULL,
		started REAL NOT NULL, how TEXT, ended REAL, ended_by TEXT, why TEXT)`);
	// A record made before tracker 185 has neither column: added once, its row kept with nulls.
	const columns = new Set(db.all(`PRAGMA table_info(job)`).map((c) => String(c.name)));
	for (const column of ["ended_by", "why"])
		if (!columns.has(column)) db.all(`ALTER TABLE job ADD COLUMN ${column} TEXT`);
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
	db.all(`CREATE TABLE IF NOT EXISTS opened (
		run TEXT NOT NULL, span TEXT NOT NULL, at REAL NOT NULL, by TEXT NOT NULL,
		PRIMARY KEY (run, span))`);
	// A row is kept (`deleted_by` null) or deleted (all three set, and no input or output left).
	db.all(`CREATE TABLE IF NOT EXISTS content (
		span TEXT PRIMARY KEY, input TEXT, output TEXT, by TEXT NOT NULL,
		deleted_by TEXT, deleted_at REAL, why TEXT,
		CHECK ((deleted_by IS NULL AND deleted_at IS NULL AND why IS NULL)
			OR (deleted_by IS NOT NULL AND deleted_at IS NOT NULL AND why IS NOT NULL
				AND input IS NULL AND output IS NULL)))`);
};

/** Every table of a record, by name: what a law reads to look at every row. */
export const TABLES = ["job", "state", "steps", "spans", "opened", "content"] as const;

const text = (row: SqlRow | undefined, key: string): string | null => {
	const v = row?.[key];
	return typeof v === "string" ? v : null;
};

const num = (row: SqlRow | undefined, key: string): number => Number(row?.[key] ?? 0);

/**
 * One machine run's newest state, kept in memory beside the record so a patch needs no read.
 * `since`: how many patches follow its last whole state. `chain`: their bytes, all told.
 */
export type Heads = Map<
	string,
	{readonly n: number; readonly state: Json; readonly since: number; readonly chain: number}
>;

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
	if (last === undefined) return null;
	const patches = rows.filter((r) => r.kind === "patch");
	const chain = patches.reduce((sum, r) => sum + String(r.body).length, 0);
	return {n: last.n, state: last.state as Json, since: patches.length, chain};
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

/** A content tag's text: what the span carried on that side, or `null`. */
const sideOf = (tags: Span["tags"], key: string): string | null => {
	const v = tags[key];
	return v === undefined ? null : String(v);
};

/** A span's tags without its content, and its content, if it carried any. Pure. */
const splitContent = (tags: Span["tags"]) => {
	const rest = Object.fromEntries(
		Object.entries(tags).filter(([key]) => key !== CONTENT.input && key !== CONTENT.output),
	);
	const input = sideOf(tags, CONTENT.input);
	const output = sideOf(tags, CONTENT.output);
	return {rest, content: input === null && output === null ? null : {input, output}};
};

/**
 * Keep each span once, by its id: a span sent again is the same span. Its content goes to
 * `content`, also once: a span sent again after its content was deleted stays deleted.
 */
export const keepSpans = (db: Db, spans: readonly Omit<Span, "by">[], by: string) =>
	db.tx(() => {
		for (const s of spans) {
			const {rest, content} = splitContent(s.tags);
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
				JSON.stringify(rest),
				JSON.stringify(s.events),
				by,
			);
			if (content !== null)
				db.all(
					`INSERT OR IGNORE INTO content (span, input, output, by) VALUES (?, ?, ?, ?)`,
					s.span,
					content.input,
					content.output,
					by,
				);
		}
		return {kept: spans.length};
	});

const contentOf = (db: Db): Content[] =>
	db.all(`SELECT * FROM content ORDER BY span`).map((r) => {
		const by = text(r, "deleted_by");
		return by === null
			? {span: String(r.span), input: text(r, "input"), output: text(r, "output")}
			: {span: String(r.span), deleted: {by, at: num(r, "deleted_at"), why: String(r.why)}};
	});

/** Who may delete content: a person, as the door stamped them. */
const isPerson = (by: string) => writerOf(by)?.kind === "user";

/**
 * The writer a call names, if its sender may name them: the sender itself, or, from a person, an
 * agent working for that person, as a host's records name the agent whose line a job is. Anyone
 * else, or none: the sender, as the door stamped it. So a call only ever narrows who wrote it.
 *
 *   named("user:github:7", "agent:claude for:github:7")   // "agent:claude for:github:7"
 *   named("user:github:7", "user:github:8")               // "user:github:7"
 *   named("agent:claude for:github:7", "user:github:7")   // "agent:claude for:github:7"
 */
const named = (by: string, claimed: string | undefined): string => {
	if (claimed === undefined || claimed === by) return by;
	const sender = writerOf(by);
	const writer = writerOf(claimed);
	return sender?.kind === "user" && writer !== null && "for" in writer && writer.for === sender.id
		? claimed
		: by;
};

/**
 * One call, as one transaction. `by`: who the door said sent it. `now`: the record's clock.
 * `keyframe`: at most this many steps of one machine run from one whole state to the next.
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
			case "keys":
				return {
					keys: db.all(`SELECT key FROM state WHERE value IS NOT NULL`).map((r) => String(r.key)),
				};
			case "step": {
				const key = headKey(call.run, call.machine, call.id);
				const head = heads.get(key) ?? headOf(db, call.run, call.machine, call.id);
				const n = (head?.n ?? 0) + 1;
				const state = plain(call.state);
				const whole = JSON.stringify(state);
				const patch =
					head === null || head.since + 1 >= keyframe
						? null
						: JSON.stringify(diff(head.state, state));
				// Mercurial's revlog rule: once the patches since the last whole state would hold more
				// than one whole state, write a whole one. Reading any step back then costs at most
				// two whole states' bytes, however big the state and however much each step changes.
				const fits = patch !== null && head !== null && head.chain + patch.length < whole.length;
				const [kind, body] = fits ? ["patch", patch] : ["full", whole];
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
				heads.set(
					key,
					kind === "patch" && head !== null
						? {n, state, since: head.since + 1, chain: head.chain + body.length}
						: {n, state, since: 0, chain: 0},
				);
				return {n};
			}
			case "began":
				db.all(
					`INSERT OR IGNORE INTO job (one, n, text, host, by, started) VALUES (1, ?, ?, ?, ?, ?)`,
					call.n,
					call.text,
					call.host,
					named(by, call.by),
					call.at,
				);
				return null;
			case "ended":
				db.all(
					`UPDATE job SET how = ?, ended = ?, ended_by = ?, why = ? WHERE how IS NULL`,
					call.how,
					call.at,
					call.stop === undefined ? null : named(by, call.stop.by),
					call.stop?.why ?? null,
				);
				return null;
			case "opened":
				db.all(
					`INSERT OR IGNORE INTO opened (run, span, at, by) VALUES (?, ?, ?, ?)`,
					call.run,
					call.span,
					call.at,
					by,
				);
				return null;
			case "spanOf": {
				// The newest: a run taken over by another host opened a span of its own there.
				const r = db.all(
					`SELECT span FROM opened WHERE run = ? ORDER BY at DESC, rowid DESC LIMIT 1`,
					call.run,
				)[0];
				return {span: text(r, "span")};
			}
			case "read":
				return {
					job: jobOf(db),
					runs: runsOf(db),
					spans: spansOf(db),
					steps: stepsOf(db.all(`SELECT * FROM steps ORDER BY run, machine, id, n`)),
					opened: openedOf(db),
					content: contentOf(db),
				} satisfies RecordRead;
			case "deleteContent":
				if (!isPerson(by)) return {error: `only a person deletes content, and ${by} is not one`};
				// A span that carried none gets the row too: what a person deleted, and why, is kept.
				db.all(
					`INSERT INTO content (span, input, output, by, deleted_by, deleted_at, why)
					 VALUES (?, NULL, NULL, ?, ?, ?, ?)
					 ON CONFLICT (span) DO UPDATE SET input = NULL, output = NULL,
						deleted_by = excluded.deleted_by, deleted_at = excluded.deleted_at, why = excluded.why`,
					call.span,
					by,
					by,
					now,
					call.why,
				);
				return null;
		}
	});

const openedOf = (db: Db): Opened[] =>
	db.all(`SELECT * FROM opened ORDER BY at, rowid`).map((r) => ({
		run: String(r.run),
		span: String(r.span),
		at: num(r, "at"),
		by: String(r.by),
	}));

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
