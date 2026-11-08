// P16, next/. P12 is not on this base. Import inside each law so a missing build reports a
// not-built red for that law. Fixtures and instrumented copies never change the working tree.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
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
import {dirname, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NodeServices} from "@effect/platform-node";
import {Effect, Schema} from "effect";
import {parseSync} from "oxc-parser";
import {afterEach, describe, expect, it, vi} from "vitest";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
const TEXT = "quote '\"; slash \\; Unicode 雪 🫖;\r\nsecond line\n</script><script>bad()</script>";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const homes: string[] = [];

type Output = {
	readonly output: ReadonlyArray<{
		readonly type: string;
		readonly code?: string;
		readonly source?: string | Uint8Array;
		readonly fileName: string;
	}>;
};
type Handle = {
	generate: (...args: unknown[]) => Promise<Output>;
	write: (...args: unknown[]) => Promise<Output>;
	close: () => Promise<void>;
};
type Rolldown = {readonly rolldown: (...args: unknown[]) => Promise<Handle>};
type Build = {
	readonly build: (options: {
		readonly chaos: boolean;
	}) => Effect.Effect<{readonly brain: string}, unknown>;
};

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
	vi.stubEnv("FABRIKA_HOME", home);
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	return {home, app};
};

// Capture real emitted bytes. This wrapper neither compiles nor manufactures build results.
const observe = async () => {
	const outputs: string[] = [];
	const closed: boolean[] = [];
	const api = await vi.importActual<Rolldown>("rolldown");
	vi.doMock("rolldown", () => ({
		...api,
		rolldown: async (...args: unknown[]) => {
			const handle = await api.rolldown(...args);
			const index = closed.push(false) - 1;
			const collect = (out: Output) => {
				for (const file of out.output)
					if (file.type === "chunk" && file.code !== undefined) outputs.push(file.code);
				return out;
			};
			return {
				...handle,
				generate: async (...options: unknown[]) => collect(await handle.generate(...options)),
				write: async (...options: unknown[]) => collect(await handle.write(...options)),
				close: async () => {
					await handle.close();
					closed[index] = true;
				},
			};
		},
	}));
	return {outputs, closed};
};

const buildAt = async (app: string, chaos = false) => {
	const api = await vi.importActual<Build>(pathToFileURL(join(app, "src/build.ts")).href);
	assert.equal(typeof api.build, "function", "P12 build contract: exported build({chaos})");
	const built = await Effect.runPromise(
		api.build({chaos}).pipe(Effect.provide(NodeServices.layer)),
	);
	return {...built, brain: resolve(app, built.brain)};
};

const strings = (source: string) => {
	const parsed = parseSync("brain.mjs", source);
	assert.equal(parsed.errors.length, 0, "the finished file must parse as JavaScript");
	const found: string[] = [];
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== "object") return;
		if (
			"type" in value &&
			value.type === "Literal" &&
			"value" in value &&
			typeof value.value === "string"
		)
			found.push(value.value);
		for (const child of Object.values(value)) visit(child);
	};
	visit(parsed.program);
	return found;
};

const textCheck = (brain: string, compiled: readonly string[]) => {
	const embedded = strings(brain);
	assert(compiled.length > 0, "the build emitted no inner program or window code");
	for (const source of compiled)
		assert(embedded.includes(source), "compiled text changed or became executable code");
};

const corruptText = (brain: string, source: string, replacement: string) => {
	const parsed = parseSync("brain.mjs", brain);
	const matches: Array<{readonly start: number; readonly end: number}> = [];
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== "object") return;
		if (
			"type" in value &&
			value.type === "Literal" &&
			"value" in value &&
			value.value === source &&
			"start" in value &&
			typeof value.start === "number" &&
			"end" in value &&
			typeof value.end === "number"
		)
			matches.push({start: value.start, end: value.end});
		for (const child of Object.values(value)) visit(child);
	};
	visit(parsed.program);
	assert.equal(matches.length, 1, "plant must replace exactly one embedded text module");
	const at = matches[0]!;
	return brain.slice(0, at.start) + JSON.stringify(replacement) + brain.slice(at.end);
};

