import {Effect} from "effect";
import {LedgerError} from "../data/index.ts";
import {GatewayClient, ProjectClient} from "./platform.ts";
import {projectStub, rpc, type BrainOptions, type Env} from "./runtime.ts";

export const fetch = Effect.fn("workers.fetch")(function* (
	request: Request,
	env: Env,
	config: BrainOptions,
) {
	const url = new URL(request.url),
		origin = `http://127.0.0.1:${config.port}`;

	if (request.headers.get("host") !== new URL(origin).host) {
		return new Response("Wrong host", {status: 421});
	}

	if (request.headers.get("origin") !== null && request.headers.get("origin") !== origin) {
		return new Response("Foreign origin", {status: 403});
	}

	if (url.pathname.startsWith("/client/")) {
		return yield* rpc(GatewayClient.make(env.GATEWAY.getByName(url.pathname)).fetch(request));
	}

	const project = ProjectClient.make(projectStub(env, config.name));

	if (url.pathname === "/grant" && request.method === "POST") {
		// oxlint-disable-next-line fabrika/no-promises -- edge: Request JSON body enters Effect
		const input = yield* Effect.tryPromise({try: () => request.json(), catch: () => null});
		return Response.json(yield* rpc(project.grant(input)));
	}

	if (url.pathname.startsWith("/grant/client/") && request.method === "GET") {
		const target = yield* Effect.try({
			try: () => decodeURIComponent(url.pathname.slice("/grant/client/".length)),
			catch: () => new LedgerError({why: "bad_row"}),
		});
		return Response.json(yield* rpc(project.target(target, url.searchParams.get("code") ?? "")));
	}

	return new Response("fabrika", {headers: {"content-type": "text/plain"}});
});
