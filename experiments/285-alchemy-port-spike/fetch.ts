// Experiment 285, next/. Questions 1 and 2: an Effect `fetch` and `ctx.props` on an Effect Worker
// that Alchemy bundles, and `Control` as a branch of that one `fetch`.
import { Deferred, Effect } from "effect";
import * as fc from "fast-check";
import { call, json, run, save, start } from "./harness.ts";
import { type Build, prebuild, stack } from "./stacks.ts";

const TOKEN = "t-285-secret";

const checks = (build: Build) =>
  Effect.scoped(
    Effect.gen(function* () {
      const ports = yield* Deferred.make<Record<string, number>>();
      const built = build === "prebuilt" ? yield* prebuild : undefined;
      const sockets = [
        { name: "spike-control", props: { token: TOKEN } },
        // Today's form, for the prebuilt file only: a named entrypoint class.
        ...(build === "prebuilt" ? [{ name: "spike-named", entrypoint: "Control", props: { token: TOKEN } }] : []),
      ];
      const began = performance.now();
      const out = (yield* start(stack(build, sockets, ports, built?.file))) as { url: string };
      const listening = yield* Deferred.await(ports);
      const control = `http://127.0.0.1:${listening["spike-control"]}`;
      const named =
        build === "prebuilt"
          ? yield* call(`http://127.0.0.1:${listening["spike-named"]}/programs`, {
              headers: { authorization: `Bearer ${TOKEN}` },
            })
          : undefined;
      const door = out.url.replace(/\/$/, "");
      const first = yield* json(`${door}/props`);
      const startMs = Math.round(performance.now() - began);

      // 1. The Effect fetch, and ctx.props, from both sides.
      const outside = first;
      const inside = yield* call(`${control}/programs`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const noBearer = yield* call(`${control}/programs`);
      const wrongBearer = yield* call(`${control}/programs`, { headers: { authorization: "Bearer nope" } });
      // The public port with the right bearer: the token alone is not enough.
      const bearerOnly = yield* call(`${door}/props`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const minted = yield* json(`${door}/mint`);

      // 2. No request from outside carries props, whatever it sends. Seeded, 300 requests.
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
      const names = [
        "props",
        "cf-props",
        "x-props",
        "cf-worker",
        "cf-ew-via",
        "cf-connecting-ip",
        "x-forwarded-for",
        "authorization",
        "token",
        "x-token",
        "cf-access-jwt-assertion",
        "mf-props",
        "x-alchemy-props",
      ];
      const values = [
        TOKEN,
        `Bearer ${TOKEN}`,
        JSON.stringify({ token: TOKEN }),
        JSON.stringify({ json: JSON.stringify({ token: TOKEN }) }),
        "Control",
        "user-worker",
      ];
      const requests = fc.sample(
        fc.record({
          method: fc.constantFrom(...methods),
          path: fc.constantFrom("/props", "/props?props=%7B%22token%22%3A%22x%22%7D", `/props?token=${TOKEN}`),
          headers: fc.dictionary(fc.constantFrom(...names), fc.constantFrom(...values), { maxKeys: 5 }),
          body: fc.constantFrom(...values),
        }),
        { seed: 119120, numRuns: 300 },
      );
      let carried = 0;
      let answered = 0;
      const statuses: Record<string, number> = {};
      const unsent: Record<string, number> = {};

      for (const request of requests) {
        const reply = yield* Effect.promise(() =>
          fetch(`${door}${request.path}`, {
            method: request.method,
            headers: request.headers,
            ...(request.method === "GET" || request.method === "OPTIONS" ? {} : { body: request.body }),
          }).then(
            async (r) => ({ status: r.status, text: await r.text() }),
            (error: unknown) => ({ status: 0, text: String(error instanceof Error ? (error.cause ?? error) : error) }),
          ),
        );

        if (reply.status === 0) {
          unsent[reply.text.slice(0, 80)] = (unsent[reply.text.slice(0, 80)] ?? 0) + 1;
        }

        statuses[String(reply.status)] = (statuses[String(reply.status)] ?? 0) + 1;
        answered += reply.status === 200 ? 1 : 0;
        carried += reply.text.includes('"branch":"control"') ? 1 : 0;
      }

      // 3. The object's request slot: a raw Request in, a raw Response out, and a socket upgrade.
      const rawReply = yield* call(`${door}/object/hello`, { method: "POST", body: "body-1" });
      const socket = yield* Effect.promise(
        () =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(`${door.replace("http", "ws")}/object/socket`);
            const timer = setTimeout(() => resolve("timeout"), 5000);
            ws.addEventListener("open", () => ws.send("ping-1"));
            ws.addEventListener("message", (event) => {
              clearTimeout(timer);
              ws.close();
              resolve(String(event.data));
            });
            ws.addEventListener("error", () => {
              clearTimeout(timer);
              resolve("error");
            });
          }),
      );

      return {
        build,
        built,
        startMs,
        namedClass: named === undefined ? undefined : { status: named.status, body: named.text },
        outside,
        control: { status: inside.status, body: inside.text },
        controlNoBearer: { status: noBearer.status, body: noBearer.text },
        controlWrongBearer: { status: wrongBearer.status, body: wrongBearer.text },
        publicPortWithBearer: { status: bearerOnly.status, body: bearerOnly.text },
        minted,
        outsideRequests: { sent: requests.length, answered200: answered, reachedControl: carried, statuses, unsent },
        objectRaw: { status: rawReply.status, body: rawReply.text, header: rawReply.headers.get("x-raw") },
        objectSocket: socket,
      };
    }),
  );

await run(
  Effect.gen(function* () {
    const bundled = yield* checks("bundled");
    const prebuilt = yield* checks("prebuilt");
    yield* save("fetch", { bundled, prebuilt });
  }),
);
