// Experiment 152: run a Codex agent (OpenAI) the way the repo runs a Claude agent, and measure how
// close it comes.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/152-codex-agent.ts stream    # one job, the event stream
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/152-codex-agent.ts stop      # stop a run mid-way (TERM, INT)
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/152-codex-agent.ts schema    # typed answers, fits and misfits
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/152-codex-agent.ts limits    # what the sandbox holds
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/152-codex-agent.ts resume    # continue a thread by id
//   env -u TYPESAFE_API_KEY CLAUDE_CODE_OAUTH_TOKEN=... nice -n 15 node experiments/152-codex-agent.ts job [n]
//   node experiments/152-codex-agent.ts report                                       # no model: the summary
//
// Codex is `codex exec --json` (codex-cli 0.163.0), started straight, as the TypeScript SDK
// (`@openai/codex-sdk` 0.164.0) starts it too: the SDK is a thin wrapper that spawns
// `codex exec --experimental-json` and reads its stdout line by line. Starting it here gives the
// two flags the SDK cannot pass (`--ignore-user-config`, `--ephemeral`) and a keep-list environment.
//
// Codex signs in with the laptop's ChatGPT plan. Every run gets a temp CODEX_HOME of its own
// that holds one thing: a symlink to the login file in ~/.codex. The login file is never read,
// copied or moved by this script. With that home, nothing else of ~/.codex is loaded: not the
// owner's config.toml (its MCP servers, plugins, model), not the global AGENTS.md, not the
// sessions. The script checks the symlink is still a symlink after each step and removes the home.
//
// Claude is the repo's builder options (`builderOptions`) on the Agent SDK, with the answer typed
// by `createDraft`'s schema, the same Effect schema the Codex runs are handed. The login is
// CLAUDE_CODE_OAUTH_TOKEN, taken from the environment by `agentEnv`, never printed.
//
// Each agent works in a fresh copy of fixtures/format-bytes under WORK (default: a temp folder),
// never in the repo. At most two runs at once: in `job`, one Codex run beside one Claude run.
//
// Node at the edge: spawn, kill and ps, for a child process the script must watch and stop.

