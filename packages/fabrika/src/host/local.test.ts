import {mkdtempSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Exit, Layer} from "effect";
import {describe, expect, it} from "vitest";
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

describe("layerLocal", () => {
	it("on a port another program holds, the start fails when the child ends, not when a clock runs out, and says why", async () => {
		const persist = mkdtempSync(join(tmpdir(), "local-taken-"));
		const exit = await heldPort((port) =>
			Effect.runPromiseExit(Effect.scoped(Layer.build(layerLocal({persist, ledger: "x", port})))),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const said = String(exit);
		// The child's end, not the 30 s clock, which says "did not say it was ready".
		expect(said).toContain("the ledger stopped before it was ready");
		expect(said).toContain("Address already in use");
	});
});
