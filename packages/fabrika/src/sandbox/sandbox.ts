import {
	Context,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Path,
	Redacted,
	Schema,
	type Scope,
} from "effect";
import {ChildProcess, type ChildProcessSpawner} from "effect/process";

// The box a program runs in (programs-run-in-a-box.md, slice 6 of
// a-ticket-runs-from-the-app.md). A job names a program, what the box holds
// besides it, and the model login it may use. The service starts the program
// as a child process in a fresh box and hands back its handle; the box is gone
// when the scope ends.
//
//   none   a plain child: its own home and temp folder, and an environment
//          built here from a short keep-list. No fence on files or network.
//   os     the same, inside Anthropic's sandbox-runtime: it reads only its own
//          folders, and reaches only the model. On `@kampus/fabrika/sandbox/os`.
//
// Both build the environment the same way, and both refuse a job that would
// carry a GitHub key in: by its name, or by its value anywhere in what the box
// is handed. A GitHub Cmd is done outside the box, never in it.
//
// Platform-free: it names Effect's FileSystem and ChildProcessSpawner, and a
// program picks their Node layers where it starts.

/** What a box holds besides the program itself. */
export const Holds = Schema.Union([
	/** No code at all: triage, and merge. */
	Schema.TaggedStruct("nothing", {}),
	/** A copy of the code, to change: plan, the test writer, build, mutation. */
	Schema.TaggedStruct("code", {folder: Schema.String}),
	/** The commit to read, never to change: review, and push. */
	Schema.TaggedStruct("commit", {folder: Schema.String}),
]);
export type Holds = typeof Holds.Type;

/**
 * The model login a box may hold, the GitHub Actions way
 * (agents-behind-one-service.md). Claude Code takes the person's token as
 * `CLAUDE_CODE_OAUTH_TOKEN`; Codex takes `auth.json`, lent for the job and
 * taken back with the box.
 */
export const Login = Schema.Union([
	Schema.TaggedStruct("none", {}),
	Schema.TaggedStruct("claude", {token: Schema.Redacted(Schema.String)}),
	Schema.TaggedStruct("codex", {auth: Schema.Redacted(Schema.String)}),
]);
export type Login = typeof Login.Type;

/** One program to start in a box. */
export const Job = Schema.Struct({
	command: Schema.String,
	args: Schema.Array(Schema.String),
	/** The program's own folders, read only: its install, its package. */
	reads: Schema.Array(Schema.String),
	/** Names the program needs set. A GitHub key's name is refused. */
	env: Schema.Record(Schema.String, Schema.String),
	holds: Holds,
	login: Login,
});
export type Job = typeof Job.Type;

/** Why a box did not start. `what` names the place, never a value. */
export class SandboxError extends Schema.TaggedError<SandboxError>()("SandboxError", {
	why: Schema.Literals(["key_in_box", "opens_home", "no_start"]),
	what: Schema.String,
}) {}

export class Sandbox extends Context.Service<
	Sandbox,
	{
		readonly kind: "none" | "os";
		/** Start the job's program in a fresh box. The box is gone when the scope ends. */
		readonly start: (
			job: Job,
		) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, SandboxError, Scope.Scope>;
	}
>()("@kampus/fabrika/Sandbox") {}

/** The environment a box is built from, or a test standing in for it. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Where the GitHub key is, for gh and git. Never handed into a box. */
export const GITHUB_KEYS = [
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GH_ENTERPRISE_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN",
] as const;

/** A name a job may not set: one of the above, or anything else gh or GitHub reads. */
const isGithubName = (name: string) => /^(GH|GITHUB)_/i.test(name);

/** What a program needs to run at all, taken from the host. HOME and TMPDIR are the box's own. */
const RUN = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] as const;

/** A box's own folders, under one temp folder that goes with the box. */
export interface Room {
	readonly root: string;
	readonly home: string;
	readonly tmp: string;
	/** Where a program that holds nothing starts. */
	readonly work: string;
}

/** What is started: the program, or the box tool around it. */
export interface Launch {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd: string;
}

/** The folder a job's program starts in. */
export const cwdOf = (job: Job, room: Room) =>
	job.holds._tag === "nothing" ? room.work : job.holds.folder;

/** Where Codex finds its lent `auth.json`, in the box's own home. */
const codexHome = (room: Room) => `${room.home}/.codex`;

const loginEnv = (login: Login, room: Room): Record<string, string> => {
	switch (login._tag) {
		case "none":
			return {};
		case "claude":
			return {CLAUDE_CODE_OAUTH_TOKEN: Redacted.value(login.token)};
		case "codex":
			return {CODEX_HOME: codexHome(room)};
	}
};

/**
 * The box's environment: the run names from the host, the box's own home and
 * temp folder, the login, and the job's own names. Nothing else of the host's
 * is handed on, so a key the host holds in its environment stays there.
 */