import {execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {query, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {createDraft, jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {runEnv} from "@kampus/fabrika-old/agents/sandbox";
import {builderOptions} from "@kampus/pipeline/stages/build/builder";
import {Option, Schema} from "effect";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "152-codex-agent.json");
const WORK = process.env.WORK ?? join(tmpdir(), "exp152");
const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");
const LOGIN = join(homedir(), ".codex", "auth.json");

const CODEX_MODEL = "gpt-6-luna";
const CLAUDE_MODEL = "claude-haiku-4-5";
const EFFORT = "low";
const CLAUDE_BUDGET = 0.2;

// ---------------------------------------------------------------- the job and its answer

/** The form both agents fill at the end. One Effect schema, handed to each as JSON Schema. */
const Answer = Schema.Struct({
	done: Schema.Boolean,
	ran: Schema.Array(Schema.Struct({call: Schema.String, printed: Schema.String})),
	summary: Schema.String,
});
type Answer = typeof Answer.Type;
const draft = createDraft({name: "job", output: Answer});

const PROMPT = [
	"Make formatBytes(n) in bytes.js turn a number of bytes into a short readable size.",
	'- Under 1024: the number and " B". formatBytes(512) is "512 B".',
	"- From 1024 up: divide by 1024 until the number is under 1024 or the unit is TB. Show one decimal and the unit: KB, MB, GB, TB.",
	'  formatBytes(1536) is "1.5 KB". formatBytes(1048576) is "1.0 MB".',
	'- Past TB, stay in TB: formatBytes(1024 ** 5) is "1024.0 TB".',
	"Then check it with one node command that prints formatBytes(1536) and formatBytes(5 * 1024 ** 3).",
	"At the end, fill the form: `done` (true if the function works), `ran` (each call you checked and what it printed), `summary` (one sentence).",
].join("\n");

/** The right answers, checked by code after the run. The agent sees three of them. */
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

/** How many of the right answers the copy's bytes.js gives. Run by code, outside any agent. */
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

// ---------------------------------------------------------------- folders

const fresh = (name: string) => {
	const dir = join(WORK, `${name}-${randomBytes(3).toString("hex")}`);
	const copy = join(dir, "copy");
	mkdirSync(dir, {recursive: true});
	cpSync(FIXTURE, copy, {recursive: true});
	return {dir, copy};
};

/** A Codex home that holds only a symlink to the login: nothing else of ~/.codex is loaded. */
const codexHome = (dir: string) => {
	const home = join(dir, "codex-home");
	mkdirSync(home, {recursive: true});
	symlinkSync(LOGIN, join(home, "auth.json"));
	return home;
};

/** True when the home's login is still the symlink it was made as, never a file of its own. */
const loginStillLinked = (home: string) => lstatSync(join(home, "auth.json")).isSymbolicLink();

/** The rollout Codex wrote for a thread in this home: its plan usage line and token records. */
const rollout = (home: string, thread: string) => {
	const walk = (d: string): string[] =>
		existsSync(d)
			? readdirSync(d).flatMap((n) => {
					const p = join(d, n);
					return statSync(p).isDirectory() ? walk(p) : [p];
				})
			: [];
	const file = walk(join(home, "sessions")).find((f) => f.includes(thread));
	if (file === undefined) return null;
	const lines = readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as {type: string; payload?: Record<string, unknown>});
	const counts = lines.filter((l) => l.payload?.type === "token_count");
	const last = counts.at(-1)?.payload as
		| {rate_limits?: {primary?: {used_percent: number; window_minutes: number}; limit_id?: string}}
		| undefined;
	// Only the shape of the plan's limit: which window and how much of it is used. No account, no balance.
	const limit = last?.rate_limits?.primary;
	return {
		tokenCountEvents: counts.length,
		planLimit:
			limit === undefined
				? null
				: {
						id: last?.rate_limits?.limit_id ?? null,
						windowMinutes: limit.window_minutes,
						usedPercent: limit.used_percent,
					},
	};
};

// ---------------------------------------------------------------- Codex: one run

interface CodexRun {
	readonly copy: string;
	readonly home: string;
	readonly prompt: string;
	readonly schema?: Record<string, unknown>;
	readonly resume?: string;
	/** `profile`: no `--sandbox`, so a permission profile in `extra` applies (the two do not combine). */
	readonly sandbox?: "read-only" | "workspace-write" | "profile";
	readonly extra?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	/** Called on every event, with the child, so a step can stop it. */
	readonly onEvent?: (event: CodexEvent, child: ReturnType<typeof spawn>) => void;
}

type Usage = {
	readonly input_tokens: number;
	readonly cached_input_tokens: number;
	readonly output_tokens: number;
	readonly reasoning_output_tokens: number;
};
type Item = {
	readonly id: string;
	readonly type: string;
	readonly text?: string;
	readonly command?: string;
	readonly exit_code?: number | null;
	readonly aggregated_output?: string;
	readonly status?: string;
	readonly changes?: ReadonlyArray<{path: string; kind: string}>;
	readonly tool?: string;
	readonly server?: string;
};
type CodexEvent =
	| {readonly type: "thread.started"; readonly thread_id: string}
	| {readonly type: "turn.started"}
	| {readonly type: "turn.completed"; readonly usage: Usage}
	| {readonly type: "turn.failed"; readonly error: {message: string}}
	| {readonly type: "item.started" | "item.updated" | "item.completed"; readonly item: Item}
	| {readonly type: "error"; readonly message: string};

interface CodexResult {
	readonly events: CodexEvent[];
	readonly exit: {code: number | null; signal: string | null};
	readonly ms: number;
	readonly stderrTail: string;
}

/** The environment a Codex process is handed: what a program needs, and where its home is. */
const codexEnv = (home: string, more: Readonly<Record<string, string>> = {}) => ({
	...runEnv(),
	...(process.env.USER === undefined ? {} : {USER: process.env.USER}),
	CODEX_HOME: home,
	...more,
});

const codexArgs = (run: CodexRun, schemaFile: string | null) => [
	"exec",
	"--json",
	"--skip-git-repo-check",
	...(run.sandbox === "profile" ? [] : ["-s", run.sandbox ?? "workspace-write"]),
	"-C",
	run.copy,
	"-m",
	CODEX_MODEL,
	"-c",
	`model_reasoning_effort="${EFFORT}"`,
	"-c",
	'web_search="disabled"',
	"-c",
	'approval_policy="never"',
	...(run.sandbox === "profile" ? [] : ["-c", "sandbox_workspace_write.network_access=false"]),
	...(run.extra ?? []),
	...(schemaFile === null ? [] : ["--output-schema", schemaFile]),
	...(run.resume === undefined ? [] : ["resume", run.resume]),
	run.prompt,
];

const runCodex = (run: CodexRun): Promise<CodexResult> =>
	new Promise((done) => {
		const schemaFile = run.schema === undefined ? null : join(dirname(run.copy), "schema.json");
		if (schemaFile !== null) writeFileSync(schemaFile, JSON.stringify(run.schema));
		const start = Date.now();
		const child = spawn(CODEX, codexArgs(run, schemaFile), {
			env: codexEnv(run.home, run.env),
			stdio: ["ignore", "pipe", "pipe"],
		});
		const events: CodexEvent[] = [];
		let buffer = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim() === "") continue;
				const event = JSON.parse(line) as CodexEvent;
				events.push(event);
				run.onEvent?.(event, child);
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-2000);
		});
		child.on("exit", (code, signal) =>
			done({events, exit: {code, signal}, ms: Date.now() - start, stderrTail: stderr.slice(-400)}),
		);
	});

