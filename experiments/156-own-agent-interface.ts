// Experiment 156: our own agent interface, its shapes taken from ACP, and the same job through
// both paths. Four rows of one provider table, all behind the same `Agent.Agents` service:
//
//   claude      Claude through our adapter on the Agent SDK      (@kampus/fabrika/agents/claude)
//   acp-claude  Claude through ACP, our ACP client and Zed's adapter (@kampus/fabrika/agents/acp)
//   codex       Codex through our adapter on `codex exec --json`  (@kampus/fabrika/agents/codex)
//   acp-codex   Codex through ACP, the pinned codex-acp adapter    (@kampus/fabrika/agents/acp)
//
//   P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
//   $P CLAUDE_CODE_OAUTH_TOKEN=... node experiments/156-own-agent-interface.ts job <row> [n]   # the format-bytes job
//   $P ... node experiments/156-own-agent-interface.ts stop <row>      # leave mid command: does it end?
//   $P ... node experiments/156-own-agent-interface.ts resume <row>    # carry a session on, by our id, in a new process
//   $P ... node experiments/156-own-agent-interface.ts budget <row>    # the limits each row holds
//   $P ... node experiments/156-own-agent-interface.ts control         # 153's detector, on a home we filled
//   node experiments/156-own-agent-interface.ts loc                     # lines of code per adapter
//   node experiments/156-own-agent-interface.ts report                  # no model: the summary
//
// Claude signs in with CLAUDE_CODE_OAUTH_TOKEN from the environment (kept by `agentEnv`, never
// printed). Codex signs in with the laptop's ChatGPT plan, through a Codex home of its own that
// holds a link to the login file: the plan check reads two of its fields in code, nothing else
// reads it. After every Codex run the script checks the link is still a link and that the owner's
// sessions folder did not grow, counts the owner's settings in what the run saved (experiment 153's
// detector), and removes the home.
//
// Each run works in a fresh copy of fixtures/format-bytes under WORK. One run at a time.
//
// Node at the edge: fs for the copies and the checks, ps for the stop step, and a child
// `node` for the resume step's second process.