export const envOf = (job: Job, room: Room, parent: Env): Record<string, string> => {
	const run = Object.fromEntries(
		RUN.flatMap((name) => {
			const value = parent[name];
			return value === undefined ? [] : [[name, value] as const];
		}),
	);
	return {...job.env, ...run, HOME: room.home, TMPDIR: room.tmp, ...loginEnv(job.login, room)};
};

/** The host's GitHub keys: the values under `GITHUB_KEYS` in its environment, and any it names. */
export const keysOf = (parent: Env, more: readonly Redacted.Redacted<string>[] = []) => [
	...GITHUB_KEYS.flatMap((name) => {
		const value = parent[name];
		return value === undefined || value === "" ? [] : [value];
	}),
	...more.map(Redacted.value).filter((value) => value !== ""),
];

/**
 * Refuse a launch that would carry a GitHub key into the box: a job's name
 * gh reads, or a key's value in any name, argument or lent file. Checked on
 * what is started, after the box tool is put around the program.
 */
export const refuseKeys = (
	job: Job,
	launch: Launch,
	keys: readonly string[],
): Effect.Effect<void, SandboxError> => {
	const named = Object.keys(job.env).find(isGithubName);
	if (named !== undefined) return Effect.fail(new SandboxError({why: "key_in_box", what: named}));
	const lent =
		job.login._tag === "codex" ? [["login", Redacted.value(job.login.auth)] as const] : [];
	const places: readonly (readonly [string, string])[] = [
		["command", launch.command],
		...launch.args.map((arg, n) => [`argument ${n + 1}`, arg] as const),
		...Object.entries(launch.env),
		...lent,
	];
	const found = places.find(([, text]) => keys.some((key) => text.includes(key)));
	return found === undefined
		? Effect.void
		: Effect.fail(new SandboxError({why: "key_in_box", what: found[0]}));
};

const noStart = (what: string) => (e: {readonly message: string}) =>
	new SandboxError({why: "no_start", what: `${what}: ${e.message}`});

/** Make the box's folders, removed when the scope ends. A Codex login is lent into its home. */
const roomOf = (job: Job) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		// Its real path: on some systems the temp folder is a link, and a box tool matches real paths.
		const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({prefix: "box-"}));
		const room: Room = {
			root,
			home: path.join(root, "home"),
			tmp: path.join(root, "tmp"),
			work: path.join(root, "work"),
		};
		for (const dir of [room.home, room.tmp, room.work]) yield* fs.makeDirectory(dir);
		if (job.login._tag === "codex") {
			yield* fs.makeDirectory(codexHome(room));
			const file = path.join(codexHome(room), "auth.json");
			yield* fs.writeFileString(file, Redacted.value(job.login.auth), {mode: 0o600});
		}
		return room;
	}).pipe(Effect.mapError(noStart("room")));

/** How a box tool puts its fence around a program. `none` puts none. */
export type Wrap<R> = (
	job: Job,
	room: Room,
	launch: Launch,
) => Effect.Effect<Launch, SandboxError, R>;

export interface SandboxOptions {
	/** The host's environment the box's few names are taken from. `process.env` where it starts. */
	readonly parent: Env;
	/** GitHub keys the host holds outside its environment, such as one gh read from the keychain. */
	readonly keys?: readonly Redacted.Redacted<string>[];
}

/** A Sandbox from a box tool's `wrap`: the room, the environment and the key check are the same for every tool. */
export const makeSandbox = <R>(
	kind: Sandbox["Service"]["kind"],
	wrap: Wrap<R>,
	o: SandboxOptions,
) =>
	Effect.gen(function* () {
		const services = yield* Effect.context<
			R | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
		>();
		const keys = keysOf(o.parent, o.keys);
		const start = (job: Job) =>
			Effect.gen(function* () {
				const room = yield* roomOf(job);
				const plain: Launch = {
					command: job.command,
					args: job.args,
					env: envOf(job, room, o.parent),
					cwd: cwdOf(job, room),
				};
				const launch = yield* wrap(job, room, plain);
				yield* refuseKeys(job, launch, keys);
				return yield* ChildProcess.make(launch.command, [...launch.args], {
					cwd: launch.cwd,
					env: {...launch.env},
					extendEnv: false,
					detached: true,
					forceKillAfter: Duration.seconds(3),
				}).pipe(Effect.mapError(noStart("spawn")));
			}).pipe(Effect.provideContext(services));
		return Sandbox.of({kind, start});
	});

/** The `none` box: a plain child with its own folders and a short environment, and no fence. */
export const layerNone = (o: SandboxOptions) =>
	Layer.effect(
		Sandbox,
		makeSandbox("none", (_job, _room, launch) => Effect.succeed(launch), o),
	);
