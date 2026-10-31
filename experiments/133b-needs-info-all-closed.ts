// Experiment 133b: every closed kamp-us/phoenix ticket that ever carried `status:needs-info`.
//
// 133 part B read 15 of them and asked whether triage needs a seventh answer, "ask the filer for
// more". This reads the rest by hand: the other 36 of 133's 51, and 18 filed from #7852 on that
// 133's count never reached, 54 in all (`133b-truth.json`, `needsInfo`). It also holds a blind
// re-read of 133's 15 (`recheck`). Then it sorts the 54 the way 133 sorted its 15, two runs each,
// and reads 133's saved answers for the 15, so the tables cover all 69.
//
// The sort is today's, as in 133: the brief and Check in packages/pipeline/src/stages/sort/brief.ts,
// the answer in answer.ts, the Agent SDK options in sorter.ts, up to two tries, sonnet at the SDK's
// default effort. Each ticket is read as it was filed, with the 200 issues filed just before it and
// no plans. The sort code below is copied from 133's script, not imported: that script runs when
// imported, and other experiments were working near it at the same time. PHOENIX_NOTE and the
// window are 133's, word for word.
//
// Run with
//   node experiments/133b-needs-info-all-closed.ts
//
//   STEP=fetch   the 54 tickets' first revisions and the issue list, through `gh` (read-only).
//                Writes only CACHE
//   STEP=sort    RUNS (default 2), ONLY=<n,n>, DRY=1 prints the estimate, PROMPT=1 prints the
//                first prompt, MAX_USD (default 5)
//   STEP=field   print one field/runs.jsonl row per answer
//   (no STEP)    print the tables. WHY=1 adds the sorter's why on every answer
//
// CACHE (default `runs/exp-133b-cache`) holds ticket text and is never committed.
// `results/133b-needs-info-all-closed.json` holds each answer, its cost and time.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, as the other replay scripts do.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {nextTry} from "@kampus/pipeline/combos";
import {type Said, SortReply, saidOf} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import {sorterOptions} from "@kampus/pipeline/stages/sort/sorter";
import {Option, Schema} from "effect";
import {median, pct} from "./lib/sort-bar.ts";
import {firstVersion, SONNET_IN, SONNET_OUT, Ticket} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-133b-cache");
const STEP = process.env.STEP ?? "tables";
const RESULTS = join(here, "results", "133b-needs-info-all-closed.json");
const OLD_RESULTS = join(here, "results", "133-triage-folds-and-needs-info.json");
const RUNS = Number(process.env.RUNS ?? 2);
const TRIES = 2;
const only = process.env.ONLY?.split(",").map(Number);

const REPO = "kamp-us/phoenix";
/** phoenix has over 7,000 issues: as in 92b and 133, sort sees the 200 filed just before the ticket. */
const WINDOW = 200;

/** What phoenix is, as experiment 92b put it. */
const PHOENIX_NOTE = [
	"The repo is kamp-us/phoenix, a pnpm monorepo:",
	"- kamp.us: a Turkish-first community site (a link board and a dictionary), one Cloudflare Worker that serves the web app and its backend.",
	"- fabrika: the agent work pipeline, a Claude Code plugin of skills plus fabrika-cli, its command-line tool. Its home is this repo; other repos use it.",
	"- Tuval: a desktop app for running and watching coding agents.",
	"- Smaller packages: a design system, and guards and scripts the CI runs.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");

// ---------------------------------------------------------------- the truth

/**
 * What the label waited on, by 133's own wording: the filer, the code (or the GitHub API), an
 * owner's ruling on a real question, or an owner's permission only, where triage already knew its
 * answer and a rule kept it from acting.
 */
const WHO = ["filer", "code", "owner_ruling", "owner_permission", "other"] as const;
type Who = (typeof WHO)[number];
/** Where the fact the park turned on sat. `none`: nothing beyond the ticket's text and a home. */
const FROM = ["issues", "code", "owner", "filer", "none"] as const;
const END = ["built", "no_answer", "no", "duplicate", "ruled"] as const;
type End = (typeof END)[number];
const TO = ["filer", "owner", "anyone"] as const;