// ---------------------------------------------------------------- Codex events as the Draft's Msgs

/**
 * What the repo's Draft would make of one Codex event: the sketch of a `codex` runner's fold.
 * A tool call is a command, a file change, an MCP call or a web search when it starts; the end is
 * `turn.completed` (finished, the answer read by the same reader as Claude's) or `turn.failed`
 * and `error` (failed). Codex has no cost and no turn count, so those stay out.
 */
type Msg =
	| {readonly type: "job_tool"; readonly tool: string}
	| {
			readonly type: "job_finished";
			readonly output: Answer | null;
			readonly session: string;
			readonly usage: Usage;
	  }
	| {readonly type: "job_failed"; readonly error: string};

const read = reader(Answer);
const readText = (text: string | null): Answer | null => {
	if (text === null) return null;
	try {
		return Option.getOrNull(read(JSON.parse(text)));
	} catch {
		// Not JSON at all: no answer, as a misfit is.
		return null;
	}
};

const toolOf = (item: Item): string | null => {
	switch (item.type) {
		case "command_execution":
			return "shell";
		case "file_change":
			return "edit";
		case "mcp_tool_call":
			return `mcp:${item.server}/${item.tool}`;
		case "web_search":
			return "web_search";
		default:
			return null;
	}
};

const foldCodex = (events: readonly CodexEvent[]): Msg[] => {
	let thread = "";
	let last: string | null = null;
	const out: Msg[] = [];
	for (const e of events) {
		if (e.type === "thread.started") thread = e.thread_id;
		else if (e.type === "item.started") {
			// Every tool call starts once, a file change too (codex-cli 0.163.0).
			const tool = toolOf(e.item);
			if (tool !== null) out.push({type: "job_tool", tool});
		}
		if (e.type === "item.completed" && e.item.type === "agent_message") last = e.item.text ?? null;
		if (e.type === "turn.completed")
			out.push({type: "job_finished", output: readText(last), session: thread, usage: e.usage});
		if (e.type === "turn.failed") out.push({type: "job_failed", error: e.error.message});
		if (e.type === "error") out.push({type: "job_failed", error: e.message});
	}
	return out;
};

