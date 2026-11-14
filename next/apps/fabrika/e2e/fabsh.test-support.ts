import { builtins, read } from "@kampus/fabsh/read";
import { drawn, type tile } from "@kampus/fabsh/tile";
import { fabshWindow, said } from "@kampus/fabsh/window";
// fabsh in a tile, slice 1, next/: law L17's one suite and its headless backend (docs/plan/lanes/
// fabsh-PLAN.md, "Laws"). The suite drives a real local instance: a person types `hlep` key by key,
// each letter shows before its echo, the reason shows, the person fixes it to `help`, presses Enter,
// and `help`'s answer is in the scrollback; a reload keeps the scrollback and the history. Each
// backend only turns its actions and observations into the suite's words, as `client-protocol`'s
// suite does. Written before `@kampus/fabsh` and the `fabsh:1` tile; until the build adds them, this
// file fails on its missing import. It needs Alchemy, workerd and Chromium, so it runs in CI's
// end-to-end job, never on a laptop step.
import { Id } from "@kampus/libfabrika";
import * as Headless from "@kampus/libfabrika/client/Headless";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { ClientKey, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { type ClientRow, ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import { Effect, Layer, Option, Schema } from "effect";
import { SuiteError } from "./client-protocol.test-support.ts";
import { type Dev, grant, type Home, reader, type Waiting } from "./p14.test-support.ts";

export const FABSH = "fabsh:1";
const TILES = [{ id: "tile_f", name: FABSH }];

/** What the suite asks of a client, whatever draws it. */
export type Backend = {
  readonly name: "browser" | "headless";
  readonly waiting: Effect.Effect<Waiting>;
  /** Waits until the client is online with its fabsh tile open. */
  readonly online: Effect.Effect<void>;
  /** Holds every draft echo until `release`, so a letter can be seen before its echo. */
  readonly hold: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
  /** Types one letter at the end of the line, as a person's key does. */
  readonly key: (letter: string) => Effect.Effect<void>;
  /** Moves the cursor back over the whole line and types it again as `line`. */
  readonly retype: (line: string) => Effect.Effect<void>;
  readonly enter: Effect.Effect<void>;
  /** The line the tile draws now: its span layer's text. */
  readonly drawn: Effect.Effect<string>;
  /** Whether the newest letter's echo has not come back yet. */
  readonly unechoed: Effect.Effect<boolean>;
  /** The words tied to the line: its accessible description. */
  readonly description: Effect.Effect<string>;
  /** The scrollback's entries, as their lines. */
  readonly scroll: Effect.Effect<ReadonlyArray<string>>;
  /** Up: the line history recall puts in the input. */
  readonly recall: Effect.Effect<string>;
  /** A reload: the same profile and key, a new page or client. */
  readonly reload: Effect.Effect<void>;
};

/** Polls `check` every 100 ms for at most 60 s. */
const until = (label: string, check: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let n = 0; n < 600; n++) {
      if (yield* check) {
        return;
      }

      yield* Effect.sleep("100 millis");
    }

    return yield* new SuiteError({ waited: label });
  });

/** The one walk: grant, type `hlep` key by key, see the reason, fix it, Enter, read the answer, reload. */
export const typeAndRun = (h: Home, dev: Dev, backend: Backend) =>
  Effect.gen(function* () {
    const w = yield* backend.waiting;
    const granted = yield* grant(h, w);

    if (!granted.ok) {
      return yield* new SuiteError({ waited: `${backend.name}: the person's grant` });
    }

    yield* backend.online;
    const before: Array<boolean> = [];
    yield* backend.hold;
    let line = "";

    for (const letter of "hlep") {
      line += letter;
      yield* backend.key(letter);
      // The letter is drawn in the update that takes it, while every echo is held (L5, 0275).
      before.push((yield* backend.drawn) === line && (yield* backend.unechoed));
    }

    yield* backend.release;
    yield* until(
      `${backend.name}: the reason for hlep`,
      Effect.map(backend.description, (d) => d.includes("hlep")),
    );
    const reason = yield* backend.description;
    yield* backend.retype("help");
    yield* until(
      `${backend.name}: help reads clean`,
      Effect.map(backend.description, (d) => d === ""),
    );
    yield* backend.enter;
    yield* until(
      `${backend.name}: help in the scrollback`,
      Effect.map(backend.scroll, (s) => s.includes("help")),
    );
    const r = yield* reader(h, dev);
    const inbox = yield* r.read(`${FABSH}/inbox`);
    const letters = inbox.filter((e) => Reflect.get(Object(Reflect.get(Object(e.body), "m")), "type") === "submitted");
    const typed = JSON.stringify(inbox).includes("hlep");
    yield* backend.reload;
    yield* backend.online;
    yield* until(
      `${backend.name}: the scrollback after a reload`,
      Effect.map(backend.scroll, (s) => s.includes("help")),
    );
    const recalled = yield* backend.recall;
    return {
      before,
      reason,
      letters: letters.map((e) => Reflect.get(Object(Reflect.get(Object(e.body), "m")), "line")),
      typed,
      recalled,
    };
  });