const fixtureProgram = (app: string, name: string, text = TEXT) => {
	const folder = join(app, "node_modules/@p16", name);
	mkdirSync(folder, {recursive: true});
	writeFileSync(
		join(folder, "package.json"),
		JSON.stringify({
			name: `@p16/${name}`,
			type: "module",
			exports: {".": "./program.ts", "./window": "./window.tsx"},
		}),
	);
	writeFileSync(
		join(folder, "program.ts"),
		[
			'import {counter as original} from "@kampus/counter";',
			`globalThis.__p16ProgramLoaded = ${JSON.stringify(text)};`,
			`export const counter = {...original, name: ${JSON.stringify(name)}};`,
		].join("\n"),
	);
	writeFileSync(
		join(folder, "window.tsx"),
		`document.body.dataset.p16 = ${JSON.stringify(text)}; export {};`,
	);
	return {name, package: `@p16/${name}`, export: "counter"};
};

// A module import, without constructing a Worker or starting a program. The platform imports
// supply base classes only; this check makes no claim about runtime isolation.
const importOuter = (file: string) =>
	Schema.decodeUnknownSync(
		Schema.fromJsonString(Schema.Struct({ok: Schema.Boolean, why: Schema.String})),
	)(
		execFileSync(
			process.execPath,
			[
				"--experimental-vm-modules",
				"--input-type=module",
				"-e",
				[
					'import {readFileSync} from "node:fs";',
					'import {SourceTextModule, SyntheticModule, createContext} from "node:vm";',
					'const context = createContext({console, TextEncoder, TextDecoder, URL, URLSearchParams, crypto, fetch, Request, Response, Headers, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, performance, Buffer, process: {env: {NODE_ENV: "test"}}});',
					"try {",
					'const module = new SourceTextModule(readFileSync(process.argv[1], "utf8"), {context});',
					"await module.link(async (name) => {",
					' const values = name === "cloudflare:workers" ? {DurableObject: class {}, WorkerEntrypoint: class {}, RpcTarget: class {}, env: {}} : name.startsWith("node:") ? await import(name) : (() => {throw new Error("unfinished outer bundle: " + name)})();',
					" return new SyntheticModule(Object.keys(values), function() {for (const [key, value] of Object.entries(values)) this.setExport(key, value);}, {context});",
					"});",
					"await module.evaluate();",
					'if (context.__p16ProgramLoaded !== undefined) throw new Error("inner program executed during outer import");',
					'process.stdout.write(JSON.stringify({ok: true, why: ""}));',
					"} catch (error) {process.stdout.write(JSON.stringify({ok: false, why: error.message}));}",
				].join("\n"),
				file,
			],
			{encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]},
		),
	);

