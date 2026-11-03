import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import {Effect, FileSystem, Layer, Path} from "effect";
import {fencedEnv, gitOf, opensHome, temps, toolchain} from "../agents/claude/sandbox.ts";
import {
	type Credential,
	type Job,
	type Launch,
	makeSandbox,
	Sandbox,
	SandboxError,
	type SandboxOptions,
	type Workspace,
} from "./sandbox.ts";

// `@kampus/fabrika-old/sandbox/os`: the `os` sandbox. The program runs inside
// Anthropic's sandbox-runtime (`srt`, Seatbelt on a Mac, bubblewrap on
// Linux), as experiments 127, 128 and 137 ran it. One settings file a sandbox:
//
//   - it reads its own folders, what is mounted, the program's own folders and
//     the toolchain. The home folder and the temp folders are closed, and no
//     folder that would open them or a login file is let in.
//   - it writes its own folders, and the worktree when one is mounted. A
//     commit is read only.
//   - it reaches only its credential's model. With no credential it reaches
//     nothing.
//
// Node at the edge: the home folder, the temp folders and the toolchain are
// the machine's, and srt is a Node program found by Node's resolver.

/**
 * Where each credential's model is. A starting list, from the makers' docs:
 * slices 8 to 11 run the real agents and fix it from what they reach.
 */
const MODEL: Record<Credential["_tag"], readonly string[]> = {
	none: [],
	claude: ["api.anthropic.com"],
	codex: ["chatgpt.com", "api.openai.com", "auth.openai.com"],
};

/** The srt settings for one sandbox. */
export const settingsOf = (
	job: Job,
	workspace: Workspace,
	tools: readonly string[],
): {readonly settings: unknown; readonly opens: string | null} => {
	const mounted = job.mount._tag === "none" ? [] : [job.mount.folder, ...gitOf(job.mount.folder)];
	const reads = [...mounted, ...job.reads];
	const opens = reads.find(opensHome) ?? null;
	const writes = job.mount._tag === "worktree" ? [job.mount.folder] : [];
	return {
		opens,
		settings: {
			network: {allowedDomains: [...MODEL[job.credential._tag]], deniedDomains: []},
			filesystem: {
				denyRead: [homedir(), ...temps()],
				// The workspace's own folders, not its root: its settings file is srt's, not the program's.
				allowRead: [
					workspace.home,
					workspace.tmp,
					workspace.work,
					...reads,
					...tools.filter((t) => !opensHome(t)),
				],
				allowWrite: [workspace.home, workspace.tmp, workspace.work, ...writes],
				denyWrite: [],
			},
		},
	};
};

/** srt's own program, from the optional peer `@anthropic-ai/sandbox-runtime`. */
const srt = Effect.try({
	try: () => fileURLToPath(import.meta.resolve("@anthropic-ai/sandbox-runtime/dist/cli.js")),
	catch: () =>
		new SandboxError({
			why: "no_start",
			what: "the os sandbox needs @anthropic-ai/sandbox-runtime installed",
		}),
});

const wrap =
	(parent: SandboxOptions["parent"]) => (job: Job, workspace: Workspace, launch: Launch) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const cli = yield* srt;
			// srt's own package too: on Linux its seccomp helper runs inside the sandbox.
			const tools = [...toolchain(parent, process.execPath), path.dirname(path.dirname(cli))];
			const {settings, opens} = settingsOf(job, workspace, tools);
			if (opens !== null) return yield* new SandboxError({why: "opens_home", what: opens});
			const file = path.join(workspace.root, "srt.json");
			yield* fs
				.writeFileString(file, JSON.stringify(settings))
				.pipe(Effect.mapError((e) => new SandboxError({why: "no_start", what: e.message})));
			return {
				command: process.execPath,
				// `--` first: without it srt reads the program's own flags as its own.
				args: [cli, "--settings", file, "--", launch.command, ...launch.args],
				// Its PATH keeps only folders the sandbox may read: a lookup stops at the first it may not.
				env: fencedEnv(launch.env, tools),
				cwd: launch.cwd,
			} satisfies Launch;
		});

/** The `os` sandbox, on sandbox-runtime. */
export const layerOs = (o: SandboxOptions) =>
	Layer.effect(Sandbox, makeSandbox("os", wrap(o.parent), o));
