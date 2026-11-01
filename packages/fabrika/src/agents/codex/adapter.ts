import {realpathSync} from "node:fs";
import {dirname, resolve, sep} from "node:path";
import {Effect, FileSystem, Option, Schema, Stream} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";
import {
	codexConfig,
	codexHome,
	codexHomeOf,
	codexLogin,
	codexSystem,
	type FolderAccess,
	fenceTooBig,
	localDisk,
	writeSystem,
} from "../acp/harness.ts";
import {formOf} from "../agent/core.ts";
import {type Adapter, failed, type Raw} from "../agent/turn.ts";
import {type Env, runEnv, toolHome} from "../claude/env.ts";
import {gitOf, onPath, toolchain, toolRoot} from "../claude/sandbox.ts";

// Codex through `codex exec --json`, as an adapter of the interface
// (../agent/turn.ts). One process per turn: it prints one JSON event per
// line, and `codex exec resume <thread>` carries a thread on. Picked over
// `codex app-server` (experiment 156): exec has the typed answer
// (`--output-schema`), resume and a clean stop (SIGINT, which exec turns
// into the app-server's own `turn/interrupt`), on a smaller and steadier
// surface; app-server is marked experimental, and exec is a client of it.
//
// Containment, experiments 152 and 153's recipe:
//   - its own Codex home per session of ours, under home's cache, holding one
//     thing at first: a link to the login. The login is never read, copied or
//     moved, but for the two fields the plan check reads (`codexHome`);
//   - `HOME` is that home too, so `~/.agents` skills stay out;
//   - the environment is a keep-list: a program's, `USER`, the home. No key
//     (`OPENAI_API_KEY`, `CODEX_API_KEY`) is ever handed on;
//   - the permission profile of the ACP row (`codexConfig`): the folder and the
//     toolchain open and what is beside them under home closed (`homeFence`),
//     the login closed wherever it is, core shell variables only, no login
//     shell, no web search, Codex's far-reaching features off. A worktree's
//     clone is opened to read (`gitOf`), so git works in a lane's tree. A table
//     too big for the box starts nothing (`fenceTooBig`);
//   - `--ignore-user-config`, and approvals `never`: nothing asks a person.
//
// Node at the edge: `realpathSync` once, to find the folder Codex's own
// binary runs from, which the profile must leave readable, and `localDisk`,
// to read home and follow links for the profile.

/** Where Codex is, and where the login it links to is. */
export interface CodexAdapterConfig {
	readonly codex: string;
	readonly parent?: Env;
	/** What every turn may do in its folder, with no default: `write` to change it, `read` for a turn that only reads code. */
	readonly access: FolderAccess;
}

/** A string as TOML: JSON's, but for DEL, which TOML does not take raw and JSON leaves raw. */
const tomlText = (text: string) => JSON.stringify(text).replaceAll("\x7f", "\\u007f");

/** A config value as TOML, for `-c key=value`. Objects with plain keys become dotted keys. */
const toml = (value: unknown): string =>
	typeof value === "string"
		? tomlText(value)
		: typeof value === "boolean" || typeof value === "number"
			? String(value)
			: `{${Object.entries(value as Record<string, unknown>)
					.map(([k, v]) => `${tomlText(k)}=${toml(v)}`)
					.join(", ")}}`;

const PLAIN = /^[A-Za-z0-9_]+$/;

/** A config object as `-c` flags. A table whose keys are not plain (paths) stays one inline table. */
export const flagsOf = (config: Record<string, unknown>, prefix = ""): string[] =>
	Object.entries(config).flatMap(([key, value]) => {
		const name = `${prefix}${key}`;
		const nested =
			typeof value === "object" && value !== null && Object.keys(value).every((k) => PLAIN.test(k));
		return nested
			? flagsOf(value as Record<string, unknown>, `${name}.`)
			: ["-c", `${name}=${toml(value)}`];
	});

/** Whether Codex's strict mode takes a JSON Schema: every object closed, every field required. */
export const strictOk = (schema: unknown): boolean => {
	if (Array.isArray(schema)) return schema.every(strictOk);
	if (typeof schema !== "object" || schema === null) return true;
	const node = schema as Record<string, unknown>;
	if (node.type === "object" && typeof node.properties === "object" && node.properties !== null) {
		const required = Array.isArray(node.required) ? node.required : [];
		if (!Object.keys(node.properties).every((k) => required.includes(k))) return false;
	}
	return Object.values(node).every(strictOk);
};

