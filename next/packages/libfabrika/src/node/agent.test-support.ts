// T328, next/. Child driver for actual key/receipt filesystem races, never a product substitute.
import {spawn} from "node:child_process";
import {existsSync, watch, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeFileSystem} from "@effect/platform-node";
import {Effect, FileSystem, Layer, Schema} from "effect";
import * as Id from "../id.ts";
import {CallStore} from "../mcp/mcp.test-support.ts";

export const reserve = {
	digest: "a".repeat(64),
	key: "agent",
	ledger: "ledger",
	target: "notes:1",
	sentAt: "2026-11-08T00:00:00Z",
	seen: 3,
};
export const raceChildren = Effect.fn("test.raceChildren")(function* (
	home: string,
	kind: "key" | "receipt",
) {
	const start = () => {
		const child = spawn(process.execPath, [import.meta.filename, "child", kind, home], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {PATH: process.env.PATH, HOME: process.env.HOME, FABRIKA_HOME: home},
		});
		let output = "",
			error = "";
		child.stdout.on("data", (b) => {
			output += b;
		});
		child.stderr.on("data", (b) => {
			error += b;
		});
		const done = Effect.callback<unknown, Error>((resume) => {
			child.once("error", (e) => resume(Effect.fail(e)));
			child.once("exit", (code) =>
				resume(
					code === 0
						? Effect.try(() => JSON.parse(output))
						: Effect.fail(new Error(`test child exit ${code}: ${error}`)),
				),
			);
			return Effect.sync(() => {
				child.kill();
			});
		});
		return {child, done};
	};
	const a = start(),
		b = start();
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			a.child.kill();
			b.child.kill();
		}),
	);
	// Both outside processes exist before either may enter the operation.
	a.child.stdin.write("go\n");
	b.child.stdin.write("go\n");
	if (kind === "key") {
		yield* Effect.callback<void, Error>((resume) => {
			const check = () => {
				if (
					existsSync(join(home, `${a.child.pid}.ready`)) &&
					existsSync(join(home, `${b.child.pid}.ready`))
				)
					resume(Effect.void);
			};
			const stopped = () =>
				resume(Effect.fail(new Error("key child exited before its actual file-install barrier")));
			const listener = watch(home, check);
			a.child.once("exit", stopped);
			b.child.once("exit", stopped);
			check();
			return Effect.sync(() => {
				listener.close();
				a.child.removeListener("exit", stopped);
				b.child.removeListener("exit", stopped);
			});
		});
	}
	a.child.stdin.end("install\n");
	b.child.stdin.end("install\n");
	return yield* Effect.all([a.done, b.done], {concurrency: 2});
});

if (process.argv[2] === "child") {
	const kind = process.argv[3],
		home = process.argv[4] ?? "";
	const go = Effect.callback<void>((resume) => {
		process.stdin.once("data", () => resume(Effect.void));
	});
	const main = Effect.gen(function* () {
		yield* go;
		if (kind === "key") {
			// Product import remains red until P25 is built. Only public identity is printed.
			// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the product module in a disposable test child
			const {agentKey} = yield* Effect.promise(() => import("./agent-key.ts"));
			// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the product decoder in a disposable test child
			const {AgentName} = yield* Effect.promise(() => import("./agent-options.ts"));
			const name = yield* Schema.decodeUnknownEffect(AgentName)("race");
			const fs = yield* FileSystem.FileSystem;
			let passed = false;
			const barrier = Effect.fnUntraced(function* (to: string) {
				if (passed || !to.endsWith("race.key")) return;
				passed = true;
				writeFileSync(join(home, `${process.pid}.ready`), "");
				yield* Effect.callback<void>((resume) => {
					process.stdin.once("data", () => resume(Effect.void));
				});
			});
			const install = <A, E, R>(to: string, operation: Effect.Effect<A, E, R>) =>
				barrier(to).pipe(Effect.andThen(operation));
			const guarded = {
				...fs,
				link: (...args: Parameters<typeof fs.link>) => install(args[1], fs.link(...args)),
				rename: (...args: Parameters<typeof fs.rename>) => install(args[1], fs.rename(...args)),
				copyFile: (...args: Parameters<typeof fs.copyFile>) =>
					install(args[1], fs.copyFile(...args)),
				open: (path: string, options?: Parameters<typeof fs.open>[1]) =>
					options?.flag?.includes("x")
						? install(path, fs.open(path, options))
						: fs.open(path, options),
			};
			const key = yield* agentKey({home, name}).pipe(
				Effect.provideService(FileSystem.FileSystem, guarded),
			);
			process.stdout.write(JSON.stringify(key.identity));
		} else {
			// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the product store in a disposable test child
			const {agentStore} = yield* Effect.promise(() => import("./agent-store.ts"));
			const receipt = yield* CallStore.use((s) => s.reserve(reserve)).pipe(
				Effect.provide(agentStore({home})),
			);
			process.stdout.write(JSON.stringify(receipt));
		}
	}).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, Id.Generator.layer)));
	// oxlint-disable-next-line fabrika/no-effect-run-outside-edge, fabrika/no-promises -- edge: executable test child owns its Effect runtime
	Effect.runPromise(main).catch(() => {
		process.exitCode = 1;
	});
}
