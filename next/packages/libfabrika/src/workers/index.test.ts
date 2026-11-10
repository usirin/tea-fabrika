import {createHash} from "node:crypto";
import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import * as fc from "fast-check";
import {workerLoader} from "./index.ts";
import type {BrainOptions, Env} from "./runtime.ts";

const unexpected = () => {
	throw new Error("unknown program reached Worker Loader");
};

it("an unknown program is refused before the Worker Loader is called", async () => {
	await fc.assert(
		fc.asyncProperty(fc.string(), fc.string(), (name, process) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const loader = workerLoader({get: unexpected, load: unexpected}, {});
					expect(yield* Effect.flip(loader.load(name, process))).toMatchObject({
						_tag: "ProgramDown",
						why: "no_program",
					});
				}),
			),
		),
		{seed: 119120, examples: [["missing", "process-test"]]},
	);
});

// P16. Builder contract: `workers/index.ts` exports `serveAsset(assets, request)`, and `fetch`
// takes the embedded asset table as its fourth argument. Nothing is read from disk.
type Asset = {readonly hash: string; readonly type: string; readonly body: string};
type Assets = Readonly<Record<string, Asset>>;

type Api = {
	readonly serveAsset?: (assets: Assets, request: Request) => Effect.Effect<Response, unknown>;
	readonly fetch: (
		request: Request,
		env: Env,
		config: BrainOptions,
		assets?: Assets,
	) => Effect.Effect<Response, unknown>;
};

const load = async () => {
	const api: Api = await import("./index.ts");
	expect(api.serveAsset, "P16 not built: libfabrika/workers serves no embedded asset").toBeTypeOf(
		"function",
	);
	return {...api, serveAsset: api.serveAsset!};
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const assets = fc.record({
	id: fc.nat(),
	body: fc.string({unit: "grapheme"}),
	type: fc.constantFrom("text/javascript; charset=utf-8", "text/css; charset=utf-8"),
});

it("embedded assets keep their headers on GET and HEAD, refuse writes and ignore inherited routes", async () => {
	const {serveAsset} = await load();
	await fc.assert(
		fc.asyncProperty(assets, async ({id, body, type}) => {
			const route = `/asset${id}.js`;
			const asset = {hash: sha(body), type, body};
			const table = {[route]: asset};

			for (const method of ["GET", "HEAD"]) {
				const response = await Effect.runPromise(
					serveAsset(table, new Request(`https://test.invalid${route}?v=${id}`, {method})),
				);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toBe(type);
				expect(response.headers.get("etag")).toBe(`"${asset.hash}"`);
				expect(await response.text()).toBe(method === "HEAD" ? "" : body);

				if (method === "HEAD") {
					expect(response.body).toBeNull();
				}
			}

			for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
				const response = await Effect.runPromise(
					serveAsset(table, new Request(`https://test.invalid${route}`, {method})),
				);
				expect(response.status).toBe(405);
				expect(response.headers.get("allow")).toBe("GET, HEAD");
			}

			// Plant: a lookup through the prototype chain, or an empty table that falls back.
			const inherited = Object.setPrototypeOf({}, table);

			for (const empty of [{}, inherited]) {
				const response = await Effect.runPromise(
					serveAsset(empty, new Request(`https://test.invalid${route}`)),
				);
				expect(response.status).toBe(404);
			}
		}),
		{seed: 119120},
	);
});

it("fetch serves the embedded table on GET and HEAD only after its host and origin checks; an unknown window path is 404", async () => {
	const {fetch} = await load();
	await fc.assert(
		fc.asyncProperty(
			assets,
			fc.integer({min: 1024, max: 65535}),
			fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/),
			async ({id, body, type}, port, missing) => {
				const route = `/window${id}.js`;
				const table = {[route]: {hash: sha(body), type, body}};
				const config: BrainOptions = {
					name: "project-test",
					port,
					person: "person-test",
					founder: "public-test",
					window: null,
					build: "build-test",
				};
				// An asset request calls no binding: each double fails the law if one is called.
				const refuse = () => {
					throw new Error("an asset request reached a binding");
				};
				const stub = new Proxy({}, {get: () => refuse});
				// oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles stand in for the two namespaces fetch can name
				const env = {
					GATEWAY: {getByName: () => stub},
					PROJECT: {getByName: () => stub},
				} as unknown as Env;
				const origin = `http://127.0.0.1:${port}`;
				const request = (path: string, headers: Record<string, string>, method = "GET") =>
					new Request(`${origin}${path}`, {headers, method});
				const host = {host: `127.0.0.1:${port}`};
				const served = await Effect.runPromise(fetch(request(route, host), env, config, table));
				expect(served.status).toBe(200);
				expect(served.headers.get("content-type")).toBe(type);
				expect(await served.text()).toBe(body);
				const head = await Effect.runPromise(
					fetch(request(route, host, "HEAD"), env, config, table),
				);
				expect(head.status).toBe(200);
				expect(head.headers.get("content-type")).toBe(type);
				expect(head.headers.get("etag")).toBe(`"${sha(body)}"`);
				expect(head.body).toBeNull();
				const wrongHost = await Effect.runPromise(
					fetch(request(route, {host: `127.0.0.2:${port}`}), env, config, table),
				);
				expect(wrongHost.status).toBe(421);
				const foreign = await Effect.runPromise(
					fetch(request(route, {...host, origin: "https://elsewhere.invalid"}), env, config, table),
				);
				expect(foreign.status).toBe(403);
				const unknown = await Effect.runPromise(
					fetch(request(`/missing-${missing}.js`, host), env, config, table),
				);
				expect(unknown.status, "an unknown window path is not the brain's text answer").toBe(404);
			},
		),
		{seed: 119120, numRuns: 30},
	);
});
