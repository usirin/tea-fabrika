import {Effect, Layer} from "effect";
import {expect, it} from "vitest";
import {HostJobs, openJobs} from "../../host/host-jobs.ts";
import {ear} from "../../program/ear.ts";
import {listed} from "../../program/listed.ts";
import {defineProgram, fork, start, tell} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {Programs, programList} from "../../shell/programs.ts";
import {type Printed, type Ready, tsh} from "../../shell/shell.ts";
import {turnProgram} from "./turn.ts";

// T237 review 2, finding 5. Today's version. A is shown; B waits behind it; the agent
// withdraws B. Use the real turn's output declaration and its non-waiting form to clear B.
// A must still be the question the person answers. No private queue is read by this law.
it("T237-R2-5: withdrawing queued B twice keeps one prompt for A and routes y to A", async () => {
	const answers: string[] = [];
	const story = defineProgram({
		name: "ask-story",
		description: "Two asks, with the second withdrawn before the person answers the first.",
		inputs: {allow: turnProgram.inputs.allow},
		outputs: {ask: turnProgram.outputs.ask, status: turnProgram.outputs.status},
		main: ({send, serve}) =>
			Effect.gen(function* () {
				yield* send("ask", {name: "scout", ask: "edit-a", title: "Write a.txt", answer: "waiting"});
				yield* send("ask", {name: "scout", ask: "edit-b", title: "Write b.txt", answer: "waiting"});
				// The turn's current protocol spells a withdrawn question as a non-waiting refusal.
				yield* send("ask", {name: "scout", ask: "edit-b", title: "Write b.txt", answer: "refused"});
				yield* send("ask", {name: "scout", ask: "edit-b", title: "Write b.txt", answer: "refused"});
				yield* send("status", {name: "scout", text: "B was withdrawn"});
				yield* serve({
					allow: fork(({ask, allow}: {ask: string; allow: boolean; by: string}) =>
						Effect.gen(function* () {
							answers.push(ask);
							yield* send("ask", {
								name: "scout",
								ask,
								title: ask === "edit-a" ? "Write a.txt" : "Write b.txt",
								answer: allow ? "allowed" : "refused",
							});
							yield* send("status", {name: "scout", text: "person answered"});
						}),
					),
				});
			}),
	});
	await Effect.runPromise(
		Effect.gen(function* () {
			const storage = memoryStorage();
			const jobs = yield* openJobs(storage);
			const asked = ear<{n: number; text: string | null}>();
			const printed = ear<Printed>();
			const status = ear<unknown>();
			const ready = ear<Ready>();
			const started = yield* start(
				tsh,
				{show: "short"},
				{asked: asked.hear, printed: printed.hear, status: status.hear, ready: ready.hear},
				{id: "tsh:cancel-queued-ask", storage},
			).pipe(
				Effect.provideService(HostJobs, {...jobs, owner: "t1", by: "user:owner"}),
				Effect.provideService(Programs, programList([listed(story, Layer.empty)])),
			);

			if (started.kind !== "running") {
				return yield* Effect.die("tsh did not start");
			}

			yield* tell(started.run, "line", "ask-story");
			yield* status.upTo(1);
			expect(ready.values).toEqual([]);
			expect.soft(asked.values.at(-1)?.text).toContain("Write a.txt");
			expect.soft(asked.values.some((a) => a.text?.includes("Write b.txt"))).toBe(false);
			expect(printed.values.filter((p) => p.text.includes("allow? [y/N]"))).toHaveLength(1);
			const n = asked.values[0]!.n;
			yield* tell(started.run, "answer", {n, allow: true});
			yield* status.upTo(2);
			expect(answers).toEqual(["edit-a"]);
			expect(asked.values.at(-1)?.text).toBeNull();
		}).pipe(Effect.scoped),
	);
});
