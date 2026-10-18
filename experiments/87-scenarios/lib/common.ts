// Experiment 87: the steps every ticket can use. None of them knows a ticket.
//
// The folder this file sits in is copied to `packages/<package>/scen87/lib/`
// in a scratch checkout of the target repository, so `PACKAGE` below is the
// package under test and `typescript` resolves from that package.
//
// Node at the edge, said out loud: `node:fs` and `node:child_process` for the
// scratch files, `git` and `tsc`. These steps stand in for a user at a shell.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {expectThat, Given, need, type Problems, Then, When, type World} from "./moves.ts";

export const PACKAGE = resolve(import.meta.dirname, "..", "..");
const TSC = createRequire(join(PACKAGE, "package.json")).resolve("typescript/bin/tsc");

/** One tsc error, read off `--pretty false` output. */
export interface Diagnostic {
	readonly file: string;
	readonly line: number;
	readonly code: string;
	readonly text: string;
}

/** Run tsc over a project; its errors, with paths made absolute. */
export function typecheck(project: string): readonly Diagnostic[] {
	const run = spawnSync(process.execPath, [TSC, "-p", project, "--pretty", "false"], {
		cwd: dirname(project),
		encoding: "utf8",
	});
	const out = `${run.stdout}${run.stderr}`;
	return [...out.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm)].map((m) => ({
		file: resolve(dirname(project), m[1] ?? ""),
		line: Number(m[2]),
		code: m[3] ?? "",
		text: m[4] ?? "",
	}));
}

export const git = (dir: string, ...args: string[]): string => {
	const run = spawnSync("git", args, {cwd: dir, encoding: "utf8"});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
	return run.stdout.trim();
};

/** A fresh git repository with one commit holding `files`. */
export function scratchRepo(files: Readonly<Record<string, string>>): string {
	const dir = mkdtempSync(join(tmpdir(), "scen87-"));
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), {recursive: true});
		writeFileSync(join(dir, path), body);
	}
	git(dir, "init", "-q", "-b", "main");
	git(dir, "-c", "user.name=scen", "-c", "user.email=scen@example.com", "add", "-A");
	git(dir, "-c", "user.name=scen", "-c", "user.email=scen@example.com", "commit", "-qm", "fixture");
	return dir;
}

// ------------------------------------------------------------ a folder and a shell

Given("act", "a scratch folder", (world) => {
	world.data.dir = mkdtempSync(join(tmpdir(), "scen87-"));
});

Given("act", "the file {string}:", (world, path, doc) => {
	const file = join(need<string>(world, "dir"), String(path));
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, String(doc));
});

When("act", "I run {string}", (world, command) => {
	const run = spawnSync("sh", ["-c", String(command)], {
		cwd: need<string>(world, "dir"),
		encoding: "utf8",
	});
	world.data.ran = {code: run.status ?? -1, out: `${run.stdout}${run.stderr}`};
});

Then("check", "it exits {int}", (world, code) => {
	const ran = need<{code: number; out: string}>(world, "ran");
	return expectThat(ran.code === code, `it exited ${ran.code}, not ${code}:\n${ran.out}`);
});

Then("check", "the file {string} contains {string}", (world, path, text) => {
	const body = readFileSync(join(need<string>(world, "dir"), String(path)), "utf8");
	return expectThat(body.includes(String(text)), `${path} does not contain ${text}`);
});

Then("check", "tsc --noEmit passes in the folder", (world) => {
	const found = typecheck(join(need<string>(world, "dir"), "tsconfig.json"));
	return found.map((d) => `${d.file}:${d.line} ${d.code} ${d.text}`);
});

// ------------------------------------------------------------ TypeScript against the package

/**
 * A scratch folder inside the package, with a tsconfig that extends the
 * package's own and maps the package's published name onto its source, so a
 * module written here imports `@demlik/tea/effect` as a user would.
 */
function moduleFolder(world: World): string {
	if (typeof world.data.tsdir === "string") return world.data.tsdir;
	const root = join(PACKAGE, "scen87", ".tsc");
	mkdirSync(root, {recursive: true});
	const dir = mkdtempSync(join(root, "s-"));
	const name = (JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {name: string})
		.name;
	const config = {
		extends: join(PACKAGE, "tsconfig.json"),
		compilerOptions: {
			noUnusedLocals: false,
			paths: {
				[name]: [join(PACKAGE, "src", "index.ts")],
				[`${name}/*`]: [join(PACKAGE, "src", "*", "index.ts")],
			},
		},
		include: ["./*.ts"],
		exclude: [],
	};
	writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config, null, 2));
	world.data.tsdir = dir;
	world.data.modules = [];
	return dir;
}

Given("act", "the TypeScript module {string}:", (world, name, doc) => {
	const dir = moduleFolder(world);
	writeFileSync(join(dir, String(name)), String(doc));
	need<string[]>(world, "modules").push(String(name));
});

Then("check", "the TypeScript modules typecheck", (world) => {
	const found = typecheck(join(moduleFolder(world), "tsconfig.json"));
	return found.map((d) => `${d.file}:${d.line} ${d.code} ${d.text}`);
});

/**
 * The refusal must be on the marked line and nowhere else. Without the second
 * half, a module whose import does not resolve yet "refuses" every marked line
 * for the wrong reason, and the scenario passes before anything is built.
 */
Then("check", "the typecheck refuses the lines marked {string} and no other", (world, marker) => {
	const dir = moduleFolder(world);
	const found = typecheck(join(dir, "tsconfig.json"));
	const marked = need<string[]>(world, "modules").flatMap((name) =>
		readFileSync(join(dir, name), "utf8")
			.split("\n")
			.flatMap((text, i) =>
				text.includes(String(marker)) ? [{file: join(dir, name), line: i + 1}] : [],
			),
	);
	const isMarked = (d: Diagnostic) => marked.some((m) => m.file === d.file && m.line === d.line);
	const missed = marked.filter((m) => !found.some((d) => d.file === m.file && d.line === m.line));
	return [
		...(marked.length === 0 ? [`no line carries ${marker}`] : []),
		...missed.map((m) => `${m.file}:${m.line} is marked ${marker} but compiles`),
		...found
			.filter((d) => !isMarked(d))
			.map((d) => `${d.file}:${d.line} ${d.code} ${d.text} (not marked)`),
	] satisfies Problems;
});
