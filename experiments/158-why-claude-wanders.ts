// Experiment 158: why Claude through our Agent SDK adapter sometimes wanders on the format-bytes
// job, when Claude through ACP does not, though ACP's Claude adapter is built on the same SDK.
// Experiment 156's job, its graded cases and its service; only the options change, one variant
// at a time:
//
//   ours      our adapter as it was in 156: no system prompt named, so the SDK sends an empty one
//   no-guard  ours, the PreToolUse guard hook off
//   preset    ours, with Claude Code's own system prompt (the `claude_code` preset), as ACP has it
//   as-acp    our adapter on ACP's options, as far as they go: the preset, `acceptEdits` and a
//             refusing `canUseTool` in place of `dontAsk` and the guard, the schema in the prompt
//             in place of `outputFormat`, streamed input, partial messages, no effort
//   acp       Claude through ACP as 156 ran it (@agentclientprotocol/claude-agent-acp 0.85.1)
//   after     our adapter as it is now (the fix: the preset, auto memory off)
//   no-format after, with no `outputFormat`: the schema in the prompt, as on the ACP row
//
//   P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
//   $P node experiments/158-why-claude-wanders.ts models       # no model call: what `haiku` is, effort
//   node experiments/158-why-claude-wanders.ts old             # no model call: 156's saved transcripts
//   $P node experiments/158-why-claude-wanders.ts job all 2    # the first five in turn, n rounds
//   $P node experiments/158-why-claude-wanders.ts job after,no-format 10 # these in turn
//   node experiments/158-why-claude-wanders.ts report          # no model: the table, the pools
//
// As run: `job all 2` (the pilot), `job all 8`, `job after,no-format 10`, then `job ours,after 6`,
// so that before and after also ran in turn. 82 runs, $4.37.
//
// Claude signs in as in 156: `agentEnv` hands the agent `USER` (the keychain login) and
// CLAUDE_CODE_OAUTH_TOKEN when set; nothing here reads or prints a login. Each run works in a
// fresh copy of fixtures/format-bytes under WORK, one run at a time, and stops starting runs once
// the dollars saved reach STOP_USD.
//
// What each run did is read back from the transcript Claude Code saves for its folder, under
// ~/.claude/projects (read only): the system prompt it recorded, the model of every request, each
// tool call and whether its result was an error, and the first version of bytes.js it wrote,
// graded on its own. Paths and the user's name are scrubbed before anything is saved.
//
// Node at the edge: fs for the copies and the transcripts, a child `node` for the grading.

