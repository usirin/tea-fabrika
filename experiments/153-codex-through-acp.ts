// Experiment 153: Codex as one more row in the ACP table. The same seven parts as experiment 152,
// through the Agent Client Protocol this time: the harness row `codex` in
// packages/fabrika/src/agents/acp/harness.ts (the pinned @agentclientprotocol/codex-acp and the
// Codex it bundles), driven by our own ACP client (`connect`) and by the `acp` program.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts contain  # what is kept out, proved
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts stream   # one job, the session/update stream
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts stop     # cancel, and a kill, mid command
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts schema   # typed answers: text read by our schema, or an MCP form tool
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts limits   # what the sandbox holds
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts resume   # session/load and session/resume in a new process
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/153-codex-through-acp.ts job [n]  # the format-bytes job through `acp --agent codex`
//   node experiments/153-codex-through-acp.ts report                                      # no model: the summary
//
// Codex signs in with the laptop's ChatGPT plan. Each run's Codex home (`codexHomeOf`, under
// ~/.cache) holds only a symlink to the login file, made by the harness row's `prepare`. Of the
// login, `prepare` reads two fields in code (the mode and whether a key is stored) and refuses
// anything but the plan; it never prints, copies or moves it. After every run the script checks the link is still a link, and that
// the owner's own sessions folder did not grow; then it removes the copy and the home.
//
// What this script reads of the owner's ~/.codex, to prove each is kept out: the names of the MCP
// servers and plugins in config.toml, the lines of the global AGENTS.md, and the skill names in
// ~/.agents/skills. They are only counted against what the run shows; none is printed or saved.
//
// Each run works in a fresh copy of fixtures/format-bytes under WORK. One run at a time.
//
// Node at the edge: fs for the copies and the checks, ps and kill for the stop step.

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
import {createServer} from "node:http";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import {layer as nodeHttpServer} from "@effect/platform-node/NodeHttpServer";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {ear, memoryStorage, start, tell} from "@kampus/fabrika";
import {
	acpProgram,
	codexHomeOf,
	connect,
	type Heard,
	harnessOf,
	type Spawnable,
	type Transcript,
} from "@kampus/fabrika/agents/acp";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {runEnv} from "@kampus/fabrika/agents/sandbox";
import {Context, Effect, Exit, Fiber, Layer, Option, Schema} from "effect";
import {McpProtocol, McpServer, Tool, Toolkit} from "effect/ai";
import {HttpRouter, HttpServer} from "effect/http";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "153-codex-through-acp.json");
const WORK = realOrSelf(process.env.WORK ?? join(tmpdir(), "exp153"));
const OWNER = join(homedir(), ".codex");

const MODEL = "gpt-6-luna";
const EFFORT = "low";

function realOrSelf(p: string) {
	mkdirSync(p, {recursive: true});
	return realpathSync(p);
}

// ---------------------------------------------------------------- the job and its answer (152's)

const Answer = Schema.Struct({
	done: Schema.Boolean,
	ran: Schema.Array(Schema.Struct({call: Schema.String, printed: Schema.String})),
	summary: Schema.String,
});
type Answer = typeof Answer.Type;
const read = reader(Answer);

const TASK = [
	"Make formatBytes(n) in bytes.js turn a number of bytes into a short readable size.",
	'- Under 1024: the number and " B". formatBytes(512) is "512 B".',
	"- From 1024 up: divide by 1024 until the number is under 1024 or the unit is TB. Show one decimal and the unit: KB, MB, GB, TB.",
	'  formatBytes(1536) is "1.5 KB". formatBytes(1048576) is "1.0 MB".',
	'- Past TB, stay in TB: formatBytes(1024 ** 5) is "1024.0 TB".',
	"Then check it with one node command that prints formatBytes(1536) and formatBytes(5 * 1024 ** 3).",
	"At the end, fill the form: `done` (true if the function works), `ran` (each call you checked and what it printed), `summary` (one sentence).",
].join("\n");

/** ACP has no output schema: the form goes in the prompt, and our schema reads the last message. */
const formInPrompt = (schema: Record<string, unknown>) =>
	`Your last message must be only one JSON object, no code fence, that fits this JSON Schema:\n${JSON.stringify(schema)}`;
const PROMPT = `${TASK}\n${formInPrompt(jsonSchema(Answer))}`;

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

/** The text read as the form: the whole message, or `null` when it is not JSON or does not fit. */
const readText = (text: string | null): Answer | null => {
	if (text === null) return null;
	try {
		return Option.getOrNull(read(JSON.parse(text.trim())));
	} catch {
		return null;
	}
};

// ---------------------------------------------------------------- folders and checks

const fresh = (name: string) => {
	const copy = join(WORK, `${name}-${randomBytes(3).toString("hex")}`);
	cpSync(FIXTURE, copy, {recursive: true});
	return {copy, home: codexHomeOf(copy)};
};
const clean = (copy: string) => {
	rmSync(copy, {recursive: true, force: true});
	rmSync(codexHomeOf(copy), {recursive: true, force: true});
};

