// Experiment 84: can a cheap reader judge a stall in the build and review loop?
//
// A stall is a review round whose list of open findings is no shorter than the
// round before. Code sees it for free. On a stall the builder must say "I will
// try a different way" or "I cannot meet this as written". This asks two
// narrow questions of Jev and of Claude (sonnet), over the stalls experiment 58
// found in the review loops today's fabrika recorded on phoenix.
//
//   same     Round N's change and round N+1's change, aimed at the list that
//            stayed: is the second a different approach, or a repeat?
//   kind     Why did the list stay: the builder is stuck on a fixable
//            problem, the criterion is wrong as written, the reviewer is
//            wrong or moved the goalposts, or a cause outside the change?
//
// Run with
//   LANES=<a repo's .fabrika folder> CLONE=<a clone of the repo> node experiments/84-stall-reader.ts
//
//   STEP=fetch   the threads of the stalled loops (`gh`, read-only), and each
//                change between rounds: from CLONE by `git diff`, else from
//                GitHub's compare. Writes only into CACHE
//   STEP=jev     ask Jev both questions (needs TYPESAFE_API_KEY; DRY=1 prints
//                the estimate and stops, TRY=<n> asks n)
//   STEP=claude  ask Claude both questions through the Agent SDK, no tools
//                (DRY=1 prints the estimate; stops before MAX_USD, default $5)
//   STEP=read    write each case with both readers' answers into CACHE, to
//                read by hand
//   (no STEP)    print the tables from the saved answers and readings
//
// CACHE (default `runs/exp-84-cache`) holds raw text from GitHub and git and
// is never committed. `results/84-stall-reader.json` holds the answers and
// timings, keyed by case id, and `84-readings.json` the hand readings. Neither
// holds a line of any comment or diff.
//
// Node at the edge, said out loud: `node:fs` for the cache files and
// `node:child_process` for `git` and `gh`, as the other replay scripts do.
import {execFile, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {Duration, Effect, Schema} from "effect";
import {
	type FailedReview,
	type Item,
	listOf,
	loadRounds,
	shuffled,
	type VerdictEvent,
} from "./lib/review-rounds.ts";
import {fetchClosers, fetchEdits, fetchThreads, readThread} from "./lib/threads.ts";

const DATA = process.env.LANES;
const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-84-cache");
const CLONE = process.env.CLONE;
const REPO = process.env.REPO ?? "kamp-us/phoenix";
const STEP = process.env.STEP ?? "tables";
if (DATA === undefined || DATA === "") {
	console.error("LANES is not set: point it at a repo's .fabrika folder");
	process.exit(1);
}
mkdirSync(CACHE, {recursive: true});

// ---------------------------------------------------------------- the stalls

/** Experiment 58's loops, one row each: the ids and the list length per round. */
const replay = JSON.parse(
	readFileSync(join(here, "results", "shrinking-list-replay.json"), "utf8"),
) as {loopRows: {id: string; pull: number | null; rounds: string; found: number[]}[]};

/** A step whose list did not get shorter: round `n - 1` failed, and round `n` failed with as many or more. */
const stalledLoops = new Map<string, number[]>();
for (const row of replay.loopRows)
	for (let i = 1; i < row.found.length; i++) {
		const [was, now] = [row.found[i - 1] as number, row.found[i] as number];
		if (was > 0 && now >= was)
			stalledLoops.set(row.id, [...(stalledLoops.get(row.id) ?? []), i + 1]);
	}
const rowOf = new Map(replay.loopRows.map((r) => [r.id, r]));

const R = loadRounds({lanes: DATA, cache: CACHE, here});
const reviewOf = new Map<VerdictEvent, FailedReview>(R.reviews.map((r) => [r.event, r]));

/** One review round a reviewer ran, as experiment 58 walks them. */
interface Round {
	readonly n: number;
	readonly event: VerdictEvent;
	readonly failed: FailedReview | null;
	readonly head: string | null;
	readonly list: readonly Item[];
}
const eventsOf = new Map<string, VerdictEvent[]>();
for (const e of R.events) {
	const id = `${e.lane}/${e.task}`;
	if (e.from !== "review" || !stalledLoops.has(id)) continue;
	if (e.polarity === "FAIL" && !reviewOf.has(e)) continue;
	eventsOf.set(id, [...(eventsOf.get(id) ?? []), e]);
}
const roundsOf = (id: string): Round[] =>
	(eventsOf.get(id) ?? []).map((event, i) => {
		const failed = reviewOf.get(event) ?? null;
		const posted = failed === null ? R.matchOf(event) : failed.failed;
		const marker = posted[0]?.marker;
		return {
			n: i + 1,
			event,
			failed,
			head: marker?.head ?? marker?.range?.tip ?? null,
			list: failed === null ? [] : listOf(R, failed),
		};
	});
/** Experiment 58 counts a failed round with no list as one finding. */
const lengthOf = (r: Round | undefined) =>
	r === undefined ? null : r.failed === null ? 0 : Math.max(1, r.list.length);

// ---------------------------------------------------------------- fetch

/** A step that reads git, GitHub or a reader failed; the run stops with what it says. */
class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}
const attempt = <A>(what: string, f: () => Promise<A>) =>
	Effect.tryPromise({
		try: f,
		catch: (cause) => new StepFailed({message: `${what}: ${String(cause)}`, cause}),
	});
