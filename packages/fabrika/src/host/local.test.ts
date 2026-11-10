import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Exit, Layer} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {layerLocal} from "./local.ts";

// The local ledger's start, when its child cannot serve: the child's end is the answer, at once.

/** A port some other program listens on, for as long as `use` runs. */
const heldPort = async <A>(use: (port: number) => Promise<A>): Promise<A> => {
	const server = createServer((socket) => socket.destroy());
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	try {
		if (address === null || typeof address === "string") throw new Error("no port");
		return await use(address.port);
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
	}
};

/** Folders a test made, removed after it: a ledger's folder holds its door secret. */
const made: string[] = [];

const folder = (prefix: string): string => {
	const path = mkdtempSync(join(tmpdir(), prefix));
	made.push(path);
	return path;
};

describe("layerLocal", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		for (const path of made.splice(0)) rmSync(path, {recursive: true, force: true});
	});

	it("on a port another program holds, the start fails when the child ends, not when a clock runs out, and says why", async () => {
		const persist = folder("local-taken-");
		const exit = await heldPort((port) =>
			Effect.runPromiseExit(Effect.scoped(Layer.build(layerLocal({persist, ledger: "x", port})))),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const said = String(exit);
		// The child's end, not the 30 s clock, which says "did not say it was ready".
		expect(said).toContain("the ledger stopped before it was ready");
		expect(said).toContain("Address already in use");
	});

	it("when the child writes more before the reason, the start still says why", async () => {
		const persist = folder("local-taken-");
		// CI's order, forced: 600 characters on the child's stderr before its own reason.
		const preload = join(folder("local-noise-"), "noise.mjs");
		writeFileSync(preload, 'process.stderr.write("x".repeat(600) + String.fromCharCode(10));\n');
		// Quoted, so a folder with a space still reads as one path.
		vi.stubEnv("NODE_OPTIONS", `--import="${preload}"`);
		const exit = await heldPort((port) =>
			Effect.runPromiseExit(Effect.scoped(Layer.build(layerLocal({persist, ledger: "x", port})))),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const said = String(exit);
		expect(said).toContain("the ledger stopped before it was ready");
		expect(said).toContain("Address already in use");
	});
});