const files = (d: string): string[] =>
	existsSync(d)
		? readdirSync(d).flatMap((n) => {
				const p = join(d, n);
				return statSync(p).isDirectory() ? files(p) : [p];
			})
		: [];

/** The owner's saved sessions, counted: a run of ours must not add one. */
const ownerSessions = () => files(join(OWNER, "sessions")).length;
const loginStillLinked = (home: string) => {
	try {
		return lstatSync(join(home, "auth.json")).isSymbolicLink();
	} catch {
		return false;
	}
};
/** What else is in a home besides the link, by top-level name. */
const homeHolds = (home: string) => (existsSync(home) ? readdirSync(home).sort() : []);

/** The owner's own names, to count against a run. Read here, never printed or saved. */
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
		// Only the plugin names that are not everyday words (a hyphen, or one word of 7 letters or
		// more): "browser" or "pdf" are found in Codex's own instructions whatever is loaded.
		plugins: names(/^\[plugins\."([^"]+)"\]/gm)
			.map((n) => n.split("@")[0] ?? n)
			.filter((n) => n.includes("-") || n.length >= 7),
		pluginIds: names(/^\[plugins\."([^"]+)"\]/gm),
		agentsLines: agents,
		agentSkills: existsSync(skillsDir) ? readdirSync(skillsDir) : [],
	};
};
const countIn = (text: string, needles: readonly string[]) =>
	needles.filter((n) => n !== "" && text.includes(n)).length;

/** Every rollout Codex saved under a home, as one text. */
const rollouts = (home: string) =>
	files(join(home, "sessions"))
		.map((f) => readFileSync(f, "utf8"))
		.join("\n");

/** Strip machine paths from text kept in the results. */
const scrub = (text: string) =>
	text.split(WORK).join("<work>").split(homedir()).join("~").split(tmpdir()).join("<tmp>");

// ---------------------------------------------------------------- one session over ACP

type Log = {readonly at: number; readonly heard: Heard};
interface Turn {
	readonly stop: string;
	readonly ms: number;
	readonly usage: acp.Usage | null;
	readonly messages: readonly string[];
	readonly tools: ReadonlyArray<{kind: string; title: string; status: string}>;
	readonly kinds: readonly string[];
	readonly asks: number;
}

/** The text messages of the updates in `log`, by message id, in order. */
const messagesOf = (log: readonly Log[]) => {
	const by = new Map<string, string>();
	for (const {heard} of log) {
		if (heard.kind !== "update") continue;
		const u = heard.update;
		if (u.sessionUpdate !== "agent_message_chunk" || u.content.type !== "text") continue;
		const id = u.messageId ?? "one";
		by.set(id, (by.get(id) ?? "") + u.content.text);
	}
	return [...by.values()];
};

const toolsOf = (log: readonly Log[]) => {
	const by = new Map<string, {kind: string; title: string; status: string}>();
	for (const {heard} of log) {
		if (heard.kind !== "update") continue;
		const u = heard.update;
		if (u.sessionUpdate === "tool_call")
			by.set(u.toolCallId, {
				kind: u.kind ?? "other",
				title: u.title,
				status: u.status ?? "pending",
			});
		if (u.sessionUpdate === "tool_call_update") {
			const was = by.get(u.toolCallId);
			if (was !== undefined)
				by.set(u.toolCallId, {...was, status: u.status ?? was.status, title: u.title ?? was.title});
		}
	}
	return [...by.values()];
};

/** The title a tool call was shown with, by its id. */
const toolsOfId = (log: readonly Log[], id: string): string | undefined => {
	for (const {heard} of [...log].reverse())
		if (
			heard.kind === "update" &&
			(heard.update.sessionUpdate === "tool_call" ||
				heard.update.sessionUpdate === "tool_call_update") &&
			heard.update.toolCallId === id &&
			typeof heard.update.title === "string"
		)
			return heard.update.title;
	return undefined;
};

const kindOf = (h: Heard) =>
	h.kind === "ask"
		? `ask:${h.ask.request.toolCall.kind ?? "other"}`
		: h.update.sessionUpdate === "tool_call" || h.update.sessionUpdate === "tool_call_update"
			? `${h.update.sessionUpdate}:${h.update.status ?? "-"}`
			: h.update.sessionUpdate;

/** Collapse runs of the same kind: `agent_message_chunk x12`. */
const squash = (kinds: readonly string[]) => {
	const out: string[] = [];
	let last = "";
	let n = 0;
	for (const k of [...kinds, ""]) {
		if (k === last) {
			n += 1;
			continue;
		}
		if (last !== "") out.push(n > 1 ? `${last} x${n}` : last);
		last = k;
		n = 1;
	}
	return out;
};

interface Driven {
	readonly init: acp.InitializeResponse;
	readonly id: string;
	readonly opened: {
		readonly model: string | null;
		readonly mode: string | null;
		readonly ms: number;
	};
	readonly turn: (text: string) => Effect.Effect<Turn, unknown>;
	readonly cancel: () => Effect.Effect<void, unknown>;
	readonly log: Log[];
	readonly config: readonly acp.SessionConfigOption[];
	readonly ext: (method: string) => Effect.Effect<unknown, unknown>;
}