const Usage = Schema.Struct({
	input_tokens: Schema.Number,
	cached_input_tokens: Schema.optional(Schema.Number),
	output_tokens: Schema.Number,
});
const Item = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	text: Schema.optional(Schema.String),
	command: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
});
/** The events of `codex exec --json` this adapter reads. Others are let through as nothing. */
const Event = Schema.Union([
	Schema.Struct({type: Schema.Literal("thread.started"), thread_id: Schema.String}),
	Schema.Struct({type: Schema.Literals(["item.started", "item.completed"]), item: Item}),
	Schema.Struct({type: Schema.Literal("turn.completed"), usage: Usage}),
	Schema.Struct({type: Schema.Literal("turn.failed"), error: Schema.optional(Schema.Unknown)}),
	Schema.Struct({type: Schema.Literal("error"), message: Schema.optional(Schema.String)}),
]);
const readEvent = Schema.decodeUnknownOption(Schema.fromJsonString(Event));

/** One line of Codex's stream, as raw updates. Pure. A failure is its message. */
export const rawOfLine = (line: string): Raw[] | {readonly broke: string} => {
	const read = readEvent(line);
	if (Option.isNone(read)) return [];
	const e = read.value;
	switch (e.type) {
		case "thread.started":
			return [{_tag: "opened", own: e.thread_id}];
		case "item.started":
			return e.item.type === "agent_message" || e.item.type === "reasoning"
				? []
				: [
						{
							_tag: "tool",
							id: e.item.id,
							title: e.item.command ?? e.item.type,
							status: "in_progress",
						},
					];
		case "item.completed":
			if (e.item.type === "agent_message") return [{_tag: "said", text: e.item.text ?? ""}];
			if (e.item.type === "reasoning") return [];
			return [
				{
					_tag: "tool",
					id: e.item.id,
					title: e.item.command ?? e.item.type,
					status:
						e.item.status === "failed" || e.item.status === "declined" ? "failed" : "completed",
				},
			];
		case "turn.completed": {
			const u = e.usage;
			return [
				{
					_tag: "tokens",
					tokens: {
						input: u.input_tokens,
						cached: u.cached_input_tokens ?? 0,
						output: u.output_tokens,
					},
					whole: true,
				},
				{_tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: null},
			];
		}
		case "turn.failed":
			return {broke: `turn failed: ${JSON.stringify(e.error ?? null).slice(0, 300)}`};
		case "error":
			return {broke: `error: ${(e.message ?? "").slice(0, 300)}`};
	}
};

/** Codex's whole environment: a program's, `USER` for its keychain, and its own home as both homes. No key. */
export const codexEnvOf = (parent: Env, home: string): Record<string, string> => ({
	...runEnv(parent),
	...(parent.USER === undefined ? {} : {USER: parent.USER}),
	HOME: home,
	CODEX_HOME: home,
});

/**
 * The folders Codex's own binary runs from, read-only inside its box: the
 * link's folder, and where it points, by the toolchain's own rule (`toolRoot`).
 * A standalone install keeps its releases under `~/.codex/packages` behind a
 * `current` link, so the box opens that folder (as experiment 152 did), never
 * the rest of `~/.codex`. A Codex at `~/codex` answers home here: the fence
 * opens nothing for it (`homeFence`). A bare name is found on the PATH, as the
 * system finds it. Not found: no folder, and the start fails on its own.
 */
export const codexFolders = (codex: string, owner: string, env: Env): string[] => {
	const found = codex.includes(sep) ? resolve(codex) : onPath(codex, env);
	if (found === undefined) return [];
	const real = Option.liftThrowable((p: string) => realpathSync(p))(found);
	const packages = `${owner}/.codex/packages`;
	const target = Option.isSome(real) ? real.value : found;
	return [dirname(found), target.startsWith(`${packages}/`) ? packages : toolRoot(target, owner)];
};