import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {query, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent} from "@kampus/fabrika";
import {acpAdapter, codexHomeOf} from "@kampus/fabrika/agents/acp";
import {claudeAdapter, type Open} from "@kampus/fabrika/agents/claude";
import {codexAdapter, psReaper} from "@kampus/fabrika/agents/codex";
import {runEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, Exit, Schema, Stream} from "effect";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FIXTURE = join(REPO, "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "156-own-agent-interface.json");
const WORK = realOrSelf(process.env.WORK ?? join(tmpdir(), "exp156"));
const OWNER = join(homedir(), ".codex");
const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");

const ROWS = ["claude", "acp-claude", "codex", "acp-codex"] as const;
type Row = (typeof ROWS)[number];
const isClaude = (row: Row) => row === "claude" || row === "acp-claude";
/** The Claude adapter over ACP offers the model by its short name only. */
const MODEL = (row: Row) =>
	row === "claude" ? "claude-haiku-4-5" : row === "acp-claude" ? "haiku" : "gpt-6-luna";
/** `EFFORT=none` runs the follow-up with no effort set, saved under its own key. */
const EFFORT = process.env.EFFORT === "none" ? null : "low";
const CLAUDE_BUDGET = 0.2;

function realOrSelf(p: string) {
	mkdirSync(p, {recursive: true});
	return realpathSync(p);
}

// ---------------------------------------------------------------- the job (experiments 152, 153)

const Answer = Schema.Struct({
	done: Schema.Boolean,
	ran: Schema.Array(Schema.Struct({call: Schema.String, printed: Schema.String})),
	summary: Schema.String,
});
type Answer = typeof Answer.Type;

const PROMPT = [
	"Make formatBytes(n) in bytes.js turn a number of bytes into a short readable size.",
	'- Under 1024: the number and " B". formatBytes(512) is "512 B".',
	"- From 1024 up: divide by 1024 until the number is under 1024 or the unit is TB. Show one decimal and the unit: KB, MB, GB, TB.",
	'  formatBytes(1536) is "1.5 KB". formatBytes(1048576) is "1.0 MB".',
	'- Past TB, stay in TB: formatBytes(1024 ** 5) is "1024.0 TB".',
	"Then check it with one node command that prints formatBytes(1536) and formatBytes(5 * 1024 ** 3).",
	"At the end, fill the form: `done` (true if the function works), `ran` (each call you checked and what it printed), `summary` (one sentence).",
].join("\n");

const TRUTH: ReadonlyArray<readonly [string, string]> = [
	["0", "0 B"],
	["1", "1 B"],
	["1023", "1023 B"],
	["1024", "1.0 KB"],
	["1536", "1.5 KB"],
	["1048576", "1.0 MB"],
	["5 * 1024 ** 3", "5.0 GB"],
	["1024 ** 4", "1.0 TB"],
	["1.5 * 1024 ** 4", "1.5 TB"],
	["1024 ** 5", "1024.0 TB"],
];

const graded = (copy: string): number => {
	const script = `import("./bytes.js").then((m) => console.log(JSON.stringify([${TRUTH.map(([n]) => `m.formatBytes(${n})`).join(",")}])))`;
	try {
		const out = execFileSync("node", ["-e", script], {cwd: copy, env: runEnv(), timeout: 10_000});
		const got = JSON.parse(String(out)) as unknown[];
		return TRUTH.filter(([, want], i) => got[i] === want).length;
	} catch {
		return 0;
	}
};

const fresh = (name: string) => {
	const dir = join(WORK, `${name}-${randomBytes(3).toString("hex")}`);
	const copy = join(dir, "copy");
	mkdirSync(dir, {recursive: true});
	cpSync(FIXTURE, copy, {recursive: true});
	return {dir, copy};
};

// ---------------------------------------------------------------- containment (experiment 153's detector)

const files = (d: string): string[] =>
	existsSync(d)
		? readdirSync(d).flatMap((f) => {
				const p = join(d, f);
				return statSync(p).isDirectory() ? files(p) : [p];
			})
		: [];
const ownerSessions = () => files(join(OWNER, "sessions")).length;

/** The owner's own Codex setup, read only to be counted against what a run saved. Never printed or kept. */
const owner = () => {
	const config = existsSync(join(OWNER, "config.toml"))
		? readFileSync(join(OWNER, "config.toml"), "utf8")
		: "";
	const names = (re: RegExp) => [...config.matchAll(re)].map((m) => m[1] ?? "").filter(Boolean);
	const agents = existsSync(join(OWNER, "AGENTS.md"))
		? readFileSync(join(OWNER, "AGENTS.md"), "utf8")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length >= 30)
		: [];
	const skillsDir = join(homedir(), ".agents", "skills");
	return {
		mcp: [...new Set(names(/^\[mcp_servers\."?([^\]".]+)"?\]/gm))],
		pluginIds: names(/^\[plugins\."([^"]+)"\]/gm),
		agentsLines: agents,
		agentSkills: existsSync(skillsDir) ? readdirSync(skillsDir) : [],
	};
};
const countIn = (text: string, needles: readonly string[]) =>
	needles.filter((n) => n !== "" && text.includes(n)).length;
const rollouts = (home: string) =>
	files(join(home, "sessions"))
		.map((f) => readFileSync(f, "utf8"))
		.join("\n");

/** What of the owner's setup a Codex home's saved sessions hold: all zeros when contained. */
const leaks = (home: string) => {
	const o = owner();
	const text = rollouts(home);
	return {
		saved: text.length > 0,
		mcp: countIn(text, o.mcp),
		plugins: countIn(text, o.pluginIds),
		agentsLines: countIn(text, o.agentsLines),
		skills: countIn(text, o.agentSkills),
		of: {
			mcp: o.mcp.length,
			plugins: o.pluginIds.length,
			agentsLines: o.agentsLines.length,
			skills: o.agentSkills.length,
		},
	};
};
const linked = (home: string) => {
	try {
		return lstatSync(join(home, "auth.json")).isSymbolicLink();
	} catch {
		return null;
	}
};

/** The Codex home a row's run in `copy` under session `session` used. */
const homeOf = (row: Row, session: string, copy: string) =>
	row === "codex"
		? codexHomeOf(`session:${session}`)
		: row === "acp-codex"
			? codexHomeOf(copy)
			: null;

// ---------------------------------------------------------------- the service, on four rows

/** The Claude SDK's messages, watched: the `init` message's lists, to count what was loaded. */
const inits: Array<{
	tools: number;
	mcp: number;
	plugins: number;
	pluginsFromOwner: number;
	skills: number;
	commands: number;
}> = [];
const watchedOpen: Open = (params) => {
	const q = query(params);
	const it = async function* () {
		for await (const m of q as AsyncIterable<SDKMessage>) {
			if (m.type === "system" && m.subtype === "init") {
				const init = m;
				const plugins = init.plugins;
				// Names are the owner's: to this console only, never to the results.
				if (process.env.SHOW_INIT === "1")
					console.error(
						"init plugins",
						plugins.map((p) => scrub(JSON.stringify(p))),
						"skills",
						init.skills,
					);
				inits.push({
					tools: init.tools?.length ?? 0,
					mcp: init.mcp_servers?.length ?? 0,
					plugins: plugins.length,
					pluginsFromOwner: plugins.filter((p) =>
						(p.path ?? "").startsWith(join(homedir(), ".claude")),
					).length,
					skills: init.skills?.length ?? 0,
					commands: init.slash_commands?.length ?? 0,
				});
			}
			yield m;
		}
	};
	return Object.assign(it(), {interrupt: () => q.interrupt(), close: () => q.close()});
};

const stops: Agent.Stopped[] = [];

const service = Effect.gen(function* () {
	const sessions = yield* Agent.fileSessions(join(WORK, "sessions"));
	return Agent.makeAgents({
		adapters: {
			claude: claudeAdapter({open: watchedOpen}),
			"acp-claude": yield* acpAdapter("claude"),
			// The format-bytes job fixes the copy, so both Codex rows may change their folder.
			codex: yield* codexAdapter({codex: CODEX, access: "write"}),
			"acp-codex": yield* acpAdapter({name: "codex", access: "write"}),
		},
		sessions,
		reaper: psReaper,
		stopped: (s) => stops.push(s),
	});
}).pipe(Effect.provide(nodeServices));

const turnOf = <A>(
	row: Row,
	copy: string,
	session: string,
	prompt: string,
	answer: Schema.Codec<A, unknown>,
	limits: Partial<Agent.Limits> = {},
): Agent.Turn<A> => ({
	provider: row,
	session,
	folder: copy,
	prompt,
	// Added in v1 slice 2: every turn names one. This run sent none on Codex and ACP.
	system: {_tag: "append", text: ""},
	answer,
	model: MODEL(row),
	effort: EFFORT,
	limits: {
		...Agent.NO_LIMITS,
		usd: isClaude(row) ? CLAUDE_BUDGET : null,
		seconds: 300,
		...limits,
	},
});

interface Ran<A> {
	readonly heard: Agent.Heard<A>[];
	readonly end: Agent.Ended<A> | null;
	readonly error: string | null;
	readonly ms: number;
}

const runTurn = async <A>(
	turn: Agent.Turn<A>,
	more: (
		s: Stream.Stream<Agent.Heard<A>, Agent.AgentFailed>,
	) => Stream.Stream<Agent.Heard<A>, Agent.AgentFailed> = (s) => s,
): Promise<Ran<A>> => {
	const agents = await Effect.runPromise(service);
	const start = Date.now();
	const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(more(agents.run(turn)))));
	const heard = Exit.isSuccess(exit) ? [...exit.value] : [];
	return {
		heard,
		end: (heard.find((h) => h._tag === "ended") as Agent.Ended<A> | undefined) ?? null,
		error: Exit.isFailure(exit) ? scrub(String(exit.cause)).slice(0, 400) : null,
		ms: Date.now() - start,
	};
};

