/**
 * The two plain helpers an object's Layer uses to hand calls to its service.
 *
 * @stability unstable
 */
import { Context, Effect, type Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { settingsWire } from "./runtime.ts";
import * as SettingsRuntime from "./SettingsRuntime.ts";

/**
 * Creates the Effect an object's Layer reads its service through.
 *
 * **Details**
 *
 * Calling `make` builds nothing. The first run of the returned Effect builds `ready`, and every
 * later run reads the same service. A failed build is not kept: the next run builds again. A
 * failed build fails the run with its wire failure, as `settingsWire` has it: a `StartsError` as
 * `Start.Failure`, and a `LedgerError` as its reason alone.
 *
 * The build is owned by a runtime of its own and not by the scope `make` is called in: Alchemy
 * closes an object's construction scope before the first call reaches it.
 *
 * @stability unstable
 * @category constructors
 */
export const make = <I, S, E>(service: Context.Key<I, S>, ready: Layer.Layer<I, E>) =>
  settingsWire(SettingsRuntime.runtime(ready).contextEffect).contextEffect.pipe(
    Effect.map((services) => Context.get(services, service)),
  );

/**
 * Creates an object's request slot from a handler of the platform's own `Request` and `Response`.
 *
 * **Details**
 *
 * The handler is given the very `Request` the platform delivered, and the slot answers with the
 * handler's own `Response`: a copy of a socket upgrade's answer would lose its socket. A failed
 * handler dies, so Alchemy answers a 5xx that carries none of the failure's text.
 *
 * @stability unstable
 * @category constructors
 */
export const fromWebHandler = <E>(handler: (request: Request) => Effect.Effect<Response, E>) =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((request) => HttpServerRequest.toWeb(request)),
    Effect.flatMap(handler),
    Effect.map((response) => HttpServerResponse.raw(response)),
    Effect.orDie,
  );