const lastText = (events: readonly CodexEvent[]) =>
	events
		.flatMap((e) =>
			e.type === "item.completed" && e.item.type === "agent_message" ? [e.item.text ?? ""] : [],
		)
		.at(-1) ?? null;

// ---------------------------------------------------------------- results file

type Results = Record<string, unknown>;
const load = (): Results =>
	existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as Results) : {};
const save = (key: string, value: unknown) => {
	const all = load();
	all[key] = value;
	all.setup = {
		codexCli: "0.163.0",
		codexSdkRead:
			"@openai/codex-sdk 0.164.0 (read, not run: it spawns `codex exec --experimental-json`)",
		claudeAgentSdk: "0.3.296",
		codexModel: CODEX_MODEL,
		claudeModel: CLAUDE_MODEL,
		effort: EFFORT,
		fixture: "fixtures/format-bytes",
	};
	writeFileSync(RESULTS, `${JSON.stringify(all, null, "\t")}\n`);
};

/** Strip a run's own folders from text kept in the results: no machine path is saved. */
const scrub = (text: string, dir: string) =>
	text.split(dir).join("<run>").split(WORK).join("<work>").split(homedir()).join("~");

// ---------------------------------------------------------------- steps

/** One Codex run of the job, every event kept by its type, and what the fold makes of them. */
async function stream() {
	const {dir, copy} = fresh("stream");
	const home = codexHome(dir);
	const r = await runCodex({copy, home, prompt: PROMPT, schema: jsonSchema(Answer)});
	const msgs = foldCodex(r.events);
	const summary = {
		exit: r.exit,
		ms: r.ms,
		eventTypes: r.events.map((e) => ("item" in e ? `${e.type}:${e.item.type}` : e.type)),
		items: r.events.flatMap((e) =>
			e.type === "item.completed"
				? [
						{
							type: e.item.type,
							command: e.item.command === undefined ? undefined : scrub(e.item.command, dir),
							exit: e.item.exit_code,
							changes: e.item.changes?.map((c) => ({kind: c.kind, path: scrub(c.path, dir)})),
							text: e.item.type === "agent_message" ? e.item.text : undefined,
						},
					]
				: [],
		),
		msgs,
		graded: graded(copy),
		of: TRUTH.length,
		rollout: rollout(home, msgs.find((m) => m.type === "job_finished")?.session ?? "none"),
		loginStillLinked: loginStillLinked(home),
	};
	console.log(JSON.stringify(summary, null, 1));
	save("stream", summary);
	rmSync(dir, {recursive: true, force: true});
}

/** Processes whose command line holds `mark`, by pid. */
const alive = (mark: string): number[] =>
	String(execFileSync("ps", ["-axo", "pid=,command="]))
		.split("\n")
		.filter((l) => l.includes(mark) && !l.includes("ps -axo"))
		.map((l) => Number(l.trim().split(/\s+/)[0]));

/** Start a long command, stop Codex as soon as the command starts, and see what is left. */
async function stop() {
	const out: unknown[] = [];
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		const {dir, copy} = fresh(`stop-${signal}`);
		const home = codexHome(dir);
		const seconds = `${100 + Math.floor(Math.random() * 800)}.${Math.floor(Math.random() * 9) + 1}`;
		const mark = `sleep ${seconds}`;
		let sentAt = 0;
		let sawCommand = false;
		const startedAt = Date.now();
		const r = await runCodex({
			copy,
			home,
			prompt: `Run this shell command and wait for it to end: ${mark}\nThen reply with the word done.`,
			onEvent: (e, child) => {
				if (sentAt === 0 && e.type === "item.started" && e.item.type === "command_execution") {
					sawCommand = true;
					// Let the command really start before the stop.
					setTimeout(() => {
						sentAt = Date.now();
						child.kill(signal);
					}, 1500);
				}
			},
		});
		const leftNow = alive(mark).length;
		await new Promise((r2) => setTimeout(r2, 3000));
		const leftAfter3s = alive(mark);
		for (const pid of leftAfter3s) {
			// Clean up whatever survived, and say so in the results.
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		const row = {
			signal,
			sawCommand,
			msToExit: sentAt === 0 ? null : startedAt + r.ms - sentAt,
			exit: r.exit,
			lastEvent: r.events.at(-1)?.type ?? null,
			sleepLeftAtExit: leftNow,
			sleepLeftAfter3s: leftAfter3s.length,
			loginStillLinked: loginStillLinked(home),
		};
		out.push(row);
		console.log(row);
		rmSync(dir, {recursive: true, force: true});
	}
	save("stop", out);
}