const Label = {
	end: Schema.Literals(END),
	to: Schema.Literals(TO),
	answered: Schema.Boolean,
	who: Schema.Literals(WHO),
	from: Schema.Literals(FROM),
	changed: Schema.Boolean,
	of: Schema.optional(Schema.Array(Schema.Int)),
	why: Schema.String,
};
const NeedsInfo = Schema.Struct({...Label, asked: Schema.String});
const Recheck = Schema.Struct({
	...Label,
	/** What the blind reader said, before 133's labels were opened. */
	blind: Schema.Struct({
		end: Schema.Literals(["built", "no_answer", "no", "duplicate"]),
		who: Schema.Literals(WHO),
		changed: Schema.Boolean,
	}),
});
const TruthFile = Schema.Struct({
	note: Schema.String,
	/** Filed from #7852 on: the closed tickets 133's count never reached. */
	late: Schema.Array(Schema.Int),
	needsInfo: Schema.Record(Schema.String, NeedsInfo),
	recheckNote: Schema.String,
	recheck: Schema.Record(Schema.String, Recheck),
});
const truth = Schema.decodeUnknownSync(TruthFile)(
	JSON.parse(readFileSync(join(here, "133b-truth.json"), "utf8")),
);
/** 133's own labels for its 15, to set the re-read against. */
const Old = Schema.Struct({
	needsInfo: Schema.Record(
		Schema.String,
		Schema.Struct({
			end: Schema.String,
			who: Schema.String,
			changed: Schema.Boolean,
		}),
	),
});
const old = Schema.decodeUnknownSync(Old)(
	JSON.parse(readFileSync(join(here, "133-truth.json"), "utf8")),
);

const NEW = Object.keys(truth.needsInfo).map(Number);
const OLD = Object.keys(truth.recheck).map(Number);
const LATE = new Set(truth.late);

/** One ticket's label, whichever reading it came from. */
type Row = {
	n: number;
	group: "133" | "rest" | "late";
	end: End;
	to: (typeof TO)[number];
	answered: boolean;
	who: Who;
	from: (typeof FROM)[number];
	changed: boolean;
	of: readonly number[];
	why: string;
};
const rows: Row[] = [
	...OLD.map((n) => {
		const t = truth.recheck[n] as typeof Recheck.Type;
		return {...t, n, group: "133" as const, of: t.of ?? []};
	}),
	...NEW.map((n) => {
		const t = truth.needsInfo[n] as typeof NeedsInfo.Type;
		return {...t, n, group: LATE.has(n) ? ("late" as const) : ("rest" as const), of: t.of ?? []};
	}),
];
const rowOf = new Map(rows.map((r) => [r.n, r]));

// ---------------------------------------------------------------- the cache

const Listed = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
});
type Listed = typeof Listed.Type;
const Cache = Schema.Struct({tickets: Schema.Array(Ticket), all: Schema.Array(Listed)});
type Cache = typeof Cache.Type;
const cacheFile = join(CACHE, "b.json");

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

/** Every issue of the repo with when it opened and closed. Titles are as they stand today. */
async function listAll(repo: string): Promise<Listed[]> {
	const raw = JSON.parse(
		await gh([
			"issue",
			"list",
			"-R",
			repo,
			"--state",
			"all",
			"--limit",
			"20000",
			"--json",
			"number,title,createdAt,closedAt",
		]),
	) as {number: number; title: string; createdAt: string; closedAt: string | null}[];
	return raw.map((i) => ({
		n: i.number,
		title: i.title,
		createdAt: i.createdAt,
		closedAt: i.closedAt === "" || i.closedAt?.startsWith("0001") ? null : i.closedAt,
	}));
}

/** Open at `t`: filed before it and not yet closed. */
const openAt = (i: Listed, t: string) => i.createdAt < t && (i.closedAt === null || i.closedAt > t);

