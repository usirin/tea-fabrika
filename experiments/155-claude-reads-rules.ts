// Experiment 155: what Claude's own loading of a project (`settingSources: ["project"]`) brings in
// besides the rules, and whether the rules can come in alone.
//
//   node experiments/155-claude-reads-rules.ts selftest       # no model: the detector and the probe, outside any box
//   env -u TYPESAFE_API_KEY CLAUDE_CODE_OAUTH_TOKEN=... nice -n 15 node experiments/155-claude-reads-rules.ts run <variant>...
//   node experiments/155-claude-reads-rules.ts report         # no model: the table from the saved answers
//
// The fixture (155-claude-reads-rules/repo) is a small repository with a code word in every
// place Claude Code might load something from: CLAUDE.md and AGENTS.md at the top and in
// packages/x, an `@file` import, .claude/rules, CLAUDE.local.md, a project skill, subagent and
// command, a plugin from a marketplace the settings name, an MCP server in .mcp.json, and a
// .claude/settings.json that turns on hooks, sets env, loosens permissions and the sandbox, and
// names an apiKeyHelper and a statusLine. Its files are kept under other names (`dot-claude`,
// `CLAUDE.md.fixture`), so no agent working in this repository loads them; the copy gets the
// real names.
//
// Two detectors, both outside the model:
//   - what the model saw: every request Claude Code sends goes through a small proxy on
//     127.0.0.1 (ANTHROPIC_BASE_URL in the SDK's env), which looks for each code word in the
//     request body and passes the request on to the API unchanged. It never reads, keeps or
//     prints a header, so the login passes through untouched. A second proxy, the trap, is the
//     ANTHROPIC_BASE_URL the project's own settings name: a request there means the project's
//     env moved the model's traffic.
//   - what ran: each hook, the plugin's hook, the MCP server, the apiKeyHelper and the statusLine
//     leave a mark file in a folder outside the copy. probe.sh, run by the agent through Bash,
//     says whether the project's env reached the sandbox and whether the sandbox let it write
//     outside the copy or reach example.com. Code checks the files afterwards too.
//
// Controls: a code word in the prompt and one in the SDK's own `env` must both be found, or the
// detector is broken. `selftest` runs the detector over the fixture's own text and the probe
// with no box.
//
// Each run is the builder's own options (`builderOptions`), with only `settingSources` and the
// options a variant names changed, and Write left out of the approved list so the project's
// `permissions.allow` can be seen to add it. The sandbox may write only in the copy, so the
// project's `sandbox.filesystem.allowWrite` can be seen to widen it.
//
// Node at the edge: http, https and zlib for the proxy, child_process for git and the probe.

