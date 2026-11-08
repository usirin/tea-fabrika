import {spawn} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Effect, Schema} from "effect";
import {build} from "./src/build.ts";
import {localStage} from "./src/local-stage.ts";
import {Settings} from "./src/settings.ts";

class StageError extends Schema.TaggedError<StageError>()("StageError", {why: Schema.String}) {}
const flags = {
	child: {type: "boolean"},
	parent: {type: "string"},
	port: {type: "string"},
	name: {type: "string"},
	person: {type: "string"},
	founder: {type: "string"},
	window: {type: "string"},
} as const;
// A base64url key can start with "-", which parseArgs refuses as a separate value. Each string
// flag takes the next word as its value, written as `--flag=value`.
const words: Array<string> = [];
for (let n = 2; n < process.argv.length; n++) {
	const word = process.argv[n] ?? "",
		value = process.argv[n + 1];
	const flag = /^--(port|name|person|founder|window|parent)$/.test(word) && value !== undefined;
	words.push(flag ? `${word}=${value}` : word);
	if (flag) n++;
}
const options = parseArgs({args: words, options: flags}).values;
const home = process.env.FABRIKA_HOME ?? join(homedir(), ".fabrika");
process.env.DO_NOT_TRACK = "1";
const guard = Effect.forever(
	Effect.gen(function* () {
		const owner = Number(options.parent);
		if (!Number.isSafeInteger(owner) || owner <= 1 || process.ppid !== owner)
			return yield* new StageError({why: "parent_gone"});
		yield* Effect.sleep("250 millis");
	}),
);
const child = Effect.scoped(
	Effect.raceFirst(
		guard,
		Effect.gen(function* () {
			mkdirSync(home, {recursive: true});
			const file = join(home, "stage.json");
			const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
			const config = Schema.decodeUnknownSync(Settings)({
				...saved,
				name: options.name ?? saved.name,
				person: options.person ?? saved.person,
				founder: options.founder ?? saved.founder,
				window: options.window ?? saved.window ?? null,
				port: Number(options.port ?? saved.port ?? 18787),
				build: "pending",
			});
			writeFileSync(file, JSON.stringify(config), {mode: 0o600});
			const built = yield* build({out: join(home, "build")});
			yield* localStage(built, {...config, home});
			process.stdout.write(
				`${JSON.stringify({ready: `http://127.0.0.1:${config.port}`, build: built.build})}\n`,
			);
			return yield* Effect.never;
		}),
	),
);
const exited = (child: import("node:child_process").ChildProcess) =>
	Effect.callback<void>((resume) => {
		if (child.exitCode !== null || child.signalCode !== null) return resume(Effect.void);
		const done = () => resume(Effect.void);
		child.once("exit", done);
		return Effect.sync(() => {
			child.off("exit", done);
		});
	});
const parent = Effect.scoped(
	Effect.gen(function* () {
		const stage = yield* Effect.acquireRelease(
			Effect.sync(() =>
				spawn(
					process.execPath,
					[
						resolve(import.meta.dirname, "dev.ts"),
						...process.argv.slice(2),
						"--child",
						`--parent=${process.pid}`,
					],
					{detached: true, stdio: "inherit"},
				),
			),
			(stage) =>
				Effect.gen(function* () {
					if (stage.pid === undefined) return;
					const pid = stage.pid;
					yield* Effect.sync(() => {
						try {
							process.kill(-pid, "SIGTERM");
						} catch {
							/* The group already closed. */
						}
					});
					yield* exited(stage).pipe(Effect.timeoutOption("3 seconds"));
					yield* Effect.sync(() => {
						try {
							process.kill(-pid, "SIGKILL");
						} catch {
							/* The group already closed. */
						}
					});
				}),
		);
		yield* exited(stage);
		if (stage.exitCode !== 0) return yield* new StageError({why: "child_failed"});
	}),
);
NodeRuntime.runMain((options.child ? child : parent).pipe(Effect.provide(NodeServices.layer)));