const scrub = (text: string) =>
	text.split(WORK).join("<work>").split(homedir()).join("~").split(tmpdir()).join("<tmp>");

// ---------------------------------------------------------------- results

type Results = Record<string, unknown>;
const load = (): Results =>
	existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as Results) : {};
const save = (key: string, value: unknown) => {
	const all = load();
	all[key] = value;
	mkdirSync(dirname(RESULTS), {recursive: true});
	writeFileSync(RESULTS, `${JSON.stringify(all, null, 1)}\n`);
};
const rowArg = (arg: string | undefined): Row => {
	if (!ROWS.includes(arg as Row)) throw new Error(`a row: ${ROWS.join(", ")}`);
	return arg as Row;
};

/** After a Codex run: the login still a link, the owner's sessions unchanged, the leaks; then the home goes. */
const afterCodex = (row: Row, session: string, copy: string, sessionsBefore: number) => {
	const home = homeOf(row, session, copy);
	if (home === null) return {};
	const out = {
		loginStillLinked: linked(home),
		ownerSessionsSame: ownerSessions() === sessionsBefore,
		leaks: leaks(home),
	};
	rmSync(home, {recursive: true, force: true});
	return out;
};

// ---------------------------------------------------------------- steps

async function job(row: Row, count: number) {
	const key = EFFORT === null ? `job:${row}:no-effort` : `job:${row}`;
	const rows = (load()[key] as unknown[] | undefined) ?? [];
	const first = rows.length + 1;
	for (let n = first; n < first + count; n++) {
		const {dir, copy} = fresh(`job-${row}-${n}`);
		const session = `job/${row}/${n}/${randomBytes(3).toString("hex")}`;
		const before = ownerSessions();
		const r = await runTurn(turnOf(row, copy, session, PROMPT, Answer));
		const g = graded(copy);
		const tools = new Set(r.heard.flatMap((h) => (h._tag === "tool" ? [h.id] : []))).size;
		const out = {
			n,
			ok: g === TRUTH.length,
			graded: g,
			typed: r.end?.answer !== null && r.end !== null,
			claimedDone: (r.end?.answer as Answer | null)?.done ?? null,
			stop: r.end?.stop ?? null,
			seconds: r.ms / 1000,
			tools,
			tokens: r.end?.tokens ?? null,
			counted: r.end?.counted ?? null,
			usd: r.end?.usd ?? null,
			requests: r.end?.requests ?? null,
			error: r.error,
			...(row === "claude" ? {init: inits.at(-1) ?? null} : {}),
			...afterCodex(row, session, copy, before),
		};
		console.log(JSON.stringify(out));
		rows.push(out);
		save(key, rows);
		rmSync(dir, {recursive: true, force: true});
	}
}