afterEach(() => {
	vi.useRealTimers();
	vi.doUnmock("rolldown");
	vi.resetModules();
	vi.unstubAllEnvs();
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

describe("P16 compiled text and program table", () => {
	it("text embedding: every real inner output survives exactly, including closing-script text", async () => {
		const {app} = fixture();
		const entry = fixtureProgram(app, "text");
		writeFileSync(join(app, "src/table.ts"), `export const programs = ${JSON.stringify([entry])};`);
		const observed = await observe();
		const built = await buildAt(app);
		const brain = readFileSync(built.brain, "utf8");
		// The outer bundle is emitted last. A final newline or banner is not inner code.
		const inner = observed.outputs.slice(0, -1);
		textCheck(brain, inner);
		expect(inner.some((source) => strings(source).includes(TEXT))).toBe(true);
		expect(observed.closed.length).toBeGreaterThan(1);
		expect(observed.closed.every(Boolean)).toBe(true);
		// Plants edit the disposable completed output, then run the same byte check.
		const source = inner.find((value) => value.includes("__p16ProgramLoaded"));
		assert(source, "fixture program was not compiled");
		for (const plant of [source.replaceAll("\\r\\n", "\\n"), source.replaceAll("\\\\", "\\")]) {
			assert.notEqual(plant, source, "the plant must change compiled bytes");
			expect(() => textCheck(corruptText(brain, source, plant), inner)).toThrow(
				"compiled text changed",
			);
		}
		expect(() => textCheck(`${source}\nexport default {};`, [source])).toThrow(
			"compiled text changed",
		);
	});

	it("text embedding: importing the actual outer module does not execute program source", async () => {
		const {app} = fixture();
		const entry = fixtureProgram(app, "inert");
		writeFileSync(join(app, "src/table.ts"), `export const programs = ${JSON.stringify([entry])};`);
		const built = await buildAt(app);
		expect(importOuter(built.brain)).toEqual({ok: true, why: ""});
		const planted = join(app, "executed.mjs");
		writeFileSync(
			planted,
			`globalThis.__p16ProgramLoaded = true;\n${readFileSync(built.brain, "utf8")}`,
		);
		expect(importOuter(planted)).toEqual({
			ok: false,
			why: "inner program executed during outer import",
		});
	});

	it("table: each listed source has its own recorded content hash; clean builds ignore checkout and wall clock", async () => {
		vi.useFakeTimers({toFake: ["Date"]});
		vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
		const first = fixture();
		const rows = [
			fixtureProgram(first.app, "first", "first source"),
			fixtureProgram(first.app, "second", "second source"),
		];
		writeFileSync(
			join(first.app, "src/table.ts"),
			`export const programs = ${JSON.stringify(rows)};`,
		);
		const observed = await observe();
		const a = await buildAt(first.app);
		const bytes = readFileSync(a.brain);
		const embedded = strings(bytes.toString("utf8"));
		// The generated box entry may itself import cloudflare:workers. Use literal inclusion
		// rather than a filename convention to identify program output in either form.
		const programs = observed.outputs.filter(
			(source) => embedded.includes(source) && source.includes("__p16ProgramLoaded"),
		);
		expect(programs).toHaveLength(2);
		for (const source of programs) expect(embedded).toContain(sha(source));
		expect(new Set(programs.map(sha)).size).toBe(2);
		const second = fixture();
		vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
		const copiedRows = [
			fixtureProgram(second.app, "first", "first source"),
			fixtureProgram(second.app, "second", "second source"),
		];
		writeFileSync(
			join(second.app, "src/table.ts"),
			`export const programs = ${JSON.stringify(copiedRows)};`,
		);
		const b = await buildAt(second.app);
		expect(sha(readFileSync(b.brain))).toBe(sha(bytes));
		for (const home of [first.home, second.home])
			expect(bytes.toString("utf8")).not.toContain(home);
	});

	it("table plant, duplicate names: the build refuses them and preserves the last good brain", async () => {
		const {app} = fixture();
		const entry = fixtureProgram(app, "duplicate");
		writeFileSync(join(app, "src/table.ts"), `export const programs = ${JSON.stringify([entry])};`);
		const good = await buildAt(app);
		const bytes = readFileSync(good.brain);
		// A fresh import path prevents the test runner's transform cache from hiding the edit.
		const second = fixture();
		const duplicate = fixtureProgram(second.app, "duplicate");
		writeFileSync(
			join(second.app, "src/table.ts"),
			`export const programs = ${JSON.stringify([duplicate, duplicate])};`,
		);
		const previous = join(second.app, relative(app, good.brain));
		mkdirSync(dirname(previous), {recursive: true});
		writeFileSync(previous, bytes);
		const api = await vi.importActual<Build>(pathToFileURL(join(second.app, "src/build.ts")).href);
		const exit = await Effect.runPromise(
			Effect.exit(api.build({chaos: false})).pipe(Effect.provide(NodeServices.layer)),
		);
		expect(exit).toMatchObject({_tag: "Failure"});
		expect(JSON.stringify(exit)).toContain("table");
		expect(readFileSync(previous)).toEqual(bytes);
	});
});
