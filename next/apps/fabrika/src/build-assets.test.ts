// P16, next/. The Compiler is real. Rolldown wrappers inject failures after acquiring a real
// handle, and record its real close. All changed inputs and outputs live in disposable copies.
import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NodeServices} from "@effect/platform-node";
import {Deferred, Effect, Exit, Fiber, Tracer} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {check} from "./exam/compiler.ts";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
const homes: string[] = [];
type Built = {readonly brain: string};
type Build = {
	readonly build: (options: {readonly chaos: boolean}) => Effect.Effect<Built, unknown>;
};
type Output = {
	readonly output: ReadonlyArray<{
		readonly type: string;
		readonly fileName: string;
		readonly code?: string;
		readonly source?: string | Uint8Array;
	}>;
};
type Handle = {
	generate: (...args: unknown[]) => Promise<Output>;
	write: (...args: unknown[]) => Promise<Output>;
	close: () => Promise<void>;
};
type Rolldown = {readonly rolldown: (...args: unknown[]) => Promise<Handle>};

const fixture = () => {
	assert(existsSync(join(APP, "src/build.ts")), "P12 not built: next/apps/fabrika/src/build.ts");
	const home = mkdtempSync("/tmp/fh.");
	homes.push(home);
	const app = join(home, "next/apps/fabrika");
	cpSync(APP, app, {
		recursive: true,
		filter: (path) => !["node_modules", "dist", ".alchemy"].includes(path.split("/").at(-1) ?? ""),
	});
	for (const name of [
		"package.json",
		"compiler-ledger.json",
		"pnpm-workspace.yaml",
		"pnpm-lock.yaml",
	])
		cpSync(join(ROOT, name), join(home, name));
	symlinkSync(join(ROOT, "node_modules"), join(home, "node_modules"), "dir");
	mkdirSync(join(app, "node_modules"), {recursive: true});
	for (const name of readdirSync(join(APP, "node_modules")))
		symlinkSync(join(APP, "node_modules", name), join(app, "node_modules", name), "dir");
	const pkg = join(app, "node_modules/@p16/compiler");
	mkdirSync(pkg, {recursive: true});
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({
			name: "@p16/compiler",
			type: "module",
			exports: {".": "./program.ts", "./window": "./window.tsx"},
		}),
	);
	writeFileSync(join(pkg, "program.ts"), 'export {counter} from "@kampus/counter";');
	writeFileSync(
		join(pkg, "window.tsx"),
		'import "./window.css"; export const Good = () => <b>good</b>;',
	);
	writeFileSync(join(pkg, "window.css"), "b { color: rgb(12, 34, 56); }");
	writeFileSync(
		join(app, "src/table.ts"),
		'export const programs = [{name: "counter", package: "@p16/compiler", export: "counter"}];',
	);
	vi.stubEnv("FABRIKA_HOME", home);
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	return {home, app, pkg};
};

const load = (app: string) => vi.importActual<Build>(pathToFileURL(join(app, "src/build.ts")).href);
const run = async (app: string) => {
	const api = await load(app);
	const built = await Effect.runPromise(
		api.build({chaos: false}).pipe(Effect.provide(NodeServices.layer)),
	);
	return {...built, brain: resolve(app, built.brain)};
};