import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {createServer, type IncomingHttpHeaders} from "node:http";
import {request} from "node:https";
import {homedir, tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {brotliDecompressSync, gunzipSync, inflateSync} from "node:zlib";
import {
	type HookCallback,
	type Options,
	query,
	type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {builderOptions} from "@kampus/pipeline/stages/build/builder";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "155-claude-reads-rules", "repo");
const RESULTS = join(HERE, "results", "155-claude-reads-rules.json");
const WORK = process.env.WORK ?? join(tmpdir(), "exp155");
const MODEL = "claude-haiku-4-5";
const BUDGET = 0.15;

// ---------------------------------------------------------------- the code words

type Kind = "rule" | "extra" | "control";
const MARKERS: ReadonlyArray<{name: string; word: string; kind: Kind; from: string}> = [
	{name: "root CLAUDE.md", word: "M155-ROOT-CLAUDE-k3v9", kind: "rule", from: "CLAUDE.md"},
	{name: "root AGENTS.md", word: "M155-ROOT-AGENTS-p2w7", kind: "rule", from: "AGENTS.md"},
	{name: "@file import", word: "M155-IMPORT-z5q1", kind: "rule", from: "docs/imported.md"},
	{
		name: "nested CLAUDE.md",
		word: "M155-NESTED-CLAUDE-r6t3",
		kind: "rule",
		from: "packages/x/CLAUDE.md",
	},
	{
		name: "nested AGENTS.md",
		word: "M155-NESTED-AGENTS-b9m2",
		kind: "rule",
		from: "packages/x/AGENTS.md",
	},
	{
		name: "@file import from outside the copy",
		word: "M155-OUTSIDE-IMPORT-j7c3",
		kind: "extra",
		from: "a file beside the copy, imported by absolute path",
	},
	{
		name: ".claude/rules",
		word: "M155-RULES-DIR-c4j8",
		kind: "rule",
		from: ".claude/rules/style.md",
	},
	{name: "CLAUDE.local.md", word: "M155-LOCAL-CLAUDE-h8n4", kind: "rule", from: "CLAUDE.local.md"},
	{
		name: "project skill",
		word: "M155-PROJECT-SKILL-f7d5",
		kind: "extra",
		from: ".claude/skills/s155",
	},
	{
		name: "project subagent",
		word: "M155-PROJECT-AGENT-g1x6",
		kind: "extra",
		from: ".claude/agents/a155.md",
	},
	{
		name: "project command",
		word: "M155-PROJECT-COMMAND-y2s8",
		kind: "extra",
		from: ".claude/commands/c155.md",
	},
	{name: "plugin skill", word: "M155-PLUGIN-SKILL-w3e7", kind: "extra", from: "market/p155"},
	{name: "MCP server's tool", word: "M155-MCP-TOOL-v8p3", kind: "extra", from: ".mcp.json"},
	{
		name: "hook's context",
		word: "M155-HOOK-CONTEXT-n5k2",
		kind: "extra",
		from: "SessionStart hook",
	},
	{name: "project env (via probe)", word: "M155-ENV-u4a2", kind: "extra", from: "settings env"},
	{name: "control: prompt", word: "M155-CTRL-PROMPT-e6r1", kind: "control", from: "the prompt"},
	{name: "control: SDK env", word: "M155-CTRL-ENV-t2y5", kind: "control", from: "options.env"},
];
const CTRL_ENV = "M155-CTRL-ENV-t2y5";

const PROMPT = [
	"This is a test of what you were given. Do these steps in order and nothing else. Do not read, list or search any other file.",
	"1. Use the Read tool on packages/x/note.txt.",
	"2. Use the Bash tool to run: sh probe.sh",
	"3. Use the Write tool to create perm-probe.txt with the text ok. If you are refused, go on.",
	"4. Answer with every code word that starts with M155- and appears anywhere in your instructions, your context or the tool results, one per line, then the probe's output.",
	"The control code word is M155-CTRL-PROMPT-e6r1.",
].join("\n");

// ---------------------------------------------------------------- the variants

interface Dirs {
	readonly copy: string;
	/** An empty git repository. */
	readonly empty: string;
	/** An empty folder, no git. */
	readonly plain: string;
}
interface Variant {
	readonly why: string;
	readonly options: (d: Dirs) => Partial<Options>;
	/** Keys added to the copy's .claude/settings.json, `{{COPY}}` and the rest filled in. */
	readonly adds?: Record<string, unknown>;
	/** Files left out of the copy, by their real names. */
	readonly drops?: readonly string[];
	/** The builder's options as this repository ships them now, nothing taken back. */
	readonly shipped?: boolean;
}
// biome-ignore-start lint/plugin/no-project-settings: these variants measure what each way of loading a project's settings brings in, so they load them on purpose
/** The candidate: the project's rule files, its settings from a folder that holds none. */
const safeOf = (root: string): Partial<Options> => ({
	settingSources: ["project"],
	projectConfigRoot: root,
	settings: {
		disableClaudeAiConnectors: true,
		pluginConfigs: {
			"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
		},
	},
});

const VARIANTS: Record<string, Variant> = {
	none: {why: "today: settingSources []", options: () => ({settingSources: []})},
	project: {why: 'settingSources ["project"]', options: () => ({settingSources: ["project"]})},
	helper: {
		why: 'settingSources ["project"], and the project names an apiKeyHelper that fails',
		options: () => ({settingSources: ["project"]}),
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
	},
	"no-hooks": {
		why: 'settingSources ["project"], flag settings disableAllHooks: true',
		options: () => ({
			settingSources: ["project"],
			settings: {disableClaudeAiConnectors: true, disableAllHooks: true},
		}),
	},
	"config-root": {
		why: 'settingSources ["project"], projectConfigRoot an empty git folder; the project names an apiKeyHelper too',
		options: (d) => ({settingSources: ["project"], projectConfigRoot: d.empty}),
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
	},
	safe: {
		why: "config-root with a plain empty folder (no git), the built-in agents-md plugin's option asking for AGENTS.md beside CLAUDE.md; the project names an apiKeyHelper too",
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
		options: (d) => safeOf(d.plain),
	},
	"safe-missing": {
		why: "safe, with projectConfigRoot a folder that is not there (/nonexistent-155)",
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
		options: () => ({...safeOf("/nonexistent-155")}),
	},
	"safe-var-empty": {
		why: "safe, with projectConfigRoot the system's empty folder /var/empty",
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
		options: () => ({...safeOf("/var/empty")}),
	},
	builder: {
		why: "the builder's options after the switch (ownRules), as shipped; the project names an apiKeyHelper too",
		adds: {apiKeyHelper: 'node "{{COPY}}/hook.mjs" apikeyhelper'},
		options: () => ({}),
		shipped: true,
	},
	"agents-only": {
		why: 'settingSources ["project"], the copy keeps AGENTS.md but no CLAUDE.md',
		options: () => ({settingSources: ["project"]}),
		drops: ["CLAUDE.md", "packages/x/CLAUDE.md"],
	},
};
// biome-ignore-end lint/plugin/no-project-settings: the variants end here

// ---------------------------------------------------------------- the copy

/** A fixture path as it is in the copy: `dot-x` is `.x`, `name.fixture` is `name`. */
const realName = (path: string) =>
	path
		.split("/")
		.map((part) => (part.startsWith("dot-") ? `.${part.slice(4)}` : part.replace(/\.fixture$/, "")))
		.join("/");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

interface Run {
	readonly dir: string;
	readonly copy: string;
	readonly marks: string;
	readonly outside: string;
	readonly empty: string;
	readonly plain: string;
}

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "user.name=exp155", "-c", "user.email=exp155@example.com", ...args], {
		cwd,
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null"},
		stdio: "ignore",
	});