/** The same Effect schema as JSON Schema: a fit, a prompt that asks for a misfit, a schema strict mode refuses, and no schema. */
async function schema() {
	const Loose = Schema.Struct({done: Schema.Boolean, note: Schema.optional(Schema.String)});
	const cases: ReadonlyArray<{name: string; prompt: string; schema?: Record<string, unknown>}> = [
		{
			name: "fit",
			prompt:
				"Do not run anything. Fill the form: done true, ran an empty list, summary 'nothing to do'.",
			schema: jsonSchema(Answer),
		},
		{
			name: "asked-to-misfit",
			prompt:
				'Do not run anything. Reply with exactly this JSON and nothing else: {"done": "maybe", "extra": 1}',
			schema: jsonSchema(Answer),
		},
		{
			name: "strict-refuses-optional",
			prompt: "Do not run anything. Fill the form with done true.",
			schema: jsonSchema(Loose),
		},
		{name: "no-schema", prompt: "Do not run anything. Reply with the word ok."},
	];
	const out: unknown[] = [];
	for (const c of cases) {
		const {dir, copy} = fresh(`schema-${c.name}`);
		const home = codexHome(dir);
		const r = await runCodex({
			copy,
			home,
			prompt: c.prompt,
			sandbox: "read-only",
			...(c.schema === undefined ? {} : {schema: c.schema}),
		});
		const text = lastText(r.events);
		const row = {
			name: c.name,
			exit: r.exit,
			text,
			read: readText(text),
			msgs: foldCodex(r.events).map((m) =>
				m.type === "job_finished" ? {type: m.type, output: m.output} : m,
			),
			error: r.events.flatMap((e) =>
				e.type === "error" || e.type === "turn.failed" ? [scrub(JSON.stringify(e), dir)] : [],
			),
			stderrTail: r.exit.code === 0 ? "" : scrub(r.stderrTail, dir),
			loginStillLinked: loginStillLinked(home),
		};
		out.push(row);
		console.log(JSON.stringify(row));
		rmSync(dir, {recursive: true, force: true});
	}
	save("schema", out);
}

