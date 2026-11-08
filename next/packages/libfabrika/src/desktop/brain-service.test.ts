// P19, next/. The launchd brain (plan "Launchd contract" and "Laws"): outside settings decode, the
// plist restarts only after a failure with an explicit throttle, a loaded service is reused and a
// foreign one refused, Quit waits past `bootout` until `print` shows the label gone and P12's
// children are gone, and the `launchctl` adapter reads `print` the way macOS writes it.
//
// Everything here runs launchctl's stand-in (`desktopFixture`) or a stand-in process spawner, never
// launchd. The real launchd laws are laptop-only, in `next/apps/fabrika/e2e/electron-launchd.test.ts`.
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Option, Schedule, Schema, Sink, Stream} from "effect";
import {ChildProcessSpawner} from "effect/process";
import * as fc from "fast-check";
import type * as IdModule from "../data/id.ts";
import type * as Brain from "./brain-service.ts";
import {
	desktopFixture,
	foundingArb,
	type Modules,
	SEED,
	type Script,
} from "./desktop.test-support.ts";
import type * as FoundingModule from "./founding.ts";
import type * as KeysModule from "./keys.ts";
import type * as Recording from "./recording.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
const brain = () =>
	load<typeof Brain>("./brain-service.ts", "desktop/brain-service.ts", [
		"LaunchdSpec",
		"ServiceState",
		"LaunchControl",
		"BrainService",
		"BrainProbe",
		"launchdPlist",
		"launchdBrain",
	]);
const fixtureFor = async (b: typeof Brain) => {
	const f = await load<typeof FoundingModule>("./founding.ts", "desktop/founding.ts", [
		"DesktopDown",
		"Founding",
	]);
	const k = await load<typeof KeysModule>("./keys.ts", "desktop/keys.ts", ["Seal"]);
	const r = await load<typeof Recording>("./recording.ts", "desktop/recording.ts", [
		"DesktopRecording",
	]);
	const s = await load<Pick<Modules, "fileDesktopStore">>(
		"../node/desktop-store.ts",
		"node/desktop-store.ts",
		["fileDesktopStore"],
	);
	const ids = await load<typeof IdModule>("../data/id.ts", "data/id.ts (upstream P14)", [
		"IdGenerator",
	]);
	return {
		f,
		fixture: (script?: Script) =>
			desktopFixture(
				{
					fileDesktopStore: s.fileDesktopStore,
					Seal: k.Seal,
					IdGenerator: ids.IdGenerator,
					LaunchControl: b.LaunchControl,
					BrainProbe: b.BrainProbe,
					ServiceState: b.ServiceState,
					DesktopRecording: r.DesktopRecording,
					DesktopDown: f.DesktopDown,
				},
				script,
			),
	};
};
const RUNS = {seed: SEED, numRuns: 150};

/** Strings a path or label might hold that XML must escape. */
const xmlish = fc.oneof(
	fc.string({minLength: 1, maxLength: 30}),
	fc.constantFrom("a&b", "<key>", "x]]>y", 'q"uote', "it's", "été", "a b"),
);
const specArb = fc.record({
	label: fc.oneof(fc.constant("dev.fabrika.test.p19"), xmlish),
	home: xmlish.map((s) => `/tmp/fh.${s}`),
	executable: xmlish.map((s) => `/Applications/${s}.app/Contents/MacOS/fabrika`),
	entry: xmlish.map((s) => `/tmp/fh.x/${s}/brain.js`),
	uid: fc.integer({min: 0, max: 100_000}),
	port: fc.integer({min: 1024, max: 65_535}),
	throttle: fc.integer({min: 1, max: 600}),
	founder: foundingArb,
});