/** A fresh run folder: the copy (a git repository), the marks folder, a folder outside, an empty one. */
const fresh = (
	name: string,
	trap: string,
	adds: Record<string, unknown> = {},
	drops: readonly string[] = [],
): Run => {
	mkdirSync(WORK, {recursive: true});
	const dir = join(realpathSync(WORK), `${name}-${randomBytes(3).toString("hex")}`);
	const run = {
		dir,
		copy: join(dir, "copy"),
		marks: join(dir, "marks"),
		outside: join(dir, "outside"),
		empty: join(dir, "empty"),
		plain: join(dir, "plain"),
	};
	for (const d of [run.copy, run.marks, run.outside, run.empty, run.plain])
		mkdirSync(d, {recursive: true});
	const fill = (text: string) =>
		text
			.replaceAll("{{COPY}}", run.copy)
			.replaceAll("{{MARKS}}", run.marks)
			.replaceAll("{{OUTSIDE}}", run.outside)
			.replaceAll("{{TRAP}}", trap);
	for (const file of walk(FIXTURE)) {
		const to = join(run.copy, realName(relative(FIXTURE, file)));
		mkdirSync(dirname(to), {recursive: true});
		writeFileSync(to, fill(readFileSync(file, "utf8")));
	}
	const settings = join(run.copy, ".claude", "settings.json");
	const merged = {...(JSON.parse(readFileSync(settings, "utf8")) as object), ...adds};
	writeFileSync(settings, fill(JSON.stringify(merged, null, "\t")));
	for (const file of drops) rmSync(join(run.copy, file));
	// A file outside the copy that CLAUDE.md imports by its absolute path: what a home file would be.
	writeFileSync(
		join(run.outside, "outside-import.md"),
		"The code word of this outside file is M155-OUTSIDE-IMPORT-j7c3.\n",
	);
	chmodSync(join(run.copy, "probe.sh"), 0o755);
	git(run.copy, "init", "-q");
	git(run.copy, "add", "-A");
	git(run.copy, "commit", "-q", "-m", "fixture");
	git(run.empty, "init", "-q");
	return run;
};

// ---------------------------------------------------------------- the proxy

