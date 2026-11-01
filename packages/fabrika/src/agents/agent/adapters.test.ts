import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, PlatformError, Schema, Stream} from "effect";
import {type ChildProcess, ChildProcessSpawner} from "effect/process";
import {describe, expect, it} from "vitest";
import {claudeResultOf, rawOfUpdate} from "../acp/adapter.ts";
import {codexHomeOf, codexSystem, FENCE_LIMIT, type FolderAccess} from "../acp/harness.ts";
import {
	type ClaudeAdapterConfig,
	claudeAdapter,
	type ExtraOptions,
	rawOf,
} from "../claude/adapter.ts";
import {type DraftRun, type Open, openLive} from "../claude/draft.ts";
import {AGENTS_MD} from "../claude/rules.ts";
import {jsonSchema} from "../claude/schema.ts";
import {
	type CodexAdapterConfig,
	codexAdapter,
	codexEnvOf,
	flagsOf,
	rawOfLine,
	strictOk,
} from "../codex/adapter.ts";
import {makeAgents} from "./core.ts";
import {agentRunner} from "./draft.ts";
import {fakeAdapter, saying} from "./fake.ts";
import {under} from "./reap.ts";
import {memorySessions} from "./sessions.ts";
import {type AdapterTurn, NO_LIMITS, NonBlank, noReaper, type SystemPrompt} from "./turn.ts";

// Each adapter's pure part: how what its maker says becomes the interface's
// raw updates, the containment that can be checked with no agent, and the
// system prompt each maker is handed. No test here starts an agent.

/** An SDK message with only the fields `rawOf` reads. */
const sdk = (m: Record<string, unknown>): SDKMessage =>
	// oxlint-disable-next-line fabrika/no-type-assertions -- a fixture holds the few fields rawOf reads; the SDK's full type has dozens more
	m as unknown as SDKMessage;