import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {homedir, tmpdir, userInfo} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {type Options, query, type SDKUserMessage} from "@anthropic-ai/claude-agent-sdk";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent} from "@kampus/fabrika";
import {ADAPTERS, acpAdapter} from "@kampus/fabrika/agents/acp";
import {claudeAdapter, type Open} from "@kampus/fabrika/agents/claude";
import {psReaper} from "@kampus/fabrika/agents/codex";
import {agentEnv, fencedEnv, runEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, Exit, Schema, Stream} from "effect";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FIXTURE = join(REPO, "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "158-why-claude-wanders.json");
const WORK = realOrSelf(process.env.WORK ?? join(tmpdir(), "exp158"));
const PROJECTS = join(homedir(), ".claude", "projects");
const OLD = process.env.OLD ?? "w156-job-";
const STOP_USD = 4.75;
const CLAUDE_BUDGET = 0.2;

function realOrSelf(p: string) {
	mkdirSync(p, {recursive: true});
	return realpathSync(p);
}

// ---------------------------------------------------------------- the job (experiments 152, 156)

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

/** A text with this machine's paths and the user's name taken out: any other absolute path becomes `<path>`. */
const scrub = (text: string) =>
	[
		[WORK, "<work>"],
		[realOrSelf(tmpdir()), "<tmp>"],
		[tmpdir(), "<tmp>"],
		[homedir(), "~"],
		[userInfo().username, "<user>"],
	]
		.reduce((t, [from, to]) => t.split(from as string).join(to as string), text)
		.replace(/\/(?:private|var|tmp|Users|home)\/[^\s'"`)]*/g, "<path>");

// ---------------------------------------------------------------- what a run did, from its transcript

const DENIED =
	/denied|refused|not allowed|permission|outside your working copy|outside the code|Do not |foreground/i;

interface Trace {
	/** The model of every request, as the API named it. */
	readonly models: readonly string[];
	/** Characters of the system prompt the run recorded; 0 is an empty one. */
	readonly prompt: number | null;
	/** Whether that prompt tells the agent to keep a memory folder (under ~/.claude). */
	readonly memory: boolean | null;
	/** The first request's input tokens, cache included. */
	readonly first: number | null;
	/** Output tokens of each model request, in order. */
	readonly outs: readonly number[];
	/** Each tool call by name, `!` after it when its result was an error. */
	readonly calls: readonly string[];
	readonly errors: ReadonlyArray<{tool: string; kind: "denied" | "failed"; text: string}>;
	/** Edit and Write calls on bytes.js. */
	readonly edits: number;
	/** The graded cases of the first bytes.js the run wrote, on its own. */
	readonly firstRight: number | null;
}

type Line = Record<string, unknown> & {type?: string};
type Block = Record<string, unknown> & {type?: string};

const blocksOf = (line: Line): Block[] => {
	const m = line.message as {content?: unknown} | undefined;
	return Array.isArray(m?.content) ? (m.content as Block[]) : [];
};

/** The first version of bytes.js a run wrote, as a Write's content or an Edit on the fixture's own. */
const firstVersion = (uses: Block[]): string | null => {
	const original = readFileSync(join(FIXTURE, "bytes.js"), "utf8");
	const first = uses.find(
		(b) =>
			(b.name === "Edit" || b.name === "Write") &&
			String((b.input as {file_path?: unknown}).file_path ?? "").endsWith("bytes.js"),
	);
	if (first === undefined) return null;
	const input = first.input as {content?: string; old_string?: string; new_string?: string};
	if (first.name === "Write") return input.content ?? null;
	const old = input.old_string ?? "";
	return old !== "" && original.includes(old)
		? original.replace(old, input.new_string ?? "")
		: null;
};

const gradeText = (text: string | null): number | null => {
	if (text === null) return null;
	const {dir, copy} = fresh("first");
	writeFileSync(join(copy, "bytes.js"), text);
	const g = graded(copy);
	rmSync(dir, {recursive: true, force: true});
	return g;
};

const traceOf = (file: string): Trace => {
	const lines = readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as Line);
	const snapshot = lines.find(
		(l) => l.type === "attachment" && (l.attachment as {type?: string}).type === "prompt_snapshot",
	);
	const recorded = (snapshot?.attachment as {systemPrompt?: unknown} | undefined)?.systemPrompt;
	const requests = new Map<string, {input: number; output: number; model: string}>();
	const uses: Block[] = [];
	const results = new Map<string, {error: boolean; text: string}>();
	for (const l of lines) {
		if (l.type === "assistant") {
			const m = l.message as {
				id: string;
				model: string;
				usage: Record<string, number | undefined>;
			};
			const u = m.usage;
			requests.set(m.id, {
				input:
					(u.input_tokens ?? 0) +
					(u.cache_read_input_tokens ?? 0) +
					(u.cache_creation_input_tokens ?? 0),
				output: u.output_tokens ?? 0,
				model: m.model,
			});
			for (const b of blocksOf(l)) if (b.type === "tool_use") uses.push(b);
		}
		if (l.type === "user")
			for (const b of blocksOf(l))
				if (b.type === "tool_result") {
					const c = b.content;
					const text = typeof c === "string" ? c : JSON.stringify(c ?? "");
					results.set(String(b.tool_use_id), {error: b.is_error === true, text});
				}
	}
	const reqs = [...requests.values()];
	const system = Array.isArray(recorded)
		? recorded.join("")
		: typeof recorded === "string"
			? recorded
			: null;
	const errors = uses.flatMap((b) => {
		const r = results.get(String(b.id));
		if (r === undefined || !r.error) return [];
		return [
			{
				tool: String(b.name),
				kind: DENIED.test(r.text) ? ("denied" as const) : ("failed" as const),
				text: scrub(r.text).replace(/\s+/g, " ").slice(0, 120),
			},
		];
	});
	return {
		models: [...new Set(reqs.map((r) => r.model))],
		prompt: system?.length ?? null,
		memory: system === null ? null : system.includes("# auto memory"),
		first: reqs[0]?.input ?? null,
		outs: reqs.map((r) => r.output),
		calls: uses.map((b) => `${String(b.name)}${results.get(String(b.id))?.error ? "!" : ""}`),
		errors,
		edits: uses.filter(
			(b) =>
				(b.name === "Edit" || b.name === "Write") &&
				String((b.input as {file_path?: unknown}).file_path ?? "").endsWith("bytes.js"),
		).length,
		firstRight: gradeText(firstVersion(uses)),
	};
};

/** The transcript Claude Code saved for a run in `copy`: its folder name is the path, every other character a dash. */
const transcriptOf = (copy: string): string | null => {
	const name = copy.replace(/[^a-zA-Z0-9]/g, "-");
	const dir = join(PROJECTS, name);
	if (!existsSync(dir)) return null;
	const file = readdirSync(dir).find((f) => f.endsWith(".jsonl"));
	return file === undefined ? null : join(dir, file);
};

// ---------------------------------------------------------------- the variants

/** What the SDK result said of the models it used, for the variants on our adapter. */
const seen = {models: [] as string[], asks: 0};

const watched =
	(open: Open): Open =>
	(params) => {
		const q = open(params);
		const it = async function* () {
			for await (const m of q) {
				if (m.type === "result") seen.models = Object.keys(m.modelUsage ?? {});
				yield m;
			}
		};
		return Object.assign(it(), {interrupt: () => q.interrupt(), close: () => q.close()});
	};

/**
 * The query as ACP's adapter opens it: no `outputFormat` (ACP has no schema field), and the
 * prompt as one user message on a stream kept open until the result.
 */
const acpOpen = (params: {prompt: string; options: Options}) => {
	const {outputFormat: _none, ...options} = params.options;
	let done = () => {};
	const ended = new Promise<void>((ok) => {
		done = ok;
	});
	async function* input(): AsyncGenerator<SDKUserMessage> {
		yield {
			type: "user",
			message: {role: "user", content: [{type: "text", text: params.prompt}]},
			parent_tool_use_id: null,
		};
		await ended;
	}
	const q = query({prompt: input(), options});
	const it = async function* () {
		try {
			for await (const m of q) {
				yield m;
				if (m.type === "result") done();
			}
		} finally {
			done();
		}
	};
	return Object.assign(it(), {interrupt: () => q.interrupt(), close: () => q.close()});
};

/** The query with no `outputFormat`, the prompt as it is: only the schema field differs. */
const textOpen = (params: {prompt: string; options: Options}) => {
	const {outputFormat: _none, ...options} = params.options;
	return query({prompt: params.prompt, options});
};

const PRESET = {type: "preset", preset: "claude_code"} as const;
const CONNECTORS_OFF = {disableClaudeAiConnectors: true};

/** The adapter before this change named no system prompt; `more` cannot unset a key, so it is set to what the SDK sends then. */
const EMPTY = "";

/** ACP's options (0.85.1, `createSession`) that are not already ours, as far as they cross into the SDK. */
const acpOptions = (): Partial<Options> => ({
	systemPrompt: PRESET,
	settings: CONNECTORS_OFF,
	permissionMode: "acceptEdits",
	hooks: {},
	canUseTool: async () => {
		seen.asks++;
		return {behavior: "deny", message: "The user refused this tool call."};
	},
	includePartialMessages: true,
	extraArgs: {"replay-user-messages": ""},
	disallowedTools: ["AskUserQuestion"],
	env: {...fencedEnv(agentEnv()), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1"},
});

const VARIANTS = ["ours", "no-guard", "preset", "as-acp", "acp", "after", "no-format"] as const;
type Variant = (typeof VARIANTS)[number];
/** The variants `job all` takes in turn. `after` and `no-format` run on their own, once the fix is in. */
const ROUND: readonly Variant[] = ["ours", "no-guard", "preset", "as-acp", "acp"];

// Since v1 slice 2 the turn's own system prompt is set after `more`, and `more`
// cannot name one, so the arms below that name `systemPrompt` all get the
// turn's (`maker`, nothing added: the bare preset). The arms with an empty
// prompt no longer reproduce, on purpose: no turn goes out without one.
const adapterOf = (v: Variant) =>
	Effect.gen(function* () {
		const sdk = watched(query);
		switch (v) {
			case "ours":
				return claudeAdapter({
					open: sdk,
					more: () => ({systemPrompt: EMPTY, settings: CONNECTORS_OFF}),
				});
			case "no-guard":
				return claudeAdapter({
					open: sdk,
					more: () => ({systemPrompt: EMPTY, settings: CONNECTORS_OFF, hooks: {}}),
				});
			case "preset":
				return claudeAdapter({
					open: sdk,
					more: () => ({systemPrompt: PRESET, settings: CONNECTORS_OFF}),
				});
			case "as-acp": {
				// No schema field (`acpOpen` drops it): the service puts the schema in the prompt and
				// reads the last message, as on the ACP row.
				const inner = claudeAdapter({open: watched(acpOpen), more: acpOptions});
				return {...inner, holds: {usd: true, schema: false}};
			}
			case "acp":
				return yield* acpAdapter("claude");
			case "after":
				return claudeAdapter({open: sdk});
			case "no-format": {
				// The fix, and no schema field: the service puts the schema in the prompt, as for ACP.
				const inner = claudeAdapter({open: watched(textOpen)});
				return {...inner, holds: {usd: true, schema: false}};
			}
		}
	});

/**
 * ACP's adapter takes the alias only. Its CLI (2.1.286) reads `haiku` as claude-haiku-4-5-20251001;
 * ours (2.1.296) reads it as a newer model (the `models` step). So `as-acp`, on our CLI, names the
 * model ACP got, not the alias.
 */
const MODEL = (v: Variant) => (v === "acp" ? "haiku" : "claude-haiku-4-5");
/** What ACP sets for `haiku`: Haiku 4.5 offers no effort (the `models` step), so ACP sets none. */
const ACP_EFFORT: string | null = null;
/** 156 set effort `low` on both Claude rows; ACP passes it only where the model offers it. */
const EFFORT = (v: Variant) => (v === "as-acp" ? ACP_EFFORT : "low");

// ---------------------------------------------------------------- one run

interface Ran {
	readonly heard: Agent.Heard<Answer>[];
	readonly end: Agent.Ended<Answer> | null;
	readonly error: string | null;
	readonly ms: number;
}

const runOnce = async (v: Variant, copy: string, session: string): Promise<Ran> => {
	const agents = await Effect.runPromise(
		Effect.gen(function* () {
			const sessions = yield* Agent.fileSessions(join(WORK, "sessions"));
			return Agent.makeAgents({
				adapters: {[v]: yield* adapterOf(v)},
				sessions,
				reaper: psReaper,
				stopped: () => {},
			});
		}).pipe(Effect.provide(nodeServices)),
	);
	const turn: Agent.Turn<Answer> = {
		provider: v,
		session,
		folder: copy,
		prompt: PROMPT,
		system: {_tag: "maker", add: ""},
		answer: Answer,
		model: MODEL(v),
		effort: EFFORT(v),
		limits: {...Agent.NO_LIMITS, usd: CLAUDE_BUDGET, seconds: 300},
	};
	const start = Date.now();
	const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(agents.run(turn))));
	const heard = Exit.isSuccess(exit) ? [...exit.value] : [];
	return {
		heard,
		end: (heard.find((h) => h._tag === "ended") as Agent.Ended<Answer> | undefined) ?? null,
		error: Exit.isFailure(exit) ? scrub(String(exit.cause)).slice(0, 400) : null,
		ms: Date.now() - start,
	};
};

// ---------------------------------------------------------------- results

type Results = Record<string, unknown>;
type Row = Record<string, unknown> & {usd?: number | null};
const load = (): Results =>
	existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as Results) : {};