const alive = (mark: string): number =>
	String(execFileSync("ps", ["-axo", "command="]))
		.split("\n")
		.filter((l) => l.includes(mark) && !l.includes("ps -axo")).length;

async function stop(row: Row) {
	const {dir, copy} = fresh(`stop-${row}`);
	const session = `stop/${row}/${randomBytes(3).toString("hex")}`;
	const before = ownerSessions();
	// Under Claude's Bash limit of ten minutes: a longer command fails before it runs.
	const seconds = `${100 + Math.floor(Math.random() * 400)}.${Math.floor(Math.random() * 9) + 1}`;
	const mark = `sleep ${seconds}`;
	// In a script: Claude Code's Bash tool refuses a long `sleep` typed as the command itself.
	// The sleep is then a child of the shell the agent started, one level further down.
	writeFileSync(join(copy, "wait.sh"), `${mark}\necho slept\n`);
	const Done = Schema.Struct({done: Schema.Boolean});
	let sawCommandAt = 0;
	let leftAt = 0;
	let runningAtLeave = 0;
	const tools: string[] = [];
	const began = Date.now();
	const r = await runTurn(
		turnOf(
			row,
			copy,
			session,
			"Run this shell command in the foreground, not in the background, and wait for it to end: sh wait.sh\nThen say done.",
			Done,
		),
		(s) =>
			s.pipe(
				Stream.tap((h) =>
					Effect.sync(() => {
						if (h._tag === "tool") tools.push(`${h.status}: ${h.title.slice(0, 80)}`);
						if (h._tag === "said") tools.push(`said: ${h.text.slice(0, 300)}`);
					}),
				),
				// Leave 1.5 s after the command is first seen running, by the process list: a
				// maker may say nothing about a tool call until it ends (ACP Codex does).
				Stream.interruptWhen(
					Effect.gen(function* () {
						while (sawCommandAt === 0 || Date.now() - sawCommandAt < 1500) {
							yield* Effect.sleep("100 millis");
							if (sawCommandAt === 0 && alive(mark) > 0) sawCommandAt = Date.now();
						}
						runningAtLeave = alive(mark);
						leftAt = Date.now();
					}),
				),
			),
	);
	const leftNow = alive(mark);
	await new Promise((ok) => setTimeout(ok, 3000));
	const leftAfter3s = alive(mark);
	const s = stops.at(-1) ?? null;
	const out = {
		sawCommand: sawCommandAt !== 0,
		secondsToCommand: sawCommandAt === 0 ? null : (sawCommandAt - began) / 1000,
		tools: tools.map(scrub),
		commandRunningAtLeave: runningAtLeave,
		msLeaveToTreeGone: s?.ms ?? null,
		underAtStop: s?.under ?? null,
		killedByReaper: s?.killed ?? null,
		sleepLeftAfterStop: leftNow,
		sleepLeftAfter3s: leftAfter3s,
		ended: r.end?.stop ?? null,
		error: r.error,
		left: leftAt !== 0,
		...afterCodex(row, session, copy, before),
	};
	console.log(JSON.stringify(out));
	save(`stop:${row}`, out);
	rmSync(dir, {recursive: true, force: true});
}