interface Options {
	readonly harness?: (h: ReturnType<typeof harnessOf>) => Spawnable;
	readonly how?: "new" | "load" | "resume";
	readonly id?: string;
	readonly servers?: readonly acp.McpServer[];
	readonly model?: boolean;
	/** Answer an ask: true to allow once. Default: refuse, as `acp` does. */
	readonly allow?: (ask: acp.RequestPermissionRequest, title: string) => boolean;
}

/** Start the codex row in `copy`, open a session, and hand it to `body`. The adapter is stopped when `body` ends. */
const drive = <A>(copy: string, options: Options, body: (d: Driven) => Effect.Effect<A, unknown>) =>
	Effect.gen(function* () {
		// The probes check that a write in the copy goes through and every other write does not.
		const row = harnessOf({name: "codex", access: "write"}, copy, null);
		if (row.prepare !== undefined) yield* row.prepare;
		const harness = options.harness === undefined ? row : options.harness(row);
		const log: Log[] = [];
		let asks = 0;
		const c = yield* connect(harness, copy, (heard) => {
			log.push({at: Date.now(), heard});
			if (heard.kind === "ask") {
				asks += 1;
				const id = heard.ask.request.toolCall.toolCallId;
				const title = toolsOfId(log, id) ?? heard.ask.request.toolCall.title ?? "";
				const allow = options.allow?.(heard.ask.request, title) ?? false;
				const o =
					heard.ask.request.options.find((x) => allow && x.kind === "allow_once") ??
					heard.ask.request.options.find((x) => x.kind === "reject_once");
				heard.ask.answer(
					o === undefined
						? {outcome: {outcome: "cancelled"}}
						: {outcome: {outcome: "selected", optionId: o.optionId}},
				);
			}
		});
		const t0 = Date.now();
		let opened = yield* c.open(
			options.how ?? "new",
			options.id ?? null,
			copy,
			row.meta,
			options.servers,
		);
		const ms = Date.now() - t0;
		if (options.model !== false) {
			opened = yield* c.configure(opened, "model", MODEL);
			const effort = opened.config.find((o) => o.category === "thought_level");
			if (effort !== undefined) opened = yield* c.configure(opened, "thought_level", EFFORT);
		}
		const current = (cat: string) => {
			const o = opened.config.find((x) => x.category === cat);
			return o?.type === "select" ? o.currentValue : null;
		};
		const turn = (text: string) =>
			Effect.gen(function* () {
				const from = log.length;
				const asksBefore = asks;
				const s = Date.now();
				const r = yield* c.prompt(opened.id, text);
				// Updates after the answer: give the last ones a moment to land.
				yield* Effect.sleep("300 millis");
				const mine = log.slice(from);
				return {
					stop: r.stopReason,
					ms: Date.now() - s - 300,
					usage: r.usage ?? null,
					messages: messagesOf(mine),
					tools: toolsOf(mine),
					kinds: squash(mine.map((l) => kindOf(l.heard))),
					asks: asks - asksBefore,
				} satisfies Turn;
			});
		return yield* body({
			init: c.init,
			id: opened.id,
			opened: {model: current("model"), mode: current("mode") ?? opened.mode, ms},
			turn,
			cancel: () => c.cancel(opened.id),
			log,
			config: opened.config,
			ext: (_method) => Effect.succeed(null),
		});
	}).pipe(Effect.scoped);

const run = <A>(e: Effect.Effect<A, unknown, never>) => Effect.runPromise(e);
const go = <A>(e: Effect.Effect<A, unknown, unknown>) =>
	run(e.pipe(Effect.provide(nodeServices)) as Effect.Effect<A, unknown, never>);

// ---------------------------------------------------------------- results file

type Results = Record<string, unknown>;
const load = (): Results =>
	existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as Results) : {};
const save = (key: string, value: unknown) => {
	const all = load();
	all[key] = value;
	all.setup = {
		adapter: "@agentclientprotocol/codex-acp 2.1.1 (adapters/, pinned)",
		codex: "@openai/codex 0.159.3, the one the adapter bundles",
		client: "@agentclientprotocol/sdk, the repo's acp client",
		model: MODEL,
		effort: EFFORT,
		fixture: "fixtures/format-bytes",
	};
	writeFileSync(RESULTS, `${JSON.stringify(all, null, "\t")}\n`);
};

const after = (copy: string, before: number) => ({
	loginStillLinked: loginStillLinked(codexHomeOf(copy)),
	ownerSessionsAdded: ownerSessions() - before,
	homeHolds: homeHolds(codexHomeOf(copy)),
});

// ---------------------------------------------------------------- steps

/** The skills Codex installs into every home it starts in (codex 0.159.3). */
const SYSTEM_SKILLS = [
	"imagegen",
	"openai-docs",
	"review-agent",
	"skill-creator",
	"skill-installer",
];