const save = (key: string, value: unknown) => {
	const all = load();
	all[key] = value;
	mkdirSync(dirname(RESULTS), {recursive: true});
	writeFileSync(RESULTS, `${JSON.stringify(all, null, 1)}\n`);
};
const rowsOf = (all: Results, v: Variant) => (all[`job:${v}`] as Row[] | undefined) ?? [];
const spent = () => {
	const all = load();
	return VARIANTS.flatMap((v) => rowsOf(all, v)).reduce((a, r) => a + (r.usd ?? 0), 0);
};

async function one(v: Variant) {
	const rows = rowsOf(load(), v);
	const n = rows.length + 1;
	const {dir, copy} = fresh(`job-${v}-${n}`);
	const session = `job/${v}/${n}/${randomBytes(3).toString("hex")}`;
	seen.models = [];
	seen.asks = 0;
	const r = await runOnce(v, copy, session);
	const g = graded(copy);
	const file = transcriptOf(copy);
	const trace = file === null ? null : traceOf(file);
	const out = {
		n,
		ok: g === TRUTH.length,
		graded: g,
		typed: r.end !== null && r.end.answer !== null,
		stop: r.end?.stop ?? null,
		seconds: r.ms / 1000,
		tools: new Set(r.heard.flatMap((h) => (h._tag === "tool" ? [h.id] : []))).size,
		failedTools: r.heard.filter((h) => h._tag === "tool" && h.status === "failed").length,
		asked: r.heard.filter((h) => h._tag === "asked").length + seen.asks,
		tokens: r.end?.tokens ?? null,
		usd: r.end?.usd ?? null,
		requests: r.end?.requests ?? null,
		/** From the SDK result where we run the SDK; from the transcript for ACP. */
		models: seen.models.length > 0 ? seen.models : (trace?.models ?? []),
		denied: trace?.errors.filter((e) => e.kind === "denied").length ?? null,
		trace,
		error: r.error,
	};
	console.log(
		JSON.stringify({
			v,
			...out,
			trace: trace === null ? null : {...trace, calls: trace.calls.join(" ")},
		}),
	);
	save(`job:${v}`, [...rows, out]);
	rmSync(dir, {recursive: true, force: true});
}

