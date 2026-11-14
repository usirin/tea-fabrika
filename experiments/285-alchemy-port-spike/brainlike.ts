// Experiment 285, next/. A Worker shaped like the brain after slice S8: Alchemy bundles it, its
// build plugins arrive as props, and it serves the real program table with libfabrika's own
// `serveAsset`. Node imports this file to plan the stack, so the table, which exists only inside
// the bundle, is imported where only workerd runs. So is the `.tsx` file: Node cannot load one.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { serveAsset } from "@kampus/libfabrika/workers";
import { Effect } from "effect";
import { HttpBody, HttpServerResponse } from "effect/http";
import { BuildInput } from "./build-input.ts";

export class BrainLike extends Cloudflare.Worker<BrainLike, Record<never, never>>()("BrainLike285") {}

const raw = (response: Response) =>
  HttpServerResponse.setBody(HttpServerResponse.empty({ status: response.status }), HttpBody.raw(response));

const sha = (text: string) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  });

export default BrainLike.make(
  BuildInput.pipe(
    Effect.map((input) => ({
      main: import.meta.url,
      dev: { host: "127.0.0.1" },
      compatibility: { date: "2026-10-12" },
      build: {
        input: {
          ...(input.plugins === undefined ? {} : { plugins: [...input.plugins] }),
          ...(input.alias === undefined ? {} : { resolve: { alias: { ...input.alias } } }),
        },
        ...(input.output === undefined ? {} : { output: input.output }),
      },
    })),
  ),
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const request = yield* Cloudflare.Request;
      const url = new URL(request.url);
      // @ts-expect-error -- the module exists only in the bundle, where the table plugin makes it
      const built: typeof import("virtual:fabrika-built") = yield* Effect.promise(
        () => import("virtual:fabrika-built"),
      );

      const { Badge } = yield* Effect.promise(() => import("./view.tsx"));

      if (url.pathname === "/table") {
        const programs: Record<string, { hash: string; same: boolean; bytes: number }> = {};

        for (const [name, program] of Object.entries(built.programs)) {
          programs[name] = {
            hash: program.hash,
            same: (yield* sha(program.source)) === program.hash,
            bytes: program.source.length,
          };
        }

        return yield* HttpServerResponse.json({
          programs,
          assets: Object.keys(built.assets).length,
          badge: typeof Badge,
        });
      }

      return raw(yield* serveAsset(built.assets, request));
    }).pipe(Effect.orDie),
  }),
);