describe("claude: SDK messages", () => {
	it("reads text, tool calls and their results, then the turn's tokens, dollars and typed answer", () => {
		const assistant = sdk({
			type: "assistant",
			parent_tool_use_id: null,
			message: {
				content: [
					{type: "text", text: "looking"},
					{type: "tool_use", id: "tu1", name: "Read", input: {}},
				],
			},
		});
		expect(rawOf(assistant)).toEqual([
			{_tag: "said", text: "looking"},
			{_tag: "tool", id: "tu1", title: "Read", status: "pending"},
		]);
		const result = sdk({
			type: "result",
			subtype: "success",
			is_error: false,
			total_cost_usd: 0.05,
			num_turns: 3,
			structured_output: {done: true},
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 90,
				cache_creation_input_tokens: 0,
			},
		});
		expect(rawOf(result)).toEqual([
			{_tag: "tokens", tokens: {input: 100, cached: 90, output: 5}, whole: true},
			{_tag: "ended", stop: "end_turn", structured: {done: true}, usd: 0.05, requests: 3},
		]);
	});

	it("names a budget stop as over_budget, and any other error result as broken", () => {
		const of = (subtype: string) =>
			rawOf(
				sdk({
					type: "result",
					subtype,
					is_error: true,
					total_cost_usd: 0.2,
					num_turns: 9,
					usage: {input_tokens: 1, output_tokens: 1},
				}),
			);
		expect(of("error_max_budget_usd")).toContainEqual(
			expect.objectContaining({stop: "over_budget"}),
		);
		expect(of("error_during_execution")).toEqual({broke: "error_during_execution (error)"});
	});

	/** The options the SDK is opened with for one turn: an empty query, no agent starts. */
	const openedWith = async (
		system: SystemPrompt,
		config: ClaudeAdapterConfig = {},
		resume: string | null = null,
	) => {
		const opened: Options[] = [];
		const open: Open = ({options}) => {
			opened.push(options);
			return {
				[Symbol.asyncIterator]: () => ({
					next: async (): Promise<IteratorResult<SDKMessage>> => ({done: true, value: undefined}),
				}),
				interrupt: async () => undefined,
				close: () => {},
			};
		};
		await Effect.runPromise(
			Effect.scoped(
				claudeAdapter({...config, open}).start({
					folder: "/work/copy",
					prompt: "p",
					system,
					schema: {},
					resume,
					session: "s",
					model: null,
					effort: null,
					usd: null,
				}),
			),
		);
		return opened[0];
	};

	it("opens Claude Code's own system prompt with the stage's line appended, auto memory off (experiment 158)", async () => {
		const options = await openedWith({_tag: "append", text: "You plan; you change no file."});
		// With no system prompt named, the SDK sends an empty one: the agent gets no instructions.
		expect(options?.systemPrompt).toEqual({
			type: "preset",
			preset: "claude_code",
			append: "You plan; you change no file.",
			snapshot: false,
		});
		// The preset asks for a memory folder under ~/.claude, outside any copy a run is given.
		expect(options?.settings).toEqual({
			disableClaudeAiConnectors: true,
			autoMemoryEnabled: false,
			pluginConfigs: AGENTS_MD,
		});
	});

	it("opens the stage's own text alone as the whole system prompt", async () => {
		const text = "You sort one ticket.\nNo tools.";
		expect((await openedWith({_tag: "replace", text: NonBlank.make(text)}))?.systemPrompt).toEqual({
			type: "custom",
			prompt: text,
			snapshot: false,
		});
	});

	it("hands a resumed turn its own prompt, not the session's first: the prompt is never recorded", async () => {
		// The SDK records a session's first prompt by default and sends that on a resume.
		const system: SystemPrompt = {
			_tag: "replace",
			text: NonBlank.make("You review; you change no file."),
		};
		const options = await openedWith(system, {}, "a-session");
		expect(options?.resume).toBe("a-session");
		expect(options?.systemPrompt).toEqual({
			type: "custom",
			prompt: "You review; you change no file.",
			snapshot: false,
		});
	});

	it("takes from a stage only the options of its allow-list, and keeps the turn's prompt", async () => {
		const more = (): ExtraOptions => ({disallowedTools: ["WebFetch"]});
		const options = await openedWith({_tag: "append", text: "ours"}, {more});
		expect(options?.disallowedTools).toEqual(["WebFetch"]);
		expect(options?.systemPrompt).toEqual({
			type: "preset",
			preset: "claude_code",
			append: "ours",
			snapshot: false,
		});
	});

	it("lets no stage swap the prompt through another option: its type refuses it, and so does the start", async () => {
		const configs: readonly ClaudeAdapterConfig[] = [
			// @ts-expect-error the main thread's agent brings its own system prompt
			{more: () => ({agent: "x", agents: {x: {description: "d", prompt: "Hi"}}})},
			// @ts-expect-error nor may a stage define agents
			{more: () => ({agents: {x: {description: "d", prompt: "Hi"}}})},
			// @ts-expect-error nor hand the CLI its own flags
			{more: () => ({extraArgs: {"system-prompt": "Hi"}})},
			// @ts-expect-error nor name the system prompt itself
			{more: () => ({systemPrompt: "something else"})},
		];
		for (const config of configs) {
			const opened: Options[] = [];
			const open: Open = ({options}) => {
				opened.push(options);
				return {
					[Symbol.asyncIterator]: () => ({
						next: async (): Promise<IteratorResult<SDKMessage>> => ({done: true, value: undefined}),
					}),
					interrupt: async () => undefined,
					close: () => {},
				};
			};
			const error = await Effect.runPromise(
				Effect.scoped(
					Effect.flip(
						claudeAdapter({...config, open}).start({
							folder: "/work/copy",
							prompt: "p",
							system: {_tag: "append", text: "ours"},
							schema: {},
							resume: null,
							session: "s",
							model: null,
							effort: null,
							usd: null,
						}),
					),
				),
			);
			expect(error).toMatchObject({_tag: "AgentFailed", why: "contain"});
			expect(opened).toHaveLength(0);
		}
	});
});