// ---------------------------------------------------------------- steps

async function job(which: string, count: number) {
	// `all`, one variant, or several joined by commas, taken in turn each round.
	const order: readonly Variant[] = which === "all" ? ROUND : which.split(",").map(variantArg);
	for (let i = 0; i < count; i++)
		for (const v of order) {
			const s = spent();
			if (s >= STOP_USD) {
				console.log(`stopped: $${s.toFixed(3)} spent, the stop is $${STOP_USD}`);
				return;
			}
			await one(v);
		}
	console.log(`spent so far: $${spent().toFixed(3)}`);
}

const variantArg = (arg: string | undefined): Variant => {
	if (!VARIANTS.includes(arg as Variant))
		throw new Error(`a variant: ${VARIANTS.join(", ")}, or all`);
	return arg as Variant;
};

/** What each CLI says of its models, with no model called: `haiku`'s id, and whether it takes an effort. */
async function models() {
	/** The CLI an SDK install runs: its platform package, under pnpm's store in `modules`. */
	const cli = (modules: string) => {
		const store = join(modules, ".pnpm");
		const name = `claude-agent-sdk-${process.platform}-${process.arch}`;
		const pkg = readdirSync(store).find((d) => d.startsWith(`@anthropic-ai+${name}@`));
		return pkg === undefined
			? ""
			: join(store, pkg, "node_modules", "@anthropic-ai", name, "claude");
	};
	const out: Record<string, unknown> = {};
	for (const [name, bin] of [
		["ours", cli(join(REPO, "node_modules"))],
		["acp", cli(ADAPTERS)],
	] as const) {
		const {dir, copy} = fresh("models");
		const version = existsSync(bin) ? String(execFileSync(bin, ["--version"])).trim() : null;
		let release = () => {};
		const hold = new Promise<void>((ok) => {
			release = ok;
		});
		/** A prompt stream that sends nothing and ends when released: the CLI starts, no model is asked. */
		const none: AsyncIterable<SDKUserMessage> = {
			[Symbol.asyncIterator]: () => ({
				next: () => hold.then(() => ({done: true as const, value: undefined})),
			}),
		};
		const q = query({
			prompt: none,
			options: {
				cwd: copy,
				env: fencedEnv(agentEnv()),
				settingSources: [],
				persistSession: false,
				...(existsSync(bin) ? {pathToClaudeCodeExecutable: bin} : {}),
			},
		});
		const list = await q.supportedModels();
		release();
		q.close();
		out[name] = {
			version,
			models: list
				.filter((m) => /haiku/i.test(`${m.value} ${m.resolvedModel ?? ""} ${m.displayName}`))
				.map((m) => ({
					value: m.value,
					resolved: m.resolvedModel ?? null,
					effort: m.supportsEffort ?? null,
					levels: m.supportedEffortLevels ?? null,
					adaptive: m.supportsAdaptiveThinking ?? null,
				})),
		};
		rmSync(dir, {recursive: true, force: true});
	}
	console.log(JSON.stringify(out, null, 1));
	save("models", out);
}