/** A git command that only answers yes or no by its exit status. */
const gitSays = (args: readonly string[]) =>
	CLONE !== undefined && spawnSync("git", ["-C", CLONE, ...args], {stdio: "ignore"}).status === 0;

const full = (sha: string | null): sha is string => sha !== null && /^[0-9a-f]{40}$/.test(sha);
const run = (cmd: string, args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile(cmd, args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null
				? resolve(stdout)
				: reject(new Error(`${cmd} failed: ${stderr.slice(0, 300)}`)),
		),
	);
const has = (sha: string) => gitSays(["cat-file", "-e", `${sha}^{commit}`]);

/** A change between two rounds: each file and its patch, from git or GitHub. */
interface Patch {
	readonly from: "git" | "github" | "none";
	/** The first commit is not an ancestor of the second: the branch was rebased, so the diff holds the base's changes too. */
	readonly rebased: boolean;
	readonly files: readonly {readonly path: string; readonly patch: string}[];
}
const patchFile = (a: string, b: string) =>
	join(CACHE, `patch-${a.slice(0, 12)}-${b.slice(0, 12)}.json`);
const readPatch = (a: string | null, b: string | null): Patch | null =>
	full(a) && full(b) && existsSync(patchFile(a, b))
		? (JSON.parse(readFileSync(patchFile(a, b), "utf8")) as Patch)
		: null;
const NOISE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.snap$/;

const fromGit = (a: string, b: string) =>
	attempt("git diff", () => run("git", ["-C", CLONE as string, "diff", "--no-color", a, b])).pipe(
		Effect.map((text): Patch => ({
			from: "git",
			rebased: !gitSays(["merge-base", "--is-ancestor", a, b]),
			files: text
				.split(/^diff --git /m)
				.slice(1)
				.map((chunk) => ({
					path: /^a\/(\S+)/.exec(chunk)?.[1] ?? "?",
					patch: chunk.slice(chunk.indexOf("@@") < 0 ? chunk.length : chunk.indexOf("@@")),
				})),
		})),
	);
/** GitHub's compare, for commits the clone lacks; a commit GitHub lacks too gives no change. */
const fromGitHub = (a: string, b: string) =>
	attempt("gh compare", () => run("gh", ["api", `repos/${REPO}/compare/${a}...${b}`])).pipe(
		Effect.map((text): Patch => {
			const raw = JSON.parse(text) as {
				status?: string;
				files?: {filename: string; patch?: string}[];
			};
			return {
				from: "github",
				rebased: raw.status === "diverged",
				files: (raw.files ?? []).map((f) => ({path: f.filename, patch: f.patch ?? ""})),
			};
		}),
		Effect.orElseSucceed((): Patch => ({from: "none", rebased: false, files: []})),
	);
const fetchPatch = (a: string, b: string) => (has(a) && has(b) ? fromGit(a, b) : fromGitHub(a, b));

// ---------------------------------------------------------------- the cases

/** One stall: round `n - 1` failed, round `n` failed no shorter. */
interface Case {
	/** `<lane>/<task>/<n>`: no text. */
	readonly id: string;
	readonly loop: string;
	readonly n: number;
	readonly pull: number | null;
	readonly before: Round;
	readonly stalled: Round;
	readonly next: Round | null;
	/** Round `n + 1` holds a shorter list than round `n`, or passes. `null`: no next round. */
	readonly shrank: boolean | null;
}
const allCases: Case[] = [];
const notFound: string[] = [];
for (const [loop, ns] of stalledLoops) {
	const rounds = roundsOf(loop);
	const want = rowOf.get(loop)?.found ?? [];
	const got = rounds.map(lengthOf);
	if (JSON.stringify(got) !== JSON.stringify(want)) {
		notFound.push(`${loop}: 58 had ${want.join(",")}, here ${got.join(",")}`);
		continue;
	}
	for (const n of ns) {
		const [before, stalled, next] = [rounds[n - 2], rounds[n - 1], rounds[n]] as [
			Round,
			Round,
			Round | undefined,
		];
		allCases.push({
			id: `${loop}/${n}`,
			loop,
			n,
			pull: rowOf.get(loop)?.pull ?? null,
			before,
			stalled,
			next: next ?? null,
			shrank:
				next === undefined ? null : (lengthOf(next) as number) < (lengthOf(stalled) as number),
		});
	}
}

