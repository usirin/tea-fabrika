import {defineProgram, start, tell} from "@tea-fabrika/tea-program";
import {ear} from "@tea-fabrika/tea-program/ear";
import {output} from "@tea-fabrika/tea-program/shape";
import {misfit} from "@tea-fabrika/wip/asks/packs";
import {asksProgram, Built, type Cleared, type Raise} from "@tea-fabrika/wip/asks/program";
import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import pack, {BY, fakeShots, Seen, uiProgram, visibleOf} from "./index.ts";

// The ui pack on its own: which builds it lets go, which it asks about, and
// that a core it cannot hold refuses it. No owner-desk here: it names none.

const SEEN = [/\.(tsx|jsx|css|html)$/, /^src\/ui\//];
const PLAN = "https://github.com/kamp-us/demlik/issues/367";

describe("the ui-verification pack", () => {
	it("a user sees .tsx, .css and anything under src/ui; not code or docs", () => {
		expect(
			visibleOf(
				["src/ui/inbox.ts", "web/page.tsx", "web/site.css", "src/fold.ts", "docs/a.md"],
				SEEN,
			),
		).toEqual(["src/ui/inbox.ts", "web/page.tsx", "web/site.css"]);
	});

	it("clears a build no user sees, and asks about one they do, with before and after", async () => {
		const cleared = ear<Cleared>();
		const raised = ear<Raise>();
		await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(uiProgram, {}, {cleared: cleared.hear, raise: raised.hear});
				if (started.kind !== "running") return yield* Effect.die(started.why);
				tell(started.run, "built", {plan: PLAN, task: 1, build: 1, changes: ["src/fold.ts"]});
				tell(started.run, "built", {plan: PLAN, task: 2, build: 1, changes: ["src/ui/inbox.tsx"]});
				yield* cleared.upTo(1);
				yield* raised.upTo(1);
				yield* started.stop;
			}).pipe(
				Effect.scoped,
				Effect.provide(Layer.mergeAll(fakeShots("shots"), Layer.succeed(Seen, {patterns: SEEN}))),
				Effect.timeout("5 seconds"),
			),
		);
		expect(cleared.values).toEqual([{plan: PLAN, task: 1, build: 1, by: BY}]);
		expect(raised.values[0]?.attachments.map((a) => a.label)).toEqual([
			"before",
			"after",
			"the change, 10 seconds",
		]);
	});

	it("fits the core it holds, and is refused by a core with no holds flag", () => {
		expect(misfit(asksProgram, pack)).toBeNull();
		const unheld = defineProgram({
			name: "unheld",
			description: "Says builds and cannot wait on anyone.",
			inputs: {},
			outputs: {built: output(Built, "Each build.")},
			main: () => Effect.void,
		});
		expect(misfit(unheld, pack)).toBe(
			"it holds what it hears, and the core has no holds flag to wait on it",
		);
	});
});
