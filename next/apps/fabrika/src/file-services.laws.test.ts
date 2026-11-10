// P12, next/. Run the real build and dev command with a recorded FileSystem and Path layer.
import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {
	Cause,
	Effect,
	Exit,
	FileSystem,
	Layer,
	Path,
	PlatformError,
	Schema,
	Sink,
	Stream,
} from "effect";
import {ChildProcessSpawner} from "effect/process";
import * as fc from "fast-check";
import {expect, it, vi} from "vitest";
import {build} from "./build.ts";
import {Row} from "./exam/compiler.ts";

const cli = vi.hoisted(() => ({
	work: undefined as Effect.Effect<unknown, unknown> | undefined,
	layer: undefined as
		| Layer.Layer<FileSystem.FileSystem | Path.Path>
		| Layer.Layer<FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>
		| undefined,
}));

vi.mock("@effect/platform-node", async (original) => {
	const actual = await original<typeof import("@effect/platform-node")>();
	return {
		...actual,
		NodeServices: {
			get layer() {
				return cli.layer ?? actual.NodeServices.layer;
			},
		},
		NodeRuntime: {
			...actual.NodeRuntime,
			runMain: (work: Effect.Effect<unknown, unknown>) => {
				cli.work = work;
			},
		},
	};
});

const stageFailure = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
	expect(Exit.isFailure(exit)).toBe(true);
	const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
	expect(Cause.hasDies(cause)).toBe(false);
	expect(Cause.findErrorOption(cause)).toMatchObject({
		_tag: "Some",
		value: {_tag: "StageError", reason},
	});
};

it("dev refuses every invalid parent with reason parent_gone before touching settings", async () => {
	const invalid = fc.oneof(
		fc.string().map((text) => `not-a-pid-${text}`),
		fc.integer().map((n) => String(n + 0.5)),
		fc.integer({min: -100, max: 1}).map(String),
		fc
			.integer({min: 2})
			.filter((pid) => pid !== process.ppid)
			.map(String),
	);
	await fc.assert(
		fc.asyncProperty(invalid, async (parent) => {
			const argv = process.argv;
			const touched = vi.fn(() => Effect.never);
			cli.layer = Layer.merge(FileSystem.layerNoop({makeDirectory: touched}), Path.layer);
			process.argv = [process.execPath, "dev.ts", "--child", `--parent=${parent}`];

			try {
				vi.resetModules();
				await import("../dev.ts");
				stageFailure(await Effect.runPromiseExit(cli.work!), "parent_gone");
				expect(touched).not.toHaveBeenCalled();
			} finally {
				process.argv = argv;
				cli.layer = undefined;
				cli.work = undefined;
			}
		}),
		{seed: 119120, numRuns: 30, examples: [["1"], ["1.5"]]},
	);
});

it("dev defaults to a scoped detached child and reports its nonzero exit as child_failed", async () => {
	await fc.assert(
		fc.asyncProperty(fc.uuid(), fc.integer({min: 0, max: 255}), async (name, code) => {
			const argv = process.argv;
			const commands: Array<import("effect/process/ChildProcess").Command> = [];
			const spawn = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make((command) =>
					Effect.sync(() => {
						commands.push(command);
						return ChildProcessSpawner.makeHandle({
							pid: ChildProcessSpawner.ProcessId(27000),
							exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
							isRunning: Effect.succeed(false),
							kill: () => Effect.void,
							stdin: Sink.drain,
							stdout: Stream.empty,
							stderr: Stream.empty,
							all: Stream.empty,
							getInputFd: () => Sink.drain,
							getOutputFd: () => Stream.empty,
							unref: Effect.succeed(Effect.void),
						});
					}),
				),
			);
			cli.layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, spawn);
			process.argv = [process.execPath, "dev.ts", "--name", name];

			try {
				vi.resetModules();
				await import("../dev.ts");
				const exit = await Effect.runPromiseExit(cli.work!);

				if (code === 0) {
					expect(Exit.isSuccess(exit)).toBe(true);
				} else {
					stageFailure(exit, "child_failed");
				}

				expect(commands).toHaveLength(1);
				expect(commands[0]).toMatchObject({
					_tag: "StandardCommand",
					command: process.execPath,
					args: [
						resolve(import.meta.dirname, "../dev.ts"),
						"--name",
						name,
						"--child",
						`--parent=${process.pid}`,
					],
					options: {
						detached: true,
						stdin: "inherit",
						stdout: "inherit",
						stderr: "inherit",
						forceKillAfter: "3 seconds",
					},
				});
			} finally {
				process.argv = argv;
				cli.layer = undefined;
				cli.work = undefined;
			}
		}),
		{seed: 119120, numRuns: 15, examples: [["clean-exit", 0]]},
	);
});

