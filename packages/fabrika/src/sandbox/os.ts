import {homedir} from "node:os";
import {fileURLToPath} from "node:url";
import {Effect, FileSystem, Layer, Path} from "effect";
import {fencedEnv, gitOf, opensHome, temps, toolchain} from "../agents/claude/sandbox.ts";
import {
	type Job,
	type Launch,
	type Login,
	makeSandbox,
	type Room,
	Sandbox,
	SandboxError,
	type SandboxOptions,
} from "./sandbox.ts";

// `@kampus/fabrika/sandbox/os`: the `os` box. The program runs inside
// Anthropic's sandbox-runtime (`srt`, Seatbelt on a Mac, bubblewrap on
// Linux), as experiments 127, 128 and 137 ran it. One settings file a box:
//
//   - it reads its own folders, what it holds, the program's own folders and
//     the toolchain. The home folder and the temp folders are closed, and no
//     folder that would open them or a login file is let in.
//   - it writes its own folders, and the copy of the code when it holds one. A
//     commit is read only.
//   - it reaches only its login's model. With no login it reaches nothing.
//
// Node at the edge: the home folder, the temp folders and the toolchain are
// the machine's, and srt is a Node program found by Node's resolver.

/**
 * Where each login's model is. A starting list, from the makers' docs: slices
 * 8 to 11 run the real agents and fix it from what they reach.
 */
const MODEL: Record<Login["_tag"], readonly string[]> = {
	none: [],
	claude: ["api.anthropic.com"],
	codex: ["chatgpt.com", "api.openai.com", "auth.openai.com"],
};

/** The srt settings for one box. */
export const settingsOf = (
	job: Job,
	room: Room,
	tools: readonly string[],
): {readonly settings: unknown; readonly opens: string | null} => {
	const held = job.holds._tag === "nothing" ? [] : [job.holds.folder, ...gitOf(job.holds.folder)];
	const reads = [...held, ...job.reads];
	const opens = reads.find(opensHome) ?? null;
	const writes = job.holds._tag === "code" ? [job.holds.folder] : [];
	return {
		opens,
		settings: {
			network: {allowedDomains: [...MODEL[job.login._tag]], deniedDomains: []},
			filesystem: {
				denyRead: [homedir(), ...temps()],
				allowRead: [room.root, ...reads, ...tools.filter((t) => !opensHome(t))],
				allowWrite: [room.home, room.tmp, room.work, ...writes],
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
			what: "the os box needs @anthropic-ai/sandbox-runtime installed",
		}),
});

const wrap = (parent: SandboxOptions["parent"]) => (job: Job, room: Room, launch: Launch) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const cli = yield* srt;
		const tools = toolchain(parent, process.execPath);
		const {settings, opens} = settingsOf(job, room, tools);
		if (opens !== null) return yield* new SandboxError({why: "opens_home", what: opens});
		const file = path.join(room.root, "srt.json");
		yield* fs
			.writeFileString(file, JSON.stringify(settings))
			.pipe(Effect.mapError((e) => new SandboxError({why: "no_start", what: e.message})));
		return {
			command: process.execPath,
			// `--` first: without it srt reads the program's own flags as its own.
			args: [cli, "--settings", file, "--", launch.command, ...launch.args],
			// Its PATH keeps only folders the box may read: a lookup stops at the first it may not.
			env: fencedEnv(launch.env, tools),
			cwd: launch.cwd,
		} satisfies Launch;
	});

/** The `os` box, on sandbox-runtime. */
export const layerOs = (o: SandboxOptions) =>
	Layer.effect(Sandbox, makeSandbox("os", wrap(o.parent), o));
