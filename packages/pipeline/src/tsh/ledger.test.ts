import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger} from "@kampus/fabrika-old";
import {Context, Effect, Exit, Layer, Scope} from "effect";
import {describe, expect, it} from "vitest";
import {ledgerNameOf, localLedger, portOf} from "./ledger.ts";

// tsh's ledger: the Durable Object in Miniflare, one per fabrika home. One tsh at a time holds it;
// what it wrote is there for the next one.

describe("ledgerNameOf and portOf", () => {
	it("a name keeps letters, digits and dashes, and drops the file's ending", () => {
		expect(ledgerNameOf("github-demlik.sqlite")).toBe("github-demlik");
		expect(ledgerNameOf("folders-My Repo-0a1b2c3d4e5f.sqlite")).toBe(
			"folders-my-repo-0a1b2c3d4e5f",
		);
	});

	it("a data folder has one port, below the ports any system gives outgoing connections", () => {
		expect(portOf("/home/a/ledgers/local")).toBe(portOf("/home/a/ledgers/local"));
		expect(portOf("/home/a/ledgers/local")).not.toBe(portOf("/home/b/ledgers/local"));
		// Linux gives outgoing connections local ports from 32768, macOS and Windows from 49152.
		const ports = Array.from({length: 2_000}, (_, i) =>
			portOf(`/tmp/h-${i.toString(36)}/ledgers/local`),
		);
		expect(Math.min(...ports)).toBeGreaterThanOrEqual(12_000);
		expect(Math.max(...ports)).toBeLessThan(32_000);
	});
});

const open = async (layer: Layer.Layer<Ledger, unknown>) => {
	const scope = Effect.runSync(Scope.make());
	const exit = await Effect.runPromiseExit(Layer.buildWithScope(layer, scope));
	return {scope, exit, ledger: Exit.isSuccess(exit) ? Context.get(exit.value, Ledger) : null};
};

describe("localLedger", () => {
	it("a second tsh on one home is refused while the first runs; the next one after it reads its rows", async () => {
		const persist = mkdtempSync(join(tmpdir(), "tsh-ledger-"));
		const layer = localLedger({persist, ledger: "github-demlik", waitMs: 600});
		const first = await open(layer);
		// Twice on CI this failed with nothing but "expected null": say why the ledger did not start.
		expect(first.ledger, String(first.exit)).not.toBeNull();
		const second = await open(layer);
		try {
			expect(Exit.isFailure(second.exit)).toBe(true);
			expect(String(second.exit)).toContain("another tsh is using the ledger");
			await Effect.runPromise(
				Effect.gen(function* () {
					const ledger = first.ledger as Ledger["Service"];
					yield* ledger.register("operate:7", "tsh-a");
					const rev = (yield* ledger.readLast("operate:7", 1))[0]?.rev ?? 0;
					yield* ledger.claim("operate:7", "tsh-a", rev, 60_000);
				}),
			);
		} finally {
			await Effect.runPromise(Scope.close(second.scope, Exit.void));
			await Effect.runPromise(Scope.close(first.scope, Exit.void));
		}
		const third = await open(layer);
		try {
			const lease = await Effect.runPromise((third.ledger as Ledger["Service"]).lease("operate:7"));
			// Past the local door: the host's tag, then its one person.
			expect(lease?.holder).toBe("tsh-a@user:owner");
		} finally {
			await Effect.runPromise(Scope.close(third.scope, Exit.void));
		}
	});
});