/** What the sandbox holds, judged by each command's exit code and output, in workspace-write. */
async function limits() {
	const variants: ReadonlyArray<{
		name: string;
		profile: boolean;
		extra: (dir: string) => readonly string[];
	}> = [
		{name: "workspace-write", profile: false, extra: () => []},
		{
			name: "workspace-write, core env, no login shell",
			profile: false,
			extra: () => [
				"-c",
				'shell_environment_policy.inherit="core"',
				"-c",
				"allow_login_shell=false",
			],
		},
		{
			// The temp folders off the writable list: only the copy is written.
			name: "workspace-write, no tmp roots, core env",
			profile: false,
			extra: () => [
				"-c",
				"sandbox_workspace_write.exclude_slash_tmp=true",
				"-c",
				"sandbox_workspace_write.exclude_tmpdir_env_var=true",
				"-c",
				'shell_environment_policy.inherit="core"',
			],
		},
		{
			// A permission profile (beta): the built-in workspace one, with home and the run's outside folder denied.
			name: "profile :workspace, home and outside denied",
			profile: true,
			extra: (dir) => [
				"-c",
				'default_permissions="box"',
				"-c",
				'permissions.box.extends=":workspace"',
				// One inline table: a quoted path in a dotted `-c` key keeps its quotes.
				"-c",
				// Codex's own binary lives in home, and Codex runs it inside the box: those two folders stay readable.
				`permissions.box.filesystem={"${homedir()}"="deny", "${join(homedir(), ".local", "bin")}"="read", "${join(homedir(), ".codex", "packages")}"="read", "${join(dir, "outside")}"="deny"}`,
				"-c",
				'shell_environment_policy.inherit="core"',
			],
		},
	];
	// ONLY=<part of a name> reruns the variants that match, keeping the other rows.
	const only = process.env.ONLY;
	const kept = ((load().limits as Array<{variant: string}> | undefined) ?? []).filter(
		(row) => only !== undefined && !row.variant.includes(only),
	);
	const out: unknown[] = [...kept];
	for (const v of variants.filter((x) => only === undefined || x.name.includes(only))) {
		const {dir, copy} = fresh("limits");
		const home = codexHome(dir);
		const outside = join(dir, "outside");
		mkdirSync(outside);
		const word = randomBytes(6).toString("hex");
		writeFileSync(join(outside, "canary.txt"), word);
		const steps = [
			`cat ${join(outside, "canary.txt")}`,
			`echo x > ${join(outside, "written.txt")}`,
			"echo x > ./inside.txt",
			"curl -sS -m 10 -o /dev/null -w '%{http_code}' https://example.com",
			'echo "mark=$EXP152_MARK"',
			"ls -a ~/.ssh | wc -l",
		];
		const r = await runCodex({
			copy,
			home,
			env: {EXP152_MARK: "seen"},
			extra: v.extra(dir),
			...(v.profile ? {sandbox: "profile" as const} : {}),
			prompt: [
				"This is a test of a sandbox. Run each command below as its own shell command, in order.",
				"If one fails, do not retry it or work around it; go on to the next.",
				...steps.map((s, i) => `${i + 1}. ${s}`),
				"Then reply with one line per step: its number, then ok or failed.",
			].join("\n"),
		});
		const commands = r.events.flatMap((e) =>
			e.type === "item.completed" && e.item.type === "command_execution" ? [e.item] : [],
		);
		const of = (needle: string) => commands.filter((c) => c.command?.includes(needle));
		const ok = (needle: string) => of(needle).some((c) => c.exit_code === 0);
		const sshCount = of("~/.ssh")
			.map((c) => Number((c.aggregated_output ?? "").trim()))
			.find((n) => Number.isFinite(n));
		const row = {
			variant: v.name,
			commands: commands.length,
			canaryRead: of("canary.txt").some((c) => (c.aggregated_output ?? "").includes(word)),
			wroteOutside: existsSync(join(outside, "written.txt")),
			wroteInside: existsSync(join(copy, "inside.txt")),
			networkReached: of("example.com").some(
				(c) => /^\d{3}$/.test((c.aggregated_output ?? "").trim()) && c.exit_code === 0,
			),
			networkOutput: of("example.com").map((c) =>
				scrub((c.aggregated_output ?? "").slice(0, 120), dir),
			),
			envMarkSeen: of("EXP152_MARK").some((c) => (c.aggregated_output ?? "").includes("mark=seen")),
			homeListed: sshCount !== undefined && sshCount > 2 && ok("~/.ssh"),
			shells: [...new Set(commands.map((c) => (c.command ?? "").split(" ").slice(0, 2).join(" ")))],
			exit: r.exit,
			failed: r.events.flatMap((e) =>
				e.type === "error" || e.type === "turn.failed"
					? [scrub(JSON.stringify(e).slice(0, 300), dir)]
					: [],
			),
			stderrTail: r.exit.code === 0 ? "" : scrub(r.stderrTail, dir),
			loginStillLinked: loginStillLinked(home),
		};
		out.push(row);
		console.log(row);
		rmSync(dir, {recursive: true, force: true});
	}
	save("limits", out);
}