/** Prove what the row keeps out: config, MCP servers, plugins, skills, the global AGENTS.md, the sessions. */
async function contain() {
	const o = owner();
	const before = ownerSessions();
	const out: Record<string, unknown> = {
		owner: {
			mcpServers: o.mcp.length,
			plugins: o.pluginIds.length,
			pluginNamesCounted: o.plugins.length,
			agentsLines: o.agentsLines.length,
			agentSkills: o.agentSkills.length,
		},
	};
	const probe = (d: Driven) =>
		Effect.gen(function* () {
			const mcp = yield* d.turn("/mcp");
			const skills = yield* d.turn("/skills");
			const mcpText = mcp.messages.join("\n");
			const skillsText = skills.messages.join("\n");
			return {
				mcpListed: mcpText.split("\n").filter((l) => l.startsWith("- ")).length,
				// Names of servers that are not the owner's: Codex's own, public.
				mcpNames: mcpText
					.split("\n")
					.filter((l) => l.startsWith("- ") && countIn(l, o.mcp) === 0)
					.map((l) => (l.slice(2).split(":")[0] ?? "").trim()),
				skillsListed: skillsText.split("\n").filter((l) => l.startsWith("- ")).length,
				ownerMcpSeen: countIn(mcpText, o.mcp),
				ownerPluginsSeen: countIn(skillsText, o.plugins),
				ownerAgentSkillsSeen: countIn(skillsText, o.agentSkills),
				skillNames: skillsText
					.split("\n")
					.filter((l) => l.startsWith("- "))
					.map((l) => (l.slice(2).split(":")[0] ?? "").trim())
					.filter((n) => !o.agentSkills.includes(n) && !o.plugins.some((p) => n.includes(p))),
			};
		});

	// A. The row as it is: a home with only the link, HOME set to it.
	{
		const {copy, home} = fresh("contain-row");
		const marker = `MARK153-${randomBytes(4).toString("hex")}`;
		// A project AGENTS.md of the copy's own, so the count below can find what is there.
		writeFileSync(join(copy, "AGENTS.md"), `# Notes\n\nThe word to remember is ${marker}.\n`);
		const row = await go(
			drive(copy, {}, (d) =>
				Effect.gen(function* () {
					const listed = yield* probe(d);
					const ok = yield* d.turn("Do not run anything. Reply with the word ok.");
					// The adapter names a new session after its first turn with a side turn of its own.
					yield* Effect.sleep("4 seconds");
					const titles = d.log.filter(
						(l) =>
							l.heard.kind === "update" && l.heard.update.sessionUpdate === "session_info_update",
					).length;
					return {
						authMethods: d.init.authMethods?.map((m) => m.id) ?? [],
						agent: d.init.agentInfo?.version ?? null,
						loadSession: d.init.agentCapabilities?.loadSession ?? false,
						opened: d.opened,
						modes: d.config.find((c) => c.category === "mode"),
						...listed,
						said: ok.messages.at(-1) ?? null,
						stop: ok.stop,
						usage: ok.usage,
						sessionInfoUpdates: titles,
					};
				}),
			),
		);
		const saved = rollouts(home);
		out.row = {
			...row,
			modes: undefined,
			modeOffered: (row.modes as {options?: Array<{value: string}>} | undefined)?.options?.map(
				(x) => x.value,
			),
			rolloutFiles: files(join(home, "sessions")).length,
			rolloutChars: saved.length,
			projectMarkerInRollout: saved.includes(marker),
			ownerAgentsLinesInRollout: countIn(saved, o.agentsLines),
			ownerMcpInRollout: countIn(saved, o.mcp),
			ownerPluginsInRollout: countIn(saved, o.plugins),
			ownerPluginIdsInRollout: countIn(saved, o.pluginIds),
			codexAppsInRollout: saved.split("codex_apps").length - 1,
			// Skills `/skills` listed that are not Codex's five system ones: does the model see them?
			pluginSkillsListed: [...new Set(row.skillNames)].filter((n) => !SYSTEM_SKILLS.includes(n))
				.length,
			pluginSkillsInRollout: countIn(
				saved,
				[...new Set(row.skillNames)].filter((n) => !SYSTEM_SKILLS.includes(n)),
			),
			// Of the owner's plugin names seen, how many Codex itself put in this fresh home's plugins folder.
			ownerPluginNamesInFreshHomePlugins: countIn(
				files(join(home, "plugins")).join("\n"),
				o.plugins,
			),
			...after(copy, before),
		};
		console.log(JSON.stringify(out.row, null, 1));
		clean(copy);
	}

	// B. The detector works: a home of our own with one MCP server, one global AGENTS.md line.
	{
		const {copy, home} = fresh("contain-control");
		mkdirSync(home, {recursive: true});
		const marker = `GLOBAL153-${randomBytes(4).toString("hex")}`;
		writeFileSync(join(home, "AGENTS.md"), `# Global\n\nThe global word is ${marker}.\n`);
		writeFileSync(
			join(home, "config.toml"),
			'[mcp_servers.probe153]\ncommand = "/usr/bin/false"\nstartup_timeout_sec = 2\n',
		);
		const row = await go(
			drive(copy, {}, (d) =>
				Effect.gen(function* () {
					const mcp = yield* d.turn("/mcp");
					yield* d.turn("Do not run anything. Reply with the word ok.");
					return {mcpText: mcp.messages.join("\n").includes("probe153")};
				}),
			),
		);
		out.control = {
			ourMcpListed: row.mcpText,
			ourGlobalAgentsInRollout: rollouts(home).includes(marker),
			...after(copy, before),
		};
		console.log(JSON.stringify(out.control));
		clean(copy);
	}

	// C. Why HOME is set: the same row with HOME left as the owner's. No model turn.
	{
		const {copy} = fresh("contain-home");
		const row = await go(
			drive(
				copy,
				{
					model: false,
					harness: (h) => ({...h, env: {...h.env, HOME: homedir()}}),
				},
				probe,
			),
		);
		out.ownerHome = {...row, skillNames: undefined, ...after(copy, before)};
		console.log(JSON.stringify(out.ownerHome));
		clean(copy);
	}
	save("contain", out);
}