/** The library's headless client in this process: the same machine, start and tile as the tab. */
export const headlessBackend = (dev: Dev, key: Identity) =>
  Effect.gen(function* () {
    const rows: Array<ClientRow> = [];
    const window = windowMachineFor({
      decode: () => Schema.decodeUnknownSync(fabshWindow.data),
      tile: () => fabshWindow.tile,
    });
    const start = () =>
      Headless.start({ tiles: TILES, window, origin: dev.url, build: "fabsh-headless" }).pipe(
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
        Effect.flatMap((booting) => booting.ready),
      );
    let run = yield* start();
    // A headless client has no socket of its own to hold; it reads the moment before any frame is
    // handled, which `dispatch` gives: the tile's update runs before the next frame.
    const own = Effect.sync(() => run.getState().tiles[0]?.own as typeof tile.model.Type);
    const view = Effect.sync(() => {
      const s = run.getState();
      const pid = s.tiles[0]?.last;
      const data = pid ? s.client.views[pid]?.view : undefined;
      return Option.getOrUndefined(Schema.decodeUnknownOption(fabshWindow.data)(data));
    });
    const send = (msg: unknown) => run.dispatch({ type: "tile", id: "tile_f", msg }).pipe(Effect.orDie);
    const text = Effect.map(own, (t) => drawn(t).text);
    const backend: Backend = {
      name: "headless",
      waiting: until(
        "headless: the waiting code",
        Effect.sync(() => run.getState().link._tag === "waiting_grant"),
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const link = run.getState().link;
            return {
              line: "",
              url: dev.url,
              fingerprint: key.fingerprint,
              code: link._tag === "waiting_grant" ? link.code : "",
            };
          }),
        ),
        Effect.orDie,
      ),
      online: until(
        "headless: online with its fabsh tile open",
        Effect.sync(() => run.getState().link._tag === "online" && run.getState().tiles[0]?.reach._tag === "open"),
      ).pipe(Effect.orDie),
      hold: Effect.void,
      release: Effect.void,
      key: (letter) =>
        Effect.flatMap(text, (now) => send({ type: "edited", text: now + letter, cursor: now.length + 1 })),
      retype: (line) => send({ type: "edited", text: line, cursor: line.length }),
      enter: send({ type: "enter" }),
      drawn: text,
      unechoed: Effect.map(own, (t) => t.echoed.n < t.mine.n),
      // The headless client draws no markup: its description is what the window writes for the line
      // it draws, the same reader and the same words.
      description: Effect.map(text, (line) =>
        read(line, { builtins: [...builtins], programs: [] })
          .spans.filter((s) => s.role === "unknown")
          .map((s) => said(s, line))
          .join(" "),
      ),
      scroll: Effect.map(view, (v) => (v?.scroll ?? []).map((e) => e.line)),
      recall: Effect.gen(function* () {
        const v = yield* view;
        yield* send({ type: "recall", to: "back", history: [...(v?.history ?? [])] });
        return yield* text;
      }),
      reload: Effect.gen(function* () {
        run = yield* start();
      }),
    };
    return backend;
  });