const Word = Schema.Struct({word: Schema.String});

/** The first turn here; the second in a new node process, by our session id alone. */
async function resume(row: Row) {
	const {dir, copy} = fresh(`resume-${row}`);
	const session = `resume/${row}/${randomBytes(3).toString("hex")}`;
	const word = `w${randomBytes(3).toString("hex")}`;
	const before = ownerSessions();
	const first = await runTurn(
		turnOf(
			row,
			copy,
			session,
			`Remember this word: ${word}. Run no tools. Fill the form with word "ok".`,
			Word,
		),
	);
	const kept = await Effect.runPromise(
		Effect.flatMap(Agent.fileSessions(join(WORK, "sessions")), (s) => s.get(session)).pipe(
			Effect.provide(nodeServices),
		),
	);
	const out2 = execFileSync(
		process.execPath,
		[
			"--disable-warning=ExperimentalWarning",
			fileURLToPath(import.meta.url),
			"resume2",
			row,
			copy,
			session,
		],
		{env: process.env, timeout: 300_000},
	);
	const second = JSON.parse(String(out2).trim().split("\n").at(-1) ?? "{}") as {
		answer: {word: string} | null;
		ms: number;
		error: string | null;
	};
	const out = {
		firstStop: first.end?.stop ?? null,
		firstError: first.error,
		mapped: kept !== null && kept.provider === row && kept.own !== session,
		ownIsOurs: kept?.own === session,
		remembered: second.answer?.word === word,
		secondSeconds: second.ms / 1000,
		secondError: second.error,
		...afterCodex(row, session, copy, before),
	};
	console.log(JSON.stringify(out));
	save(`resume:${row}`, out);
	rmSync(dir, {recursive: true, force: true});
}

async function resume2(row: Row, copy: string, session: string) {
	const r = await runTurn(
		turnOf(
			row,
			copy,
			session,
			"Which word did I ask you to remember? Run no tools. Fill the form with it.",
			Word,
		),
	);
	console.log(JSON.stringify({answer: r.end?.answer ?? null, ms: r.ms, error: r.error}));
}

/** The limits each row holds: Claude's dollar cap; for Codex, a cap refused at start, and the tool limit. */
async function budget(row: Row) {
	const {dir, copy} = fresh(`budget-${row}`);
	const before = ownerSessions();
	const out: Record<string, unknown> = {};
	if (isClaude(row)) {
		const session = `budget/${row}/${randomBytes(3).toString("hex")}`;
		const r = await runTurn(turnOf(row, copy, session, PROMPT, Answer, {usd: 0.005}));
		out.usdCap = {
			stop: r.end?.stop ?? null,
			usd: r.end?.usd ?? null,
			error: r.error,
			seconds: r.ms / 1000,
		};
	} else {
		const capped = await runTurn(turnOf(row, copy, `budget/${row}/usd`, PROMPT, Answer, {usd: 1}));
		out.usdCap = {error: capped.error, ms: capped.ms};
		const session = `budget/${row}/${randomBytes(3).toString("hex")}`;
		const r = await runTurn(turnOf(row, copy, session, PROMPT, Answer, {tools: 1}));
		const tools = new Set(r.heard.flatMap((h) => (h._tag === "tool" ? [h.id] : []))).size;
		out.toolLimit = {
			stop: r.end?.stop ?? null,
			toolsPassed: tools,
			error: r.error,
			seconds: r.ms / 1000,
		};
		Object.assign(out, afterCodex(row, session, copy, before));
	}
	console.log(JSON.stringify(out));
	save(`budget:${row}`, out);
	rmSync(dir, {recursive: true, force: true});
}

