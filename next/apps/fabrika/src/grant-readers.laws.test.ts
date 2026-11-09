// P12, next/. The real command is captured at its NodeRuntime edge; no process or socket starts.
import {Cause, Effect, Exit} from "effect";
import * as fc from "fast-check";
import {expect, it, vi} from "vitest";

const cli = vi.hoisted(() => ({work: undefined as Effect.Effect<unknown, unknown> | undefined}));
vi.mock("@effect/platform-node", async (original) => ({
	...(await original<typeof import("@effect/platform-node")>()),
	NodeRuntime: {
		runMain: (work: Effect.Effect<unknown, unknown>) => {
			cli.work = work;
		},
	},
}));
const typed = (exit: Exit.Exit<unknown, unknown>) => {
	expect(Exit.isFailure(exit)).toBe(true);
	const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
	expect(Cause.hasDies(cause)).toBe(false);
	expect(Cause.hasFails(cause)).toBe(true);
	expect(Cause.findErrorOption(cause)).toMatchObject({_tag: "Some", value: {_tag: "GrantError"}});
};
it("grant command rejects malformed outside URLs as GrantError before fetching or signing", async () => {
	const invalid = fc.oneof(
		fc.string().map((s) => `relative-${encodeURIComponent(s)}`),
		fc.constantFrom("http://[", "http://%", "http://[::1", "https://"),
	);
	await fc.assert(
		fc.asyncProperty(invalid, async (url) => {
			const argv = process.argv;
			const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
			process.argv = [
				process.execPath,
				"grant.ts",
				"client",
				url,
				"public-fingerprint",
				"--code=made-up",
				"--key=unused-key-path",
			];
			try {
				cli.work = undefined;
				vi.resetModules();
				await import("../grant.ts");
				expect(cli.work).toBeDefined();
				typed(await Effect.runPromiseExit(cli.work!));
				expect(fetch).not.toHaveBeenCalled();
			} finally {
				process.argv = argv;
				fetch.mockRestore();
			}
		}),
		{seed: 119120, numRuns: 20, examples: [["http://["]]},
	);
});