/** The 200 issues filed just before `t`, newest first. Pure. */
const windowOf = (cache: Cache, t: {n: number; createdAt: string}) =>
	cache.all
		.filter((i) => i.n !== t.n && i.createdAt < t.createdAt)
		.toSorted((x, y) => y.createdAt.localeCompare(x.createdAt))
		.slice(0, WINDOW);

/** What the sorter is handed for one ticket, as the world stood when it was filed. Pure. */
function briefOf(cache: Cache, t: Ticket): Brief {
	return {
		ticket: {
			url: `https://github.com/${REPO}/issues/${t.n}`,
			number: t.n,
			state: "open",
			title: t.title,
			body: t.body,
		},
		context: {
			earlier: windowOf(cache, t).map((i) => ({
				number: i.n,
				title: i.title,
				state: openAt(i, t.createdAt) ? ("open" as const) : ("closed" as const),
				reason: null,
			})),
			plans: [],
		},
		note: PHOENIX_NOTE,
	};
}

// ---------------------------------------------------------------- one sort

const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
type Try = typeof Try.Type;
/** One sort: every try, the last one the answer. */
const Run = Schema.Struct({tries: Schema.Array(Try)});
type Run = typeof Run.Type;
const readReply = reader(SortReply);

/** One call through the Agent SDK with the pipeline sorter's own options, and no effort set. */
async function callOnce(prompt: string, cwd: string): Promise<Omit<Try, "problems">> {
	const started = Date.now();
	const {effort: _, ...options} = sorterOptions(
		{model: "sonnet", effort: "high", budget: 0.5, note: ""},
		cwd,
	);
	for await (const message of query({
		prompt,
		options: {...options, outputFormat: {type: "json_schema", schema: jsonSchema(SortReply)}},
	})) {
		if (message.type === "result") {
			const u = message.usage;
			const tokens =
				u.input_tokens +
				u.output_tokens +
				(u.cache_creation_input_tokens ?? 0) +
				(u.cache_read_input_tokens ?? 0);
			const answer =
				message.subtype === "success" ? readReply(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens,
			};
		}
	}
	throw new Error("no result");
}

/** One sort as the machine runs it: a try, the Check, and one more try told the problems. */
async function sortOnce(brief: Brief, cwd: string): Promise<Run> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const got = await callOnce(promptFor(brief, note), cwd);
		const problems = got.answer === null ? [] : sortProblems(got.answer, brief);
		tries.push({...got, problems: [...problems]});
		if (got.answer === null) break;
		const next = nextTry(problems, i, TRIES);
		if (next.go !== "again") break;
		note = next.note;
	}
	return {tries};
}

const lastOf = (r: Run) => r.tries.at(-1);
const sortOf = (r: Run) => lastOf(r)?.answer?.sort;
const usdOf = (r: Run) => r.tries.reduce((s, t) => s + t.usd, 0);
const msOf = (r: Run) => r.tries.reduce((s, t) => s + t.ms, 0);
const saidOfRun = (r: Run): Said | null => {
	const a = sortOf(r);
	return a === undefined ? null : saidOf(a);
};
const passed = (r: Run) => {
	const last = lastOf(r);
	return last !== undefined && last.answer !== null && last.problems.length === 0;
};

// ---------------------------------------------------------------- results

const Pool = Schema.Record(Schema.String, Schema.Array(Run));
type Pool = Record<string, Run[]>;
const Saved = Schema.Struct({model: Schema.String, b: Pool});
type Saved = {model: string; b: Pool};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {model: "sonnet", b: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);
/** 133's saved answers for its 15. */
const oldPool: Pool = existsSync(OLD_RESULTS)
	? (Schema.decodeUnknownSync(Schema.Struct({b: Pool}))(
			JSON.parse(readFileSync(OLD_RESULTS, "utf8")),
		).b as Pool)
	: {};