for (const edge of ["makeDirectory", "readFileString", "writeFileString"] as const) {
	it(`dev reports ${edge} failure with reason settings and never starts a build`, async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), async (name) => {
				const argv = process.argv;
				const folder = mkdtempSync(join(tmpdir(), "p12-dev-error-"));
				const failure = PlatformError.systemError({
					module: "FileSystem",
					method: edge,
					_tag: "PermissionDenied",
				});
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.void,
					exists: () => Effect.succeed(true),
					readFileString: () =>
						Effect.succeed(
							JSON.stringify({
								name,
								person: "person",
								founder: "public",
								window: null,
								port: 18787,
								build: "old",
							}),
						),
					[edge]: () => Effect.fail(failure),
				});
				vi.stubEnv("FABRIKA_HOME", folder);
				cli.layer = Layer.merge(fs, Path.layer);
				process.argv = [process.execPath, "dev.ts", "--child", `--parent=${process.ppid}`];

				try {
					vi.resetModules();
					await import("../dev.ts");
					stageFailure(await Effect.runPromiseExit(cli.work!), "settings");
				} finally {
					process.argv = argv;
					cli.layer = undefined;
					cli.work = undefined;
					vi.unstubAllEnvs();
					rmSync(folder, {recursive: true, force: true});
				}
			}),
			{seed: 119120, numRuns: 10},
		);
	});
}

// Bundler output is platform input here. Compiler behavior has its own real-build laws.
// P16's table check refuses a program whose hash is not its source's own SHA-256 hex.
vi.mock("@kampus/libfabrika/node/build", async (original) => ({
	...(await original<typeof import("@kampus/libfabrika/node/build")>()),
	bundlePrograms: () =>
		Effect.succeed({
			counter: {hash: createHash("sha256").update("counter").digest("hex"), source: "counter"},
		}),
	bundle: () => Effect.succeed({output: [{type: "chunk", code: "export default {};"}]}),
}));

vi.mock("./exam/compiler.ts", async (original) => ({
	...(await original<typeof import("./exam/compiler.ts")>()),
	compile: (_file: string, code: string) => ({code}),
	check: () => [],
}));

vi.mock("./local-stage.ts", () => ({
	localStage: () => Effect.fail({reason: "test_stage_ready"}),
}));

const root = resolve(import.meta.dirname, "../../../..");

const generated = fc.record({
	name: fc.uuid(),
	label: fc.string(),
	port: fc.integer({min: 1024, max: 65535}),
});

const boundary = {name: "saved-home", label: "first build", port: 18787};

