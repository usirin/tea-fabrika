// P16, next/. Vitest transpiles TypeScript; the app's real command must also work in plain Node.
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

const APP = resolve(import.meta.dirname, "..");
const homes: string[] = [];

const fixture = () => {
	const home = mkdtempSync("/tmp/fh.");
	homes.push(home);
	for (const file of ["package.json", "build.ts"]) copyFileSync(join(APP, file), join(home, file));
	for (const dir of ["src", "node_modules"]) symlinkSync(join(APP, dir), join(home, dir), "dir");
	return home;
};

const command = (home: string) =>
	spawnSync(process.execPath, ["build.ts"], {
		cwd: home,
		encoding: "utf8",
		env: {
			...process.env,
			FABRIKA_HOME: home,
			FABRIKA_FOREGROUND: undefined,
			TYPESAFE_API_KEY: undefined,
			NODE_OPTIONS: undefined,
		},
	});

const verify = (home: string, result: ReturnType<typeof command>) => {
	expect(result.error, "Node must start").toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
	expect(readFileSync(join(home, "dist/brain.mjs"), "utf8").length).toBeGreaterThan(0);
};

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

describe("P16 app build command", () => {
	it("scenario: node build.ts exits zero and writes brain.mjs in a fresh folder", () => {
		const home = fixture();
		verify(home, command(home));
	});
	it("scenario: plant a parameter property in the real command and reject Node's import failure", () => {
		const home = fixture(),
			file = join(home, "build.ts");
		writeFileSync(
			file,
			`class Options { constructor(readonly out: string) {} }\n${readFileSync(file, "utf8")}`,
		);
		const result = command(home);
		expect(result.stderr).toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
		expect(result.stderr).toContain("TypeScript parameter property");
		expect(result.stderr).toContain("class Options { constructor(readonly out: string) {} }");
		expect(() => verify(home, result)).toThrow();
	});
});