afterEach(() => {
	vi.doUnmock("rolldown");
	vi.resetModules();
	vi.unstubAllEnvs();
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

const REFUSED = [
	'import {useRef} from "react";',
	"export const Refused = () => {",
	" const ref = useRef(1);",
	" return <b>{ref.current}</b>;",
	"};",
].join("\n");

describe("P16 Compiler and atomic output", () => {
	for (const [name, source, ledger] of [
		["skipped function", REFUSED, []],
		["impure function", "export const Clock = () => <b>{Date.now()}</b>;", []],
		["unlisted directive", REFUSED.replace("const ref", '"use no memo"; const ref'), []],
		[
			"stale ledger row",
			"export const Good = () => <b>good</b>;",
			[
				{
					file: "next/apps/fabrika/node_modules/@p16/compiler/window.tsx",
					fn: "Good",
					why: "planted stale row",
				},
			],
		],
	] as const) {
		it(`Compiler plant, ${name}: the actual check refuses it before replacing output`, async () => {
			const {app, home, pkg} = fixture();
			const good = await run(app);
			const previous = readFileSync(good.brain);
			const file = "next/apps/fabrika/node_modules/@p16/compiler/window.tsx";
			// Verify the plant reaches the Compiler's own check, rather than a syntax error.
			expect(check(new Map([[file, source]]), ledger).length).toBeGreaterThan(0);
			writeFileSync(join(pkg, "window.tsx"), source);
			writeFileSync(join(home, "compiler-ledger.json"), JSON.stringify(ledger));
			vi.resetModules();
			const api = await load(app);
			const exit = await Effect.runPromise(
				Effect.exit(api.build({chaos: false})).pipe(Effect.provide(NodeServices.layer)),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(JSON.stringify(exit)).toContain("compiler");
			expect(readFileSync(good.brain)).toEqual(previous);
		});
	}

	it("assets plant, duplicate emitted route: rejects the collision without overwriting good output", async () => {
		const {app} = fixture();
		const good = await run(app);
		const previous = readFileSync(good.brain);
		const native = await vi.importActual<Rolldown>("rolldown");
		let fired = false;
		vi.doMock("rolldown", () => ({
			...native,
			rolldown: async (...args: unknown[]) => {
				const handle = await native.rolldown(...args);
				const plant = (out: Output): Output => {
					const css = out.output.find((file) => file.fileName.endsWith(".css"));
					if (css === undefined) return out;
					fired = true;
					return {...out, output: [...out.output, {...css, source: "b { color: red; }"}]};
				};
				return {
					...handle,
					generate: async (...options: unknown[]) => plant(await handle.generate(...options)),
					write: async (...options: unknown[]) => plant(await handle.write(...options)),
					close: () => handle.close(),
				};
			},
		}));
		vi.resetModules();
		const api = await load(app);
		const exit = await Effect.runPromise(
			Effect.exit(api.build({chaos: false})).pipe(Effect.provide(NodeServices.layer)),
		);
		expect(fired, "fixture must reach actual window output collection").toBe(true);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toMatch(/table|output/);
		expect(readFileSync(good.brain)).toEqual(previous);
	});

	it("cleanup plant, bundling fails: closes acquired handles and retains the last good file", async () => {
		const {app} = fixture();
		const good = await run(app);
		const previous = readFileSync(good.brain);
		const native = await vi.importActual<Rolldown>("rolldown");
		const opened: boolean[] = [];
		let fired = false;
		vi.doMock("rolldown", () => ({
			...native,
			rolldown: async (...args: unknown[]) => {
				const handle = await native.rolldown(...args);
				const index = opened.push(false) - 1;
				const fail = async (): Promise<Output> => {
					fired = true;
					throw new Error("P16 planted bundle failure");
				};
				return {
					...handle,
					generate: fail,
					write: fail,
					close: async () => {
						await handle.close();
						opened[index] = true;
					},
				};
			},
		}));
		vi.resetModules();
		const api = await load(app);
		const exit = await Effect.runPromise(
			Effect.exit(api.build({chaos: false})).pipe(Effect.provide(NodeServices.layer)),
		);
		expect(fired, "the plant must reach the actual output operation").toBe(true);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(opened.length).toBeGreaterThan(0);
		expect(opened.every(Boolean)).toBe(true);
		expect(readFileSync(good.brain)).toEqual(previous);
	});

	it("cleanup plant, interruption during generation: closes the native handle and publishes no partial file", async () => {
		const {app} = fixture();
		const good = await run(app);
		const previous = readFileSync(good.brain);
		const entered = await Effect.runPromise(Deferred.make<void>());
		const native = await vi.importActual<Rolldown>("rolldown");
		const closed: boolean[] = [];
		vi.doMock("rolldown", () => ({
			...native,
			rolldown: async (...args: unknown[]) => {
				const handle = await native.rolldown(...args);
				const index = closed.push(false) - 1;
				const block = () => {
					Effect.runSync(Deferred.succeed(entered, undefined));
					return new Promise<Output>(() => {});
				};
				return {
					...handle,
					generate: block,
					write: block,
					close: async () => {
						await handle.close();
						closed[index] = true;
					},
				};
			},
		}));
		vi.resetModules();
		const api = await load(app);
		const fiber = Effect.runFork(
			api.build({chaos: false}).pipe(Effect.provide(NodeServices.layer)),
		);
		try {
			await Effect.runPromise(Effect.race(Deferred.await(entered), Fiber.join(fiber)));
		} finally {
			await Effect.runPromise(Fiber.interrupt(fiber));
		}
		expect(closed.length).toBeGreaterThan(0);
		expect(closed.every(Boolean)).toBe(true);
		expect(readFileSync(good.brain)).toEqual(previous);
	});
});

type Recorded = {
	readonly name: string;
	readonly attributes: Record<string, unknown>;
	readonly status: Tracer.SpanStatus;
};
const recording = (rows: readonly Recorded[], fail: boolean, forbidden: readonly string[]) => {
	assert(rows.length > 0, "build phases were not recorded");
	for (const phase of fail ? ["build.bundle"] : ["build.bundle", "build.emit"])
		assert(
			rows.some((row) => row.name === phase),
			"build phase missing",
		);
	for (const row of rows) {
		assert.equal(row.status._tag, "Ended", "duration missing");
		if (row.status._tag === "Ended")
			assert(row.status.endTime >= row.status.startTime, "negative duration");
	}
	const attributes = rows.flatMap((row) => Object.entries(row.attributes));
	const values = attributes.map(([, value]) => value);
	assert(values.includes(fail ? "failure" : "success"), "build outcome missing");
	assert(
		!fail || rows.some((row) => typeof row.attributes["error.type"] === "string"),
		"failure class missing",
	);
	assert(
		fail || values.some((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)),
		"content hashes missing",
	);
	assert(
		fail ||
			attributes.some(
				([key, value]) => /bytes|size/.test(key) && typeof value === "number" && value > 0,
			),
		"output sizes missing",
	);
	const text = JSON.stringify(rows.map((row) => ({name: row.name, attributes: row.attributes})));
	for (const value of forbidden.filter(Boolean))
		assert(
			!text.includes(value) && !text.includes(JSON.stringify(value).slice(1, -1)),
			"compiled source or machine path recorded",
		);
	assert(text.includes("1.2.13") && text.includes("4.1.1"), "tool versions missing");
};

describe("P16 build recording", () => {
	for (const fail of [false, true])
		it(`recording: ${fail ? "failed" : "successful"} build retains both phases and safe measurements`, async () => {
			const {app, home} = fixture();
			const spans: Tracer.Span[] = [];
			const tracer = Tracer.make({
				span: (options) => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			const native = await vi.importActual<Rolldown>("rolldown");
			const compiled: string[] = [];
			vi.doMock("rolldown", () => ({
				...native,
				rolldown: async (...args: unknown[]) => {
					const handle = await native.rolldown(...args);
					const collect = (out: Output) => {
						compiled.push(
							...out.output.flatMap((file) => (file.code === undefined ? [] : [file.code])),
						);
						return out;
					};
					return {
						...handle,
						generate: async (...options: unknown[]) => collect(await handle.generate(...options)),
						write: async (...options: unknown[]) => collect(await handle.write(...options)),
						close: () => handle.close(),
					};
				},
			}));
			if (fail) writeFileSync(join(app, "src/brain.ts"), 'import "./p16-missing-module.ts";');
			const api = await load(app);
			const exit = await Effect.runPromise(
				Effect.exit(api.build({chaos: false})).pipe(
					Effect.withTracer(tracer),
					Effect.provide(NodeServices.layer),
				),
			);
			expect(Exit.isFailure(exit)).toBe(fail);
			const phases = spans.filter((span) => ["build.bundle", "build.emit"].includes(span.name));
			const completed = phases.map((span) => ({
				name: span.name,
				attributes: Object.fromEntries(span.attributes),
				status: span.status,
			}));
			const forbidden = [home, ROOT, ...compiled, 'import "./p16-missing-module.ts";'];
			recording(completed, fail, forbidden);
			expect(() => recording([], fail, forbidden)).toThrow("phases");
			expect(() =>
				recording(
					completed.map((row) => ({...row, name: "omitted"})),
					fail,
					forbidden,
				),
			).toThrow("phase missing");
			expect(() =>
				recording(
					completed.map((row) => ({
						...row,
						attributes: {...row.attributes, body: compiled[0] ?? home},
					})),
					fail,
					forbidden,
				),
			).toThrow("compiled source or machine path");
			expect(() =>
				recording(
					completed.map((row) => ({...row, attributes: {outcome: "success"}})),
					true,
					forbidden,
				),
			).toThrow("outcome missing");
		});
});