/** 156's saved transcripts, read: the same summary each run here gets. */
function old() {
	const out = readdirSync(PROJECTS)
		.filter((d) => d.includes(OLD))
		.sort()
		.flatMap((d) =>
			readdirSync(join(PROJECTS, d))
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => ({
					run: d.slice(d.indexOf(OLD) + OLD.length),
					...traceOf(join(PROJECTS, d, f)),
				})),
		)
		.map((t) => ({...t, out: t.outs.reduce((a, b) => a + b, 0)}));
	for (const t of out) console.log(JSON.stringify({...t, calls: t.calls.join(" ")}));
	save("old", out);
}

function report() {
	const all = load();
	const median = (xs: number[]) => {
		const s = [...xs].sort((a, b) => a - b);
		if (s.length === 0) return null;
		const mid = Math.floor(s.length / 2);
		return s.length % 2 === 1
			? (s[mid] as number)
			: ((s[mid - 1] as number) + (s[mid] as number)) / 2;
	};
	const spread = (xs: number[]) => (xs.length === 0 ? null : [Math.min(...xs), Math.max(...xs)]);
	const table: Record<string, unknown> = {};
	for (const v of VARIANTS) {
		const rows = rowsOf(all, v);
		if (rows.length === 0) continue;
		const col = (f: (r: Row) => number | null | undefined) =>
			rows.map(f).filter((x): x is number => typeof x === "number");
		const stat = (xs: number[]) => ({median: median(xs), spread: spread(xs)});
		const trace = (r: Row) => r.trace as Trace | null;
		table[v] = {
			runs: rows.length,
			right: rows.filter((r) => r.ok).length,
			typed: rows.filter((r) => r.typed).length,
			firstRight: rows.filter((r) => trace(r)?.firstRight === TRUTH.length).length,
			// The slow mode of 156: a run over 30 s, and a run with one request of over 4,000 output
			// tokens (thinking, as the transcript keeps no thinking text).
			long: rows.filter((r) => (r.seconds as number) > 30).length,
			bigThink: rows.filter((r) => Math.max(0, ...(trace(r)?.outs ?? [])) > 4000).length,
			seconds: stat(col((r) => r.seconds as number)),
			tools: stat(col((r) => r.tools as number)),
			output: stat(col((r) => (r.tokens as Agent.Tokens | null)?.output)),
			usd: {...stat(col((r) => r.usd)), sum: col((r) => r.usd).reduce((a, b) => a + b, 0)},
			denied: col((r) => r.denied as number | null).reduce((a, b) => a + b, 0),
			failed: col((r) => trace(r)?.errors.filter((e) => e.kind === "failed").length).reduce(
				(a, b) => a + b,
				0,
			),
			asked: col((r) => r.asked as number).reduce((a, b) => a + b, 0),
			prompt: [...new Set(col((r) => trace(r)?.prompt))],
			firstInput: stat(col((r) => trace(r)?.first)),
			models: [...new Set(rows.flatMap((r) => r.models as string[]))],
		};
	}
	const pooled = Object.fromEntries(
		POOLS.map(([name, a, b]) => [name, compare(rowsOf2(all, a), rowsOf2(all, b), median)]),
	);
	console.log(JSON.stringify({table, pooled}, null, 1));
	console.log(`spent: $${spent().toFixed(3)}`);
	save("report", {table, pooled});
}