// A plist reader just big enough for what a launchd job holds: dict, array, string, integer, bools.
type Plist = string | number | boolean | ReadonlyArray<Plist> | {readonly [k: string]: Plist};
const unescape = (s: string) =>
	s
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
const readPlist = (xml: string): Plist => {
	const tokens = [
		...xml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, "").matchAll(/<(\/?)(\w+)(\/?)>|([^<]+)/g),
	];
	let i = 0;
	const skip = () => {
		while (i < tokens.length && tokens[i]![4] !== undefined && tokens[i]![4]!.trim() === "") i++;
	};
	const text = (tag: string): string => {
		const t = tokens[i]![4] ?? "";
		if (tokens[i]![4] !== undefined) i++;
		if (tokens[i]![2] !== tag || tokens[i]![1] !== "/") throw new Error(`unclosed <${tag}>`);
		i++;
		return unescape(t);
	};
	const value = (): Plist => {
		skip();
		const [, close, tag, self] = tokens[i]!;
		if (close === "/") throw new Error(`stray </${tag}>`);
		i++;
		if (self === "/") {
			if (tag === "true") return true;
			if (tag === "false") return false;
			if (tag === "dict") return {};
			if (tag === "array") return [];
			throw new Error(`unknown <${tag}/>`);
		}
		if (tag === "string") {
			if (tokens[i]![2] !== "string") return text("string");
			i++;
			return "";
		}
		if (tag === "integer") return Number(text("integer"));
		if (tag === "array") {
			const out: Array<Plist> = [];
			for (skip(); !(tokens[i]![1] === "/" && tokens[i]![2] === "array"); skip()) out.push(value());
			i++;
			return out;
		}
		if (tag === "dict") {
			const out: Record<string, Plist> = {};
			for (skip(); !(tokens[i]![1] === "/" && tokens[i]![2] === "dict"); skip()) {
				i++; // <key>
				const key = text("key");
				out[key] = value();
			}
			i++;
			return out;
		}
		if (tag === "plist") {
			const inner = value();
			skip();
			i++;
			return inner;
		}
		throw new Error(`unknown <${tag}>`);
	};
	return value();
};

describe("P19 brain service: outside settings", () => {
	it("plant, call .make on outside input: LaunchdSpec and ServiceState decode any JSON to a value or a typed failure", async () => {
		const b = await brain();
		fc.assert(
			fc.property(
				fc.jsonValue(),
				specArb,
				fc.constantFrom("label", "home", "uid", "port", "throttle", "founder"),
				(json, good, key) => {
					for (const schema of [b.LaunchdSpec, b.ServiceState] as const)
						expect(Exit.hasDies(Effect.runSyncExit(Schema.decodeUnknownEffect(schema)(json)))).toBe(
							false,
						);
					expect(
						Exit.isSuccess(Effect.runSyncExit(Schema.decodeUnknownEffect(b.LaunchdSpec)(good))),
					).toBe(true);
					const bad = {...good, [key]: key === "label" || key === "home" ? "" : "not a number"};
					const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(b.LaunchdSpec)(bad));
					expect(Exit.isFailure(exit) && !Exit.hasDies(exit), key).toBe(true);
				},
			),
			RUNS,
		);
	});
});

describe("P19 brain service: the plist", () => {
	it("plant, unconditional KeepAlive or no throttle: the job restarts only after a failed exit, with the spec's throttle and its group", async () => {
		const b = await brain();
		const plutil = process.platform === "darwin";
		fc.assert(
			fc.property(specArb, (raw) => {
				const spec = Schema.decodeUnknownSync(b.LaunchdSpec)(raw);
				const xml = b.launchdPlist(spec);
				const job = readPlist(xml);
				expect(job).toMatchObject({
					Label: spec.label,
					ProgramArguments: [spec.executable, spec.entry],
					RunAtLoad: true,
					KeepAlive: {SuccessfulExit: false},
					ThrottleInterval: spec.throttle,
					AbandonProcessGroup: false,
				});
				const env = (job as Record<string, Plist>)["EnvironmentVariables"] as Record<string, Plist>;
				expect(env["ELECTRON_RUN_AS_NODE"]).toBe("1");
				expect(env["FABRIKA_HOME"]).toBe(spec.home);
				expect(Object.keys(env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k))).toEqual([]);
				expect(xml).not.toContain("FABRIKA_FOREGROUND");
				if (plutil) {
					const lint = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], {
						input: xml,
						encoding: "utf8",
					});
					expect(lint.status, lint.stderr).toBe(0);
					expect(JSON.parse(lint.stdout)).toEqual(job);
				}
			}),
			{seed: SEED, numRuns: plutil ? 60 : 150},
		);
	});
});

