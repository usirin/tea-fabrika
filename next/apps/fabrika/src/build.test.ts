// P12 and P16, next/. Exercise the real build entry. A Compiler failure must preserve every
// last-good byte. P16: the app's build hands its selections to libfabrika's one-file build, so
// only brain.mjs is published, and every failure is BuildError with its `reason`.
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {Effect, FileSystem, Layer, type Path, PlatformError} from "effect";
import * as fc from "fast-check";
import {rolldown} from "rolldown";
import {afterEach, describe, expect, it} from "vitest";

const homes: Array<string> = [];

const runNode = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.runPromise(work.pipe(Effect.provide(NodeServices.layer)));

const discovery = (files: Array<string>, seen?: {calls: number}) =>
	Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, (fs) => ({
			...fs,
			glob: () =>
				Effect.sync(() => {
					if (seen) seen.calls++;
					return files;
				}),
		})),
	);

const refused = (reason: string) => ({_tag: "Failure", failure: {_tag: "BuildError", reason}});

afterEach(() => {
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});

const home = () => {
	const h = mkdtempSync(join(tmpdir(), "p12-b-"));
	homes.push(h);
	return h;
};

const generated = fc.record({name: fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/), label: fc.string()});
const chosen = {name: "view", label: "view-built"};

const law = (
	name: string,
	check: (input: ReturnType<typeof generated.generate>["value"]) => Promise<void>,
) =>
	it(name, async () => {
		await fc.assert(
			fc.asyncProperty(generated, async (input) => {
				try {
					await check(input);
				} finally {
					for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
				}
			}),
			{seed: 119120, numRuns: 3, examples: [[chosen]]},
		);
	});

const snapshot = (dir: string): ReadonlyArray<readonly [string, string]> =>
	readdirSync(dir, {recursive: true, withFileTypes: true})
		.filter((f) => f.isFile())
		.map(
			(f) =>
				[
					relative(dir, join(f.parentPath, f.name)),
					readFileSync(join(f.parentPath, f.name)).toString("base64"),
				] as const,
		)
		.sort(([a], [b]) => a.localeCompare(b));

const clean = "export const Tip = (p: {text: string}) => <b>{p.text}</b>;";

const plants = [
	[
		"skipped function",
		'import {useRef} from "react"; export const Tip = () => {const r = useRef(1); return <b>{r.current}</b>;}',
	],
	["purity error", "export const Tip = () => <b>{Date.now()}</b>;"],
	["unlisted directive", 'export const Tip = () => {"use no memo"; return <b>ok</b>;}'],
] as const;

