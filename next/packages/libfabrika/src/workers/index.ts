import {Effect, Option, Schema} from "effect";
import type {Asset} from "../app/built.ts";
import {
	Declaration,
	workerExecution,
	type ExecutionCalls,
	type ProgramSource,
} from "../app/execution.ts";
import {ProgramDown} from "../app/program.ts";
export type {ProgramSource} from "../app/execution.ts";
export {workerSql} from "../data/worker-sql.ts";

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
		// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader describes its checked declaration through RPC
		const raw = yield* Effect.tryPromise({
			try: () => rpc.describe(),
			catch: () => new ProgramDown({why: "load"}),
		});
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

/** Answer a request from the brain's embedded window files. Nothing else is read: an unknown route is 404. */
export const serveAsset = (assets: Readonly<Record<string, Asset>>, request: Request) =>
	Effect.sync(() => {
		const route = new URL(request.url).pathname;
		const asset = Object.hasOwn(assets, route) ? assets[route] : undefined;
		if (asset === undefined) return new Response("Not found", {status: 404});
		if (request.method !== "GET" && request.method !== "HEAD")
			return new Response("Method not allowed", {status: 405, headers: {allow: "GET, HEAD"}});
		return new Response(request.method === "HEAD" ? null : asset.body, {
			headers: {"content-type": asset.type, etag: `"${asset.hash}"`},
		});
	}).pipe(Effect.withSpan("brain.asset"));