/** One job run: the stream of session/update, the answer read by our schema, the grade. */
async function stream() {
	const before = ownerSessions();
	const {copy} = fresh("stream");
	const r = await go(drive(copy, {}, (d) => d.turn(PROMPT)));
	const last = r.messages.at(-1) ?? null;
	const row = {
		stop: r.stop,
		ms: r.ms,
		kinds: r.kinds,
		tools: r.tools.map((t) => ({...t, title: scrub(t.title).slice(0, 100)})),
		messages: r.messages.length,
		usage: r.usage,
		read: readText(last),
		graded: graded(copy),
		of: TRUTH.length,
		...after(copy, before),
	};
	console.log(JSON.stringify(row, null, 1));
	save("stream", row);
	clean(copy);
}

const alive = (mark: string): number[] =>
	String(execFileSync("ps", ["-axo", "pid=,command="]))
		.split("\n")
		.filter((l) => l.includes(mark) && !l.includes("ps -axo"))
		.map((l) => Number(l.trim().split(/\s+/)[0]));
/** The Codex app-server processes under this one, by pid: the adapter's child. */
const codexPids = (): number[] => {
	const rows = String(execFileSync("ps", ["-axo", "pid=,ppid=,command="]))
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
		.filter((p) => p.length >= 3)
		.map(([pid, ppid, ...cmd]) => ({pid: Number(pid), ppid: Number(ppid), cmd: cmd.join(" ")}));
	const mine = new Set([process.pid]);
	for (let grew = true; grew;) {
		grew = false;
		for (const r of rows)
			if (mine.has(r.ppid) && !mine.has(r.pid)) {
				mine.add(r.pid);
				grew = true;
			}
	}
	return rows.filter((r) => mine.has(r.pid) && r.cmd.includes("app-server")).map((r) => r.pid);
};
const stillAlive = (pids: readonly number[]) =>
	pids.filter((pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}).length;

/** Stop a run while its command runs: session/cancel, then the adapter killed (the scope closed). */
async function stop() {
	const before = ownerSessions();
	const out: unknown[] = [];
	for (const how of ["cancel", "kill"] as const) {
		const {copy} = fresh(`stop-${how}`);
		const seconds = `${100 + Math.floor(Math.random() * 800)}.${Math.floor(Math.random() * 9) + 1}`;
		const mark = `sleep ${seconds}`;
		let sentAt = 0;
		let endedAt = 0;
		let stopReason: string | null = null;
		let codexDuring: number[] = [];
		let sleepAfterCancel: number | null = null;
		let sleepAfterCancel2s: number | null = null;
		const prompt = `Run this shell command and wait for it to end: ${mark}\nThen reply with the word done.`;
		await go(
			drive(copy, {}, (d) =>
				Effect.gen(function* () {
					const started = Effect.gen(function* () {
						for (;;) {
							if (alive(mark).length > 0) return;
							yield* Effect.sleep("200 millis");
						}
					}).pipe(Effect.timeout("60 seconds"));
					if (how === "cancel") {
						const fiber = yield* Effect.forkChild(d.turn(prompt));
						yield* started;
						yield* Effect.sleep("1500 millis");
						codexDuring = codexPids();
						sentAt = Date.now();
						yield* d.cancel();
						const t = yield* Fiber.await(fiber);
						endedAt = Date.now();
						stopReason = Exit.isSuccess(t) ? t.value.stop : "failed";
						// The session still open: is the command gone, or only the turn?
						sleepAfterCancel = alive(mark).length;
						yield* Effect.sleep("2 seconds");
						sleepAfterCancel2s = alive(mark).length;
						return;
					}
					// Kill: the scope closes mid turn (stdin closes, then the process is killed).
					yield* Effect.raceFirst(
						d.turn(prompt).pipe(Effect.asVoid),
						started.pipe(
							Effect.andThen(Effect.sleep("1500 millis")),
							Effect.andThen(
								Effect.sync(() => {
									codexDuring = codexPids();
									sentAt = Date.now();
								}),
							),
						),
					);
				}),
			).pipe(Effect.ignore),
		);
		if (endedAt === 0) endedAt = Date.now();
		const leftNow = alive(mark).length;
		const codexNow = stillAlive(codexDuring);
		await new Promise((r) => setTimeout(r, 3000));
		const leftAfter3s = alive(mark);
		const codexAfter3s = stillAlive(codexDuring);
		for (const pid of leftAfter3s)
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		const row = {
			how,
			msToEnd: sentAt === 0 ? null : endedAt - sentAt,
			codexDuring: codexDuring.length,
			sleepAfterCancel,
			sleepAfterCancel2s,
			stopReason,
			sleepLeftAtEnd: leftNow,
			sleepLeftAfter3s: leftAfter3s.length,
			codexLeftAtEnd: codexNow,
			codexLeftAfter3s: codexAfter3s,
			...after(copy, before),
		};
		out.push(row);
		console.log(row);
		clean(copy);
	}
	save("stop", out);
}

