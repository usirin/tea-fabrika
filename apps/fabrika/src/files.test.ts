import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {answer, CSP, fileOf, isOurs, PROGRAM, pageOf, TERMINAL, TERMINAL_CSP} from "./files.ts";

// What the app's own protocol serves, with a file system that holds what the test says.

describe("the app's own files", () => {
	it("are the ones it lists, on its own scheme and host, and nothing else", () => {
		expect(fileOf(TERMINAL)).toBe("/terminal.html");
		expect(fileOf("fabrika://app/")).toBe("/terminal.html");
		expect(fileOf("fabrika://app/terminal.js?x=1")).toBe("/terminal.js");
		expect(fileOf(PROGRAM)).toBe("/program.html");
		expect(fileOf("fabrika://app/../main.mjs")).toBeNull();
		expect(fileOf("fabrika://app/preload.cjs")).toBeNull();
		expect(fileOf("fabrika://app/index.html")).toBeNull();
		expect(fileOf("fabrika://other/terminal.html")).toBeNull();
		expect(fileOf("https://example.com/terminal.js")).toBeNull();
		expect(fileOf("not a url")).toBeNull();
		expect(isOurs("fabrika://app/terminal.html")).toBe(true);
		expect(isOurs("file:///terminal.html")).toBe(false);
	});

	it("say which page a url shows: the terminal, a program's window, or none", () => {
		expect(pageOf(TERMINAL)).toBe("terminal");
		expect(pageOf("fabrika://app/")).toBe("terminal");
		expect(pageOf(`${PROGRAM}?run=counter:1`)).toBe("program");
		expect(pageOf("fabrika://app/terminal.js")).toBeNull();
		expect(pageOf("https://example.com/program.html")).toBeNull();
	});

	it("are answered with their type and the policy, a name not listed with 404, a read that fails with 500", async () => {
		const fs = FileSystem.makeNoop({
			readFileString: (path) => Effect.succeed(`read ${path}`),
		});
		const run = (url: string, read: FileSystem.FileSystem) =>
			Effect.runPromise(
				answer("/dist", url).pipe(
					Effect.provideService(FileSystem.FileSystem, read),
					Effect.provide(Path.layer),
				),
			);
		const page = await run(PROGRAM, fs);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(page.headers.get("content-security-policy")).toBe(CSP);
		expect(page.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await page.text()).toBe("read /dist/program.html");
		expect((await run("fabrika://app/main.mjs", fs)).status).toBe(404);
		// The no-op file system finds no file at all: a read that fails.
		expect((await run(TERMINAL, FileSystem.makeNoop({}))).status).toBe(500);
	});

	it("let only the terminal's page compile WebAssembly, and change nothing else in its policy", async () => {
		const fs = FileSystem.makeNoop({readFileString: () => Effect.succeed("")});
		const terminal = await Effect.runPromise(
			answer("/dist", TERMINAL).pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provide(Path.layer),
			),
		);
		expect(terminal.headers.get("content-security-policy")).toBe(TERMINAL_CSP);
		expect(TERMINAL_CSP.replace(" 'wasm-unsafe-eval'", "")).toBe(CSP);
	});
});