interface Seen {
	readonly via: "proxy" | "trap";
	readonly path: string;
	readonly model: string | null;
	readonly words: string[];
	readonly tools: string[];
	/** Whether the request carried a credential header. Only yes or no: the value is never read. */
	readonly login: boolean;
}

const decode = (raw: Buffer, encoding: string | undefined): string => {
	try {
		if (encoding === "gzip") return gunzipSync(raw).toString("utf8");
		if (encoding === "deflate") return inflateSync(raw).toString("utf8");
		if (encoding === "br") return brotliDecompressSync(raw).toString("utf8");
	} catch {
		// Not what the header said: read the bytes as they are.
	}
	return raw.toString("utf8");
};

/** What one request body holds: the code words found, the model and the tools' names. */
const look = (via: Seen["via"], path: string, text: string, login = false): Seen => {
	let model: string | null = null;
	let tools: string[] = [];
	try {
		const body = JSON.parse(text) as {model?: string; tools?: {name?: string}[]};
		model = body.model ?? null;
		tools = (body.tools ?? []).map((t) => t.name ?? "?");
	} catch {
		// Not JSON: only the words are looked for.
	}
	return {
		via,
		path: path.split("?")[0] ?? path,
		model,
		words: MARKERS.filter((m) => text.includes(m.word)).map((m) => m.word),
		tools,
		login,
	};
};

/** A proxy to the API that notes what each request body holds. Headers pass through unread. */
const proxy = (via: Seen["via"]) =>
	new Promise<{url: string; seen: Seen[]; close: () => void}>((ready) => {
		const seen: Seen[] = [];
		const server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => {
				const raw = Buffer.concat(chunks);
				const text = decode(raw, req.headers["content-encoding"] as string);
				// Only whether a credential header is there. Its value is not read.
				const login = "authorization" in req.headers || "x-api-key" in req.headers;
				seen.push(look(via, req.url ?? "", text, login));
				const headers: IncomingHttpHeaders = {...req.headers, host: "api.anthropic.com"};
				const up = request(
					{host: "api.anthropic.com", port: 443, method: req.method, path: req.url, headers},
					(answer) => {
						res.writeHead(answer.statusCode ?? 502, answer.headers);
						answer.pipe(res);
					},
				);
				up.on("error", () => {
					res.writeHead(502);
					res.end();
				});
				up.end(raw);
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const at = server.address();
			const port = typeof at === "object" && at !== null ? at.port : 0;
			ready({url: `http://127.0.0.1:${port}`, seen, close: () => server.close()});
		});
	});

// ---------------------------------------------------------------- results

type Results = Record<string, unknown>;
const load = (): Results =>
	existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as Results) : {};
const save = (key: string, value: unknown) => {
	const all = load();
	all[key] = value;
	all.setup = {
		claudeAgentSdk: "0.3.296",
		claudeCode: "2.1.296",
		model: MODEL,
		fixture: "experiments/155-claude-reads-rules/repo",
	};
	writeFileSync(RESULTS, `${JSON.stringify(all, null, "\t")}\n`);
};

/** Strip a run's own folders from text kept in the results: no machine path is saved. */
const scrub = (text: string, dir: string) =>
	text.split(dir).join("<run>").split(realpathSync(WORK)).join("<work>").split(homedir()).join("~");

// ---------------------------------------------------------------- one run