export const codexAdapter = (
	config: CodexAdapterConfig,
): Effect.Effect<Adapter, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const parent = config.parent ?? process.env;
		const owner = parent.HOME ?? "";
		const login = codexLogin(parent);
		return {
			name: "codex",
			// No dollar cap on a plan. A typed answer by `--output-schema`, when strict mode takes the schema.
			holds: {usd: false, schema: true},
			start: (turn) =>
				Effect.gen(function* () {
					const tools = [
						...toolchain(parent),
						...codexFolders(config.codex, owner, parent),
						...gitOf(turn.folder),
					];
					const profile = codexConfig(
						turn.folder,
						tools,
						owner,
						config.access,
						localDisk,
						toolHome(parent),
						[login],
					);
					const tooBig = fenceTooBig(profile.permissions.fenced.filesystem);
					if (tooBig !== null) return yield* Effect.fail(failed("contain", tooBig));
					// Our session, not the folder, names the home: a thread lives in the home it was made in.
					const home = codexHomeOf(`session:${turn.session}`, parent);
					yield* codexHome(home, login).pipe(
						Effect.provideService(FileSystem.FileSystem, fs),
						Effect.mapError((why) => failed("contain", why)),
					);
					// The turn's system prompt, as config (`codexSystem`); a `replace` prompt is a file in the home.
					const system = codexSystem(turn.system, home);
					yield* writeSystem(system.file).pipe(
						Effect.provideService(FileSystem.FileSystem, fs),
						Effect.mapError((why) => failed("start", why)),
					);
					const strict = strictOk(turn.schema);
					const schemaFile = `${home}/answer-schema.json`;
					if (strict)
						yield* fs
							.writeFileString(schemaFile, JSON.stringify(turn.schema))
							.pipe(Effect.mapError((e) => failed("start", String(e))));
					const args = [
						"exec",
						"--json",
						"--skip-git-repo-check",
						"--ignore-user-config",
						"-C",
						turn.folder,
						...(turn.model === null ? [] : ["-m", turn.model]),
						...(turn.effort === null ? [] : ["-c", `model_reasoning_effort=${toml(turn.effort)}`]),
						"-c",
						'approval_policy="never"',
						...flagsOf(profile),
						...flagsOf(system.config),
						...(strict ? ["--output-schema", schemaFile] : []),
						...(turn.resume === null ? [] : ["resume", turn.resume]),
						strict ? turn.prompt : `${turn.prompt}\n${formOf(turn.schema)}`,
					];
					const handle = yield* spawner
						.spawn(
							ChildProcess.make(config.codex, args, {
								cwd: turn.folder,
								env: codexEnvOf(parent, home),
								extendEnv: false,
								stdin: "ignore",
								forceKillAfter: "3 seconds",
							}),
						)
						.pipe(Effect.mapError((e) => failed("start", String(e))));
					const updates = handle.stdout.pipe(
						Stream.decodeText(),
						Stream.splitLines,
						Stream.mapError((e) => failed("broke", String(e))),
						Stream.mapEffect((line) => {
							const raws = rawOfLine(line);
							return Array.isArray(raws)
								? Effect.succeed(raws)
								: Effect.fail(failed("broke", raws.broke));
						}),
						Stream.flattenIterable,
					);
					// Read to its end, or a full pipe would stop Codex; the tail is kept for a failure's message.
					const err = {tail: ""};
					yield* handle.stderr.pipe(
						Stream.decodeText(),
						Stream.runForEach((text) =>
							Effect.sync(() => {
								err.tail = (err.tail + text).slice(-1_000);
							}),
						),
						Effect.ignore,
						Effect.forkScoped,
					);
					// Codex that exits with no turn's end failed: say what it wrote on the way out.
					const exited = Stream.fromEffect(
						handle.exitCode.pipe(
							Effect.orElseSucceed(() => -1),
							Effect.flatMap((code) =>
								Effect.fail(
									failed(
										"broke",
										`codex exited (${code}) with no turn's end: ${err.tail.trim().slice(-400)}`,
									),
								),
							),
						),
					);
					return {
						updates: Stream.concat(updates, exited),
						pid: handle.pid,
						// SIGINT, never SIGTERM: on SIGTERM Codex dies and leaves its command running (152).
						stop: handle
							.kill({killSignal: "SIGINT"})
							.pipe(Effect.andThen(handle.exitCode), Effect.timeout("3 seconds"), Effect.ignore),
					};
				}),
		};
	});
