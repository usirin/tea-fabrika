// Experiment 148's host, inside the project's Durable Object: one tsh per person, with its
// programs, on the object's own storage. It names no platform: the object hands it a key-value
// store, a way to print, a way to note a fact on the ledger, and a way to run a job in a box.
//
//   const s = await openSession({who: "github:1", kv, boxes, out, fact});
//   await s.line("counter &");          // [1] counter:7f3a...   the prompt is back at once
//   await s.line("tell %1 press plus");  // the count is 1, kept in the object's storage
//   await s.line("box --run 'node /app/ask.mjs hello'");
//   // a box starts for this one job; its call to the model gets this person's key outside it
//
// Nothing here outlives the object in memory. The object is evicted when idle; the next message
// opens the session again on the same storage, and every job the last tsh had comes back as
// "detached": `openSession` attaches each again in the background (`attach %n &`), where it left
// off. A job is its storage, not a fiber.
import {defineMachine} from "@demlik/tea";
import {
	defineProgram,
	flag,
	kind,
	listed,
	memoryStorage,
	offer,
	output,
	Shell,
	start,
	storageOf,
} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";
import {Context, Effect, Exit, Layer, Schema, Scope, Stream} from "effect";
import {KeyValueStore} from "effect/persistence";

// ---------------------------------------------------------------- the job box, as a program

/** What a box job comes to: what it printed, and how it ended. */
export interface Ended {
	readonly said: string;
	readonly code: number;
}

/** Run one job in a box of its own. `job` is the job's id: asked again, the same job answers, never a second box. */
export class Boxes extends Context.Service<
	Boxes,
	{readonly run: (job: string, cmd: string) => Effect.Effect<Ended>}
>()("exp148/Boxes") {}

interface BoxState {
	readonly job: string | null;
	readonly ended: Ended | null;
}
type BoxMsg =
	| {readonly type: "began"; readonly job: string}
	| {readonly type: "ended"; readonly ended: Ended};

/** The job's id and its end, kept, so a run attached again after an eviction asks for the same box. */
const boxMachine = defineMachine({
	types: {model: {} as BoxState, msg: {} as BoxMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {job: null, ended: null}, []],
	update: {
		began: (s, m) => [{...s, job: m.job}, []],
		ended: (s, m) => [{...s, ended: m.ended}, []],
	},
});

export const box = defineProgram({
	name: "box",
	description:
		"Runs one command in a box of its own, and says what it printed. The box goes when it ends.",
	flags: {run: flag(Schema.String, "The command, run by sh in the box.")},
	inputs: {},
	outputs: {said: output(Schema.String, "What the command printed, and how it ended.")},
	machines: {
		job: kind({
			machine: boxMachine,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "job", steps: {}}),
			status: (s) => (s.ended === null ? `running ${s.job ?? ""}` : `ended ${s.ended.code}`),
		}),
	},
	main: ({flags, send, machines}) =>
		Effect.gen(function* () {
			const boxes = yield* Boxes;
			const m = yield* machines.job.get("job").start();
			if (m.getState().job === null)
				yield* m.dispatch({type: "began", job: crypto.randomUUID()}).pipe(Effect.orDie);
			const job = m.getState().job ?? "";
			if (m.getState().ended === null) {
				const ended = yield* boxes.run(job, flags.run);
				yield* m.dispatch({type: "ended", ended}).pipe(Effect.orDie);
			}
			const ended = m.getState().ended ?? {said: "", code: -1};
			yield* send("said", `${ended.said.trimEnd()} (exit ${ended.code})`);
		}).pipe(Effect.scoped),
});

// ---------------------------------------------------------------- storage on the object

/** The object's synchronous key-value store, as much of it as this needs. */
export interface Kv {
	get<T = unknown>(key: string): T | undefined;
	put<T>(key: string, value: T): void;
	delete(key: string): boolean;
	list<T = unknown>(options?: {prefix?: string}): Iterable<[string, T]>;
}

/** Web Storage over the object's store, under one prefix: what Effect's `layerStorage` takes. */
const webStorageOn = (kv: Kv, prefix: string): Storage => {
	const keys = () => [...kv.list<string>({prefix})].map(([k]) => k.slice(prefix.length));
	return {
		get length() {
			return keys().length;
		},
		key: (i) => keys()[i] ?? null,
		getItem: (k) => kv.get<string>(prefix + k) ?? null,
		setItem: (k, v) => kv.put(prefix + k, v),
		removeItem: (k) => {
			kv.delete(prefix + k);
		},
		clear: () => {
			for (const k of keys()) kv.delete(prefix + k);
		},
	};
};

