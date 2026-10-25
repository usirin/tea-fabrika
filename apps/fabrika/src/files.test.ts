import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {answer, CSP, DESK, DESK_CSP, fileOf, isDesk, isOurs} from "./files.ts";

// What the app's own protocol serves, with a file system that holds what the test says.

describe("the app's own files", () => {
	it("are the ones it lists, on its own scheme and host, and nothing else", () => {
		expect(fileOf(DESK)).toBe("/desk.html");
		expect(fileOf("fabrika://app/")).toBe("/desk.html");
		expect(fileOf("fabrika://app/desk.js?x=1")).toBe("/desk.js");
		expect(fileOf("fabrika://app/../main.mjs")).toBeNull();
		expect(fileOf("fabrika://app/preload.cjs")).toBeNull();
		expect(fileOf("fabrika://app/terminal.html")).toBeNull();
		expect(fileOf("fabrika://app/program.html")).toBeNull();
		expect(fileOf("fabrika://other/desk.html")).toBeNull();
		expect(fileOf("https://example.com/desk.js")).toBeNull();
		expect(fileOf("not a url")).toBeNull();
		expect(isOurs("fabrika://app/desk.html")).toBe(true);
		expect(isOurs("file:///desk.html")).toBe(false);
	});

	it("say whether a url shows the desk, the one page", () => {
		expect(isDesk(DESK)).toBe(true);
		expect(isDesk("fabrika://app/")).toBe(true);
		expect(isDesk("fabrika://app/desk.js")).toBe(false);
		expect(isDesk("https://example.com/desk.html")).toBe(false);
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
		const script = await run("fabrika://app/desk.js", fs);
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
		expect(script.headers.get("content-security-policy")).toBe(CSP);
		expect(script.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await script.text()).toBe("read /dist/desk.js");
		expect((await run("fabrika://app/main.mjs", fs)).status).toBe(404);
		// The no-op file system finds no file at all: a read that fails.
		expect((await run(DESK, FileSystem.makeNoop({}))).status).toBe(500);
	});

	it("let the page compile WebAssembly, and change nothing else in its policy", async () => {
		const fs = FileSystem.makeNoop({readFileString: () => Effect.succeed("")});
		const page = await Effect.runPromise(
			answer("/dist", DESK).pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provide(Path.layer),
			),
		);
		expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(page.headers.get("content-security-policy")).toBe(DESK_CSP);
		expect(DESK_CSP.replace(" 'wasm-unsafe-eval'", "")).toBe(CSP);
	});
});
