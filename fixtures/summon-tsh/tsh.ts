import {HostJobs, listed, memoryStorage, openJobs, Shell, start, tell} from "@kampus/fabrika-old";
import {summonManager, turnProgram} from "@kampus/fabrika-old/agents/summon";
import {fileStorage} from "@kampus/fabrika-old/storage/node";
import {Effect, Layer} from "effect";

// A real host for T237's restart law. Only the fake ACP agent runs here.
const [home, folder, line] = process.argv.slice(2);
if (home === undefined || folder === undefined || line === undefined)
	throw new Error("usage: tsh.ts <home> <repo> <line>");

const storage = fileStorage(home);
process.exitCode = await Effect.runPromise(
	Effect.gen(function* () {
		const manager = yield* Shell.SummonManager;
		const jobs = yield* openJobs(storage);
		let status = 0;
		const started = yield* start(
			Shell.tsh,
			{show: "json"},
			{
				printed: ({to, text}) => (to === "err" ? process.stderr : process.stdout).write(`${text}\n`),
				ready: (ready) => {
					status = ready.status;
				},
			},
			{id: "tsh:fixture", storage: memoryStorage()},
		).pipe(
			Effect.provideService(HostJobs, {...jobs, owner: "t1", by: "user:owner"}),
			Effect.provideService(
				Shell.Programs,
				Shell.programList([listed(turnProgram, Layer.succeed(Shell.SummonManager, manager))]),
			),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		for (const text of line.split("\n")) yield* tell(started.run, "line", text);
		started.close("line");
		yield* started.run.ended;
		return status;
	}).pipe(Effect.scoped, Effect.provide(summonManager({storage, folder}))),
);