describe("claude: where its settings come from", () => {
	const TURN: AdapterTurn = {
		folder: "/work/repo",
		prompt: "p",
		system: {_tag: "append", text: ""},
		schema: {},
		resume: null,
		session: "s",
		model: null,
		effort: null,
		usd: null,
	};

	/** An opener that keeps the options it is handed and opens an empty query: no agent starts. */
	const keeping = () => {
		const seen: Options[] = [];
		const open: Open = ({options}) => {
			seen.push(options);
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.resolve({done: true as const, value: undefined}),
				}),
				interrupt: () => Promise.resolve(undefined),
				close: () => undefined,
			};
		};
		return {seen, open};
	};

	it("reads the folder's rule files and none of its settings, as the stages do", async () => {
		const {seen, open} = keeping();
		await Effect.runPromise(Effect.scoped(claudeAdapter({open}).start(TURN)));
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			settingSources: ["project"],
			projectConfigRoot: "/var/empty",
			settings: {disableClaudeAiConnectors: true, pluginConfigs: AGENTS_MD},
			strictMcpConfig: true,
			mcpServers: {},
			permissionMode: "dontAsk",
		});
	});

	it("lets no stage say where settings come from: its type refuses it, and so does the start", async () => {
		const {seen, open} = keeping();
		const configs: readonly ClaudeAdapterConfig[] = [
			// @ts-expect-error a stage's options cannot name the settings sources
			{open, more: () => ({settingSources: ["user", "project"]})},
			// @ts-expect-error nor the folder the project's settings are read from
			{open, more: () => ({projectConfigRoot: "/work/repo"})},
		];
		for (const config of configs) {
			const error = await Effect.runPromise(
				Effect.scoped(Effect.flip(claudeAdapter(config).start(TURN))),
			);
			expect(error).toMatchObject({_tag: "AgentFailed", why: "contain"});
		}
		expect(seen).toHaveLength(0);
	});

	it("fails as not started when the live opener refuses the turn, with its reason", async () => {
		// The live opener, handed options that point the settings elsewhere: it starts nothing.
		const open: Open = (params) =>
			openLive({...params, options: {...params.options, projectConfigRoot: "/work/repo"}});
		const error = await Effect.runPromise(
			Effect.scoped(
				Effect.flip(
					Effect.flatMap(claudeAdapter({open}).start(TURN), (running) =>
						Stream.runDrain(running.updates),
					),
				),
			),
		);
		expect(error).toMatchObject({why: "start", message: expect.stringContaining("not /var/empty")});
	});
});

describe("codex: exec's JSON lines", () => {
	it("reads the thread, commands, the last message and the turn's tokens", () => {
		const lines = [
			'{"type":"thread.started","thread_id":"019a"}',
			'{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"cat a"}}',
			'{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"cat a","status":"completed"}}',
			'{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"{\\"done\\":true}"}}',
			'{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":300,"output_tokens":40}}',
		];
		expect(lines.flatMap((l) => rawOfLine(l) as never[])).toEqual([
			{_tag: "opened", own: "019a"},
			{_tag: "tool", id: "i1", title: "cat a", status: "in_progress"},
			{_tag: "tool", id: "i1", title: "cat a", status: "completed"},
			{_tag: "said", text: '{"done":true}'},
			{_tag: "tokens", tokens: {input: 500, cached: 300, output: 40}, whole: true},
			{_tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: null},
		]);
		expect(rawOfLine('{"type":"turn.failed","error":{"message":"x"}}')).toHaveProperty("broke");
		expect(rawOfLine("not json")).toEqual([]);
	});

	it("turns the config into -c flags, a table of paths kept whole", () => {
		expect(
			flagsOf({
				allow_login_shell: false,
				permissions: {fenced: {extends: ":workspace", filesystem: {"/home/x": "deny"}}},
			}),
		).toEqual([
			"-c",
			"allow_login_shell=false",
			"-c",
			'permissions.fenced.extends=":workspace"',
			"-c",
			'permissions.fenced.filesystem={"/home/x"="deny"}',
		]);
	});

	it("knows which schemas strict mode refuses: an optional field", () => {
		const Fits = Schema.Struct({
			done: Schema.Boolean,
			ran: Schema.Array(Schema.Struct({call: Schema.String})),
		});
		const Loose = Schema.Struct({done: Schema.Boolean, note: Schema.optional(Schema.String)});
		expect(strictOk(jsonSchema(Fits))).toBe(true);
		expect(strictOk(jsonSchema(Loose))).toBe(false);
	});

	it("hands Codex no key, whatever the parent holds (planted)", () => {
		const env = codexEnvOf(
			{
				PATH: "/bin",
				HOME: "/home/x",
				USER: "x",
				OPENAI_API_KEY: "planted",
				CODEX_API_KEY: "planted",
				TYPESAFE_API_KEY: "planted",
				ANTHROPIC_API_KEY: "planted",
			},
			"/home/x/.cache/codex-home",
		);
		expect(Object.values(env)).not.toContain("planted");
		expect(env).toMatchObject({
			HOME: "/home/x/.cache/codex-home",
			CODEX_HOME: "/home/x/.cache/codex-home",
		});
	});
});