/** The rows of several variants together. */
const rowsOf2 = (all: Record<string, unknown>, vs: readonly Variant[]) =>
	vs.flatMap((v) => rowsOf(all, v));

/** Rows pooled by what they share: a pool is too few runs to name a cause one row at a time. */
const POOLS: ReadonlyArray<readonly [string, readonly Variant[], readonly Variant[]]> = [
	// No system prompt (the guard made no difference) against Claude Code's own, on any path.
	["empty vs preset", ["ours", "no-guard"], ["preset", "as-acp", "acp", "after", "no-format"]],
	// The fix, against the adapter as it was.
	["ours vs after", ["ours"], ["after"]],
	// Auto memory on (as ACP has it) against off (the fix).
	["memory off vs on", ["after", "no-format"], ["preset", "as-acp", "acp"]],
	// `outputFormat` against the schema in the prompt, both on the preset.
	["format vs text", ["preset", "after"], ["as-acp", "no-format"]],
];

/** Two pools side by side, and how often a random split of their runs gives `a` a mean as high. */
const compare = (a: Row[], b: Row[], median: (xs: number[]) => number | null) => {
	const measures: Record<string, (r: Row) => number> = {
		output: (r) => (r.tokens as Agent.Tokens).output,
		seconds: (r) => r.seconds as number,
		// Work done: the StructuredOutput call is the answer itself, there on `outputFormat` rows only.
		work: (r) => (r.trace as Trace).calls.filter((c) => c !== "StructuredOutput").length,
		usd: (r) => r.usd ?? 0,
		// The two slow modes, as 1 or 0: so their mean is the share of runs.
		firstWrong: (r) => ((r.trace as Trace).firstRight === TRUTH.length ? 0 : 1),
		bigThink: (r) => (Math.max(0, ...(r.trace as Trace).outs) > 4000 ? 1 : 0),
		hugeThink: (r) => (Math.max(0, ...(r.trace as Trace).outs) > 9000 ? 1 : 0),
	};
	const side = (rows: Row[]) => ({
		runs: rows.length,
		firstWrong: rows.filter((r) => (r.trace as Trace).firstRight !== TRUTH.length).length,
		long: rows.filter((r) => (r.seconds as number) > 30).length,
		bigThink: rows.filter((r) => Math.max(0, ...(r.trace as Trace).outs) > 4000).length,
		...Object.fromEntries(
			Object.entries(measures).map(([k, f]) => {
				const xs = rows.map(f);
				return [k, {mean: xs.reduce((s, x) => s + x, 0) / xs.length, median: median(xs)}];
			}),
		),
	});
	return {
		a: side(a),
		b: side(b),
		p: Object.fromEntries(
			Object.entries(measures).map(([k, f]) => [k, permuted(a.map(f), b.map(f))]),
		),
	};
};

/** One-sided permutation test, 20,000 shuffles from a fixed seed: P(mean of a - mean of b >= seen). */
const permuted = (a: number[], b: number[]) => {
	const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
	const seen = sum(a) / a.length - sum(b) / b.length;
	const all = [...a, ...b];
	let seed = 158;
	const next = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	const N = 20_000;
	let hits = 0;
	for (let i = 0; i < N; i++) {
		for (let j = all.length - 1; j > 0; j--) {
			const k = Math.floor(next() * (j + 1));
			[all[j], all[k]] = [all[k] as number, all[j] as number];
		}
		if (sum(all.slice(0, a.length)) / a.length - sum(all.slice(a.length)) / b.length >= seen)
			hits++;
	}
	return Math.round((hits / N) * 1000) / 1000;
};

const [step, arg, ...rest] = process.argv.slice(2);
const steps: Record<string, () => Promise<void> | void> = {
	job: () => job(arg ?? "all", Number(rest[0] ?? 1)),
	models,
	old,
	report,
};
const f = step === undefined ? undefined : steps[step];
if (f === undefined) throw new Error(`a step: ${Object.keys(steps).join(", ")}`);
await f();
