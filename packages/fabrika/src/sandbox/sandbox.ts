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

// The sandbox a program runs in (programs-run-in-a-box.md, slice 6 of
// a-ticket-runs-from-the-app.md). A job names a program, what is mounted in
// the sandbox besides it, and the model credential it may use. The service
// starts the program as a child process in a fresh sandbox and hands back its
// handle; the sandbox is gone when the scope ends.
//
//   none   a plain child: its own home and temp folder, and an environment
//          built here from a short keep-list. No fence on files or network.
//   os     the same, inside Anthropic's sandbox-runtime: it reads only its own
//          folders, and reaches only the model. On `@kampus/fabrika/sandbox/os`.
//
// Both build the environment the same way, and both refuse a job that would
// carry a GitHub key in: by its name, or by its value anywhere in what the
// sandbox is handed. A GitHub Cmd is done outside the sandbox, never in it.
//
// Platform-free: it names Effect's FileSystem and ChildProcessSpawner, and a
// program picks their Node layers where it starts.

/** What is mounted in a sandbox besides the program itself. */
export const Mount = Schema.Union([
	/** No code at all: triage, and merge. */
	Schema.TaggedStruct("none", {}),
	/** A working copy of the code, to change: plan, the test writer, build, mutation. */
	Schema.TaggedStruct("worktree", {folder: Schema.String}),
	/** The commit to read, never to change: review, and push. */
	Schema.TaggedStruct("commit", {folder: Schema.String}),
]);
export type Mount = typeof Mount.Type;

/**
 * The model credential a sandbox may hold, the GitHub Actions way
 * (agents-behind-one-service.md). Claude Code takes the person's token as
 * `CLAUDE_CODE_OAUTH_TOKEN`; Codex takes `auth.json`, lent for the job and
 * taken back with the sandbox.
 */
export const Credential = Schema.Union([
	Schema.TaggedStruct("none", {}),
	Schema.TaggedStruct("claude", {token: Schema.Redacted(Schema.String)}),
	Schema.TaggedStruct("codex", {auth: Schema.Redacted(Schema.String)}),
]);
export type Credential = typeof Credential.Type;

/** One program to start in a sandbox. */
export const Job = Schema.Struct({
	command: Schema.String,
	args: Schema.Array(Schema.String),
	/** The program's own folders, read only: its install, its package. */
	reads: Schema.Array(Schema.String),
	/** Names the program needs set. A GitHub key's name is refused. */
	env: Schema.Record(Schema.String, Schema.String),
	mount: Mount,
	credential: Credential,
});
export type Job = typeof Job.Type;

/** Why a sandbox did not start. `what` names the place, never a value. */
export class SandboxError extends Schema.TaggedError<SandboxError>()("SandboxError", {
	why: Schema.Literals(["key_in_sandbox", "opens_home", "no_start"]),
	what: Schema.String,
}) {}

export class Sandbox extends Context.Service<
	Sandbox,
	{
		readonly kind: "none" | "os";
		/** Start the job's program in a fresh sandbox. The sandbox is gone when the scope ends. */
		readonly start: (
			job: Job,
		) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, SandboxError, Scope.Scope>;
	}
>()("@kampus/fabrika/Sandbox") {}

/** The environment a sandbox is built from, or a test standing in for it. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Where the GitHub key is, for gh and git. Never handed into a sandbox. */
export const GITHUB_KEYS = [
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GH_ENTERPRISE_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN",
] as const;

/** A name a job may not set: one of the above, or anything else gh or GitHub reads. */
const isGithubName = (name: string) => /^(GH|GITHUB)_/i.test(name);

/** What a program needs to run at all, taken from the host. HOME and TMPDIR are the sandbox's own. */
const RUN = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] as const;

/** A sandbox's own folders, under one temp folder that goes with the sandbox. */
export interface Workspace {
	readonly root: string;
	readonly home: string;
	readonly tmp: string;
	/** Where a program with nothing mounted starts. */
	readonly work: string;
}

/** What is started: the program, or the sandbox tool around it. */
export interface Launch {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd: string;
}

/** The folder a job's program starts in. */
export const cwdOf = (job: Job, workspace: Workspace) =>
	job.mount._tag === "none" ? workspace.work : job.mount.folder;

/** Where Codex finds its lent `auth.json`, in the sandbox's own home. */
const codexHome = (workspace: Workspace) => `${workspace.home}/.codex`;

const credentialEnv = (credential: Credential, workspace: Workspace): Record<string, string> => {
	switch (credential._tag) {
		case "none":
			return {};
		case "claude":
			// oxlint-disable-next-line fabrika/no-redacted-value -- the lent login goes out here, into the box's env
			return {CLAUDE_CODE_OAUTH_TOKEN: Redacted.value(credential.token)};
		case "codex":
			return {CODEX_HOME: codexHome(workspace)};
	}
};