async function runOne(variant: string) {
	const v = VARIANTS[variant];
	if (v === undefined)
		throw new Error(`no variant ${variant}: ${Object.keys(VARIANTS).join(", ")}`);
	const main = await proxy("proxy");
	const trap = await proxy("trap");
	const run = fresh(variant, trap.url, v.adds, v.drops);
	const refused: string[] = [];
	let ours = 0;
	const counted: HookCallback = async () => {
		ours += 1;
		return {};
	};
	const shipped = builderOptions(
		{model: MODEL, effort: "low", budget: BUDGET},
		run.copy,
		(tool, why) => refused.push(`${tool}: ${scrub(why, run.dir)}`),
	);
	// The builder's options as they were before the switch: no settings loaded, the connectors off.
	// A variant then names its own loading. `builder` takes the shipped options as they are.
	const {projectConfigRoot: _root, ...before} = shipped;
	const base: Options =
		v.shipped === true
			? shipped
			: {...before, settingSources: [], settings: {disableClaudeAiConnectors: true}};
	const extra = v.options({copy: run.copy, empty: run.empty, plain: run.plain});
	const options: Options = {
		...base,
		...extra,
		settings: {
			...(typeof base.settings === "object" ? base.settings : {}),
			...(typeof extra.settings === "object" ? extra.settings : {}),
		},
		env: {...base.env, ANTHROPIC_BASE_URL: main.url, EXP155_CTRL: CTRL_ENV},
		persistSession: false,
		allowedTools: (base.allowedTools ?? []).filter((t) => t !== "Write"),
		sandbox: {
			...base.sandbox,
			filesystem: {...base.sandbox?.filesystem, allowWrite: [run.copy]},
		},
		hooks: {
			...base.hooks,
			PreToolUse: [...(base.hooks?.PreToolUse ?? []), {hooks: [counted]}],
		},
	};
	const calls: {tool: string; input: string}[] = [];
	let init: Record<string, unknown> | null = null;
	let result: Record<string, unknown> | null = null;
	let answer = "";
	const start = Date.now();
	try {
		for await (const m of query({prompt: PROMPT, options}) as AsyncIterable<SDKMessage>) {
			if (m.type === "system" && m.subtype === "init")
				init = {
					tools: m.tools,
					mcp_servers: m.mcp_servers,
					plugins: m.plugins.map((p) => p.name),
					skills: m.skills,
					slash_commands: m.slash_commands.filter((c) => c.includes("155")),
					agents: m.agents,
					permissionMode: m.permissionMode,
					apiKeySource: m.apiKeySource,
				};
			if (m.type === "assistant")
				for (const block of m.message.content)
					if (block.type === "tool_use")
						calls.push({tool: block.name, input: scrub(JSON.stringify(block.input), run.dir)});
			if (m.type === "result") {
				result = {
					subtype: m.subtype,
					isError: m.is_error,
					costUsd: m.total_cost_usd,
					turns: m.num_turns,
					input:
						m.usage.input_tokens +
						(m.usage.cache_read_input_tokens ?? 0) +
						(m.usage.cache_creation_input_tokens ?? 0),
					cached: m.usage.cache_read_input_tokens ?? 0,
					output: m.usage.output_tokens,
				};
				if (m.subtype === "success") answer = m.result;
			}
		}
	} catch (error) {
		result = {...result, error: scrub(String(error), run.dir).slice(0, 400)};
	}
	main.close();
	trap.close();
	const seen = [...main.seen, ...trap.seen];
	const messages = seen.filter((s) => s.path.endsWith("/v1/messages"));
	const mainCalls = messages.filter((s) => s.tools.length > 0);
	const marks = Object.fromEntries(
		readdirSync(run.marks).map((f) => [f, readFileSync(join(run.marks, f), "utf8").trim()]),
	);
	const row = {
		variant,
		why: v.why,
		seconds: (Date.now() - start) / 1000,
		result,
		init,
		calls,
		refused,
		ourHookCalls: ours,
		requests: {
			proxy: main.seen.length,
			trap: trap.seen.length,
			trapWithLogin: trap.seen.filter((s) => s.login).length,
			paths: [...new Set(seen.map((s) => `${s.via} ${s.path}`))],
		},
		firstMainRequest: mainCalls[0] ?? null,
		wordsSeen: [...new Set(messages.flatMap((s) => s.words))],
		wordsAtStart: mainCalls[0]?.words ?? [],
		toolsOffered: [...new Set(mainCalls.flatMap((s) => s.tools))],
		ran: marks,
		outsideWritten: existsSync(join(run.outside, "sbx-probe")),
		permProbeWritten: existsSync(join(run.copy, "perm-probe.txt")),
		answer: scrub(answer, run.dir).slice(0, 1500),
	};
	rmSync(run.dir, {recursive: true, force: true});
	return row;
}

// ---------------------------------------------------------------- steps