// The form as an MCP tool the client lends the session, as the ACP builder's `report_build` (exp 77).
const Hand = Tool.make("hand_in", {
	description: "Hand in your form, once, at the very end. Then end your turn.",
	parameters: Answer,
	success: Schema.String,
});
const kit = Toolkit.make(Hand);
const formServer = Effect.gen(function* () {
	let form: Answer | null = null;
	let calls = 0;
	const path = `/mcp/${randomBytes(8).toString("hex")}` as const;
	const handlers = kit.toLayer({
		hand_in: (given) =>
			Effect.sync(() => {
				calls += 1;
				const fits = Schema.decodeUnknownOption(Answer)(given);
				if (Option.isNone(fits)) return "Refused: that form does not fit its shape.";
				form = fits.value;
				return "Taken. End your turn now.";
			}),
	});
	const app = McpServer.toolkit(kit).pipe(
		Layer.provide(handlers),
		Layer.provideMerge(
			McpServer.layerHttp({
				name: "form",
				version: "1",
				path,
				protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
			}),
		),
	);
	const served = HttpRouter.serve(app, {disableLogger: true, disableListenLog: true}).pipe(
		Layer.provideMerge(nodeHttpServer(() => createServer(), {port: 0, host: "127.0.0.1"})),
	);
	const context = yield* Layer.build(served).pipe(Effect.withTracerEnabled(false), Effect.orDie);
	const address = Context.get(context, HttpServer.HttpServer).address;
	if (address._tag !== "InetAddressV4") return yield* Effect.die("no port");
	return {
		server: {
			type: "http",
			name: "form",
			url: `http://127.0.0.1:${address.port}${path}`,
			headers: [],
		} satisfies acp.McpServer,
		form: () => form,
		calls: () => calls,
	};
});

/** Typed answers through ACP: the form in the prompt and read by our schema, or an MCP tool. */
async function schema() {
	const before = ownerSessions();
	const out: unknown[] = [];
	const textCases = [
		{
			name: "text: fit",
			prompt: `Do not run anything. Fill the form: done true, ran an empty list, summary 'nothing to do'.\n${formInPrompt(jsonSchema(Answer))}`,
		},
		{
			name: "text: asked to misfit",
			prompt: `Do not run anything. Reply with exactly this JSON and nothing else: {"done": "maybe", "extra": 1}\n${formInPrompt(jsonSchema(Answer))}`,
		},
	];
	for (const c of textCases) {
		const {copy} = fresh("schema");
		const r = await go(drive(copy, {}, (d) => d.turn(c.prompt)));
		const last = r.messages.at(-1) ?? null;
		const row = {
			name: c.name,
			stop: r.stop,
			text: last,
			read: readText(last),
			...after(copy, before),
		};
		out.push(row);
		console.log(JSON.stringify(row));
		clean(copy);
	}
	const toolCases = [
		{
			name: "mcp tool: fit",
			prompt:
				"Do not run anything else. Call the hand_in tool once with: done true, ran an empty list, summary 'nothing to do'. Then reply with the word ok.",
		},
		{
			name: "mcp tool: asked to misfit",
			prompt:
				'Do not run anything else. Call the hand_in tool once with exactly these arguments: {"done": "maybe", "extra": 1}. Then reply with the word ok.',
		},
	];
	for (const c of toolCases) {
		const {copy} = fresh("schema");
		const asked: string[] = [];
		const row = await go(
			Effect.gen(function* () {
				const f = yield* formServer;
				const r = yield* drive(
					copy,
					{
						servers: [f.server],
						allow: (ask, title) => {
							// The ask may name its call only by id; its title came on the tool_call before.
							const named = JSON.stringify(ask).includes("hand_in") || title.includes("hand_in");
							asked.push(
								`${ask.toolCall.kind ?? "?"} options=${ask.options.map((o) => o.kind).join(",")} ask_names_tool=${JSON.stringify(ask).includes("hand_in")} call_title=${title}`,
							);
							return named;
						},
					},
					(d) => d.turn(c.prompt),
				);
				return {
					name: c.name,
					stop: r.stop,
					tools: r.tools.map((t) => ({kind: t.kind, title: t.title, status: t.status})),
					asks: asked,
					calls: f.calls(),
					form: f.form(),
					said: r.messages.at(-1) ?? null,
				};
			}).pipe(Effect.scoped),
		);
		const full = {...row, ...after(copy, before)};
		out.push(full);
		console.log(JSON.stringify(full));
		clean(copy);
	}
	save("schema", out);
}