// ---------------------------------------------------------------- one person's tsh

export interface Session {
	readonly who: string;
	/** A whole line, typed on the laptop: tsh reads it as it reads a line from its terminal. */
	readonly line: (text: string) => Promise<void>;
	/** How long opening took, in ms: tsh started and every detached job attached again. */
	readonly openMs: number;
	/** The jobs attached again at this open. */
	readonly attached: readonly number[];
	readonly close: () => Promise<void>;
}

/** One job, as the ledger is told it. */
const factOf = (job: Shell.Job) => ({
	n: job.n,
	text: job.text,
	state: job.state,
	background: job.background,
	runs: job.stages.map((s) => s.run),
});

export const openSession = async (o: {
	readonly who: string;
	readonly kv: Kv;
	readonly boxes: Boxes["Service"];
	/** tsh printed this, or its prompt is back (`ready`). */
	readonly out: (
		m: {readonly type: "printed"; readonly text: string} | {readonly type: "ready"},
	) => void;
	/** Note a fact on the project's ledger, for this person. */
	readonly fact: (kind: string, data: unknown) => void;
}): Promise<Session> => {
	const t0 = Date.now();
	const scope = Effect.runSync(Scope.make());
	const jobs = storageOf(KeyValueStore.layerStorage(() => webStorageOn(o.kv, `s:${o.who}:`)));
	const programs = Shell.programList([
		...Shell.SMALL,
		listed(counter, Layer.empty),
		listed(box, Layer.succeed(Boxes, o.boxes)),
	]);
	const told = new Map<number, string>();
	const tell = (table: Shell.Jobs) => {
		const now = new Map(table.jobs.map((j) => [j.n, factOf(j)] as const));
		for (const [n, fact] of now) {
			const text = JSON.stringify(fact);
			if (told.get(n) === text) continue;
			o.fact(told.has(n) ? "job_moved" : "job_began", fact);
			told.set(n, text);
		}
		for (const n of [...told.keys()])
			if (!now.has(n)) {
				o.fact("job_left", {n});
				told.delete(n);
			}
	};
	const readies: (() => void)[] = [];
	const opened = Effect.gen(function* () {
		const started = yield* start(
			Shell.tsh,
			{show: "short"},
			{
				printed: (p) => o.out({type: "printed", text: p.text}),
				ready: () => {
					const r = readies.shift();
					// The empty line's answer is the host's own: the page is not told of it.
					if (r !== undefined) r();
					else o.out({type: "ready"});
				},
			},
			{id: `tsh:${o.who}`, storage: memoryStorage()},
		).pipe(
			Effect.provideService(Shell.Programs, programs),
			Effect.provideService(Shell.JobStorage, jobs),
		);
		if (started.kind !== "running")
			return yield* Effect.die(`tsh refused its flags: ${started.why}`);
		const table = () => started.run.machines.jobs.state();
		// What the last tsh left is known now: the ledger is told only of what moves after this.
		for (const j of table()?.jobs ?? [])
			told.set(j.n, JSON.stringify(factOf({...j, state: "running"})));
		yield* started.run.machines.jobs.changes.pipe(
			Stream.runForEach((t) => Effect.sync(() => (t === null ? undefined : tell(t)))),
			Effect.forkScoped,
		);
		// tsh marks the last tsh's jobs detached as it starts, then reads its first line. An empty
		// line, read and answered, says that is done.
		const answered = new Promise<void>((r) => readies.push(r));
		yield* offer(started.run, "line", "");
		yield* Effect.promise(() => answered);
		// Every job of the last tsh runs again, in the background, where it left off.
		const detached = (table()?.jobs ?? []).filter((j) => j.state === "detached").map((j) => j.n);
		for (const n of detached) yield* offer(started.run, "line", `attach %${n} &`);
		return {started, detached};
	});
	const {started, detached} = await Effect.runPromise(
		opened.pipe(Effect.provideService(Scope.Scope, scope)),
	);
	return {
		who: o.who,
		openMs: Date.now() - t0,
		attached: detached,
		line: (text) => Effect.runPromise(offer(started.run, "line", text).pipe(Effect.asVoid)),
		close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
	};
};
