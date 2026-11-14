// next/, L5: real workerd storage and alarms cannot be exercised by the pure machine laws.
// Edge: Effect has no SSH public-key generation API.
import { createHash, generateKeyPairSync } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Clock, Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PROJECT = "scheduled-job-alarm";
const NAME = "beat:1";
// P40: a build table key is `pack/program`, the name the fixture pack declares.
const PROGRAM = "schedules/beat";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const WAIT = 25_000;

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const until = <A>(label: string, look: Effect.Effect<A, unknown>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    const end = (yield* Clock.currentTimeMillis) + WAIT;
    let last: A | undefined;

    while ((yield* Clock.currentTimeMillis) < end) {
      last = yield* look;

      if (done(last)) {
        return last;
      }

      yield* Effect.sleep("50 millis");
    }

    return yield* Effect.die(new Error(`${label}: timed out; last observed ${JSON.stringify(last)}`));
  });

const Beat = Schema.Struct({
  _tag: Schema.Literal("beat"),
  body: Schema.Struct({ due: Schema.Number, period: Schema.Int }),
});

const Letter = Schema.Struct({
  id: Schema.String,
  pos: Schema.Int,
  body: Schema.Struct({ m: Schema.Unknown }),
});

const Timer = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number });

const View = Schema.Struct({
  rev: Schema.Number,
  view: Schema.Union([
    Schema.TaggedStruct("idle", { next: Schema.Number, period: Schema.Int }),
    Schema.TaggedStruct("running", { due: Schema.Number, period: Schema.Int }),
  ]),
});

it("scenario: L5 real local alarms write three beats and save the idle model's next wake", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "sjob-" });
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = {
            home: process.env.FABRIKA_HOME,
            alchemy: process.env.ALCHEMY_HOME,
            tracking: process.env.DO_NOT_TRACK,
          };
          process.env.FABRIKA_HOME = home;
          process.env.DO_NOT_TRACK = "1";
          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            for (const [key, value] of [
              ["FABRIKA_HOME", previous.home],
              ["ALCHEMY_HOME", previous.alchemy],
              ["DO_NOT_TRACK", previous.tracking],
            ] as const) {
              if (value === undefined) {
                delete process.env[key];
              } else {
                process.env[key] = value;
              }
            }
          }),
      );
      const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
      const { build } = yield* Effect.promise(() => import("./build.ts"));
      const { localInstance } = yield* Effect.promise(() => import("./local-instance.ts"));
      const pair = generateKeyPairSync("ed25519");
      const raw = pair.publicKey.export({ format: "jwk" }).x!;
      const bytes = Buffer.from(raw, "base64url");
      const founder = `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(bytes)]).toString("base64")}`;
      const fingerprint = `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
      yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
      const module = path.join(home, "beat.ts");
      const fixture = path.resolve(import.meta.dirname, "../../../../fixtures/next/packs/schedules/beat.ts");
      // Build beside the app's dependencies; the fixture directory has no package links.
      // The app builder selects `program`; the pack's public export is `beat`.
      yield* fs.writeFileString(module, `${yield* fs.readFileString(fixture)}\nexport { beat as program };\n`);
      const built = yield* build({ out: path.join(home, "dist"), programs: { [PROGRAM]: module } });
      const code = built.programs[PROGRAM];
      expect(code).toBeDefined();
      yield* Effect.gen(function* () {
        const held = yield* Effect.acquireRelease(heldPort(), (port) => port.release);
        const options = RecordWireTest.startupFixture({
          home,
          name: PROJECT,
          person: PERSON,
          founder,
          window: raw,
          port: held.port,
        });
        const instance = yield* localInstance(built, options);
        const from: From = {
          by: fingerprint,
          for: PERSON,
          sentAt: "2026-11-11T00:00:00.000Z",
          seen: 0,
          parent: null,
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          build: built.build,
        };
        const started = yield* Effect.promise(() =>
          Reflect.get(instance.project(PROJECT), "start")(
            { _tag: "first", id: "start-beat", name: NAME, code: { program: PROGRAM, hash: code!.hash } },
            from,
          ),
        );
        const pid = Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
        const beats = yield* until(
          "three beat facts",
          Effect.promise(() => Reflect.get(instance.project(PROJECT), "read")("beats", 0, "audit")).pipe(
            Effect.map(Schema.decodeUnknownSync(Schema.Array(Beat))),
          ),
          (rows) => rows.length >= 3,
        );
        expect(beats.length).toBeGreaterThanOrEqual(3);

        for (let index = 1; index < beats.length; index++) {
          expect(beats[index]!.body.due).toBeGreaterThan(beats[index - 1]!.body.due);
        }

        for (const beat of beats) {
          expect(beat.body.period).toBeGreaterThan(0);
        }

        const rows = Schema.decodeUnknownSync(Schema.Array(Letter))(
          yield* Effect.promise(() => Reflect.get(instance.project(PROJECT), "read")(`${NAME}/inbox`, 0, "audit")),
        );
        const timers = rows.filter((row) => Schema.is(Timer)(row.body.m));
        expect(timers.length).toBeGreaterThanOrEqual(3);
        expect(new Set(timers.map((row) => row.id)).size).toBe(timers.length);

        for (const row of timers) {
          const timer = Schema.decodeUnknownSync(Timer)(row.body.m);
          // format: the runner writes a timer letter's id as `<process>/due/<at>/<pos>`, with the inbox
          // position whose model asked for this wake, so the same wake asked for again is a new
          // letter (P14 slice 2, plan amendment A-Timer-4). The letter itself lands next, at `pos + 1`.
          expect(row.id).toBe(`${pid}/due/${timer.at}/${row.pos - 1}`);
        }

        for (const beat of beats) {
          expect(timers.some((row) => row.id === `${pid}/due/${beat.body.due}/${row.pos - 1}`)).toBe(true);
        }

        // Bracket the alarm read with views: retry when a tick crosses the observation.
        const stable = yield* until(
          "stable idle view around saved alarm",
          Effect.gen(function* () {
            const before = Schema.decodeUnknownSync(View)(
              yield* Effect.promise(() => Reflect.get(instance.process(pid), "open")("scheduled-job-observer")),
            );
            const alarm = yield* Effect.promise(() => Reflect.get(instance.process(pid), "savedAlarm")());
            const after = Schema.decodeUnknownSync(View)(
              yield* Effect.promise(() => Reflect.get(instance.process(pid), "open")("scheduled-job-observer")),
            );
            return { before, alarm, after };
          }),
          ({ before, after }) => before.view._tag === "idle" && after.view._tag === "idle" && before.rev === after.rev,
        );
        expect(stable.before.view._tag).toBe("idle");

        if (stable.before.view._tag === "idle") {
          expect(stable.alarm).toBe(stable.before.view.next);
        }
      }).pipe(Effect.provide(localState()));
    }).pipe(Effect.scoped, Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(NodeServices.layer)),
  );
}, 180_000);