/** What the sandbox holds: one probe script run by the agent, judged by what the script wrote. */
async function limits() {
	const before = ownerSessions();
	const variants: ReadonlyArray<{
		name: string;
		config?: (c: Record<string, unknown>) => Record<string, unknown>;
	}> = [
		{name: "row as is (workspace-write, its permission profile)"},
		{
			name: "row without its permission profile",
			config: ({default_permissions: _, permissions: __, ...c}) => c,
		},
		{
			name: "row + no temp roots asked in config",
			config: (c) => ({
				...c,
				sandbox_workspace_write: {exclude_slash_tmp: true, exclude_tmpdir_env_var: true},
			}),
		},
	];
	const out: unknown[] = [];
	for (const v of variants) {
		const {copy, home} = fresh("limits");
		const outside = join(WORK, `outside-${randomBytes(3).toString("hex")}`);
		mkdirSync(outside);
		writeFileSync(join(outside, "canary.txt"), "x");
		const tmpFile = `/tmp/exp153-${randomBytes(4).toString("hex")}`;
		const homeFile = join(homedir(), `.exp153-probe-${randomBytes(4).toString("hex")}`);
		const lines = [
			'r(){ if sh -c "$2" >/dev/null 2>&1; then echo "$1=yes"; else echo "$1=no"; fi; }',
			`r read_outside 'cat ${join(outside, "canary.txt")}'`,
			`r read_owner_codex_config 'cat ${join(OWNER, "config.toml")} > /dev/null'`,
			`r list_ssh 'ls ${join(homedir(), ".ssh")}'`,
			`r list_codex_home 'ls ${home}'`,
			`r write_outside 'echo x > ${join(outside, "written.txt")}'`,
			`r write_tmp 'echo x > ${tmpFile}'`,
			`r write_codex_home 'echo x > ${join(home, "written-by-agent")}'`,
			`r write_home 'echo x > ${homeFile}'`,
			"r write_copy 'echo x > ./inside.txt'",
			"r run_node 'node -e 1'",
			"r network 'curl -sS -m 8 -o /dev/null https://example.com'",
			"r codex_home_var 'test -n \"$CODEX_HOME\"'",
			`r home_is_real_home '[ "$HOME" = "${homedir()}" ]'`,
		];
		writeFileSync(join(copy, "probe.sh"), `${lines.join("\n")}\n`);
		const harness =
			v.config === undefined
				? undefined
				: (h: ReturnType<typeof harnessOf>): Spawnable => ({
						...h,
						env: {
							...h.env,
							CODEX_CONFIG: JSON.stringify(v.config?.(JSON.parse(h.env.CODEX_CONFIG ?? "{}"))),
						},
					});
		const r = await go(
			drive(copy, harness === undefined ? {} : {harness}, (d) =>
				d.turn(
					"This is a sandbox test. Run exactly `sh probe.sh > probe.out 2>&1` once, as one shell command, then `cat probe.out`. Do not retry anything, do not ask for more access, do not work around a failure. Then reply with the word done.",
				),
			),
		);
		const probe = existsSync(join(copy, "probe.out"))
			? readFileSync(join(copy, "probe.out"), "utf8")
			: "";
		const got = Object.fromEntries(
			probe
				.split("\n")
				.map((l) => l.split("="))
				.filter((p) => p.length === 2)
				.map(([k, val]) => [k, val]),
		);
		const row = {
			variant: v.name,
			stop: r.stop,
			asks: r.asks,
			tools: r.tools.map((t) => ({kind: t.kind, status: t.status})),
			got,
			tmpWrittenReally: existsSync(tmpFile),
			outsideWrittenReally: existsSync(join(outside, "written.txt")),
			codexHomeWrittenReally: existsSync(join(home, "written-by-agent")),
			homeWrittenReally: existsSync(homeFile),
			...after(copy, before),
		};
		out.push(row);
		console.log(JSON.stringify(row));
		rmSync(tmpFile, {force: true});
		rmSync(homeFile, {force: true});
		rmSync(outside, {recursive: true, force: true});
		clean(copy);
	}
	save("limits", out);
}

