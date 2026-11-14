/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
// After build, review runs each temporary plant and restores by copy:
// L1 bootstrap a loaded job; accept mismatched argv. L2 return at bootout; remove before absence.
// L3 accept any nonzero print; erase causes. L4 remove semaphore; accept a stale Cmd id.
// L5 remove deadlines; succeed at timeout; choose another port. L6 replace foreign bytes; skip sync.
// L5 after build: accept matching replies at the deadline; replace Timeout with an asynchronous delivery error.
// L7 unconditional KeepAlive; interpolate argv; inherit env. L8 drop a pending absence Cmd when saving.
// L9 keep records only in memory; delete before acknowledgement.
// L10 expose stderr/raw causes in errors, Model, URLs, logs, spans, plist and durable content, one output at a time.
// L11 CI checks the public types. L12's rule plants ran in this tests step.
// L14 ignore invalid settings; bypass declared providers.
// Lead runs L13 and its disposable host plants: no KeepAlive, stop on controller release,
// leave a detached child, and return at bootout. Observe each over three declared throttle intervals.
// P19 next/. No duplicate lifecycle: controlled OS services feed the real driver.
import { Effect, Layer } from "effect";
import { Digest } from "effect/crypto";
import * as Declarations from "../settings/Declarations.ts";
import * as Snapshot from "../settings/Snapshot.ts";
import * as Sources from "../settings/Sources.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import * as ControlTest from "./BrainControl.test-support.ts";
import * as Managed from "./BrainServiceManaged.ts";

export const timing = Effect.fn("BrainServiceTest.timing")(function* (flags: Record<string, string> = {}) {
  const resolved = yield* Sources.resolve(Declarations.all, {
    flags: Sources.flags({
      "desktop.brain-poll": "1",
      "desktop.brain-start-timeout": "20",
      "desktop.brain-stop-timeout": "20",
      ...flags,
    }),
    env: Sources.env({}),
    repo: Sources.file("repo", { value: {}, spans: [] }),
    person: Sources.file("person", { value: {}, spans: [] }),
  });
  return yield* Snapshot.make(Declarations.all, resolved).pipe(Effect.provide(Digest.layerWebCrypto));
});

export const layer = (
  outside: Effect.Success<ReturnType<typeof ControlTest.make>>,
  settings: Snapshot.Snapshot,
  sink: SpanSink["Service"] = {
    batch: (work) => work,
    flush: Effect.succeed({ sent: 0 }),
    check: Effect.void,
    summaries: () => Effect.succeed([]),
    sums: () => Effect.succeed([]),
  },
) =>
  Managed.layer(ControlTest.spec, settings).pipe(
    Layer.provide(
      Layer.mergeAll(
        outside.control,
        outside.probe,
        Layer.succeed(SpanSink, sink),
        RecordManager.memory(1_000_000),
        Archive.memory,
      ),
    ),
  );