/** A thread told a word, then continued by its id and asked for it. */
async function resume() {
	const {dir, copy} = fresh("resume");
	const home = codexHome(dir);
	const word =
		["amber", "cobalt", "saffron", "teal", "umber"][Math.floor(Math.random() * 5)] ?? "teal";
	const first = await runCodex({
		copy,
		home,
		sandbox: "read-only",
		prompt: `Remember this word for later: ${word}. Do not run anything. Reply with the word ok.`,
	});
	const thread = first.events.find((e) => e.type === "thread.started");
	const id = thread?.type === "thread.started" ? thread.thread_id : "";
	const second = await runCodex({
		copy,
		home,
		sandbox: "read-only",
		resume: id,
		prompt: "Which word did I ask you to remember? Reply with that word only.",
	});
	const again = second.events.find((e) => e.type === "thread.started");
	const usage = (r: CodexResult) =>
		r.events.flatMap((e) => (e.type === "turn.completed" ? [e.usage] : []))[0] ?? null;
	const row = {
		firstExit: first.exit,
		secondExit: second.exit,
		sameThread: again?.type === "thread.started" && again.thread_id === id,
		remembered: (lastText(second.events) ?? "").toLowerCase().includes(word),
		firstUsage: usage(first),
		secondUsage: usage(second),
		loginStillLinked: loginStillLinked(home),
	};
	console.log(row);
	save("resume", row);
	rmSync(dir, {recursive: true, force: true});
}

// ---------------------------------------------------------------- the job, both agents

interface JobRow {
	readonly agent: "codex" | "claude";
	readonly n: number;
	readonly ok: boolean;
	readonly graded: number;
	readonly typed: boolean;
	readonly claimedDone: boolean | null;
	readonly seconds: number;
	readonly tools: number;
	/** Every input token, cached or not, and every output token. */
	readonly input: number;
	readonly cached: number;
	readonly output: number;
	readonly costUsd: number | null;
	readonly planLimit?: unknown;
	readonly error?: string;
}

async function codexJob(n: number): Promise<JobRow> {
	const {dir, copy} = fresh(`job-codex-${n}`);
	const home = codexHome(dir);
	const r = await runCodex({copy, home, prompt: PROMPT, schema: jsonSchema(Answer)});
	const msgs = foldCodex(r.events);
	const end = msgs.find((m) => m.type === "job_finished" || m.type === "job_failed");
	const g = graded(copy);
	const roll = end?.type === "job_finished" ? rollout(home, end.session) : null;
	const row: JobRow = {
		agent: "codex",
		n,
		ok: g === TRUTH.length,
		graded: g,
		typed: end?.type === "job_finished" && end.output !== null,
		claimedDone: end?.type === "job_finished" ? (end.output?.done ?? null) : null,
		seconds: r.ms / 1000,
		tools: msgs.filter((m) => m.type === "job_tool").length,
		input: end?.type === "job_finished" ? end.usage.input_tokens : 0,
		cached: end?.type === "job_finished" ? end.usage.cached_input_tokens : 0,
		output: end?.type === "job_finished" ? end.usage.output_tokens : 0,
		costUsd: null,
		planLimit: roll?.planLimit ?? null,
		...(end?.type === "job_failed" ? {error: scrub(end.error, dir)} : {}),
	};
	if (!loginStillLinked(home)) throw new Error("the login in the temp home is no longer a symlink");
	rmSync(dir, {recursive: true, force: true});
	return row;
}