/**
 * The sandbox's environment: the run names from the host, the sandbox's own
 * home and temp folder, the credential, and the job's own names. Nothing else
 * of the host's is handed on, so a key the host holds in its environment stays
 * there.
 */
export const envOf = (job: Job, workspace: Workspace, parent: Env): Record<string, string> => {
	const run = Object.fromEntries(
		RUN.flatMap((name) => {
			const value = parent[name];
			return value === undefined ? [] : [[name, value] as const];
		}),
	);
	return {
		...job.env,
		...run,
		HOME: workspace.home,
		TMPDIR: workspace.tmp,
		...credentialEnv(job.credential, workspace),
	};
};

/** The host's GitHub keys: the values under `GITHUB_KEYS` in its environment, and any it names. */
export const keysOf = (parent: Env, more: readonly Redacted.Redacted<string>[] = []) => [
	...GITHUB_KEYS.flatMap((name) => {
		const value = parent[name];
		return value === undefined || value === "" ? [] : [value];
	}),
	// oxlint-disable-next-line fabrika/no-redacted-value -- the keys stay in the host; refuseKeys needs their text to search a launch for them
	...more.map(Redacted.value).filter((value) => value !== ""),
];

/**
 * Refuse a launch that would carry a GitHub key into the sandbox: a job's name
 * gh reads, or a key's value in any name, argument or lent file. Checked on
 * what is started, after the sandbox tool is put around the program.
 */
export const refuseKeys = (
	job: Job,
	launch: Launch,
	keys: readonly string[],
): Effect.Effect<void, SandboxError> => {
	const named = Object.keys(job.env).find(isGithubName);
	if (named !== undefined)
		return Effect.fail(new SandboxError({why: "key_in_sandbox", what: named}));
	const lent =
		job.credential._tag === "codex"
			? // oxlint-disable-next-line fabrika/no-redacted-value -- the lent auth.json stays in the host here; its text is searched for the keys
				[["credential", Redacted.value(job.credential.auth)] as const]
			: [];
	const places: readonly (readonly [string, string])[] = [
		["command", launch.command],
		...launch.args.map((arg, n) => [`argument ${n + 1}`, arg] as const),
		...Object.entries(launch.env),
		...lent,
	];
	const found = places.find(([, text]) => keys.some((key) => text.includes(key)));
	return found === undefined
		? Effect.void
		: Effect.fail(new SandboxError({why: "key_in_sandbox", what: found[0]}));
};

const noStart = (what: string) => (e: {readonly message: string}) =>
	new SandboxError({why: "no_start", what: `${what}: ${e.message}`});

/** Make the sandbox's folders, removed when the scope ends. A Codex credential is lent into its home. */
const workspaceOf = (job: Job) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		// Its real path: on some systems the temp folder is a link, and a sandbox tool matches real paths.
		const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({prefix: "sandbox-"}));
		const workspace: Workspace = {
			root,
			home: path.join(root, "home"),
			tmp: path.join(root, "tmp"),
			work: path.join(root, "work"),
		};
		for (const dir of [workspace.home, workspace.tmp, workspace.work]) yield* fs.makeDirectory(dir);
		if (job.credential._tag === "codex") {
			yield* fs.makeDirectory(codexHome(workspace));
			const file = path.join(codexHome(workspace), "auth.json");
			// oxlint-disable-next-line fabrika/no-redacted-value -- the lent auth.json goes out here, into the box's home, mode 0600
			yield* fs.writeFileString(file, Redacted.value(job.credential.auth), {mode: 0o600});
		}
		return workspace;
	}).pipe(Effect.mapError(noStart("workspace")));

/** How a sandbox tool puts its fence around a program. `none` puts none. */
export type Wrap<R> = (
	job: Job,
	workspace: Workspace,
	launch: Launch,
) => Effect.Effect<Launch, SandboxError, R>;

export interface SandboxOptions {
	/** The host's environment the sandbox's few names are taken from. `process.env` where it starts. */
	readonly parent: Env;
	/** GitHub keys the host holds outside its environment, such as one gh read from the keychain. */
	readonly keys?: readonly Redacted.Redacted<string>[];
}

/** A Sandbox from a sandbox tool's `wrap`: the workspace, the environment and the key check are the same for every tool. */
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
				const workspace = yield* workspaceOf(job);
				const plain: Launch = {
					command: job.command,
					args: job.args,
					env: envOf(job, workspace, o.parent),
					cwd: cwdOf(job, workspace),
				};
				const launch = yield* wrap(job, workspace, plain);
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

/** The `none` sandbox: a plain child with its own folders and a short environment, and no fence. */
export const layerNone = (o: SandboxOptions) =>
	Layer.effect(
		Sandbox,
		makeSandbox("none", (_job, _workspace, launch) => Effect.succeed(launch), o),
	);
