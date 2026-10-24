import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {answer, CSP, fileOf, isOurs, START} from "./files.ts";

// What the app's own protocol serves, with a file system that holds what the test says.

describe("the app's own files", () => {
	it("are the three it lists, on its own scheme and host, and nothing else", () => {
		expect(fileOf(START)).toBe("/index.html");
		expect(fileOf("fabrika://app/")).toBe("/index.html");
		expect(fileOf("fabrika://app/window.js?x=1")).toBe("/window.js");
		expect(fileOf("fabrika://app/../main.mjs")).toBeNull();
		expect(fileOf("fabrika://app/preload.cjs")).toBeNull();
		expect(fileOf("fabrika://other/index.html")).toBeNull();
		expect(fileOf("https://example.com/window.js")).toBeNull();
		expect(fileOf("not a url")).toBeNull();
		expect(isOurs("fabrika://app/index.html")).toBe(true);
		expect(isOurs("file:///index.html")).toBe(false);
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
		const page = await run(START, fs);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(page.headers.get("content-security-policy")).toBe(CSP);
		expect(page.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await page.text()).toBe("read /dist/index.html");
		expect((await run("fabrika://app/main.mjs", fs)).status).toBe(404);
		// The no-op file system finds no file at all: a read that fails.
		expect((await run(START, FileSystem.makeNoop({}))).status).toBe(500);
	});
});