describe("P19 brain service: reuse and refusal", () => {
	const state = fc.oneof(
		fc.constant({kind: "absent" as const}),
		fc.constant({kind: "same" as const}),
		fc.constantFrom("executable", "args").map((what) => ({kind: "foreign" as const, what})),
	);
	const readiness = fc.array(fc.boolean(), {maxLength: 6}).map((bs) => [...bs, true]);

	it("plant, bootstrap twice or attach to any listener: one bootstrap for an absent label, none for a match, a refusal for a foreign one", async () => {
		const b = await brain();
		const {fixture, f} = await fixtureFor(b);
		await fc.assert(
			fc.asyncProperty(
				specArb,
				state,
				readiness,
				fc.boolean(),
				async (raw, s, ready, portTaken) => {
					const spec = Schema.decodeUnknownSync(b.LaunchdSpec)(raw);
					const loaded =
						s.kind === "absent"
							? Option.none()
							: Option.some({
									executable:
										s.kind === "foreign" && s.what === "executable"
											? "/usr/bin/other"
											: spec.executable,
									args:
										s.kind === "foreign" && s.what === "args"
											? [spec.executable, "/tmp/other.js"]
											: [spec.executable, spec.entry],
								});
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const fx = yield* fixture({loaded, ready: portTaken ? ["port_taken"] : ready});
								const exit = yield* Effect.exit(
									Effect.gen(function* () {
										return yield* (yield* b.BrainService).up;
									}).pipe(
										Effect.provide(
											b
												.launchdBrain(spec, {poll: Schedule.spaced("1 millis")})
												.pipe(Layer.provide(Layer.mergeAll(fx.launch, fx.probe, fx.records))),
										),
									),
								);
								const ops = (yield* fx.calls).map((c) => c.op);
								const boots = (yield* fx.calls).filter((c) => c.op === "bootstrap");
								expect(Exit.hasDies(exit)).toBe(false);
								expect(ops).not.toContain("bootout");
								if (s.kind === "foreign") {
									expect(boots).toHaveLength(0);
									expect(JSON.stringify(exit)).toContain("foreign_service");
								} else if (portTaken) {
									expect(JSON.stringify(exit)).toContain("port_taken");
								} else {
									expect(boots).toHaveLength(s.kind === "absent" ? 1 : 0);
									if (s.kind === "absent") expect(boots[0]!.plist).toBe(b.launchdPlist(spec));
									expect(Exit.isSuccess(exit)).toBe(true);
									if (Exit.isSuccess(exit))
										expect(new URL(exit.value.url).port).toBe(String(spec.port));
									expect(ops.filter((o) => o === "ready")).toHaveLength(ready.length);
								}
								void f;
							}),
						),
					);
				},
			),
			{seed: SEED, numRuns: 100},
		);
	});
});

