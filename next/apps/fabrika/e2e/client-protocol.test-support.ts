// P18 slice 1, next/ (ticket 290): law L9's one suite and its two backends. The suite drives a real
// local instance through one round trip; each backend only turns its actions and observations into
// the suite's words. The browser backend is a Chromium tab, built in `client-protocol.test.ts` where
// Playwright's Promises may be met; the headless one is the library's own `Headless.start` in this
// process, on Node's global WebSocket, with a key the test makes.
import { checklistWindow } from "@kampus/checklist/window";
import { Id } from "@kampus/libfabrika";
import * as Headless from "@kampus/libfabrika/client/Headless";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { ClientKey, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { type ClientRow, ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import { Effect, Layer, Option, Schema } from "effect";
import { type Dev, grant, type Home, reader, type Waiting } from "./p14.test-support.ts";

export const NAME = "checklist:1";
const TILES = [{ id: "tile_1", name: NAME }];

/** One row of the checklist as the backend shows it. */
export type Row = { readonly name: string; readonly checked: boolean };

/** What the suite asks of a client, whatever draws it. */
export type Backend = {
  readonly name: "browser" | "headless";
  /** Waits until the client shows its waiting code, and reads it. */
  readonly waiting: Effect.Effect<Waiting>;
  /** Waits until the client is online with its checklist tile open. */
  readonly online: Effect.Effect<void>;
  /** Whether the client is online now. */
  readonly live: Effect.Effect<boolean>;
  /** Submits one `add` through the tile, as a person or a program would. */
  readonly add: (name: string) => Effect.Effect<void>;
  /** The checklist's rows the client shows now. */
  readonly shown: Effect.Effect<ReadonlyArray<Row>>;
  /** How many sockets the client has dialed so far. */
  readonly dials: () => number;
};

/** The suite's own failure: a wait that ran out, named by what it waited for. */
export class SuiteError extends Schema.TaggedError<SuiteError>()("SuiteError", { waited: Schema.String }) {}

/** Polls `check` every 250 ms for at most 60 s. */
const until = (label: string, check: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let n = 0; n < 240; n++) {
      if (yield* check) {
        return;
      }

      yield* Effect.sleep("250 millis");
    }

    return yield* new SuiteError({ waited: label });
  });

/** The one round trip: dial, wait, grant, sign the hello, ping in text, open, submit, read back. */
export const roundTrip = (h: Home, dev: Dev, backend: Backend) =>
  Effect.gen(function* () {
    const w = yield* backend.waiting;
    const first = backend.dials();
    const granted = yield* grant(h, w);

    if (!granted.ok) {
      return yield* new SuiteError({ waited: `${backend.name}: the person's grant` });
    }

    // The door admits only a hello signed with the waiting key, so online means the hello was signed.
    yield* backend.online;
    // Text `ping` keeps the link: a socket-level ping frame gets no `pong` text and the link stalls.
    yield* Effect.sleep("12 seconds");
    const kept = (yield* backend.live) && backend.dials() === first;
    // One `add` goes through the real `process.send`, and its checked view comes back.
    yield* backend.add("milk");
    yield* until(
      `${backend.name}: milk in the view`,
      Effect.map(backend.shown, (rows) => rows.some((r) => r.name === "milk" && !r.checked)),
    );
    const r = yield* reader(h, dev);
    const inbox = yield* r.read(`${NAME}/inbox`);
    const sent = inbox.filter((e) => Reflect.get(Object(Reflect.get(Object(e.body), "m")), "name") === "milk");
    return { first, kept, sent: sent.length };
  });

/** The library's headless client in this process: the same machine and start as the tab. */
export const headlessBackend = (dev: Dev, key: Identity) =>
  Effect.gen(function* () {
    const rows: Array<ClientRow> = [];
    const window = windowMachineFor({
      decode: () => Schema.decodeUnknownSync(checklistWindow.data),
      tile: () => undefined,
    });
    const booting = yield* Headless.start({ tiles: TILES, window, origin: dev.url, build: "p18-headless" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ClientKey, {
            current: () => Effect.succeed(key),
            claimPersist: Effect.succeed(false),
            persist: Effect.succeed(true),
          }),
          Layer.succeed(ClientRows, { put: (row: ClientRow) => Effect.sync(() => void rows.push(row)) }),
          Id.Generator.layer,
        ),
      ),
    );
    const run = yield* booting.ready;
    let dials = 0;
    let last: number | null = null;
    const count = () => {
      const link = run.getState().link;
      const dial = "dial" in link && link._tag !== "retrying" ? link.dial : null;

      if (dial !== null && dial !== last) {
        last = dial;
        dials++;
      }

      return dials;
    };
    const state = Effect.sync(() => {
      count();
      return run.getState();
    });
    const backend: Backend = {
      name: "headless",
      waiting: until(
        "headless: the waiting code",
        Effect.map(state, (s) => s.link._tag === "waiting_grant"),
      ).pipe(
        Effect.andThen(state),
        Effect.map((s) => {
          const link = s.link;
          const code = link._tag === "waiting_grant" ? link.code : "";
          return { line: "", url: dev.url, fingerprint: key.fingerprint, code };
        }),
        Effect.orDie,
      ),
      online: until(
        "headless: online with its tile open",
        Effect.map(state, (s) => s.link._tag === "online" && s.tiles[0]?.reach._tag === "open"),
      ).pipe(Effect.orDie),
      live: Effect.map(state, (s) => s.link._tag === "online"),
      add: (name) =>
        run.dispatch({ type: "press", tile: "tile_1", m: { type: "add", name }, via: "button" }).pipe(Effect.orDie),
      shown: Effect.map(state, (s) => {
        const pid = s.tiles[0]?.last;
        const view = pid ? s.client.views[pid]?.view : undefined;
        const data = Option.getOrUndefined(Schema.decodeUnknownOption(checklistWindow.data)(view));
        return (data?.items ?? []).map((i) => ({ name: i.name, checked: i.state === "checked" }));
      }),
      dials: count,
    };
    return backend;
  });