if (STEP === "fetch") {
	const program = Effect.gen(function* () {
		// Pass 1: the closing pull requests of lanes that name none, so the threads can be found.
		const unnamed = R.events
			.filter((e) => stalledLoops.has(`${e.lane}/${e.task}`) && e.threads.length === 0)
			.flatMap((e) => (e.issue === null ? [] : [e.issue]));
		yield* attempt("closers", () => fetchClosers(REPO, unnamed, CACHE));
		const numbers = new Set<number>();
		for (const e of R.events)
			if (stalledLoops.has(`${e.lane}/${e.task}`)) {
				for (const n of e.threads) numbers.add(n);
				if (e.issue !== null) numbers.add(e.issue);
			}
		const queries = yield* attempt("threads", () => fetchThreads(REPO, [...numbers], CACHE, 8));
		const edited = [...numbers].filter((n) => {
			const t = readThread(CACHE, n);
			return t !== null && t !== "missing" && t.comments.some((c) => c.editedAt !== null);
		});
		const more = yield* attempt("edits", () => fetchEdits(REPO, edited, CACHE));
		console.log(`threads ${numbers.size} in ${queries + more} queries; run again for the patches`);
		// Pass 2, once the threads are in: the change before the stall and the change after it.
		const pairs = allCases.flatMap((c) => [
			[c.before.head, c.stalled.head],
			[c.stalled.head, c.next?.head ?? null],
		]);
		let fetched = 0;
		yield* Effect.forEach(
			pairs,
			([a, b]) =>
				full(a) && full(b) && a !== b && !existsSync(patchFile(a, b))
					? fetchPatch(a, b).pipe(
							Effect.tap((p) =>
								Effect.sync(() => {
									writeFileSync(patchFile(a, b), JSON.stringify(p));
									fetched += 1;
								}),
							),
						)
					: Effect.void,
			{concurrency: 4, discard: true},
		);
		console.log(`patches fetched ${fetched}`);
	});
	await Effect.runPromise(program);
	process.exit(0);
}

// ---------------------------------------------------------------- what each reader sees

/** A reader sees at most this much of one change, and of one file in it. Both readers see the same cut. */
const DIFF_CHARS = 10_000;
const FILE_CHARS = 2_500;
const FINDING_CHARS = 1_200;
const TICKET_CHARS = 2_500;

interface View {
	readonly kind: "change" | "none" | "missing";
	readonly text: string;
	/** The whole change, before the cut. */
	readonly chars: number;
	readonly cut: boolean;
}
function viewOf(a: string | null, b: string | null): View {
	if (a !== null && a === b)
		return {
			kind: "none",
			text: "(no new commit: the branch did not move between these two reviews)",
			chars: 0,
			cut: false,
		};
	const patch = readPatch(a, b);
	if (patch === null || patch.from === "none")
		return {kind: "missing", text: "", chars: 0, cut: false};
	const files = patch.files.filter((f) => !NOISE.test(f.path));
	const chars = files.reduce((n, f) => n + f.patch.length, 0);
	const parts: string[] = [];
	const left: string[] = [];
	let used = 0;
	let cut = false;
	for (const f of files) {
		if (used >= DIFF_CHARS) {
			left.push(f.path);
			continue;
		}
		const room = Math.min(FILE_CHARS, DIFF_CHARS - used);
		const shown = f.patch.slice(0, room);
		if (shown.length < f.patch.length) cut = true;
		parts.push(
			`--- ${f.path}\n${shown}${shown.length < f.patch.length ? `\n[${f.patch.length - shown.length} more characters of this file not shown]` : ""}`,
		);
		used += shown.length;
	}
	if (left.length > 0) {
		cut = true;
		parts.push(`[${left.length} more files not shown: ${left.slice(0, 20).join(", ")}]`);
	}
	const head = patch.rebased
		? "(the branch was rebased between the two reviews, so this diff also holds changes from the base branch)\n"
		: "";
	return {kind: "change", text: head + parts.join("\n"), chars, cut};
}

/** A round's list as text, one entry a finding. A failed round with no list stands by its reason, as it counts. */
const listText = (r: Round): string[] => {
	if (r.failed === null) return [];
	const items =
		r.list.length > 0
			? r.list
			: R.itemsOf(r.failed)
					.filter((i) => i.level === "reason")
					.slice(0, 1);
	return items.map((i) => i.whole.slice(0, FINDING_CHARS));
};
const ticketOf = (c: Case): string => {
	const issue = c.before.event.issue;
	const thread = issue === null ? null : readThread(CACHE, issue);
	return thread === null || thread === "missing" || thread.body.trim() === ""
		? "(no ticket text)"
		: thread.body.slice(0, TICKET_CHARS);
};

