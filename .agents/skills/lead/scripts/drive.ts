// drive.ts: run one Codex step end to end in plain code, so no agent waits on it. Today's lead
// tooling, run on our own laptop; it is not product. Run it in the background and read the last
// line only: one JSON object with the outcome, the new head and the report's path.
//
//   node drive.ts <lane> <plan|tests|build|review> <brief-file> [--from <ref>] [--ticket <n>]
//                 [--branch fabrikalfa/<name>] [--plan-only]
//
// The step is a tea machine on the Effect engine, made of the pipeline's moves:
//
//   starting   Act     box.sh new, at the lane's head
//   drafting   Draft   box.sh run as a Sub: Codex in the box, waited on with no agent
//   reading    Gather  fetch, then the commits, their step notes, exam paths, leaks and the report
//   (update)   Check   pure: what the step answered and what the reads found make one outcome
//   pushing    Act     botpush the backup branch, <branch>-wip, when the step committed
//   recording  Act     the field row, state/<lane>.json and .md, and the box removed unless stuck
//   over               the outcome
//
// Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (a question for
// the lead, in `why`), 30 stuck, 2 usage, 3 refused to start (8 Codex boxes running). It never
// retries. A stuck step keeps its box for the lead to look at. DRIVE_MINUTES (default 60) is how
// long Codex may run before it is stopped and the step is stuck.

import {spawn, spawnSync} from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {defineMachine, type Sub} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {act, gather, intentOf, listen} from "@kampus/pipeline/primitives";
import {nameOf, outcomesOf} from "@kampus/pipeline/stages/outcome";
import {Effect, Schema, Stream} from "effect";

const HERE = import.meta.dirname;
const STEPS = ["plan", "tests", "build", "review"] as const;
type StepName = (typeof STEPS)[number];

// ---------------------------------------------------------------- the outcome

const drive = outcomesOf({
	done: {head: Schema.String},
	send: {
		tests: ["exam_paths", "step_said"],
		build: ["step_said"],
		plan: ["plancheck", "step_said"],
	},
	ask: {lead: ["question"]},
	skip: [],
	stuck: [
		"box_failed",
		"codex_failed",
		"timeout",
		"fetch_failed",
		"read_failed",
		"record_failed",
		"review_committed",
		"unsigned",
		"leak",
		"no_answer",
		"no_commit",
		"push_failed",
		"step_said",
	],
});
type Outcome = typeof drive.schema.Type;

const exitOf = (o: Outcome): number => {
	switch (o.kind) {
		case "done":
			return 0;
		case "send":
			return o.to === "tests" ? 10 : o.to === "build" ? 11 : 12;
		case "ask":
			return 20;
		default:
			return 30;
	}
};

// ---------------------------------------------------------------- the moves

const Ask = Schema.Struct({
	lane: Schema.String,
	step: Schema.Literals(STEPS),
	ticket: Schema.String,
	branch: Schema.String,
	base: Schema.String,
	box: Schema.String,
	run: Schema.String,
	prompt: Schema.String,
	report: Schema.String,
	events: Schema.String,
	err: Schema.String,
	minutes: Schema.Number,
});
type Ask = typeof Ask.Type;

const Read = Schema.Struct({
	/** `null`: the fetch failed, with why in `problem`. */
	head: Schema.NullOr(Schema.String),
	commits: Schema.Number,
	unsigned: Schema.Array(Schema.String),
	exam: Schema.Array(Schema.String),
	/** `file:line` of each added line that leaks; never the text. */
	leaks: Schema.Array(Schema.String),
	/** What `plancheck --draft` said when it failed; `null` when it passed or did not run. */
	plancheck: Schema.NullOr(Schema.String),
	report: Schema.String,
	problem: Schema.NullOr(Schema.String),
});
type Read = typeof Read.Type;

const Done = Schema.Struct({ok: Schema.Boolean, detail: Schema.String});

const boxNew = act("box_new", {input: Ask, ok: Done, err: ["unknown"]});
const stepRead = gather("step_read", {input: Ask, ok: Read, err: ["unknown"]});
const backupPush = act("backup_push", {
	input: Schema.Struct({ask: Ask, head: Schema.String}),
	ok: Done,
	err: ["unknown"],
});
const Entry = Schema.Struct({
	ask: Ask,
	outcome: Schema.String,
	why: Schema.String,
	head: Schema.String,
	exit: Schema.Number,
	keep: Schema.Boolean,
});
const record = act("record", {input: Entry, ok: Done, err: ["unknown"]});

