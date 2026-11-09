import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import * as fc from "fast-check";
import {Asset, sha256} from "../app/built.ts";
import {serveAsset, workerLoader} from "./index.ts";

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

it("embedded assets keep their headers on GET and HEAD, refuse writes and ignore inherited routes", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.nat(),
			fc.string(),
			fc.constantFrom("text/javascript; charset=utf-8", "text/css; charset=utf-8"),
			async (id, body, type) => {
				const route = `/asset${id}.js`;
				const asset = await Effect.runPromise(Asset.makeEffect({hash: sha256(body), type, body}));
				const assets = {[route]: asset};
				for (const method of ["GET", "HEAD"]) {
					const response = await Effect.runPromise(
						serveAsset(assets, new Request(`https://test.invalid${route}?v=${id}`, {method})),
					);
					expect(response.status).toBe(200);
					expect(response.headers.get("content-type")).toBe(type);
					expect(response.headers.get("etag")).toBe(`"${asset.hash}"`);
					expect(await response.text()).toBe(method === "HEAD" ? "" : body);
					if (method === "HEAD") expect(response.body).toBeNull();
				}
				for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
					const response = await Effect.runPromise(
						serveAsset(assets, new Request(`https://test.invalid${route}`, {method})),
					);
					expect(response.status).toBe(405);
					expect(response.headers.get("allow")).toBe("GET, HEAD");
				}
				const inherited = Object.setPrototypeOf({}, assets);
				for (const table of [{}, inherited]) {
					const response = await Effect.runPromise(
						serveAsset(table, new Request(`https://test.invalid${route}`)),
					);
					expect(response.status).toBe(404);
				}
			},
		),
		{seed: 119120},
	);
});