/** No model: every code word is found in the fixture's own text, and the probe works with no box. */
function selftest() {
	const run = fresh("selftest", "http://127.0.0.1:9");
	const text = [...walk(run.copy), ...walk(run.outside)]
		.filter((f) => !f.includes(`${run.copy}/.git/`))
		.map((f) => readFileSync(f, "utf8"))
		.join("\n");
	const found = look("proxy", "/selftest", `${text}\n${PROMPT}\n${CTRL_ENV}`).words;
	const missing = MARKERS.filter((m) => !found.includes(m.word)).map((m) => m.name);
	const left = text.includes("{{") ? "a placeholder was left" : "none left";
	const probe = execFileSync("sh", ["probe.sh"], {
		cwd: run.copy,
		env: {...process.env, EXP155_ENV: "M155-ENV-u4a2", EXP155_CTRL: CTRL_ENV},
	}).toString("utf8");
	const out = {
		markers: MARKERS.length,
		missing,
		placeholders: left,
		probeOutsideAnyBox: probe.trim().split("\n"),
		outsideWritten: existsSync(join(run.outside, "sbx-probe")),
	};
	rmSync(run.dir, {recursive: true, force: true});
	console.log(JSON.stringify(out, null, 2));
	save("selftest", out);
}

async function runMany(names: readonly string[]) {
	if (
		process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined &&
		process.env.ANTHROPIC_API_KEY === undefined
	)
		throw new Error("run needs CLAUDE_CODE_OAUTH_TOKEN");
	const runs = (load().runs as Record<string, unknown> | undefined) ?? {};
	for (const name of names) {
		const row = await runOne(name);
		runs[name] = row;
		save("runs", runs);
		const r = row.result as {costUsd?: number} | null;
		console.log(
			`${name}: $${r?.costUsd ?? "?"}, ${row.wordsSeen.length} words, trap ${row.requests.trap}, ran ${Object.keys(row.ran).join(" ") || "nothing"}`,
		);
	}
}

function report() {
	const runs = (load().runs ?? {}) as Record<
		string,
		{
			wordsSeen: string[];
			ran: Record<string, string>;
			result: {costUsd?: number; error?: string} | null;
			requests: {trap: number; trapWithLogin: number};
			init: {slash_commands: string[]; agents: string[]; apiKeySource: string} | null;
			ourHookCalls: number;
			outsideWritten: boolean;
			permProbeWritten: boolean;
		}
	>;
	const names = Object.keys(runs);
	console.log(`| what | ${names.join(" | ")} |`);
	console.log(`|---|${names.map(() => "---|").join("")}`);
	for (const m of MARKERS)
		console.log(
			`| ${m.name} | ${names.map((n) => (runs[n]?.wordsSeen.includes(m.word) ? "seen" : "-")).join(" | ")} |`,
		);
	const kinds = new Set(names.flatMap((n) => Object.keys(runs[n]?.ran ?? {})));
	for (const k of kinds)
		console.log(
			`| ran: ${k} | ${names.map((n) => (k in (runs[n]?.ran ?? {}) ? "ran" : "-")).join(" | ")} |`,
		);
	const row = (what: string, cell: (r: NonNullable<(typeof runs)[string]>) => string) =>
		console.log(`| ${what} | ${names.map((n) => (runs[n] ? cell(runs[n]) : "?")).join(" | ")} |`);
	row("model calls sent to the project's URL, with the login", (r) =>
		r.requests.trapWithLogin > 0 ? `${r.requests.trapWithLogin}` : "-",
	);
	row("project skill and command listed", (r) =>
		(r.init?.slash_commands.length ?? 0) > 0 ? "listed" : "-",
	);
	row("login from the project's apiKeyHelper", (r) =>
		r.init?.apiKeySource === "apiKeyHelper" ? "yes" : "-",
	);
	row("our own SDK hook calls", (r) => `${r.ourHookCalls}`);
	row("sandbox wrote outside the copy", (r) => (r.outsideWritten ? "yes" : "-"));
	row("Write approved by the project", (r) => (r.permProbeWritten ? "yes" : "-"));
	row("run failed", (r) => (r.result?.error === undefined ? "-" : "failed"));
	const cost = names.reduce((s, n) => s + (runs[n]?.result?.costUsd ?? 0), 0);
	console.log(`\ncost: $${cost.toFixed(4)}`);
}

const [step, ...rest] = process.argv.slice(2);
if (step === "selftest") selftest();
else if (step === "run") await runMany(rest.length === 0 ? Object.keys(VARIANTS) : rest);
else if (step === "report") report();
else console.log("selftest | run <variant>... | report");
