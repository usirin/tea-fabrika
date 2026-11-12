// L3, next/. launchctl print is deliberately decoded narrowly; unknown text never means absent.
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import * as Status from "./LaunchdStatus.ts";

const target = "gui/501/test.p19.brain";
const Word = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_雪 -]{0,18}[a-zA-Z0-9雪]$/));

const print = (word: string, pid: number | null) =>
  `${target} = {\n\tpath = /test/${word}/brain.plist\n\ttype = LaunchAgent\n\tstate = ${pid === null ? "waiting" : "running"}\n\tprogram = /test/${word}/Electron\n\targuments = {\n\t\t/test/${word}/Electron\n\t\t/test/${word}/brain.mjs\n\t}\n\tenvironment = {\n\t\tFABRIKA_HOME => /test/${word}\n\t\tELECTRON_RUN_AS_NODE => 1\n\t\tFABRIKA_BUILD => build-a\n\t}\n${pid === null ? "" : `\tpid = ${pid}\n`}\tproperties = runatload\n}\n`;

const decode = (code: number, stdout: string, stderr = "") =>
  Status.decode({ target, code, stdout: Redacted.make(stdout), stderr: Redacted.make(stderr) });

const error = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : null);

it.effect.prop(
  "L3 loaded waiting and running jobs retain exact checked fields",
  [Word, Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })))],
  ([word, pid]) =>
    Effect.gen(function* () {
      const value = yield* decode(0, print(word, pid));
      expect(value).toMatchObject({
        _tag: "loaded",
        executable: `/test/${word}/Electron`,
        args: [`/test/${word}/brain.mjs`],
        home: `/test/${word}`,
        pid,
      });
    }),
  { arbitrary: { seed: 119120, numRuns: 200 } },
);

it.effect.prop(
  "L3 only the exact missing-service response, including code 113, confirms absence",
  [Word],
  ([word]) =>
    Effect.gen(function* () {
      const missing = `Could not find service "test.p19.brain" in domain for user gui: 501\n`;
      expect(yield* decode(113, "", missing)).toEqual({ _tag: "absent" });
      const invalid = [
        [113, "", `Could not find service "other-${word}" in domain for user gui: 501\n`],
        [113, "", `Could not find service "test.p19.brain" in domain for user gui: 502\n`],
        [113, "", "Could not find domain for user gui: 501\n"],
        [1, "", "Operation not permitted\n"],
        [5, "", "Input/output error\n"],
        [0, "", ""],
        [113, "", word],
      ] as const;

      for (const [code, out, err] of invalid) {
        const failure = error(yield* decode(code, out, err).pipe(Effect.exit));
        expect(failure).toMatchObject({ _tag: "BrainControlError", reason: { cause: expect.anything() } });
      }
    }),
  { arbitrary: { seed: 119120, numRuns: 200 } },
);

it("L3 missing, duplicate, nested, ambiguous and wrong-target fields fail Unsupported", () => {
  fc.assert(
    fc.property(
      fc.record({
        mutation: fc.constantFrom(
          "missing-program",
          "duplicate-program",
          "nested-program",
          "argument",
          "target",
          "duplicate-pid",
          "truncated",
        ),
        word: fc.stringMatching(/^[a-z]{1,20}$/),
      }),
      ({ mutation, word }) => {
        const text = print(word, 81);
        const broken =
          mutation === "missing-program"
            ? text.replace(/\tprogram = .*\n/, "")
            : mutation === "duplicate-program"
              ? text.replace("\ttype =", `\tprogram = /test/${word}/Electron\n\ttype =`)
              : mutation === "nested-program"
                ? text.replace(/\tprogram = .*\n/, `\tunrelated = {\n\t\tprogram = /test/${word}/Electron\n\t}\n`)
                : mutation === "argument"
                  ? text.replace(`/test/${word}/brain.mjs`, 'unbalanced "argument')
                  : mutation === "target"
                    ? text.replace(target, "gui/502/foreign")
                    : mutation === "duplicate-pid"
                      ? text.replace("\tpid = 81", "\tpid = 82\n\tpid = 81")
                      : text.slice(0, -3);
        const exit = Effect.runSync(decode(0, broken).pipe(Effect.exit));
        expect(error(exit)).toMatchObject({
          _tag: "BrainControlError",
          reason: { _tag: "Unsupported", cause: expect.anything() },
        });
      },
    ),
    { seed: 119120, numRuns: 200 },
  );
});
