import {execFileSync} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {Duration, Effect, Exit, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {LocalLedger, layerLocal} from "./local.ts";

// The local ledger's start, when its child cannot serve: the child's end is the answer, at once.
// Its memory cap, on a real child: only workerd counts.

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

/**
 * The names of the processes in group `pgid` other than its leader, from `ps`. A name is the last
 * part of `comm`: a full path on macOS, the name alone on Linux. A process that ended and was not
 * reaped is still listed: by its name on Linux, as `<defunct>` on macOS.
 */
const othersIn = (pgid: number) =>
	execFileSync("ps", ["-A", "-o", "pid=,pgid=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
		.filter((m) => m !== null && Number(m[2]) === pgid && Number(m[1]) !== pgid)
		.map((m) => basename((m?.[3] ?? "").trim()));

/** Watch a running local ledger for `ms`, with its cap read every 100 ms. */
const watch = (capMb: number, ms: number) =>
	Effect.gen(function* () {
		const local = yield* LocalLedger;
		yield* Effect.sleep(Duration.millis(ms));
		const pid = yield* local.pid;
		return {
			restarts: yield* local.restarts,
			groupMb: yield* local.memoryMb,
			workerdMb: yield* local.workerdMb,
			others: othersIn(pid),
		};
	}).pipe(
		Effect.scoped,
		Effect.provide(
			layerLocal({
				persist: mkdtempSync(join(tmpdir(), "local-cap-")),
				ledger: "x",
				capMb,
				checkEvery: Duration.millis(100),
			}),
		),
	);

describe("the memory cap", () => {
	it("counts workerd alone: a cap over workerd and under the whole group restarts nothing, and esbuild is gone once the Worker is bundled", async () => {
		const seen = await Effect.runPromise(watch(150, 1500));
		// The group holds the child's own Node too, so it is over the cap; workerd is under it.
		expect(seen.workerdMb).toBeGreaterThan(0);
		expect(seen.workerdMb).toBeLessThan(150);
		expect(seen.groupMb).toBeGreaterThan(seen.workerdMb);
		expect(seen.restarts).toBe(0);
		// Beside the child's own Node, workerd alone: esbuild has ended and been reaped.
		expect(seen.others).toEqual(["workerd"]);
	}, 30_000);

	it("restarts the child when workerd passes it", async () => {
		const seen = await Effect.runPromise(watch(1, 3000));
		expect(seen.restarts).toBeGreaterThan(0);
	}, 30_000);
});