const recorded = (folder: string, source: string, text: string, failPublish: boolean) => {
	const out = join(folder, "build"),
		pending = join(folder, ".fabrika-build-test"),
		backup = `${pending}.old`;
	const files = new Map([
		[source, text],
		[join(root, "compiler-ledger.json"), "[]"],
		[join(out, "brain.mjs"), "last good"],
	]);
	const modes: Array<ReadonlyArray<unknown>> = [];
	const calls: Array<ReadonlyArray<unknown>> = [],
		paths: Array<ReadonlyArray<string>> = [];
	const note = (name: string, ...args: ReadonlyArray<unknown>) => {
		calls.push([name, ...args]);
	};
	const move = (from: string, to: string) => {
		for (const [path, text] of [...files]) {
			if (path === from || path.startsWith(`${from}/`)) {
				files.delete(path);
				files.set(to + path.slice(from.length), text);
			}
		}
	};
	const write = (path: string, text: string) =>
		Effect.sync(() => {
			note("write", path, text);
			files.set(path, text);
		});
	const fs = FileSystem.layerNoop({
		glob: () => Effect.succeed([relative(root, source)]),
		exists: (path) =>
			Effect.sync(
				() => files.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`)),
			),
		readFileString: (path) =>
			Effect.sync(() => {
				note("read", path);
				return files.get(path) ?? "";
			}),
		makeDirectory: (path) =>
			Effect.sync(() => {
				note("mkdir", path);
			}),
		makeTempDirectory: () =>
			Effect.sync(() => {
				note("temp", pending);
				return pending;
			}),
		writeFileString: (path, text, options) => {
			modes.push([path, options?.mode]);
			return write(path, text);
		},
		writeFile: (path, bytes) => write(path, new TextDecoder().decode(bytes)),
		rename: (from, to) =>
			Effect.suspend(() => {
				note("rename", from, to);

				if (failPublish && from === pending && to === out) {
					return Effect.fail(
						PlatformError.systemError({
							module: "FileSystem",
							method: "rename",
							_tag: "PermissionDenied",
							pathOrDescriptor: from,
						}),
					);
				}

				move(from, to);
				return Effect.void;
			}),
		remove: (path) =>
			Effect.sync(() => {
				note("remove", path);

				for (const file of files.keys()) {
					if (file === path || file.startsWith(`${path}/`)) {
						files.delete(file);
					}
				}
			}),
	});
	const path = Effect.runSync(Path.Path.pipe(Effect.provide(Path.layer)));
	const layer = Layer.merge(
		fs,
		Layer.succeed(Path.Path, {
			...path,
			join: (...parts) => {
				paths.push(parts);
				return path.join(...parts);
			},
		}),
	);
	return {out, pending, backup, files, calls, paths, modes, layer};
};

for (const failed of [false, true]) {
	it(`build reads and publishes through FileSystem, preserving write and rollback order: ${failed ? "rename fails" : "success"}`, async () => {
		await fc.assert(
			fc.asyncProperty(generated, async ({name, label}) => {
				const folder = mkdtempSync(join(tmpdir(), "p12-build-fs-")),
					source = join(folder, `${name}.tsx`);
				const text = `export const label = ${JSON.stringify(label)};`;
				const w = recorded(folder, source, text, failed);
				// HEAD has real paths too, so ignoring the supplied service fails an assertion, not setup.
				mkdirSync(w.out);
				writeFileSync(join(w.out, "brain.mjs"), "last good");
				writeFileSync(source, text);

				try {
					const result = await Effect.runPromiseExit(
						build({out: w.out, files: [source]}).pipe(Effect.provide(w.layer)),
					);
					expect(w.calls[0]).toEqual(["read", source]);
					expect(w.calls[1]).toEqual(["read", join(root, "compiler-ledger.json")]);
					const renames = w.calls.filter(([call]) => call === "rename");
					expect(renames).toEqual([
						["rename", w.out, w.backup],
						["rename", w.pending, w.out],
						...(failed ? [["rename", w.backup, w.out]] : []),
					]);
					const firstRename = w.calls.findIndex(([call]) => call === "rename");
					const writes = w.calls.flatMap(([call], index) => (call === "write" ? [index] : []));
					// P16 publishes one file: brain.mjs is the only file written, into the pending folder.
					expect(writes.map((index) => w.calls[index]![1])).toEqual([join(w.pending, "brain.mjs")]);
					expect(writes.every((index) => index < firstRename)).toBe(true);
					expect(w.calls.slice(-2)).toEqual([
						["remove", w.pending],
						["remove", w.backup],
					]);
					expect(w.paths.length).toBeGreaterThan(0);
					expect(w.files.get(join(w.out, "brain.mjs"))).toBe(
						failed ? "last good" : "export default {};",
					);
					expect(Exit.isFailure(result)).toBe(failed);
					const cause = Exit.isFailure(result) ? result.cause : Cause.empty;
					expect(Cause.hasDies(cause)).toBe(false);

					if (failed) {
						expect(Cause.findErrorOption(cause)).toMatchObject({
							_tag: "Some",
							value: {_tag: "BuildError", reason: "publish"},
						});
					}
				} finally {
					rmSync(folder, {recursive: true, force: true});
				}
			}),
			{seed: 119120, numRuns: 10, examples: [[boundary]]},
		);
	});
}

it("dev chooses flags, saved settings or defaults and saves with mode 0600 before building", async () => {
	await fc.assert(
		fc.asyncProperty(
			generated,
			fc.record({
				saved: fc.boolean(),
				inline: fc.boolean(),
				name: fc.boolean(),
				person: fc.boolean(),
				founder: fc.boolean(),
				window: fc.boolean(),
				port: fc.boolean(),
				savedWindow: fc.option(fc.uuid(), {nil: null}),
			}),
			async ({name, port}, choices) => {
				const folder = mkdtempSync(join(tmpdir(), "p12-dev-fs-")),
					file = join(folder, "stage.json"),
					source = join(folder, "view.tsx");
				const saved = {
					name: "saved-project",
					person: "person-test",
					founder: "public-test",
					window: choices.savedWindow,
					port: 18787,
					build: "old",
				};
				const w = recorded(folder, source, "export const view = 1;", false);

				if (choices.saved) {
					w.files.set(file, JSON.stringify(saved));
				}

				writeFileSync(source, "export const view = 1;");
				const argv = process.argv;
				vi.stubEnv("FABRIKA_HOME", folder);
				cli.layer = w.layer;
				cli.work = undefined;
				const overrides = {
					name,
					person: `person-${name}`,
					founder: `-public-${name}`,
					window: `-window-${name}`,
					port,
				};
				const selected = Object.entries(overrides).filter(
					([field]) =>
						choices[field as keyof typeof overrides] ||
						(!choices.saved && ["name", "person", "founder"].includes(field)),
				);
				process.argv = [
					process.execPath,
					"dev.ts",
					"--child",
					`--parent=${process.ppid}`,
					...selected.flatMap(([field, value]) =>
						choices.inline ? [`--${field}=${value}`] : [`--${field}`, String(value)],
					),
				];

				try {
					vi.resetModules();
					await import("../dev.ts");
					expect(cli.work).toBeDefined();
					const exit = await Effect.runPromiseExit(cli.work!);
					expect(
						Cause.findErrorOption(Exit.isFailure(exit) ? exit.cause : Cause.empty),
					).toMatchObject({_tag: "Some", value: {reason: "test_stage_ready"}});
					const calls = w.calls.filter(([, path]) => path === folder || path === file);
					const expected = {
						...(choices.saved ? saved : {...overrides, window: null, port: 18787}),
						...Object.fromEntries(selected),
						build: "pending",
					};
					expect(calls).toEqual([
						["mkdir", folder],
						...(choices.saved ? [["read", file]] : []),
						["write", file, w.files.get(file)],
					]);
					expect(JSON.parse(w.files.get(file)!)).toEqual(expected);
					expect(w.modes.filter(([path]) => path === file)).toEqual([[file, 0o600]]);
					const savedAt = w.calls.findIndex(([call, path]) => call === "write" && path === file);
					const buildAt = w.calls.findIndex(([call, path]) => call === "read" && path === source);
					expect(savedAt).toBeLessThan(buildAt);
					expect(w.paths).toContainEqual([folder, "stage.json"]);
				} finally {
					process.argv = argv;
					cli.layer = undefined;
					cli.work = undefined;
					vi.unstubAllEnvs();
					rmSync(folder, {recursive: true, force: true});
				}
			},
		),
		{seed: 119120, numRuns: 40},
	);
});

it("dev without saved settings reports settings for each missing required value", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.uuid(),
			fc.constantFrom("name", "person", "founder"),
			async (name, missing) => {
				const folder = mkdtempSync(join(tmpdir(), "p12-empty-"));
				const source = join(folder, "view.tsx");
				const w = recorded(folder, source, "export const view = 1;", false);
				const argv = process.argv;
				vi.stubEnv("FABRIKA_HOME", folder);
				cli.layer = w.layer;
				process.argv = [
					process.execPath,
					"dev.ts",
					"--child",
					`--parent=${process.ppid}`,
					...["name", "person", "founder"]
						.filter((field) => field !== missing)
						.map((field) => `--${field}=${name}`),
				];

				try {
					vi.resetModules();
					await import("../dev.ts");
					stageFailure(await Effect.runPromiseExit(cli.work!), "settings");
					expect(w.calls.filter(([call]) => call === "write" || call === "temp")).toEqual([]);
				} finally {
					process.argv = argv;
					cli.layer = undefined;
					cli.work = undefined;
					vi.unstubAllEnvs();
					rmSync(folder, {recursive: true, force: true});
				}
			},
		),
		{seed: 119120, numRuns: 15},
	);
});

it("build returns BuildError for malformed compiler ledger bytes supplied by FileSystem", async () => {
	const encoded = Schema.fromJsonString(Schema.Array(Row));
	const invalid = fc
		.oneof(
			fc.string(),
			fc.jsonValue().map((value) => JSON.stringify(value)),
		)
		.filter((text) => !Schema.is(encoded)(text));
	await fc.assert(
		fc.asyncProperty(invalid, async (raw) => {
			const folder = mkdtempSync(join(tmpdir(), "p12-ledger-fs-")),
				source = join(folder, "view.tsx");
			const w = recorded(folder, source, "export const view = 1;", false);
			w.files.set(join(root, "compiler-ledger.json"), raw);
			writeFileSync(source, "export const view = 1;");

			try {
				const exit = await Effect.runPromiseExit(
					build({out: w.out, files: [source]}).pipe(Effect.provide(w.layer)),
				);
				expect(Exit.isFailure(exit)).toBe(true);
				const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
				expect(Cause.hasDies(cause)).toBe(false);
				expect(Cause.hasFails(cause)).toBe(true);
				expect(Cause.findErrorOption(cause)).toMatchObject({
					_tag: "Some",
					value: {_tag: "BuildError", reason: "read"},
				});
				expect(w.calls.filter(([call]) => call === "write" || call === "rename")).toEqual([]);
			} finally {
				rmSync(folder, {recursive: true, force: true});
			}
		}),
		{seed: 119120, numRuns: 20, examples: [["{"], ["null"], ['[{"file":17}]']]},
	);
});

it("dev returns StageError for malformed saved settings without writing or building", async () => {
	const invalid = fc
		.oneof(
			fc.string(),
			fc.jsonValue().map((value) => JSON.stringify(value)),
		)
		.filter((text) => {
			try {
				const raw: unknown = JSON.parse(text);
				return typeof raw !== "object" || raw === null || !("name" in raw);
			} catch {
				return true;
			}
		});
	await fc.assert(
		fc.asyncProperty(invalid, async (raw) => {
			const folder = mkdtempSync(join(tmpdir(), "p12-settings-fs-")),
				source = join(folder, "view.tsx"),
				file = join(folder, "stage.json");
			const w = recorded(folder, source, "export const view = 1;", false);
			w.files.set(file, raw);
			writeFileSync(file, raw);
			const argv = process.argv;
			vi.stubEnv("FABRIKA_HOME", folder);
			cli.layer = w.layer;
			cli.work = undefined;
			process.argv = [process.execPath, "dev.ts", "--child", `--parent=${process.ppid}`];

			try {
				vi.resetModules();
				await import("../dev.ts");
				expect(cli.work).toBeDefined();
				const exit = await Effect.runPromiseExit(cli.work!);
				expect(Exit.isFailure(exit)).toBe(true);
				const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
				expect(Cause.hasDies(cause)).toBe(false);
				expect(Cause.hasFails(cause)).toBe(true);
				expect(Cause.findErrorOption(cause)).toMatchObject({
					_tag: "Some",
					value: {_tag: "StageError", reason: "settings"},
				});
				expect(w.calls.filter(([call]) => call === "write" || call === "temp")).toEqual([]);
			} finally {
				process.argv = argv;
				cli.layer = undefined;
				cli.work = undefined;
				vi.unstubAllEnvs();
				rmSync(folder, {recursive: true, force: true});
			}
		}),
		{seed: 119120, numRuns: 20, examples: [["{"], ["null"], ["{}"]]},
	);
});