async function claudeJob(n: number): Promise<JobRow> {
	const {dir, copy} = fresh(`job-claude-${n}`);
	const start = Date.now();
	const refused: string[] = [];
	const options = {
		...builderOptions(
			{model: CLAUDE_MODEL, effort: EFFORT, budget: CLAUDE_BUDGET},
			copy,
			(tool, why) => refused.push(`${tool}: ${why}`),
		),
		persistSession: false,
		outputFormat: {type: "json_schema" as const, schema: draft.schema},
	};
	const run = {
		key: "job",
		id: `claude-${n}`,
		prompt: PROMPT,
		session: {id: "", continues: false},
		agent: null,
		folder: null,
	};
	let tools = 0;
	let end: ReturnType<typeof draft.msgsOf>[number] | null = null;
	let usage: {
		input_tokens: number;
		output_tokens: number;
		cache_read_input_tokens?: number | null;
		cache_creation_input_tokens?: number | null;
	} | null = null;
	try {
		for await (const m of query({prompt: PROMPT, options}) as AsyncIterable<SDKMessage>) {
			if (m.type === "result") usage = m.usage;
			for (const msg of draft.msgsOf(m, run)) {
				if (draft.is.tool(msg)) tools += 1;
				else end = msg;
			}
		}
	} catch (error) {
		if (end === null)
			end = {
				type: "job_failed",
				key: "job",
				id: run.id,
				error: String(error),
				spend: {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0},
			};
	}
	const g = graded(copy);
	const finished = end !== null && draft.is.finished(end) ? end : null;
	const row: JobRow = {
		agent: "claude",
		n,
		ok: g === TRUTH.length,
		graded: g,
		typed: finished !== null && finished.output !== null,
		claimedDone: finished?.output?.done ?? null,
		seconds: (Date.now() - start) / 1000,
		tools,
		input:
			usage === null
				? 0
				: usage.input_tokens +
					(usage.cache_read_input_tokens ?? 0) +
					(usage.cache_creation_input_tokens ?? 0),
		cached: usage?.cache_read_input_tokens ?? 0,
		output: usage?.output_tokens ?? 0,
		costUsd: end === null ? null : end.spend.costUsd,
		...(end !== null && draft.is.failed(end) ? {error: scrub(end.error, dir)} : {}),
		...(refused.length > 0 ? {error: `refused: ${refused.length}`} : {}),
	};
	rmSync(dir, {recursive: true, force: true});
	return row;
}

async function job(count: number) {
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined)
		throw new Error("job needs CLAUDE_CODE_OAUTH_TOKEN for the Claude runs");
	const rows: JobRow[] = (load().job as JobRow[] | undefined) ?? [];
	const start = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.n)) + 1;
	for (let n = start; n < start + count; n++) {
		// Two at once at most: one Codex run beside one Claude run.
		const pair = await Promise.all([codexJob(n), claudeJob(n)]);
		for (const row of pair) console.log(JSON.stringify(row));
		rows.push(...pair);
		save("job", rows);
	}
}

function report() {
	const all = load();
	const rows = (all.job as JobRow[] | undefined) ?? [];
	const median = (xs: number[]) => {
		const s = [...xs].sort((a, b) => a - b);
		const m = Math.floor(s.length / 2);
		return s.length === 0
			? 0
			: s.length % 2 === 1
				? (s[m] ?? 0)
				: ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
	};
	const by = (agent: "codex" | "claude") => {
		const r = rows.filter((x) => x.agent === agent);
		return {
			runs: r.length,
			right: r.filter((x) => x.ok).length,
			typed: r.filter((x) => x.typed).length,
			claimedDoneButWrong: r.filter((x) => x.claimedDone === true && !x.ok).length,
			medianSeconds: median(r.map((x) => x.seconds)),
			medianTools: median(r.map((x) => x.tools)),
			medianInput: median(r.map((x) => x.input)),
			medianCached: median(r.map((x) => x.cached)),
			medianOutput: median(r.map((x) => x.output)),
			dollars: r.reduce((s, x) => s + (x.costUsd ?? 0), 0),
		};
	};
	const summary = {codex: by("codex"), claude: by("claude")};
	console.log(JSON.stringify(summary, null, 1));
	save("summary", summary);
}

const [step = "report", arg] = process.argv.slice(2);
mkdirSync(WORK, {recursive: true});
const steps: Record<string, () => unknown> = {
	stream,
	stop,
	schema,
	limits,
	resume,
	job: () => job(Number(arg ?? 5)),
	report,
};
const chosen = steps[step];
if (chosen === undefined) throw new Error(`unknown step ${step}: ${Object.keys(steps).join(", ")}`);
await chosen();