const loadCache = (): Cache => {
	if (!existsSync(cacheFile)) {
		console.error(`no ${cacheFile}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(cacheFile, "utf8")));
};

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const all = await listAll(REPO);
	const tickets: Ticket[] = [];
	for (const n of NEW) tickets.push(await firstVersion(n, REPO));
	writeFileSync(cacheFile, JSON.stringify({tickets, all}, null, "\t"));
	console.log(`${REPO}: ${tickets.length} tickets, ${all.length} issues`);
	process.exit(0);
}

// ---------------------------------------------------------------- sort

if (STEP === "sort") {
	const cache = loadCache();
	const pool = saved.b;
	const todo = cache.tickets
		.filter((t) => only === undefined || only.includes(t.n))
		.flatMap((t) => Array.from({length: Math.max(0, RUNS - (pool[t.n]?.length ?? 0))}, () => t));
	const chars = todo.reduce((s, t) => s + promptFor(briefOf(cache, t), null).length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 400 * SONNET_OUT;
	console.log(
		`${todo.length} calls, ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price, before the cache and before second tries`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined)
		console.log(promptFor(briefOf(cache, todo[0]), null));
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 5);
	const cwd = mkdtempSync(join(tmpdir(), "exp-133b-"));
	let spent = 0;
	for (const t of todo) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}`);
			break;
		}
		const r = await sortOnce(briefOf(cache, t), cwd);
		spent += usdOf(r);
		pool[t.n] = [...(pool[t.n] ?? []), r];
		save();
		console.log(
			`#${t.n} ${word(r)}${lastOf(r)?.answer === null ? ` ${lastOf(r)?.error}` : ""} (${r.tries.length} tr${r.tries.length === 1 ? "y" : "ies"}${passed(r) ? "" : ", Check not passed"}, $${usdOf(r).toFixed(3)}, ${(msOf(r) / 1000).toFixed(1)} s)`,
		);
	}
	console.log(`spent $${spent.toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- reading an answer

/** An answer in a few words: what it said, and its rule or target. Pure. */
function word(run: Run): string {
	const a = sortOf(run);
	if (a === undefined) return "none";
	if (a.answer === "duplicate") return `duplicate #${a.of}`;
	if (a.answer === "no") return `no:${a.rule}`;
	if (a.next === "plan") return a.partOf === null ? "plan" : `fold #${a.partOf}`;
	return a.next;
}

/**
 * Did the answer reach the ticket's real end? A built ticket wants plan (or fold), a ruled one a
 * ruling, a no a no (or a duplicate of the ticket that covered it), a duplicate a duplicate of a
 * ticket the record names (any duplicate when it names none) or a no by `carried`. An answer that
 * asks an owner for a ruling also counts when the label really waited on one: 133 counted #4934 so.
 */
function fits(row: Row, run: Run): boolean {
	const a = sortOf(run);
	if (a === undefined) return false;
	if (a.answer === "yes" && a.next === "ruling" && row.who === "owner_ruling") return true;
	const dupOfRecord =
		a.answer === "duplicate" && (row.of.length === 0 || row.of.includes(a.of) === true);
	switch (row.end) {
		case "built":
			return a.answer === "yes" && a.next === "plan";
		case "ruled":
			return a.answer === "yes" && a.next === "ruling";
		case "no":
		case "no_answer":
			return a.answer === "no" || (a.answer === "duplicate" && row.of.includes(a.of));
		case "duplicate":
			return dupOfRecord || (a.answer === "no" && a.rule === "carried");
	}
}

/** The runs of a ticket: this experiment's for the 54, 133's saved ones for its 15. */
const runsOf = (n: number): readonly Run[] => (OLD.includes(n) ? oldPool[n] : saved.b[n]) ?? [];

/** An answer by its outcome's name, as the sort stage prints it. */
const OUTCOME: Record<Said, string> = {
	duplicate: "done:closed:duplicate",
	no: "done:closed:no",
	plan: "send:plan:yes",
	fold: "send:plan:fold",
	research: "send:research:yes",
	ruling: "ask:owner:ruling",
};