/** A word told in one process, asked for in a new process: session/load, then session/resume. */
async function resume() {
	const before = ownerSessions();
	const {copy} = fresh("resume");
	const word =
		["lantern", "quarry", "meadow", "harbor"][Math.floor(Math.random() * 4)] ?? "lantern";
	const first = await go(
		drive(copy, {}, (d) =>
			Effect.gen(function* () {
				const t = yield* d.turn(`Remember this word: ${word}. Do not run anything. Reply with ok.`);
				return {id: d.id, usage: t.usage};
			}),
		),
	);
	const out: Record<string, unknown> = {first: {usage: first.usage}};
	for (const how of ["load", "resume"] as const) {
		out[how] = await go(
			drive(copy, {how, id: first.id}, (d) =>
				Effect.gen(function* () {
					const replayed = d.log.length;
					const t = yield* d.turn(
						"Which word did I ask you to remember? Reply with the word only.",
					);
					return {
						sameId: d.id === first.id,
						openMs: d.opened.ms,
						replayedUpdates: replayed,
						remembered: (t.messages.at(-1) ?? "").toLowerCase().includes(word),
						usage: t.usage,
					};
				}),
			),
		);
		console.log(how, JSON.stringify(out[how]));
	}
	save("resume", {...out, ...after(copy, before)});
	clean(copy);
}

/** The job, n times, through the `acp` program itself: `acp --agent codex`. */
async function job(n: number) {
	const before = ownerSessions();
	const rows: unknown[] = [];
	for (let i = 0; i < n; i++) {
		const {copy} = fresh(`job-${i}`);
		const t0 = Date.now();
		const r = await go(
			Effect.gen(function* () {
				const said = ear<string>();
				const results = ear<{
					stop: string;
					ms: number;
					input: number;
					output: number;
					cached: number;
					tools: number;
				}>();
				const asks = ear<{ask: string}>();
				const started = yield* start(
					acpProgram,
					{
						agent: "codex",
						folder: copy,
						model: MODEL,
						effort: EFFORT,
						mode: "workspace-write",
						permissions: undefined,
						reopen: undefined,
						budget: undefined,
					},
					{said: said.hear, result: results.hear, ask: asks.hear},
					{id: `acp:exp153-job-${i}`, storage: memoryStorage()},
				);
				if (started.kind !== "running") return yield* Effect.die(started.why);
				yield* tell(started.run, "prompt", PROMPT);
				started.close("prompt");
				yield* started.run.ended;
				// `said` is every agent message of the turn joined; the form is the last message alone.
				const t = started.run.machines.transcript.state() as Transcript | null;
				const lastMessage = t?.messages.filter((m) => m.who === "agent").at(-1)?.text ?? null;
				return {
					said: said.values,
					lastMessage,
					messages: t?.messages.filter((m) => m.who === "agent").length ?? 0,
					result: results.values[0],
					asks: asks.values.length,
				};
			}).pipe(Effect.scoped),
		);
		const answer = readText(r.lastMessage);
		const saidFits = readText(r.said.at(-1) ?? null) !== null;
		const row = {
			run: i + 1,
			wallMs: Date.now() - t0,
			turnMs: r.result?.ms ?? null,
			stop: r.result?.stop ?? null,
			tools: r.result?.tools ?? null,
			input: r.result?.input ?? null,
			cached: r.result?.cached ?? null,
			output: r.result?.output ?? null,
			asks: r.asks,
			fits: answer !== null,
			saidFits,
			agentMessages: r.messages,
			saidDone: answer?.done ?? null,
			graded: graded(copy),
			of: TRUTH.length,
			...after(copy, before),
		};
		rows.push(row);
		console.log(JSON.stringify(row));
		clean(copy);
	}
	save("job", rows);
}

function report() {
	const all = load();
	const jobs = (all.job as Array<Record<string, number | boolean | null>> | undefined) ?? [];
	const median = (xs: number[]) => {
		const s = [...xs].sort((a, b) => a - b);
		const low = s[Math.floor((s.length - 1) / 2)];
		const high = s[Math.ceil((s.length - 1) / 2)];
		return low === undefined || high === undefined ? null : (low + high) / 2;
	};
	const num = (k: string) =>
		jobs.map((j) => j[k]).filter((x): x is number => typeof x === "number");
	console.log({
		runs: jobs.length,
		right: jobs.filter((j) => j.graded === j.of).length,
		fits: jobs.filter((j) => j.fits === true).length,
		saidDoneWrong: jobs.filter((j) => j.saidDone === true && j.graded !== j.of).length,
		medianTurnS: (median(num("turnMs")) ?? 0) / 1000,
		rangeS: [Math.min(...num("turnMs")) / 1000, Math.max(...num("turnMs")) / 1000],
		medianTools: median(num("tools")),
		medianInput: median(num("input")),
		medianCached: median(num("cached")),
		medianOutput: median(num("output")),
	});
}

const [step, arg] = process.argv.slice(2);
const steps: Record<string, () => Promise<void> | void> = {
	contain,
	stream,
	stop,
	schema,
	limits,
	resume,
	job: () => job(Number(arg ?? "5")),
	report,
};
const f = step === undefined ? undefined : steps[step];
if (f === undefined) {
	console.error(`usage: node experiments/153-codex-through-acp.ts ${Object.keys(steps).join("|")}`);
	process.exit(2);
}
await f();