/**
 * 153's control: the detector must find what a home holds, or a 0 means nothing. A Codex home of
 * ours with a marker in its global AGENTS.md (Codex reads that file even with
 * `--ignore-user-config`, experiment 152), run once through our codex adapter.
 */
async function control() {
	const {dir, copy} = fresh("control");
	const session = `control/${randomBytes(3).toString("hex")}`;
	const home = codexHomeOf(`session:${session}`);
	const marker = `The control marker for this run is ${randomBytes(6).toString("hex")} and it means nothing.`;
	mkdirSync(home, {recursive: true, mode: 0o700});
	writeFileSync(join(home, "AGENTS.md"), `${marker}\n`);
	const before = ownerSessions();
	const r = await runTurn(
		turnOf("codex", copy, session, 'Run no tools. Fill the form with word "ok".', Word),
	);
	const text = rollouts(home);
	const out = {
		markerFound: text.includes(marker),
		answered: r.end?.answer !== null,
		error: r.error,
		loginStillLinked: linked(home),
		ownerSessionsSame: ownerSessions() === before,
	};
	rmSync(home, {recursive: true, force: true});
	console.log(JSON.stringify(out));
	save("control", out);
	rmSync(dir, {recursive: true, force: true});
}

function loc() {
	const count = (p: string) =>
		readFileSync(join(REPO, p), "utf8")
			.split("\n")
			.filter(
				(l) =>
					l.trim() !== "" &&
					!l.trim().startsWith("//") &&
					!l.trim().startsWith("*") &&
					!l.trim().startsWith("/*"),
			).length;
	const out = Object.fromEntries(
		[
			"packages/fabrika/src/agents/agent/turn.ts",
			"packages/fabrika/src/agents/agent/core.ts",
			"packages/fabrika/src/agents/agent/sessions.ts",
			"packages/fabrika/src/agents/agent/reap.ts",
			"packages/fabrika/src/agents/agent/draft.ts",
			"packages/fabrika/src/agents/agent/fake.ts",
			"packages/fabrika/src/agents/claude/adapter.ts",
			"packages/fabrika/src/agents/codex/adapter.ts",
			"packages/fabrika/src/agents/acp/adapter.ts",
			"packages/fabrika/src/agents/acp/client.ts",
			"packages/fabrika/src/agents/acp/harness.ts",
		].map((p) => [p, count(p)]),
	);
	console.log(out);
	save("loc", out);
}

function report() {
	const all = load();
	const median = (xs: number[]) => {
		const s = [...xs].sort((a, b) => a - b);
		return s.length === 0 ? null : (s[Math.floor((s.length - 1) / 2)] as number);
	};
	for (const row of ROWS) {
		const rows = (all[`job:${row}`] as Array<Record<string, unknown>> | undefined) ?? [];
		console.log(row, {
			runs: rows.length,
			ok: rows.filter((r) => r.ok).length,
			typed: rows.filter((r) => r.typed).length,
			medianSeconds: median(rows.map((r) => r.seconds as number)),
			medianOutput: median(rows.map((r) => (r.tokens as Agent.Tokens | null)?.output ?? 0)),
			usd: rows.reduce((a, r) => a + ((r.usd as number | null) ?? 0), 0),
		});
	}
}

const [step, arg, ...rest] = process.argv.slice(2);
const steps: Record<string, () => Promise<void> | void> = {
	job: () => job(rowArg(arg), Number(rest[0] ?? 1)),
	stop: () => stop(rowArg(arg)),
	resume: () => resume(rowArg(arg)),
	resume2: () => resume2(rowArg(arg), rest[0] ?? "", rest[1] ?? ""),
	budget: () => budget(rowArg(arg)),
	control,
	loc,
	report,
};
const f = step === undefined ? undefined : steps[step];
if (f === undefined) throw new Error(`a step: ${Object.keys(steps).join(", ")}`);
await f();