type Cmds =
	| ReturnType<typeof boxNew>
	| ReturnType<typeof stepRead>
	| ReturnType<typeof backupPush>
	| ReturnType<typeof record>;

type CodexSub = Sub<"codex", Ask>;
type Drafted = {readonly type: "drafted"; readonly code: number | null; readonly timedOut: boolean};

type Model =
	| {readonly phase: "idle"}
	| {readonly phase: "starting" | "drafting"; readonly ask: Ask}
	| {readonly phase: "reading"; readonly ask: Ask}
	| {
			readonly phase: "pushing" | "recording";
			readonly ask: Ask;
			readonly outcome: Outcome;
			readonly why: string;
			readonly head: string;
	  }
	| {
			readonly phase: "over";
			readonly ask: Ask;
			readonly outcome: Outcome;
			readonly why: string;
			readonly head: string;
	  };
type Msg = {readonly type: "start"; readonly ask: Ask} | Drafted;

// ---------------------------------------------------------------- the Check

const ANSWER = /^[`*\s]*answer:\s*(done|send\s+(tests|build|plan)|ask|stuck)\b[`*\s]*(.*)$/i;

/** What the step said on its last `answer:` line; a review's verdict line counts without one. */
const answerOf = (step: StepName, report: string) => {
	const lines = report
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	for (const line of lines.toReversed()) {
		const m = ANSWER.exec(line);
		if (m) {
			const verb = (m[1] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
			const why = (m[3] ?? "").replace(/^[`*\s]+|[`*\s]+$/g, "");
			return {verb, to: m[2]?.toLowerCase() ?? "", why};
		}
	}
	const first = (lines[0] ?? "").replace(/^[`*#\s]+/, "");
	if (step === "review" && /^merge-ready/i.test(first))
		return {verb: "done", to: "", why: "merge-ready"};
	if (step === "review" && /^changes/i.test(first)) return {verb: "send", to: "build", why: first};
	return null;
};

type Judged = {readonly outcome: Outcome; readonly why: string};
const stuck = (why: Extract<Outcome, {kind: "stuck"}>["why"], text: string): Judged => ({
	outcome: {kind: "stuck", why},
	why: text,
});

/** The Check, pure: what the reads found wins over what the step said. */
const decide = (ask: Ask, read: Read): Judged => {
	if (read.head === null) return stuck("fetch_failed", read.problem ?? "fetch failed");
	if (read.problem !== null) return stuck("read_failed", read.problem);
	if (ask.step === "review" && read.head !== ask.base)
		return stuck("review_committed", `the review moved the head to ${read.head.slice(0, 8)}`);
	if (read.unsigned.length > 0) return stuck("unsigned", read.unsigned.slice(0, 5).join("; "));
	if (read.leaks.length > 0)
		return stuck("leak", `added lines leak, nothing pushed: ${read.leaks.slice(0, 10).join(" ")}`);
	if (ask.step === "build" && read.exam.length > 0)
		return {
			outcome: {kind: "send", to: "tests", why: "exam_paths"},
			why: `the build touched exam paths: ${read.exam.join(" ")}`,
		};
	if (ask.step === "plan" && read.plancheck !== null)
		return {
			outcome: {kind: "send", to: "plan", why: "plancheck"},
			why: `plancheck --draft: ${read.plancheck}`,
		};
	const said = answerOf(ask.step, read.report);
	if (said === null) return stuck("no_answer", "no answer line in the report");
	switch (said.verb) {
		case "done":
			if ((ask.step === "tests" || ask.step === "build") && read.commits === 0)
				return stuck("no_commit", "answered done with no commit");
			return {outcome: {kind: "done", part: false, head: read.head}, why: said.why};
		case "send": {
			const to = said.to === "tests" ? "tests" : said.to === "plan" ? "plan" : "build";
			return {outcome: {kind: "send", to, why: "step_said"}, why: said.why};
		}
		case "ask":
			return {outcome: {kind: "ask", who: "lead", for: "question"}, why: said.why};
		default:
			return stuck("step_said", said.why);
	}
};

// ---------------------------------------------------------------- the machine

type Step = readonly [Model, readonly Cmds[]];
const stay = (s: Model): Step => [s, []];
const recordIt = (ask: Ask, j: Judged, head: string): Step => {
	const entry = record({
		ask,
		outcome: nameOf(j.outcome),
		why: j.why,
		head,
		exit: exitOf(j.outcome),
		keep: j.outcome.kind === "stuck",
		intent: intentOf("record", ask.box),
	});
	return [{phase: "recording", ask, outcome: j.outcome, why: j.why, head}, [entry]];
};

const codex = listen("codex", (s: Model) => (s.phase === "drafting" ? s.ask : null));

const machine = defineMachine({
	types: {model: {} as Model, msg: {} as Msg, sub: {} as CodexSub, ctx: undefined},
	cmds: [boxNew, stepRead, backupPush, record],
	init: (): Step => [{phase: "idle"}, []],
	subs: [codex],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			if (m.ask.step === "plan") return [{phase: "drafting", ask: m.ask}, []];
			const asked = boxNew({...m.ask, intent: intentOf("box_new", m.ask.box)});
			return [{phase: "starting", ask: m.ask}, [asked]];
		},
		box_new_ok: (s, m): Step => {
			if (s.phase !== "starting") return stay(s);
			if (!m.value.ok) return recordIt(s.ask, stuck("box_failed", m.value.detail), s.ask.base);
			return [{phase: "drafting", ask: s.ask}, []];
		},
		box_new_err: (s): Step =>
			s.phase === "starting"
				? recordIt(s.ask, stuck("box_failed", "box.sh new threw"), s.ask.base)
				: stay(s),
		drafted: (s, m): Step => {
			if (s.phase !== "drafting") return stay(s);
			if (m.timedOut)
				return recordIt(
					s.ask,
					stuck("timeout", `stopped after ${s.ask.minutes} minutes`),
					s.ask.base,
				);
			if (m.code !== 0)
				return recordIt(
					s.ask,
					stuck("codex_failed", `Codex exited ${m.code}; see ${s.ask.err}`),
					s.ask.base,
				);
			return [{phase: "reading", ask: s.ask}, [stepRead(s.ask)]];
		},
		step_read_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const j = decide(s.ask, m.value);
			const head = m.value.head ?? s.ask.base;
			if (j.outcome.kind !== "stuck" && m.value.commits > 0) {
				const asked = backupPush({ask: s.ask, head, intent: intentOf("push", s.ask.box)});
				return [{phase: "pushing", ask: s.ask, outcome: j.outcome, why: j.why, head}, [asked]];
			}
			return recordIt(s.ask, j, head);
		},
		step_read_err: (s): Step =>
			s.phase === "reading"
				? recordIt(s.ask, stuck("fetch_failed", "reading the step threw"), s.ask.base)
				: stay(s),
		backup_push_ok: (s, m): Step => {
			if (s.phase !== "pushing") return stay(s);
			if (!m.value.ok) return recordIt(s.ask, stuck("push_failed", m.value.detail), s.head);
			return recordIt(s.ask, {outcome: s.outcome, why: s.why}, s.head);
		},
		backup_push_err: (s): Step =>
			s.phase === "pushing"
				? recordIt(s.ask, stuck("push_failed", "botpush threw"), s.head)
				: stay(s),
		record_ok: (s, m): Step => {
			if (s.phase !== "recording") return stay(s);
			if (m.value.ok) return [{...s, phase: "over"}, []];
			const outcome: Outcome = {kind: "stuck", why: "record_failed"};
			return [{...s, phase: "over", outcome, why: `${s.why} (${m.value.detail})`}, []];
		},
		record_err: (s): Step =>
			s.phase === "recording"
				? [
						{
							...s,
							phase: "over",
							outcome: {kind: "stuck", why: "record_failed"},
							why: `${s.why} (not recorded)`,
						},
						[],
					]
				: stay(s),
	},
});

// ---------------------------------------------------------------- the world

type Env = {readonly MAIN: string; readonly BOXES: string; readonly GH_REPO: string};

const sh = (cmd: string, args: readonly string[], cwd?: string) => {
	const r = spawnSync(cmd, args, {cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024});
	return {code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? ""};
};
const tail = (text: string, n = 3) => text.trim().split("\n").slice(-n).join(" | ");

/** The paths env.sh gives every lead script. */
const loadEnv = (): Env => {
	const r = sh("sh", [
		"-c",
		'. "$0" && printf "%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO"',
		join(HERE, "env.sh"),
	]);
	const [MAIN = "", BOXES = "", GH_REPO = ""] = r.out.split("\n");
	if (r.code !== 0 || !MAIN) throw new Error(`env.sh failed: ${r.err}`);
	return {MAIN, BOXES, GH_REPO};
};

// Shapes that leak on any machine: home and temp folders, key prefixes, private keys, em dashes.
const SHAPES = [
	/\/Users\/[A-Za-z]/,
	/\/home\/[a-z]/,
	/\/private\/(tmp|var)\//,
	/\/var\/folders\/[a-z0-9_]{2}\//,
	/\bsk-[A-Za-z0-9_-]{16,}/,
	/\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{10,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY/,
	// An em dash, built from its code so this file has none.
	new RegExp(String.fromCharCode(0x2014)),
];

/** `file:line` of each added line that leaks. The private words are read here and never printed. */
const leaksIn = (diff: string, repo: string): string[] => {
	const file = join(homedir(), ".fabrika/leak-words");
	const words = existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.map((w) => w.trim().toLowerCase())
				.filter(Boolean)
		: [];
	const hits: string[] = [];
	let path: string | null = null;
	let line = 0;
	for (const raw of diff.split("\n")) {
		if (raw.startsWith("+++ ")) path = raw.startsWith("+++ b/") ? raw.slice(6) : null;
		else if (raw.startsWith("@@")) line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
		else if (raw.startsWith("+") && path !== null) {
			const text = raw.slice(1).replaceAll(repo, "");
			const low = text.toLowerCase();
			if (SHAPES.some((s) => s.test(text)) || words.some((w) => low.includes(w)))
				hits.push(`${path}:${line}`);
			line += 1;
		}
	}
	return hits;
};

const unsignedIn = (env: Env, ask: Ask, head: string): string[] => {
	const expect = ask.step;
	const shas = sh("git", ["-C", env.MAIN, "rev-list", `${ask.base}..${head}`])
		.out.split("\n")
		.filter(Boolean);
	return shas.flatMap((sha) => {
		const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);
		if (r.code !== 0) return [`${sha.slice(0, 8)} has no step note`];
		const note = JSON.parse(r.out) as {_tag?: string; step?: string; ticket?: string};
		if (note._tag !== "attested") return [`${sha.slice(0, 8)} note is not attested`];
		if (note.step !== expect) return [`${sha.slice(0, 8)} signed ${note.step}, not ${expect}`];
		if (String(note.ticket) !== ask.ticket)
			return [`${sha.slice(0, 8)} signed for ticket ${note.ticket}, not ${ask.ticket}`];
		return [];
	});
};

const handlers = (env: Env) => {
	const box = (...args: string[]) => sh("sh", [join(HERE, "box.sh"), ...args]);
	const git = (...args: string[]) =>
		sh("git", ["-C", env.MAIN, "-c", "core.hooksPath=/dev/null", ...args]);
	return {
		box_new: (cmd: Ask) =>
			Effect.sync(() => {
				const r = box("new", cmd.box, cmd.base, cmd.branch);
				writeFileSync(join(env.BOXES, `${cmd.box}.log`), r.out + r.err);
				return {ok: r.code === 0, detail: r.code === 0 ? "" : `box.sh new: ${tail(r.err)}`};
			}),
		step_read: (ask: Ask) =>
			Effect.sync((): Read => {
				const report = existsSync(ask.report) ? readFileSync(ask.report, "utf8") : "";
				const empty = {commits: 0, unsigned: [], exam: [], leaks: [], plancheck: null, report};
				if (ask.step === "plan") {
					const r = sh(
						"sh",
						[join(HERE, "../../plan/scripts/plancheck.sh"), "--draft", ask.report],
						env.MAIN,
					);
					return {
						...empty,
						head: ask.base,
						plancheck: r.code === 0 ? null : tail(r.out + r.err),
						problem: null,
					};
				}
				// A review commits nothing: its branch lands on a side ref and the lane's branch is left alone.
				const ref = ask.step === "review" ? `refs/drive/${ask.box}` : `refs/heads/${ask.branch}`;
				const f =
					ask.step === "review"
						? git("fetch", "-q", "-f", join(env.BOXES, ask.box), `refs/heads/${ask.branch}:${ref}`)
						: box("fetch", ask.box, ask.branch);
				if (f.code !== 0)
					return {
						...empty,
						head: null,
						problem: `fetch: ${tail(f.err)} (is ${ask.branch} checked out in a worktree?)`,
					};
				const head = git("rev-parse", ref).out.trim();
				if (ask.step === "review") git("update-ref", "-d", ref);
				const failed = (what: string, r: {code: number; err: string}) => ({
					...empty,
					head,
					problem: `${what}: ${tail(r.err)}`,
				});
				const count = git("rev-list", "--count", `${ask.base}..${head}`);
				if (count.code !== 0) return failed("rev-list", count);
				const commits = Number(count.out.trim());
				// Every path any commit touched, so a change undone by a later commit still counts.
				const touched = git("log", "--format=", "--name-only", `${ask.base}..${head}`);
				if (touched.code !== 0) return failed("git log", touched);
				const names = [...new Set(touched.out.split("\n").filter(Boolean))];
				const examRun =
					names.length === 0
						? {code: 0, out: "", err: ""}
						: sh("python3", [
								"-I",
								join(HERE, "../../step-commit/scripts/exam.py"),
								join(env.MAIN, "exam-paths.json"),
								...names,
							]);
				if (examRun.code > 1) return failed("exam.py", examRun);
				const exam = examRun.out
					.split("\n")
					.filter(Boolean)
					.map((l) => l.split("\t")[0] ?? l);
				// Each commit's own added lines, so nothing a later commit removed slips past.
				const diff = git("log", "-p", "-U0", "--no-color", "--format=", `${ask.base}..${head}`);
				if (diff.code !== 0) return failed("git log -p", diff);
				// The repo's own commit check verifies the signatures; this step's name is checked here.
				const check =
					commits === 0
						? {code: 0, out: "", err: ""}
						: sh(
								"node",
								[
									join(env.MAIN, "next/apps/fabrika/src/exam/commits.ts"),
									"check",
									"--base",
									ask.base,
									"--head",
									head,
								],
								env.MAIN,
							);
				if (check.code > 1) return failed("commits check", check);
				const unsigned = [
					...(check.code === 1 ? [`commits check: ${tail(check.out + check.err)}`] : []),
					...unsignedIn(env, ask, head),
				];
				return {
					head,
					commits,
					unsigned,
					exam,
					leaks: leaksIn(diff.out, env.GH_REPO),
					plancheck: null,
					report,
					problem: null,
				};
			}),
		backup_push: (cmd: {ask: Ask; head: string}) =>
			Effect.sync(() => {
				const r = sh("node", [
					join(HERE, "botpush.mjs"),
					env.MAIN,
					`${cmd.ask.branch}-wip`,
					cmd.head,
				]);
				return {
					ok: r.code === 0,
					detail: r.code === 0 ? tail(r.out, 1) : `botpush: ${tail(r.out + r.err, 1)}`,
				};
			}),
		record: (e: typeof Entry.Type) =>
			Effect.sync(() => {
				const {ask} = e;
				const notes: string[] = [];
				const ended = new Date().toISOString();
				// The field row, held beside the boxes until a field PR lands it.
				if (existsSync(ask.events)) {
					const row =
						{done: "pass", send: "fail", ask: "parked"}[e.outcome.split(":")[0] ?? ""] ?? "stopped";
					const why = `drive.ts ${ask.step} in box ${ask.box} at ${ask.base.slice(0, 8)}: ${e.outcome}. ${e.why}`;
					const r = sh("python3", [
						"-I",
						join(HERE, "fieldrow.py"),
						ask.events,
						ask.run,
						ask.ticket,
						row,
						why,
					]);
					if (r.code === 0) appendFileSync(join(env.BOXES, `${ask.lane}-rows.jsonl`), r.out);
					else notes.push(`no field row: ${tail(r.err, 1)}`);
				}
				const ok = notes.length === 0;
				const outcome = ok ? e.outcome : "stuck:record_failed";
				const keep = e.keep || !ok;
				// A stuck step, or a build sent back for exam paths, does not move the lane's head.
				const accepted = !outcome.startsWith("stuck") && outcome !== "send:tests:exam_paths";
				const state = join(env.BOXES, "state", `${ask.lane}.json`);
				const saved = existsSync(state)
					? (JSON.parse(readFileSync(state, "utf8")) as Lane)
					: {lane: ask.lane, steps: []};
				const entry = {
					step: ask.step,
					box: ask.box,
					run: ask.run,
					from: ask.base,
					head: e.head,
					outcome,
					why: ok ? e.why : `${e.why} (${notes.join("; ")})`,
					exit: ok ? e.exit : 30,
					report: ask.report,
					kept: keep,
					ended,
				};
				const lane: Lane = {
					...saved,
					ticket: ask.ticket,
					branch: ask.branch,
					head: accepted ? e.head : (saved.head ?? ask.base),
					steps: [...saved.steps, entry],
				};
				writeFileSync(`${state}.tmp`, `${JSON.stringify(lane, null, "\t")}\n`);
				renameSync(`${state}.tmp`, state);
				appendFileSync(
					join(env.BOXES, "state", `${ask.lane}.md`),
					`- ${ended} drive.ts ${ask.step} in box ${ask.box}: ${outcome}, head ${e.head.slice(0, 8)}. ${e.why}\n`,
				);
				if (!keep && ask.step !== "plan" && ask.box) {
					rmSync(join(env.BOXES, ask.box), {recursive: true, force: true});
					rmSync(join(env.BOXES, `${ask.box}-gitdata`), {recursive: true, force: true});
				}
				return {ok, detail: notes.join("; ")};
			}),
	};
};

/** The Draft: Codex in the box (or the read-only plan writer), as a Sub that answers once. */
const codexRunner = (sub: CodexSub) =>
	Stream.fromEffect(
		Effect.callback<Drafted>((resume) => {
			const ask = sub.deps;
			const out = openSync(ask.step === "plan" ? ask.err : ask.events, "a");
			const err = openSync(ask.err, "a");
			const args =
				ask.step === "plan"
					? [join(HERE, "runplan.sh"), ask.box, ask.prompt]
					: [join(HERE, "box.sh"), "run", ask.box, ask.prompt, ask.report];
			// Its own process group, so a stop reaches every command Codex started too.
			const child = spawn("sh", args, {stdio: ["ignore", out, err], detached: true});
			let timedOut = false;
			let force: ReturnType<typeof setTimeout> | undefined;
			const stopAll = () => {
				const group = child.pid === undefined ? undefined : -child.pid;
				if (group === undefined) return;
				try {
					process.kill(group, "SIGTERM");
					force = setTimeout(() => {
						try {
							process.kill(group, "SIGKILL");
						} catch {}
					}, 10_000);
				} catch {}
			};
			const timer = setTimeout(() => {
				timedOut = true;
				stopAll();
			}, ask.minutes * 60_000);
			child.on("exit", (code) => {
				clearTimeout(timer);
				clearTimeout(force);
				closeSync(out);
				closeSync(err);
				resume(Effect.succeed({type: "drafted", code, timedOut}));
			});
			return Effect.sync(() => {
				clearTimeout(timer);
				stopAll();
			});
		}),
	);

type Lane = {
	readonly lane: string;
	readonly ticket?: string;
	readonly branch?: string;
	readonly head?: string;
	readonly steps: readonly {readonly step: string}[];
};

// ---------------------------------------------------------------- the command

const TAIL = `

---
drive.ts reads your report. End it with exactly one of these lines, as its last line:
answer: done
answer: send tests <why>
answer: send build <why>
answer: ask <the one question for the lead>
answer: stuck <why>
`;

const usage = () => {
	console.error(
		"usage: node drive.ts <lane> <plan|tests|build|review> <brief-file> [--from <ref>] [--ticket <n>] [--branch fabrikalfa/<name>] [--plan-only]",
	);
	process.exit(2);
};

const flag = (args: string[], name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};

const main = () => {
	const args = process.argv.slice(2);
	const [lane = "", step = "", brief = ""] = args;
	if (step === "mutation") {
		console.error("drive.ts: mutation binds a port; a Claude agent runs it");
		process.exit(2);
	}
	if (
		!/^[a-z0-9][a-z0-9-]*$/.test(lane) ||
		!(STEPS as readonly string[]).includes(step) ||
		!existsSync(brief)
	)
		usage();
	const env = loadEnv();
	mkdirSync(join(env.BOXES, "state"), {recursive: true});
	const statePath = join(env.BOXES, "state", `${lane}.json`);
	const saved: Lane | null = existsSync(statePath)
		? (JSON.parse(readFileSync(statePath, "utf8")) as Lane)
		: null;
	const ticket = flag(args, "--ticket") ?? saved?.ticket;
	if (!ticket) {
		console.error(`drive.ts: no ticket for lane ${lane} yet; pass --ticket`);
		process.exit(2);
	}
	const branch = flag(args, "--branch") ?? saved?.branch ?? `fabrikalfa/${lane}`;
	if (!branch.startsWith("fabrikalfa/")) usage();
	sh("git", ["-C", env.MAIN, "fetch", "-q", "origin"]);
	// A plan writer reads the main checkout as it stands, so its base is that checkout's HEAD.
	if (step === "plan" && flag(args, "--from") !== undefined) {
		console.error("drive.ts: a plan reads the main checkout; it takes no --from");
		process.exit(2);
	}
	const from = step === "plan" ? "HEAD" : (flag(args, "--from") ?? saved?.head ?? "origin/main");
	const base = sh("git", [
		"-C",
		env.MAIN,
		"rev-parse",
		"-q",
		"--verify",
		`${from}^{commit}`,
	]).out.trim();
	if (!base) {
		console.error(`drive.ts: ${from} is not a commit in the main checkout`);
		process.exit(2);
	}
	const s = step as StepName;
	let n = (saved?.steps.filter((e) => e.step === s).length ?? 0) + 1;
	while (
		existsSync(join(env.BOXES, `${lane}-${s}${n}`)) ||
		existsSync(join(env.BOXES, `${lane}-${s}${n}-prompt.md`))
	)
		n += 1;
	const box = `${lane}-${s}${n}`;
	const at = (suffix: string) => join(env.BOXES, `${box}${suffix}`);
	const ask: Ask = {
		lane,
		step: s,
		ticket,
		branch,
		base,
		box,
		run: `t${ticket}-${s}${n === 1 ? "" : n}`,
		prompt: at("-prompt.md"),
		report: s === "plan" ? at("-plan.md") : at(".md"),
		events: s === "plan" ? at("-plan.jsonl") : at(".jsonl"),
		err: at(".err"),
		minutes: Number(process.env.DRIVE_MINUTES ?? 60),
	};
	const boxes = sh("pgrep", ["-f", "^codex exec"]).out.split("\n").filter(Boolean).length;
	if (args.includes("--plan-only")) {
		console.log(JSON.stringify({outcome: "plan-only", ...ask, codexBoxes: boxes}));
		return;
	}
	if (boxes >= 8) {
		console.log(
			JSON.stringify({outcome: "refused", why: `${boxes} Codex boxes running; the cap is 8`}),
		);
		process.exit(3);
	}
	const verdict =
		s === "review"
			? "Keep your verdict line, merge-ready or changes: <n>, as the report's first line.\n"
			: "";
	writeFileSync(ask.prompt, readFileSync(brief, "utf8") + TAIL + verdict);

	const program = Effect.gen(function* () {
		// One typecheck at a time across all agents: a step that typechecks waits for a free tsgo.
		if (s === "tests" || s === "build")
			while (sh("pgrep", ["-x", "tsgo"]).code === 0) yield* Effect.sleep("20 seconds");
		const h = handlers(env);
		const handle = yield* run(machine, {
			ctx: undefined,
			interpret: h,
			subscribe: {codex: codexRunner},
			terminal: (m) => m.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({type: "start", ask});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`drive stopped in ${end.phase}`);
		const line = {
			outcome: nameOf(end.outcome),
			lane,
			step: s,
			box,
			from: base,
			head: end.head,
			why: end.why,
			report: ask.report,
			kept: end.outcome.kind === "stuck",
			exit: exitOf(end.outcome),
		};
		console.log(JSON.stringify(line));
		process.exitCode = line.exit;
	});
	Effect.runPromise(Effect.scoped(program)).catch((e: unknown) => {
		console.log(
			JSON.stringify({
				outcome: "stuck:crash",
				lane,
				step: s,
				box,
				why: String(e),
				kept: true,
				exit: 30,
			}),
		);
		process.exitCode = 30;
	});
};

main();