const sameQuestion = {
	type: "choice",
	instructions:
		"A reviewer failed a pull request with the findings in `before`. The author changed it (`first`, a diff). The reviewer failed it again with `open`, a list no shorter. The author then changed it again (`second`, a diff). Choose whether the second change is a different approach to the open findings, or a repeat of the first change.",
	criteria: {
		different:
			"The second change does something the first did not: it edits other files or other parts of them, takes another approach to the open findings, or answers open findings the first change never touched.",
		repeat:
			"The second change does the same thing again: the same files and the same kind of edit as the first, reworded, moved or tweaked, with no new approach to the open findings.",
		cannot_tell: "The two diffs are not enough to say.",
	},
};
const kindQuestion = {
	type: "choice",
	instructions:
		"A reviewer failed a pull request with the findings in `before`. The author changed it (`change`, a diff). The reviewer failed it again with `after`, a list no shorter. `ticket` is the issue the pull request is for, with its acceptance criteria. Choose the main reason the list did not get shorter.",
	criteria: {
		builder_stuck:
			"The findings are right and can be met as the ticket is written, and the change did not fix them, fixed them only in part, or broke something new on its own lines.",
		criterion_wrong:
			"The ticket cannot be met as written: a criterion is impossible, contradicts a rule or another criterion, or asks for something the code cannot do. Fixing code alone will not pass.",
		reviewer_wrong:
			"The reviewer is wrong or moved the goalposts: the change did what was asked, and the new list misreads the change, asks for more than the ticket, or raises points on older text that the first review could have raised.",
		outside:
			"Something outside the change kept the list: a red, pending or flaky check, the base branch moving, a merge conflict, or the tooling or environment.",
	},
};
type Question = typeof sameQuestion | typeof kindQuestion;
const CHOICES = {
	same: Object.keys(sameQuestion.criteria),
	kind: Object.keys(kindQuestion.criteria),
} as const;
type Call = keyof typeof CHOICES;

interface Ask {
	readonly id: string;
	readonly call: Call;
	readonly state: Record<string, unknown>;
	/** The change shown was cut to fit. */
	readonly cut: boolean;
}
const views = new Map(
	allCases.map((c) => [
		c.id,
		{
			first: viewOf(c.before.head, c.stalled.head),
			second: c.next === null ? null : viewOf(c.stalled.head, c.next.head),
		},
	]),
);
const viewsOf = (c: Case) => views.get(c.id) as {first: View; second: View | null};
const asks: Ask[] = allCases.flatMap((c): Ask[] => {
	const {first, second} = viewsOf(c);
	const out: Ask[] = [];
	if (first.kind !== "missing")
		out.push({
			id: c.id,
			call: "kind",
			cut: first.cut,
			state: {
				ticket: ticketOf(c),
				before: listText(c.before),
				change: first.text,
				after: listText(c.stalled),
			},
		});
	// A next try with no new commit, or no first change, is code's to see: no reader is asked.
	if (second !== null && first.kind === "change" && second.kind === "change")
		out.push({
			id: c.id,
			call: "same",
			cut: first.cut || second.cut,
			state: {
				before: listText(c.before),
				first: first.text,
				open: listText(c.stalled),
				second: second.text,
			},
		});
	return out;
});
const questionOf = (call: Call): Question => (call === "same" ? sameQuestion : kindQuestion);

// ---------------------------------------------------------------- saved answers

/** The share Jev gave each choice, and how long the call took. */
const JevAnswer = Schema.Struct({
	p: Schema.Record(Schema.String, Schema.Number),
	ms: Schema.Number,
});
/** Claude's choice, what it cost and how long it took. Its reason stays in CACHE: it quotes the diffs. */
const ClaudeAnswer = Schema.Struct({
	choice: Schema.String,
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
const Saved = Schema.Struct({
	note: Schema.String,
	jev: Schema.Struct({
		same: Schema.Record(Schema.String, JevAnswer),
		kind: Schema.Record(Schema.String, JevAnswer),
		tokens: Schema.Number,
	}),
	claude: Schema.Struct({
		model: Schema.String,
		same: Schema.Record(Schema.String, ClaudeAnswer),
		kind: Schema.Record(Schema.String, ClaudeAnswer),
	}),
});
/** The saved answers, as a script fills them in place. */
interface Store {
	note: string;
	jev: {
		same: Record<string, typeof JevAnswer.Type>;
		kind: Record<string, typeof JevAnswer.Type>;
		tokens: number;
	};
	claude: {
		model: string;
		same: Record<string, typeof ClaudeAnswer.Type>;
		kind: Record<string, typeof ClaudeAnswer.Type>;
	};
}
const savedFile = join(here, "results", "84-stall-reader.json");
const saved: Store = existsSync(savedFile)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(savedFile, "utf8"))) as Store)
	: {
			note: "Experiment 84. Answers of Jev and Claude to two questions about each stalled review step, keyed by `<lane>/<task>/<round>`. No comment or diff text.",
			jev: {same: {}, kind: {}, tokens: 0},
			claude: {model: "", same: {}, kind: {}},
		};
const save = () => writeFileSync(savedFile, `${JSON.stringify(saved, null, "\t")}\n`);
const whysFile = join(CACHE, "claude-whys.json");
const whys: Record<string, string> = existsSync(whysFile)
	? (JSON.parse(readFileSync(whysFile, "utf8")) as Record<string, string>)
	: {};