describe("P12 Rolldown build", () => {
	for (const [plant, source] of plants)
		law(`every reachable TSX input passes the Compiler check: ${plant}`, async ({name}) => {
			const {build} = await import("./build.ts");
			const folder = home(),
				file = join(folder, `${name}.tsx`),
				program = join(folder, "program.ts"),
				out = join(folder, "dist");
			mkdirSync(join(folder, "node_modules"));
			symlinkSync(
				resolve(
					import.meta.dirname,
					"../../../../node_modules/.pnpm/react@19.3.1/node_modules/react",
				),
				join(folder, "node_modules/react"),
			);
			writeFileSync(file, clean);
			writeFileSync(
				program,
				`import {Tip} from "./${name}.tsx"; import {counter} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))}; export const program = {...counter, fixture: Tip};`,
			);
			const options = {out, files: [], ledger: [], programs: {counter: program}};
			await runNode(build(options));
			const before = snapshot(out);
			writeFileSync(file, source);
			const failed = await runNode(Effect.result(build(options)));
			expect(failed, "reachable input is checked even with files: []").toMatchObject(
				refused("compiler"),
			);
			expect(snapshot(out)).toEqual(before);
		});
	law(
		"Compiler ledger rows use the same repo-relative paths as discovered inputs",
		async ({name}) => {
			const {build} = await import("./build.ts");
			const folder = home(),
				file = join(folder, `${name}.tsx`),
				root = resolve(import.meta.dirname, "../../../..");
			writeFileSync(file, 'export const Tip = () => {"use no memo"; return <b>approved</b>;}');
			const path = relative(root, file);
			const result = await runNode(
				Effect.exit(
					build({
						out: join(folder, "dist"),
						ledger: [{file: path, fn: "Tip", why: "fixture approval"}],
					}),
				).pipe(Effect.provide(discovery([path]))),
			);
			expect(result).toMatchObject({_tag: "Success"});
		},
	);
	law(
		"default discovery checks a view without publishing siblings and custom modules export program",
		async ({name, label}) => {
			const {build} = await import("./build.ts");
			const parent = home(),
				folder = join(parent, "owned"),
				view = join(folder, `${name}.tsx`),
				program = join(folder, "program.ts"),
				out = join(folder, "dist");
			mkdirSync(folder);
			writeFileSync(view, `export const label = ${JSON.stringify(label)};`);
			writeFileSync(
				program,
				`export {counter as program} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))};`,
			);
			chmodSync(parent, 0o500);
			try {
				const built = await runNode(
					build({out, programs: {counter: program}}).pipe(
						Effect.provide(
							discovery([relative(resolve(import.meta.dirname, "../../../.."), view)]),
						),
					),
				);
				expect(built.programs.counter?.hash).toMatch(/^[a-f0-9]{64}$/);
				// P16 replaces P12's loose view files: the one published file is the brain.
				expect(readdirSync(out)).toEqual(["brain.mjs"]);
				// Discovery must still reach the real Compiler.
				const before = snapshot(out);
				writeFileSync(view, plants[1][1]);
				const failed = await runNode(
					Effect.result(build({out, programs: {counter: program}})).pipe(
						Effect.provide(
							discovery([relative(resolve(import.meta.dirname, "../../../.."), view)]),
						),
					),
				);
				expect(failed, "default discovery must check its TSX inputs").toMatchObject(
					refused("compiler"),
				);
				expect(snapshot(out)).toEqual(before);
			} finally {
				chmodSync(parent, 0o700);
			}
		},
	);
	law(
		"Compiler plant: calling compile without check publishes a skipped or impure rebuild",
		async ({name}) => {
			const {build} = await import("./build.ts");
			const h = home(),
				file = join(h, `${name}.tsx`),
				out = join(h, "dist");
			writeFileSync(file, clean);
			const options = {out, files: [file], ledger: []};
			const good = await runNode(build(options));
			expect(good).toMatchObject({build: expect.any(String)});
			const before = snapshot(out);
			expect(before.length).toBeGreaterThan(0);
			for (const [name, source] of plants) {
				writeFileSync(file, source);
				const failed = await runNode(Effect.result(build(options)));
				expect(failed, name).toMatchObject(refused("compiler"));
				expect(snapshot(out), name).toEqual(before);
			}
		},
	);
	law(
		"Compiler plant: checking transformed files misses a stale ledger row or deleted input",
		async ({name}) => {
			const {build} = await import("./build.ts");
			const h = home(),
				file = join(h, `${name}.tsx`),
				out = join(h, "dist");
			writeFileSync(file, clean);
			await runNode(build({out, files: [file], ledger: []}));
			const before = snapshot(out);
			for (const stale of [file, join(h, "gone.tsx")]) {
				const result = await runNode(
					Effect.result(
						build({
							out,
							files: [file],
							ledger: [{file: stale, fn: "Tip", why: "test plant"}],
						}),
					),
				);
				expect(result).toMatchObject(refused("compiler"));
				expect(snapshot(out)).toEqual(before);
			}
		},
	);
	law(
		"sealed program plant: generated source must execute without host imports or ambient bindings",
		async ({name}) => {
			const {build} = await import("./build.ts");
			const built = await runNode(build({out: join(home(), "dist")}));
			expect(built.brain).toEqual(expect.any(String));
			expect(built.programs.counter).toMatchObject({
				hash: expect.any(String),
				source: expect.any(String),
			});
			// The native Worker entry may import cloudflare:workers. Its execution is checked on workerd.
			const file = join(home(), `${name}.mjs`);
			writeFileSync(file, built.programs.counter!.source);
			const bundle = await rolldown({
				input: file,
				platform: "browser",
				external: ["cloudflare:workers"],
			});
			try {
				const generated = await bundle.generate({format: "esm"});
				expect(
					generated.output.some((o) => o.type === "chunk" && o.exports.includes("default")),
				).toBe(true);
			} finally {
				await bundle.close();
			}
			expect(built.build.length).toBeGreaterThan(0);
		},
	);
	law(
		"discovery keeps program TSX and leaves out test files and installed dependencies",
		async ({name}) => {
			const {build} = await import("./build.ts");
			const folder = home(),
				out = join(folder, "dist"),
				root = resolve(import.meta.dirname, "../../../.."),
				good = join(folder, `${name}.tsx`),
				test = join(folder, `${name}.test.tsx`),
				dependency = join(folder, "node_modules", `${name}.tsx`);
			mkdirSync(join(folder, "node_modules"));
			writeFileSync(good, clean);
			writeFileSync(test, "this is invalid TSX");
			writeFileSync(dependency, "this is invalid TSX");
			const seen = {calls: 0};
			const built = await runNode(
				build({out, ledger: []}).pipe(
					Effect.provide(
						discovery(
							[good, test, dependency].map((file) => relative(root, file)),
							seen,
						),
					),
				),
			);
			expect(seen.calls, "default discovery ran").toBeGreaterThan(0);
			expect(built.brain).toBe(join(out, "brain.mjs"));
			expect(readFileSync(built.brain, "utf8").length).toBeGreaterThan(0);
			// Plant: the same good file, refused, still fails through discovery.
			writeFileSync(good, plants[0][1]);
			const failed = await runNode(
				Effect.result(build({out, ledger: []})).pipe(
					Effect.provide(discovery([relative(root, good)])),
				),
			);
			expect(failed).toMatchObject(refused("compiler"));
		},
	);
	law(
		"discovery plant: a disk failure is a typed BuildError and preserves the last good file",
		async ({label}) => {
			const {build} = await import("./build.ts");
			const folder = home(),
				out = join(folder, "dist");
			mkdirSync(out);
			writeFileSync(join(out, "brain.mjs"), label);
			const before = snapshot(out);
			let calls = 0;
			const failing = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fs) => ({
					...fs,
					glob: () => {
						calls++;
						return Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method: "glob",
								description: "planted discovery disk failure",
							}),
						);
					},
				})),
			);
			// Effect.result catches typed failures only. A defect escapes this law.
			const result = await runNode(
				Effect.result(build({out, ledger: []})).pipe(Effect.provide(failing)),
			);
			expect(calls).toBeGreaterThan(0);
			expect(result).toMatchObject(refused("read"));
			expect(snapshot(out)).toEqual(before);
		},
	);
});