describe("P19 brain service: Quit waits for absence", () => {
	it("plant, return on bootout or treat a print error as absence: stop ends only after print shows the label gone and the children gone", async () => {
		const b = await brain();
		const {fixture} = await fixtureFor(b);
		const printFailure = fc.option(
			fc.constantFrom("launchctl", "unsupported") as fc.Arbitrary<"launchctl" | "unsupported">,
			{nil: null},
		);
		await fc.assert(
			fc.asyncProperty(
				specArb,
				fc.integer({min: 0, max: 5}),
				fc.array(fc.constant(false), {maxLength: 4}),
				printFailure,
				fc.boolean(),
				async (raw, lingers, slow, printBad, bootoutBad) => {
					const spec = Schema.decodeUnknownSync(b.LaunchdSpec)(raw);
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const fx = yield* fixture({
									loaded: Option.some({
										executable: spec.executable,
										args: [spec.executable, spec.entry],
									}),
									lingers,
									stopped: [...slow, true],
									bootout: bootoutBad ? ["launchctl"] : ["ok"],
									print: printBad === null ? ["ok"] : ["ok", printBad],
								});
								const exit = yield* Effect.exit(
									Effect.gen(function* () {
										return yield* (yield* b.BrainService).stop;
									}).pipe(
										Effect.provide(
											b
												.launchdBrain(spec, {poll: Schedule.spaced("1 millis")})
												.pipe(Layer.provide(Layer.mergeAll(fx.launch, fx.probe, fx.records))),
										),
									),
								);
								const calls = yield* fx.calls;
								const ops = calls.map((c) => c.op);
								expect(Exit.hasDies(exit)).toBe(false);
								if (bootoutBad || printBad !== null) {
									expect(Exit.isFailure(exit), `bootout ${bootoutBad}, print ${printBad}`).toBe(
										true,
									);
									return;
								}
								expect(Exit.isSuccess(exit)).toBe(true);
								const out = ops.indexOf("bootout");
								expect(out).toBeGreaterThanOrEqual(0);
								// After bootout: the prints that still show the label, then one that does not.
								expect(ops.slice(out).filter((o) => o === "print").length).toBeGreaterThanOrEqual(
									lingers + 1,
								);
								expect(ops.filter((o) => o === "stopped").length).toBe(slow.length + 1);
								expect(ops.lastIndexOf("stopped")).toBeGreaterThan(out);
							}),
						),
					);
				},
			),
			{seed: SEED, numRuns: 100},
		);
	});
});