const tokensOf = (a: Ask) =>
	(JSON.stringify(a.state).length + JSON.stringify(questionOf(a.call)).length) / 4;
const pickTry = <T>(list: readonly T[]) =>
	process.env.TRY === undefined ? list : list.slice(0, Number(process.env.TRY));

if (STEP === "jev") {
	const todo = pickTry(asks.filter((a) => saved.jev[a.call][a.id] === undefined));
	const tokens = todo.reduce((n, a) => n + tokensOf(a), 0);
	console.log(
		`Jev: ${todo.length} calls to make (${todo.filter((a) => a.call === "same").length} same, ${todo.filter((a) => a.call === "kind").length} kind), about ${Math.round(tokens / 1000)}k tokens, about $${((tokens * 0.042) / 1e6).toFixed(3)} at $0.042 a million`,
	);
	if (process.env.DRY === "1" || todo.length === 0) process.exit(0);
	const {askAll} = await import("./lib/jev.ts");
	const answers = await Effect.runPromise(
		Effect.forEach(
			todo,
			(a) =>
				attempt(`Jev on ${a.id}`, () => askAll({[a.call]: questionOf(a.call)}, a.state)).pipe(
					Effect.timed,
					Effect.map(([took, raw]) => {
						const answer = raw[a.call] as {probabilities: Record<string, number>} | undefined;
						if (answer === undefined) throw new Error(`no answer for ${a.id}`);
						return {
							a,
							p: Object.fromEntries(
								Object.entries(answer.probabilities).map(([k, v]) => [k, +v.toFixed(3)]),
							),
							ms: Math.round(Duration.toMillis(took)),
						};
					}),
				),
			{concurrency: 8},
		),
	);
	for (const {a, p, ms} of answers) saved.jev[a.call][a.id] = {p, ms};
	saved.jev.tokens = Math.round(saved.jev.tokens + tokens);
	save();
	if (process.env.SHOW === "1")
		for (const {a, p} of answers) console.log(`${a.call} ${a.id} ${JSON.stringify(p)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- Claude, the stronger reference

const SYSTEM =
	"You judge one narrow question about a code review loop. Read the JSON you are given and answer with the one choice that fits best, and one or two sentences on why. Do not use any tool.";
const promptOf = (a: Ask): string => {
	const q = questionOf(a.call);
	const options = Object.entries(q.criteria)
		.map(([k, v]) => `- ${k}: ${v}`)
		.join("\n");
	return `${q.instructions}\n\nThe choices:\n${options}\n\nThe case, as JSON:\n${JSON.stringify(a.state, null, 1)}`;
};
const answerSchema = (call: Call) => ({
	type: "object",
	properties: {choice: {type: "string", enum: CHOICES[call]}, why: {type: "string"}},
	required: ["choice", "why"],
	additionalProperties: false,
});
/** Sonnet's list price, for the estimate only: what a call cost is read from the SDK's result. */
const SONNET_IN = 3 / 1e6;
const SONNET_OUT = 15 / 1e6;

const askClaude = (a: Ask) =>
	attempt(`Claude on ${a.id}`, async () => {
		const started = Date.now();
		let model = "";
		for await (const message of query({
			prompt: promptOf(a),
			options: {
				model: process.env.MODEL ?? "sonnet",
				systemPrompt: SYSTEM,
				tools: [],
				skills: [],
				mcpServers: {},
				strictMcpConfig: true,
				maxTurns: 3,
				settingSources: [],
				persistSession: false,
				cwd: CACHE,
				outputFormat: {type: "json_schema", schema: answerSchema(a.call)},
			},
		})) {
			if (message.type === "system" && message.subtype === "init") model = message.model;
			if (message.type === "result") {
				const u = message.usage;
				if (process.env.SHOW === "1")
					console.log(
						`usage: in ${u.input_tokens}, out ${u.output_tokens}, cache write ${u.cache_creation_input_tokens}, cache read ${u.cache_read_input_tokens}, turns ${message.num_turns}`,
					);
				const tokens =
					u.input_tokens +
					u.output_tokens +
					(u.cache_creation_input_tokens ?? 0) +
					(u.cache_read_input_tokens ?? 0);
				const out =
					message.subtype === "success"
						? (message.structured_output as {choice?: string; why?: string} | undefined)
						: undefined;
				return {
					model,
					choice: out?.choice ?? "no_answer",
					why: out?.why ?? message.subtype,
					usd: message.total_cost_usd,
					ms: Date.now() - started,
					tokens,
				};
			}
		}
		throw new Error(`no result for ${a.id}`);
	});

if (STEP === "claude") {
	const only = process.env.ONLY as Call | undefined;
	// In a fixed shuffle: when the limit stops the run part way, what was asked is a fair sample.
	const todo = pickTry(
		shuffled(asks, 84).filter(
			(a) => saved.claude[a.call][a.id] === undefined && (only === undefined || a.call === only),
		),
	);
	const estimate = todo.reduce(
		(n, a) => n + (promptOf(a).length / 4 + 1500) * SONNET_IN + 250 * SONNET_OUT,
		0,
	);
	const limit = Number(process.env.MAX_USD ?? "5");
	const spentSoFar = [
		...Object.values(saved.claude.same),
		...Object.values(saved.claude.kind),
	].reduce((n, x) => n + x.usd, 0);
	console.log(
		`Claude: ${todo.length} calls to make, about $${estimate.toFixed(2)} at list price; spent so far $${spentSoFar.toFixed(2)}; limit $${limit}`,
	);
	if (process.env.DRY === "1" || todo.length === 0) process.exit(0);
	let spent = spentSoFar;
	await Effect.runPromise(
		Effect.forEach(
			todo,
			(a) =>
				spent >= limit
					? Effect.void
					: askClaude(a).pipe(
							Effect.tap((r) =>
								Effect.sync(() => {
									spent += r.usd;
									saved.claude.model = r.model;
									saved.claude[a.call][a.id] = {
										choice: r.choice,
										usd: +r.usd.toFixed(5),
										ms: r.ms,
										tokens: r.tokens,
									};
									whys[`${a.call}:${a.id}`] = r.why;
									// Saved after every answer: a stop part way keeps what was paid for.
									save();
									writeFileSync(whysFile, JSON.stringify(whys, null, 1));
									if (process.env.SHOW === "1")
										console.log(
											`${a.call} ${a.id} ${r.choice} $${r.usd.toFixed(4)} ${r.ms}ms ${r.why}`,
										);
								}),
							),
							Effect.asVoid,
						),
			{concurrency: 4, discard: true},
		),
	);
	console.log(`Claude: spent $${spent.toFixed(2)} in all`);
	process.exit(0);
}

// ---------------------------------------------------------------- the readings by hand

/** A reader's own answer to both questions, with a few words of reason. No quotes. */
interface Reading {
	readonly same?: string;
	readonly kind: string;
	readonly why: string;
}
const readingsFile = join(here, "84-readings.json");
const readings: Record<string, Reading> = existsSync(readingsFile)
	? (JSON.parse(readFileSync(readingsFile, "utf8")) as {cases: Record<string, Reading>}).cases
	: {};

const FLOOR = 0.8;
const top = (p: Readonly<Record<string, number>>): [string, number] =>
	Object.entries(p).sort((x, y) => y[1] - x[1])[0] ?? ["none", 0];
/** Jev's choice: its top answer, or `unsure` under the floor when `floor` is set. */
const jevSays = (call: Call, id: string, floor = 0): string | null => {
	const a = saved.jev[call][id];
	if (a === undefined) return null;
	const [choice, p] = top(a.p);
	return p >= floor ? choice : "unsure";
};
const claudeSays = (call: Call, id: string): string | null =>
	saved.claude[call][id]?.choice ?? null;

/** The hand sample: a fixed draw that leans on the weak spots, then every case the two readers split on. */
const caseOf = new Map(allCases.map((c) => [c.id, c]));
const multiFinding = (c: Case) => (lengthOf(c.stalled) as number) >= 3;
const longChange = (c: Case) => viewsOf(c).first.cut || (viewsOf(c).second?.cut ?? false);
const handSample = (): Case[] => {
	const both = allCases.filter((c) => claudeSays("kind", c.id) !== null);
	const pick = (list: readonly Case[], n: number, seed: number) => shuffled(list, seed).slice(0, n);
	const out = new Map<string, Case>();
	for (const c of [
		...pick(both.filter(multiFinding), 5, 841),
		...pick(both.filter(longChange), 5, 842),
		...pick(
			both.filter((c) => jevSays("kind", c.id) !== claudeSays("kind", c.id)),
			5,
			843,
		),
		...pick(
			allCases.filter(
				(c) =>
					claudeSays("same", c.id) !== null && jevSays("same", c.id) !== claudeSays("same", c.id),
			),
			3,
			844,
		),
		...pick(
			allCases.filter((c) => c.shrank === false && claudeSays("same", c.id) !== null),
			3,
			845,
		),
	])
		out.set(c.id, c);
	return [...out.values()];
};

if (STEP === "read") {
	const text = handSample().map((c) => {
		const {first, second} = viewsOf(c);
		const jev = (call: Call) =>
			saved.jev[call][c.id] === undefined ? "-" : JSON.stringify(saved.jev[call][c.id]?.p);
		return [
			`## ${c.id}  https://github.com/${REPO}/pull/${c.pull}`,
			`lists ${lengthOf(c.before)} -> ${lengthOf(c.stalled)} -> ${lengthOf(c.next ?? undefined) ?? "end"}; next round shorter: ${c.shrank}; change cut: ${first.cut}/${second?.cut ?? "-"}; sizes ${first.chars}/${second?.chars ?? "-"}`,
			`jev kind ${jev("kind")}\nclaude kind ${claudeSays("kind", c.id)}: ${whys[`kind:${c.id}`] ?? "-"}`,
			`jev same ${jev("same")}\nclaude same ${claudeSays("same", c.id)}: ${whys[`same:${c.id}`] ?? "-"}`,
			`read so far: ${JSON.stringify(readings[c.id] ?? null)}`,
			`\n### ticket\n${ticketOf(c).slice(0, 1500)}`,
			`\n### before (round ${c.n - 1})\n${listText(c.before).join("\n\n")}`,
			`\n### after (round ${c.n})\n${listText(c.stalled).join("\n\n")}`,
			`\n### next (round ${c.n + 1})\n${c.next === null ? "(none)" : c.next.failed === null ? "PASS" : listText(c.next).join("\n\n")}`,
			`\n### first change\n${first.text.slice(0, 6000)}`,
			`\n### second change\n${second?.text.slice(0, 6000) ?? "(none)"}`,
		].join("\n");
	});
	writeFileSync(
		join(CACHE, "read-84.md"),
		text.join("\n\n==========================================\n\n"),
	);
	console.log(`wrote ${text.length} cases to read into CACHE/read-84.md`);
	process.exit(0);
}