// ---------------------------------------------------------------- field rows

if (STEP === "field") {
	for (const n of NEW) {
		const r = rowOf.get(n) as Row;
		for (const [i, run] of (saved.b[n] ?? []).entries()) {
			const tokens = run.tries.reduce((s, t) => s + t.tokens, 0);
			const said = saidOfRun(run);
			console.log(
				JSON.stringify({
					date: "2026-10-24",
					lane: `${REPO}#${n}`,
					role: "triager",
					model: "sonnet",
					effort: null,
					outcome: said === null ? "stopped" : "pass",
					why: `experiment 133b: today's sort brief and Check on the first title and body, no tools (run ${i + 1}, ${run.tries.length} tries); said ${word(run)}, really needs-info waiting on ${r.who}, ended ${r.end}; posted nothing`,
					tokens,
					tools: null,
					minutes: +(msOf(run) / 60000).toFixed(2),
					note: "2026-10-24-04",
					driver_caused: false,
					costUsd: +usdOf(run).toFixed(4),
					billed: tokens,
					replay: true,
					name: said === null ? null : OUTCOME[said],
				}),
			);
		}
	}
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

const count = <T>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;
const GROUPS = [
	["133", "133's 15"],
	["rest", "the other 36 of 133's 51"],
	["late", "the 18 filed from #7852 on"],
] as const;

console.log(
	`${rows.length} closed needs-info tickets: ${GROUPS.map(([g, name]) => `${count(rows, (r) => r.group === g)} ${name}`).join(", ")}\n`,
);

// 1. What each label waited on, all 69.
console.log("what the label waited on (tickets / the fact changed the end / someone answered):");
for (const who of WHO) {
	const rs = rows.filter((r) => r.who === who);
	if (rs.length === 0) continue;
	const by = GROUPS.map(([g]) => count(rs, (r) => r.group === g)).join(" + ");
	console.log(
		`  ${who}: ${rs.length} (${by}) / ${count(rs, (r) => r.changed)} / ${count(rs, (r) => r.answered)}`,
	);
}

// 2. The facts that changed the end: where they sat.
const changed = rows.filter((r) => r.changed);
console.log(`\na fact changed the end on ${changed.length} of ${rows.length}:`);
for (const from of FROM) {
	const rs = changed.filter((r) => r.from === from);
	if (rs.length > 0)
		console.log(
			`  it sat in ${from}: ${rs.length} (${rs.map((r) => `#${r.n} ${r.who}`).join(", ")})`,
		);
}

// 3. Where the fact the park turned on sat, every ticket.
console.log("\nwhere the fact the park turned on sat, every ticket:");
for (const from of FROM) {
	const rs = rows.filter((r) => r.from === from);
	if (rs.length > 0)
		console.log(
			`  ${from}: ${rs.length} (${GROUPS.map(([g]) => count(rs, (r) => r.group === g)).join(" + ")})`,
		);
}

// 4. Every ask put to the filer.
const toFiler = rows.filter((r) => r.to === "filer");
console.log(
	`\nasked of the filer: ${toFiler.length} of ${rows.length}, answered ${count(toFiler, (r) => r.answered)}:`,
);
for (const r of toFiler)
	console.log(`  #${r.n} ${r.who}, from ${r.from}${r.answered ? ", answered" : ""}: ${r.why}`);

// 5. Every ticket only the filer could unblock.
const filerOnly = rows.filter((r) => r.who === "filer" || r.from === "filer");
console.log(`\nonly the filer held the fact: ${filerOnly.length}`);
for (const r of filerOnly)
	console.log(`  #${r.n} ended ${r.end}${r.changed ? ", it changed the end" : ""}: ${r.why}`);

// 6. The blind re-read of 133's 15.
const pairs = OLD.map((n) => {
	const t = truth.recheck[n] as typeof Recheck.Type;
	return {n, blind: t.blind, was: old.needsInfo[n], now: t};
});
const agree = (k: "end" | "who" | "changed") =>
	count(pairs, (p) => p.was !== undefined && p.blind[k] === p.was[k]);
const settled = (k: "end" | "who" | "changed") =>
	count(pairs, (p) => p.was !== undefined && p.now[k] === p.was[k]);
const allThree = (
	a: (typeof pairs)[number]["blind"],
	b: {end: string; who: string; changed: boolean},
) => a.end === b.end && a.who === b.who && a.changed === b.changed;
console.log(`\nthe blind re-read of 133's ${OLD.length}:`);
console.log(
	`  blind against 133: end ${agree("end")}, who ${agree("who")}, changed ${agree("changed")}; all three ${count(pairs, (p) => p.was !== undefined && allThree(p.blind, p.was))}`,
);
console.log(
	`  after the disputes were read again, against 133: end ${settled("end")}, who ${settled("who")}, changed ${settled("changed")}; all three ${count(pairs, (p) => p.was !== undefined && allThree(p.now, p.was))}`,
);
console.log(
	`  blind against the labels after the disputes: end ${count(pairs, (p) => p.blind.end === p.now.end)}, who ${count(pairs, (p) => p.blind.who === p.now.who)}, changed ${count(pairs, (p) => p.blind.changed === p.now.changed)}; all three ${count(pairs, (p) => allThree(p.blind, p.now))}`,
);
for (const p of pairs) {
	if (p.was === undefined || allThree(p.blind, p.was)) continue;
	const show = (x: {end: string; who: string; changed: boolean}) =>
		`${x.end}/${x.who}/${x.changed ? "changed" : "same"}`;
	console.log(
		`  #${p.n} 133 ${show(p.was)}, blind ${show(p.blind)}, now ${show(p.now)}: ${p.now.why}`,
	);
}

// 7. The sort.
const sorted = NEW.flatMap((n) => runsOf(n).map((run) => ({n, run})));
if (sorted.length > 0) {
	const usd = sorted.reduce((s, {run}) => s + usdOf(run), 0);
	const tokens = sorted.reduce((s, {run}) => s + run.tries.reduce((t, x) => t + x.tokens, 0), 0);
	console.log(
		`\nsort on the ${NEW.length}: model ${saved.model}; ${sorted.length} sorts, ${sorted.reduce((s, {run}) => s + run.tries.length, 0)} calls, $${usd.toFixed(2)}, ${tokens} tokens; median ${(median(sorted.map(({run}) => msOf(run))) / 1000).toFixed(1)} s a sort; Check passed ${pct(
			count(sorted, ({run}) => passed(run)),
			sorted.length,
		)}`,
	);
	const same = count(NEW, (n) => {
		const ws = runsOf(n).map(word);
		return ws.length > 1 && ws.every((w) => w === ws[0]);
	});
	console.log(`  same answer every run: ${same} of ${NEW.length} tickets`);
}

/** Answers on a set of tickets: how many reached the real end, by run and by ticket. */
function fitLine(ns: readonly number[], name: string) {
	const rs = ns.flatMap((n) => runsOf(n).map((run) => ({row: rowOf.get(n) as Row, run})));
	if (rs.length === 0) return;
	const both = count(ns, (n) => {
		const runs = runsOf(n);
		return runs.length > 0 && runs.every((run) => fits(rowOf.get(n) as Row, run));
	});
	console.log(
		`  ${name}: ${count(rs, ({row, run}) => fits(row, run))} of ${rs.length} answers, ${both} of ${ns.length} tickets every run`,
	);
}
console.log("\nsort reached the real end:");
fitLine(OLD, "133's 15, 133's answers");
fitLine(
	NEW.filter((n) => !LATE.has(n)),
	"the other 36",
);
fitLine(truth.late, "the late 18");
fitLine([...OLD, ...NEW], "all 69");
console.log("  by how it ended (answers that fit / answers; what it said):");
for (const end of END) {
	const ns = rows.filter((r) => r.end === end).map((r) => r.n);
	const rs = ns.flatMap((n) => runsOf(n).map((run) => ({row: rowOf.get(n) as Row, run})));
	const said = new Map<string, number>();
	for (const {run} of rs) {
		const w = word(run).replace(/ #\d+$/, "");
		said.set(w, (said.get(w) ?? 0) + 1);
	}
	console.log(
		`    ${end}: ${ns.length} tickets, ${count(rs, ({row, run}) => fits(row, run))} / ${rs.length}; ${[...said].map(([w, c]) => `${w} ${c}`).join(", ")}`,
	);
}

// 8. The misses, and whether the ticket it needed was in the brief.
const cache = existsSync(cacheFile) ? loadCache() : null;
/** Was `target` among the 200 issues in `n`'s brief? 133's 15 are found by their filing time. */
const inBrief = (n: number, target: number) => {
	const at = cache?.all.find((x) => x.n === n)?.createdAt;
	if (cache === null || at === undefined) return null;
	return windowOf(cache, {n, createdAt: at}).some((i) => i.n === target);
};

console.log(
	"\nby what the label waited on (answers that fit / answers, tickets every run; answers that said ruling):",
);
for (const who of WHO) {
	const ws = rows.filter((r) => r.who === who);
	const rs = ws.flatMap((row) => runsOf(row.n).map((run) => ({row, run})));
	if (rs.length > 0)
		console.log(
			`  ${who}: ${count(rs, ({row, run}) => fits(row, run))} / ${rs.length}, ${count(ws, (r) => runsOf(r.n).every((run) => fits(r, run)))} of ${ws.length}; ${count(rs, ({run}) => saidOfRun(run) === "ruling")}`,
		);
}

/**
 * Why sort missed a ticket's real end, by the first that holds: the fact sat in the code, an owner
 * later ruled against the ask, the ticket it needed was not among the 200 in the brief, it said
 * research on a ticket that was built, it said plan on a duplicate whose ticket was in the brief,
 * or none of these.
 */
function causeOf(r: Row): string {
	const misses = runsOf(r.n).filter((run) => !fits(r, run));
	if (r.from === "code") return "the fact was in the code";
	if (r.from === "owner" && r.changed) return "an owner later ruled against the ask";
	if (r.of.length > 0 && r.of.every((o) => inBrief(r.n, o) === false))
		return "the ticket it needed was not in the brief";
	if (r.end === "built" && misses.every((run) => saidOfRun(run) === "research"))
		return "research, on a ticket that was built";
	if (
		r.of.some((o) => inBrief(r.n, o) === true) &&
		misses.every((run) => saidOfRun(run) === "plan")
	)
		return "plan, on a duplicate whose ticket was in the brief";
	return "other";
}
const missed = rows.filter((r) => runsOf(r.n).some((run) => !fits(r, run)));
console.log(`\nmissed on at least one run: ${missed.length} of ${rows.length} tickets`);
for (const cause of [...new Set(missed.map(causeOf))]) {
	const rs = missed.filter((r) => causeOf(r) === cause);
	console.log(`  ${cause}: ${rs.length} (${rs.map((r) => `#${r.n}`).join(", ")})`);
}

console.log("\nevery ticket (* an answer that missed the real end):");
for (const r of rows) {
	const ws = runsOf(r.n).map((run) => `${word(run)}${fits(r, run) ? "" : "*"}`);
	const of = r.of
		.map((o) => {
			const seen = inBrief(r.n, o);
			return `#${o}${seen === null ? "" : seen ? " in brief" : " not in brief"}`;
		})
		.join(", ");
	console.log(
		`#${r.n} [${r.group}] ended ${r.end}, waited on ${r.who}, fact in ${r.from}${r.changed ? ", it changed the end" : ""}${of === "" ? "" : `, of ${of}`}: ${ws.join(" / ")}`,
	);
	if (process.env.WHY === "1")
		for (const run of runsOf(r.n)) console.log(`    ${sortOf(run)?.why}`);
}
