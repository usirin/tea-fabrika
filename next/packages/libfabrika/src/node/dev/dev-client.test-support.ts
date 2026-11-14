// P12, next/. The HTTP client `startDev`'s laws provide, over each run's own `fetch` stub.
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

/**
 * The entry's own client, `FetchHttpClient.layer`, whose `fetch` is the global one at the moment
 * of each request. A real process reads the global once. A law stubs it anew on every run, and
 * the client would keep the first stub it saw.
 */
export const fetchClient = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, (input, init) => globalThis.fetch(input, init))),
);

/** A stubbed `fetch` call's body as text, sent as a string or as the client's bytes. */
export const bodyText = (options: RequestInit | undefined): string =>
  typeof options?.body === "string" ? options.body : new TextDecoder().decode(options?.body as Uint8Array);
