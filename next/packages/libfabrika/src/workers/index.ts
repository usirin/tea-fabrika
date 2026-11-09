import {Effect, Option, Schema} from "effect";
import {
	Declaration,
	workerExecution,
	type ExecutionCalls,
	type ProgramSource,
} from "../app/execution.ts";
import {ProgramDown} from "../app/program.ts";
export type {ProgramSource} from "../app/execution.ts";
export {workerSql} from "../data/worker-sql.ts";
export {fetch, serveAsset} from "./fetch.ts";

type Calls = Rpc.WorkerEntrypointBranded &
	Required<ExecutionCalls> & {
		readonly describe: () => Promise<unknown>;
	};

export const workerLoader = (
	loader: WorkerLoader,
	programs: Readonly<Record<string, ProgramSource>>,
) => ({
	load: Effect.fn("loader.load")(function* (name: string, process: string) {
		const code = Object.hasOwn(programs, name) ? programs[name] : undefined;
		if (code === undefined) return yield* new ProgramDown({why: "no_program"});
		const worker = loader.get(`${code.hash}/${process}`, () => ({
			compatibilityDate: "2026-10-12",
			// Worker Loader reads an ES module only from a ".js" name; ".mjs" fails to load.
			mainModule: "program.js",
			modules: {"program.js": code.source},
			env: {},
			globalOutbound: null,
		}));
		const rpc = worker.getEntrypoint<Calls>();
		const fail = () => new ProgramDown({why: "load"});
		// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader describes its checked declaration through RPC
		const work = Effect.tryPromise({try: () => rpc.describe(), catch: fail});
		const raw = yield* work;
		const declaration = yield* Schema.decodeUnknownEffect(Declaration)(raw).pipe(
			Effect.mapError(() => new ProgramDown({why: "load"})),
		);
		return {
			execution: workerExecution(rpc),
			declaration,
			hash: code.hash,
			handler: () => Option.none(),
		};
	}),
});