describe("codex: the system prompt", () => {
	/** A made-up home with a plan login in the shape Codex writes: no key, no real token. */
	const madeUpHome = () => {
		const home = realpathSync(mkdtempSync(join(tmpdir(), "codex-system-")));
		mkdirSync(join(home, ".codex"));
		writeFileSync(
			join(home, ".codex", "auth.json"),
			JSON.stringify({auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {id_token: "x"}}),
		);
		return home;
	};

	/** One turn's start in `home`'s folder `copy`. The spawner keeps the command and refuses: nothing runs. */
	const tryStart = async (home: string, system: SystemPrompt, access: FolderAccess) => {
		const parent = {PATH: "/usr/bin:/bin", HOME: home, USER: "someone", TMPDIR: tmpdir()};
		const seen: ChildProcess.StandardCommand[] = [];
		const spawner = ChildProcessSpawner.make((command) => {
			if (command._tag === "StandardCommand") seen.push(command);
			return Effect.fail(
				PlatformError.systemError({_tag: "NotFound", module: "test", method: "spawn"}),
			);
		});
		const why = await Effect.runPromise(
			Effect.gen(function* () {
				const adapter = yield* codexAdapter({
					codex: "/nowhere/codex",
					parent,
					access,
				});
				return yield* Effect.flip(
					Effect.scoped(adapter.start({...TURN, system, folder: join(home, "copy")})),
				);
			}).pipe(
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.provide(nodeServices),
			),
		);
		return {why, seen, parent};
	};

	/** The command Codex would be started with for one turn. */
	const startedWith = async (system: SystemPrompt, access: FolderAccess) => {
		const home = madeUpHome();
		mkdirSync(join(home, "copy"));
		mkdirSync(join(home, "co-beside"));
		const {why, seen, parent} = await tryStart(home, system, access);
		expect(why.why).toBe("start");
		const command = seen[0];
		if (command === undefined) throw new Error("codex was never started");
		const args = command.args.filter((a) => typeof a === "string");
		const flags = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
		return {flags, home: codexHomeOf("session:s", parent), owner: home};
	};

	const TURN: AdapterTurn = {
		folder: "/work/copy",
		prompt: "p",
		system: {_tag: "append", text: ""},
		schema: {},
		resume: null,
		session: "s",
		model: null,
		effort: null,
		usd: null,
	};

	it("hands the stage's line on as developer instructions, on top of Codex's own", async () => {
		const text = 'You plan; you change no file; hand back one "PlanDraft".';
		const {flags} = await startedWith({_tag: "append", text}, "read");
		const named = flags.filter((f) => /^(developer_instructions|model_instructions_file)=/.test(f));
		expect(named).toEqual([`developer_instructions=${JSON.stringify(text)}`]);
	});

	it("hands the stage's own text on as Codex's whole instructions, in a file in its own home", async () => {
		const text = "You sort one ticket.\nNo tools.";
		const {flags, home} = await startedWith({_tag: "replace", text: NonBlank.make(text)}, "read");
		const named = flags.filter((f) => /^(developer_instructions|model_instructions_file)=/.test(f));
		const file = codexSystem({_tag: "replace", text: NonBlank.make(text)}, home).file?.path ?? "";
		expect(file.startsWith(`${home}/system-`)).toBe(true);
		expect(named).toEqual([`model_instructions_file=${JSON.stringify(file)}`]);
		expect(readFileSync(file, "utf8")).toBe(text);
	});

	it("leaves the folder writable, or only readable for a turn that reads code", async () => {
		// Both lines matter: `:workspace` makes the folder writable whatever its own line says.
		const box = ({flags, owner}: {flags: readonly string[]; owner: string}) => {
			const table = flags.find((f) => f.startsWith("permissions.fenced.filesystem="));
			return {
				base: flags.find((f) => f.startsWith("permissions.fenced.extends=")),
				folder: ["write", "read"].find((rule) => table?.includes(`"${owner}/copy"="${rule}"`)),
			};
		};
		expect(box(await startedWith({_tag: "append", text: ""}, "write"))).toEqual({
			base: 'permissions.fenced.extends=":workspace"',
			folder: "write",
		});
		expect(box(await startedWith({_tag: "append", text: ""}, "read"))).toEqual({
			base: 'permissions.fenced.extends=":read-only"',
			folder: "read",
		});
	});

	it("reads home's own listing for a folder under home: home open, what is beside the folder closed", async () => {
		const {flags, owner} = await startedWith({_tag: "append", text: ""}, "write");
		const table = flags.find((f) => f.startsWith("permissions.fenced.filesystem="));
		// A near name, so it is closed by name with patterns or without.
		expect(table).toContain(`"${owner}/co-beside"="deny"`);
		expect(table).not.toContain(`"${owner}"="deny"`);
	});

	/** The table of one turn in `home`'s `copy`, with `more` in the parent's environment and Codex at `codex`. */
	const tableFor = async (
		home: string,
		codex: string,
		more: Readonly<Record<string, string>> = {},
	) => {
		const parent = {PATH: "/usr/bin:/bin", HOME: home, USER: "someone", TMPDIR: tmpdir(), ...more};
		const seen: ChildProcess.StandardCommand[] = [];
		const spawner = ChildProcessSpawner.make((command) => {
			if (command._tag === "StandardCommand") seen.push(command);
			return Effect.fail(
				PlatformError.systemError({_tag: "NotFound", module: "test", method: "spawn"}),
			);
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const adapter = yield* codexAdapter({codex, parent, access: "write"});
				return yield* Effect.flip(
					Effect.scoped(adapter.start({...TURN, folder: join(home, "copy")})),
				);
			}).pipe(
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.provide(nodeServices),
			),
		);
		const args = (seen[0]?.args ?? []).filter((arg) => typeof arg === "string");
		return args.find((arg) => arg.startsWith("permissions.fenced.filesystem=")) ?? "";
	};

	it.each<[string, string, string]>([
		["pnpm's folder on a Mac", "Library/pnpm/codex", "Library"],
		["a tool's bin, beside its login", ".cargo/bin/codex", ".cargo"],
		["the shared `.local`", ".local/bin/codex", ".local"],
		["the shared `.config`", ".config/tool/codex", ".config"],
	])("opens only the folder a plain Codex is in, in %s", async (_, at, parent) => {
		const home = madeUpHome();
		mkdirSync(join(home, "copy"));
		const codex = join(home, at);
		mkdirSync(dirname(codex), {recursive: true});
		writeFileSync(codex, "");
		const table = await tableFor(home, codex);
		expect(table).toContain(`"${dirname(codex)}"="read"`);
		expect(table).not.toContain(`"${join(home, parent)}"="read"`);
	});

	it("opens a linked Codex's own package, where its binary is, and only the packages of `.codex`", async () => {
		const home = madeUpHome();
		mkdirSync(join(home, "copy"));
		const bin = join(home, ".npm-global", "bin");
		const target = join(home, ".npm-global", "lib", "c", "bin", "codex.js");
		mkdirSync(bin, {recursive: true});
		mkdirSync(dirname(target), {recursive: true});
		writeFileSync(target, "");
		symlinkSync(target, join(bin, "codex"));
		const table = await tableFor(home, join(bin, "codex"));
		expect(table).toContain(`"${join(home, ".npm-global", "lib", "c")}"="read"`);
		expect(table).not.toContain(`"${join(home, ".npm-global")}"="read"`);

		const packages = join(home, ".codex", "packages");
		const standalone = join(packages, "standalone", "v1", "bin");
		mkdirSync(standalone, {recursive: true});
		writeFileSync(join(standalone, "codex"), "");
		const standing = await tableFor(home, join(standalone, "codex"));
		expect(standing).toContain(`"${packages}"="read"`);
		expect(standing).toContain(`"${join(home, ".codex", "auth.json")}"="deny"`);
	});

	it("closes the login where `CODEX_HOME` puts it, and where a link there leads", async () => {
		const home = madeUpHome();
		mkdirSync(join(home, "copy"));
		const moved = realpathSync(mkdtempSync(join(tmpdir(), "codex-moved-")));
		const away = realpathSync(mkdtempSync(join(tmpdir(), "codex-away-")));
		writeFileSync(
			join(away, "real.json"),
			JSON.stringify({auth_mode: "chatgpt", OPENAI_API_KEY: null}),
		);
		symlinkSync(join(away, "real.json"), join(moved, "auth.json"));
		const table = await tableFor(home, "/nowhere/codex", {CODEX_HOME: moved});
		expect(table).toContain(`"${join(moved, "auth.json")}"="deny"`);
		expect(table).toContain(`"${join(away, "real.json")}"="deny"`);
	});

	it("opens the clone a worktree shares, read-only, for a folder that is one", async () => {
		const home = madeUpHome();
		const own = join(home, "clone", ".git", "worktrees", "7");
		const tree = join(home, "copy");
		mkdirSync(own, {recursive: true});
		mkdirSync(tree);
		writeFileSync(join(tree, ".git"), `gitdir: ${own}\n`);
		writeFileSync(join(own, "commondir"), "../..\n");
		writeFileSync(join(own, "gitdir"), `${join(tree, ".git")}\n`);
		const table = await tableFor(home, "/nowhere/codex");
		expect(table).toContain(`"${join(home, "clone", ".git")}"="read"`);
	});

	it("starts nothing and says why when the box could not take the home's table", async () => {
		const home = madeUpHome();
		mkdirSync(join(home, "copy"));
		for (let n = 0; n <= FENCE_LIMIT; n++) writeFileSync(join(home, `co-private-${n}`), "");
		const {why, seen, parent} = await tryStart(home, {_tag: "append", text: ""}, "write");
		expect(why.why).toBe("contain");
		expect(why.message).toContain(`at most ${FENCE_LIMIT}`);
		expect(why.message).not.toContain("co-private");
		expect(seen).toEqual([]);
		expect(existsSync(codexHomeOf("session:s", parent))).toBe(false);
	});

	it("cannot be made without saying what the folder allows", () => {
		// No default: a turn that only reads must not get a writable folder because `access` was left out.
		// @ts-expect-error `access` is required.
		const left: CodexAdapterConfig = {codex: "/nowhere/codex"};
		const said: CodexAdapterConfig = {codex: "/nowhere/codex", access: "read"};
		expect([left.access, said.access]).toEqual([undefined, "read"]);
	});
});