// ---------------------------------------------------------------- the tables

const pct = (n: number, of: number) => (of === 0 ? "-" : `${Math.round((100 * n) / of)}%`);
function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
) {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
/** Cohen's kappa for two readers over the same items. */
function kappa(pairs: readonly (readonly [string, string])[]): number {
	const n = pairs.length;
	if (n === 0) return Number.NaN;
	const agree = pairs.filter(([x, y]) => x === y).length / n;
	const labels = [...new Set(pairs.flat())];
	const chance = labels.reduce(
		(s, l) =>
			s +
			(pairs.filter(([x]) => x === l).length / n) * (pairs.filter(([, y]) => y === l).length / n),
		0,
	);
	return chance === 1 ? 1 : (agree - chance) / (1 - chance);
}
const agreement = (pairs: readonly (readonly [string, string])[]) =>
	`${pairs.filter(([x, y]) => x === y).length} of ${pairs.length} (${pct(pairs.filter(([x, y]) => x === y).length, pairs.length)}), kappa ${kappa(pairs).toFixed(2)}`;
const pairsOf = (
	call: Call,
	a: (call: Call, id: string) => string | null,
	b: (call: Call, id: string) => string | null,
	keep: (c: Case) => boolean = () => true,
): [string, string][] =>
	allCases.flatMap((c) => {
		const [x, y] = [a(call, c.id), b(call, c.id)];
		return x === null || y === null || !keep(c) ? [] : [[x, y] as [string, string]];
	});
const handSays = (call: Call, id: string): string | null =>
	(call === "same" ? readings[id]?.same : readings[id]?.kind) ?? null;

const withNext = allCases.filter((c) => c.next !== null);
console.log(
	`stalled steps: ${allCases.length} in ${stalledLoops.size} loops (as long ${allCases.filter((c) => lengthOf(c.stalled) === lengthOf(c.before)).length}, longer ${allCases.filter((c) => (lengthOf(c.stalled) as number) > (lengthOf(c.before) as number)).length}); rebuilt from experiment 58's loops: ${notFound.length === 0 ? "all" : `${notFound.length} not`}`,
);
console.log(
	`with a next round ${withNext.length}: shorter or PASS ${withNext.filter((c) => c.shrank).length}, not shorter ${withNext.filter((c) => c.shrank === false).length}`,
);
console.log(
	`first change: ${allCases.filter((c) => viewsOf(c).first.kind === "change").length} a diff, ${allCases.filter((c) => viewsOf(c).first.kind === "none").length} no new commit, ${allCases.filter((c) => viewsOf(c).first.kind === "missing").length} not found; cut to fit ${allCases.filter((c) => viewsOf(c).first.cut).length}`,
);
const noCommit = withNext.filter((c) => viewsOf(c).second?.kind === "none");
console.log(
	`next try with no new commit (code sees it, no reader asked): ${noCommit.length}, of them the next round shorter ${noCommit.filter((c) => c.shrank).length}`,
);
console.log(
	`asked: same ${asks.filter((a) => a.call === "same").length} (Jev ${Object.keys(saved.jev.same).length}, Claude ${Object.keys(saved.claude.same).length}); kind ${asks.filter((a) => a.call === "kind").length} (Jev ${Object.keys(saved.jev.kind).length}, Claude ${Object.keys(saved.claude.kind).length}); multi-finding (3+) ${allCases.filter(multiFinding).length}; a change cut ${allCases.filter(longChange).length}`,
);

// Call 1: does "different" foretell a shorter list next round?
const sameReaders: [string, (id: string) => string | null][] = [
	["Jev, top answer", (id) => jevSays("same", id)],
	[`Jev at ${FLOOR}`, (id) => jevSays("same", id, FLOOR)],
	["Claude", (id) => claudeSays("same", id)],
	["by hand", (id) => handSays("same", id)],
];
for (const [name, says] of sameReaders) {
	const rows = ["different", "repeat", "cannot_tell", "unsure"].flatMap((choice) => {
		const hit = withNext.filter((c) => says(c.id) === choice);
		return hit.length === 0
			? []
			: [
					[
						choice,
						hit.length,
						hit.filter((c) => c.shrank).length,
						hit.filter((c) => !c.shrank).length,
						pct(hit.filter((c) => c.shrank).length, hit.length),
					],
				];
	});
	table(
		`Same or different, ${name}, against the next round`,
		["Says", "Steps", "Next shorter", "Next not shorter", "Share shorter"],
		rows,
	);
}

table(
	"Agreement",
	["Call", "Jev and Claude", "Jev and the hand reading", "Claude and the hand reading"],
	(["same", "kind"] as const).map((call) => [
		call,
		agreement(pairsOf(call, jevSays, claudeSays)),
		agreement(pairsOf(call, jevSays, handSays)),
		agreement(pairsOf(call, claudeSays, handSays)),
	]),
);
table(
	"Jev and Claude on the weak spots",
	["Call", "Slice", "Agree"],
	(["same", "kind"] as const).flatMap((call) => [
		[call, "a change cut to fit", agreement(pairsOf(call, jevSays, claudeSays, longChange))],
		[call, "nothing cut", agreement(pairsOf(call, jevSays, claudeSays, (c) => !longChange(c)))],
		[call, "3 or more findings", agreement(pairsOf(call, jevSays, claudeSays, multiFinding))],
		[
			call,
			"1 or 2 findings",
			agreement(pairsOf(call, jevSays, claudeSays, (c) => !multiFinding(c))),
		],
	]),
);

// Call 2: what each reader says, and what came next.
const kinds = CHOICES.kind;
table(
	"Stall kind, by reader",
	[
		"Kind",
		"Jev top (all)",
		`Jev at ${FLOOR} (all)`,
		"Jev top (Claude's sample)",
		"Claude (sample)",
		"By hand",
		"Next round shorter, by Claude's kind",
	],
	[...kinds, "unsure"].map((k) => {
		const sample = allCases.filter((c) => claudeSays("kind", c.id) !== null);
		const byClaude = sample.filter((c) => claudeSays("kind", c.id) === k && c.next !== null);
		return [
			k,
			allCases.filter((c) => jevSays("kind", c.id) === k).length,
			allCases.filter((c) => jevSays("kind", c.id, FLOOR) === k).length,
			sample.filter((c) => jevSays("kind", c.id) === k).length,
			sample.filter((c) => claudeSays("kind", c.id) === k).length,
			allCases.filter((c) => handSays("kind", c.id) === k).length,
			byClaude.length === 0
				? "-"
				: `${byClaude.filter((c) => c.shrank).length} of ${byClaude.length}`,
		];
	}),
);
table(
	"Jev's kind against Claude's (rows Jev, columns Claude)",
	["Jev \\ Claude", ...kinds],
	kinds.map((j) => [
		j,
		...kinds.map(
			(k) =>
				allCases.filter((c) => jevSays("kind", c.id) === j && claudeSays("kind", c.id) === k)
					.length,
		),
	]),
);

// Cost and time.
const med = (xs: readonly number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const jevAll = [...Object.values(saved.jev.same), ...Object.values(saved.jev.kind)];
const claudeAll = [...Object.values(saved.claude.same), ...Object.values(saved.claude.kind)];
const jevUsd = (saved.jev.tokens * 0.042) / 1e6;
table(
	"Cost and time per call",
	[
		"Reader",
		"Calls",
		"Dollars in all",
		"Dollars a call",
		"Seconds a call, median",
		"Seconds a call, mean",
	],
	[
		[
			"Jev",
			jevAll.length,
			`$${jevUsd.toFixed(3)}`,
			`$${(jevUsd / jevAll.length).toFixed(5)}`,
			(med(jevAll.map((a) => a.ms)) / 1000).toFixed(2),
			(mean(jevAll.map((a) => a.ms)) / 1000).toFixed(2),
		],
		[
			`Claude (${saved.claude.model})`,
			claudeAll.length,
			`$${claudeAll.reduce((n, a) => n + a.usd, 0).toFixed(2)}`,
			`$${mean(claudeAll.map((a) => a.usd)).toFixed(4)}`,
			(med(claudeAll.map((a) => a.ms)) / 1000).toFixed(2),
			(mean(claudeAll.map((a) => a.ms)) / 1000).toFixed(2),
		],
	],
);
if (process.env.LIST === "1")
	for (const c of allCases)
		console.log(
			`${c.id} lists ${lengthOf(c.before)}>${lengthOf(c.stalled)}>${lengthOf(c.next ?? undefined)} shrank=${c.shrank} cut=${longChange(c)} jev=${jevSays("same", c.id)}/${jevSays("kind", c.id)} claude=${claudeSays("same", c.id)}/${claudeSays("kind", c.id)} hand=${handSays("same", c.id)}/${handSays("kind", c.id)}`,
		);
void caseOf;