describe("P19 the launchctl adapter", () => {
	type Run = {readonly command: string; readonly args: ReadonlyArray<string>};
	/** A process spawner whose every child prints `out` and exits `code`, and the commands it saw. */
	const spawner = (answers: ReadonlyArray<{readonly code: number; readonly out: string}>) => {
		const seen: Array<Run> = [];
		let n = 0;
		const layer = Layer.succeed(
			ChildProcessSpawner.ChildProcessSpawner,
			ChildProcessSpawner.make((command) =>
				Effect.sync(() => {
					const std = command._tag === "StandardCommand" ? command : undefined;
					seen.push({command: std?.command ?? "?", args: (std?.args ?? []).map(String)});
					const a = answers[Math.min(n++, answers.length - 1)] ?? {code: 0, out: ""};
					const bytes = Stream.make(new TextEncoder().encode(a.out));
					return ChildProcessSpawner.makeHandle({
						pid: ChildProcessSpawner.ProcessId(1000 + n),
						exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(a.code)),
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						stdin: Sink.drain,
						stdout: bytes,
						stderr: Stream.empty,
						all: bytes,
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						unref: Effect.succeed(Effect.void),
					});
				}),
			),
		);
		return {layer, seen};
	};
	const printed = (
		spec: {label: string; home: string; uid: number},
		job: {program: string; args: ReadonlyArray<string>; pid: number | null; state: string},
	) =>
		[
			`gui/${spec.uid}/${spec.label} = {`,
			"\tactive count = 1",
			`\tpath = ${spec.home}/brain.plist`,
			`\tstate = ${job.state}`,
			"",
			`\tprogram = ${job.program}`,
			"\targuments = {",
			...job.args.map((a) => `\t\t${a}`),
			"\t}",
			"",
			...(job.pid === null ? [] : [`\tpid = ${job.pid}`]),
			"\tlast exit code = (never exited)",
			"}",
			"",
		].join("\n");
	const safe = fc.stringMatching(/^[A-Za-z0-9._/-]{1,24}$/);

	it("plant, call every print error absence or guess at unknown output: 113 is absent, a job is loaded, anything else is typed", async () => {
		const b = await brain();
		const l = await load<{
			readonly launchControl: Layer.Layer<
				Brain.LaunchControl,
				never,
				ChildProcessSpawner.ChildProcessSpawner
			>;
		}>("../node/launchd.ts", "node/launchd.ts", ["launchControl"]);
		const answer = fc.oneof(
			fc.constant({kind: "absent" as const}),
			fc
				.record({
					program: safe.map((s) => `/x/${s}`),
					extra: fc.array(safe, {maxLength: 3}),
					pid: fc.option(fc.integer({min: 2, max: 99_999}), {nil: null}),
					state: fc.constantFrom("running", "waiting", "spawn scheduled"),
				})
				.map((job) => ({kind: "job" as const, ...job})),
			fc
				.integer({min: 1, max: 255})
				.filter((c) => c !== 113)
				.map((code) => ({kind: "error" as const, code})),
			fc.string({maxLength: 60}).map((out) => ({kind: "garbage" as const, out})),
		);
		await fc.assert(
			fc.asyncProperty(specArb, answer, async (raw, a) => {
				const spec = Schema.decodeUnknownSync(b.LaunchdSpec)(raw);
				const out =
					a.kind === "job"
						? printed(spec, {
								program: a.program,
								args: [a.program, ...a.extra],
								pid: a.pid,
								state: a.state,
							})
						: a.kind === "garbage"
							? a.out
							: `Bad request.\nCould not find service "${spec.label}" in domain for user gui: ${spec.uid}\n`;
				const code = a.kind === "absent" ? 113 : a.kind === "error" ? a.code : 0;
				const {layer, seen} = spawner([{code, out}]);
				const exit = await Effect.runPromise(
					Effect.exit(
						Effect.gen(function* () {
							return yield* (yield* b.LaunchControl).print(spec);
						}).pipe(Effect.provide(l.launchControl.pipe(Layer.provide(layer)))),
					),
				);
				expect(seen).toEqual([
					{command: "launchctl", args: ["print", `gui/${spec.uid}/${spec.label}`]},
				]);
				expect(Exit.hasDies(exit)).toBe(false);
				if (a.kind === "absent")
					expect(Exit.isSuccess(exit) && exit.value._tag === "absent").toBe(true);
				else if (a.kind === "job") {
					expect(Exit.isSuccess(exit)).toBe(true);
					if (Exit.isSuccess(exit))
						expect(exit.value).toMatchObject({
							_tag: "loaded",
							pid: a.pid,
							executable: a.program,
							args: [a.program, ...a.extra],
						});
				} else if (a.kind === "error") expect(JSON.stringify(exit)).toContain("launchctl");
				else expect(Exit.isFailure(exit), "unknown output is never a state").toBe(true);
			}),
			{seed: SEED, numRuns: 200},
		);
	});

	it("plant, bootstrap into another domain or file: the adapter runs bootstrap and bootout on the spec's own label and plist", async () => {
		const b = await brain();
		const l = await load<{
			readonly launchControl: Layer.Layer<
				Brain.LaunchControl,
				never,
				ChildProcessSpawner.ChildProcessSpawner
			>;
		}>("../node/launchd.ts", "node/launchd.ts", ["launchControl"]);
		await fc.assert(
			fc.asyncProperty(specArb, fc.integer({min: 1, max: 255}), async (raw, failCode) => {
				const spec = Schema.decodeUnknownSync(b.LaunchdSpec)(raw);
				const plist = b.launchdPlist(spec);
				const {layer, seen} = spawner([{code: 0, out: ""}]);
				const control = l.launchControl.pipe(Layer.provide(layer));
				await Effect.runPromise(
					Effect.gen(function* () {
						const c = yield* b.LaunchControl;
						yield* c.bootstrap(spec, plist);
						yield* c.bootout(spec);
					}).pipe(Effect.provide(control)),
				);
				const runs = seen.filter((r) => r.command === "launchctl");
				expect(runs.map((r) => r.args[0])).toEqual(["bootstrap", "bootout"]);
				expect(runs[0]!.args.slice(1)).toEqual([`gui/${spec.uid}`, `${spec.home}/brain.plist`]);
				expect(runs[1]!.args.slice(1)).toEqual([`gui/${spec.uid}/${spec.label}`]);
				const failing = spawner([
					{code: failCode, out: "Bootstrap failed: 5: Input/output error\n"},
				]);
				const exit = await Effect.runPromise(
					Effect.exit(
						Effect.gen(function* () {
							yield* (yield* b.LaunchControl).bootstrap(spec, plist);
						}).pipe(Effect.provide(l.launchControl.pipe(Layer.provide(failing.layer)))),
					),
				);
				expect(Exit.isFailure(exit) && !Exit.hasDies(exit)).toBe(true);
			}),
			{seed: SEED, numRuns: 50},
		);
	});
});