describe("acp: session updates", () => {
	it("reads tool calls by id, and an update only when it has a status", () => {
		expect(
			rawOfUpdate({
				sessionUpdate: "tool_call",
				toolCallId: "c1",
				title: "Read a",
				status: "pending",
			}),
		).toEqual([{_tag: "tool", id: "c1", title: "Read a", status: "pending"}]);
		expect(rawOfUpdate({sessionUpdate: "tool_call_update", toolCallId: "c1"})).toEqual([]);
	});

	it("reads Claude's forwarded result for the turn's tokens and dollars", () => {
		expect(
			claudeResultOf({
				message: {
					type: "result",
					subtype: "success",
					total_cost_usd: 0.1,
					num_turns: 4,
					usage: {input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 95},
				},
			}),
		).toEqual({tokens: {input: 100, cached: 95, output: 7}, usd: 0.1, requests: 4, over: false});
		expect(claudeResultOf({message: {type: "assistant"}})).toBeNull();
	});
});

describe("the reaper", () => {
	it("finds every process under a root, at any depth, and nothing else", () => {
		const map = new Map([
			[10, 1],
			[11, 10],
			[12, 11],
			[13, 1],
		]);
		expect(under(10, map).sort()).toEqual([11, 12]);
	});
});

describe("a Draft on the interface", () => {
	it("hears the same three Msgs a Draft hears today", async () => {
		const Note = Schema.Struct({text: Schema.String});
		const fake = fakeAdapter(() => ({
			raws: [
				{_tag: "tool", id: "t1", title: "Read", status: "pending"},
				{_tag: "tool", id: "t1", title: "Read", status: "completed"},
				...saying('{"text":"done"}').raws,
			],
		}));
		const agents = makeAgents({adapters: {fake}, sessions: memorySessions(), reaper: noReaper});
		const runner = agentRunner("note", agents, (run: DraftRun) => ({
			provider: "fake",
			session: run.session.id,
			folder: "/nowhere",
			prompt: run.prompt,
			system: {_tag: "replace", text: NonBlank.make("You take notes.")},
			answer: Note,
			model: null,
			effort: null,
			limits: NO_LIMITS,
		}));
		const run: DraftRun = {
			key: "k",
			id: "k/1",
			prompt: "p",
			session: {id: "s", continues: false},
			agent: null,
			folder: null,
		};
		const msgs = await Effect.runPromise(
			Stream.runCollect(runner({id: "note", type: "note", deps: run} as Sub<"note", DraftRun>)),
		);
		expect([...msgs]).toMatchObject([
			{type: "note_tool", key: "k", id: "k/1", tool: "Read"},
			{type: "note_finished", key: "k", id: "k/1", output: {text: "done"}, session: "s"},
		]);
	});
});
