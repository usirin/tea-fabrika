// L3, next/. launchctl print is deliberately decoded narrowly; unknown text never means absent.
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import * as Status from "./LaunchdStatus.ts";

const target = "gui/501/test.p19.brain";
const Word = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_雪 -]{0,18}[a-zA-Z0-9雪]$/));

const print = (word: string, pid: number | null) =>
  `${target} = {\n\tpath = /test/${word}/brain.plist\n\ttype = LaunchAgent\n\tstate = ${pid === null ? "waiting" : "running"}\n\tprogram = /test/${word}/Electron\n\targuments = {\n\t\t/test/${word}/Electron\n\t\t/test/${word}/brain.mjs\n\t}\n\tenvironment = {\n\t\tFABRIKA_HOME => /test/${word}\n\t\tELECTRON_RUN_AS_NODE => 1\n\t\tFABRIKA_BUILD => build-a\n\t}\n${pid === null ? "" : `\tpid = ${pid}\n`}\tproperties = runatload\n}\n`;

// vector: the whole print of a job as a real Mac on macOS 14.3.1 gave it to the L13 host run on 2026-11-13,
// with the test's paths and label in place of the host's.
const real = (state: string, pid: number | null) =>
  [
    `${target} = {`,
    `\tactive count = ${pid === null ? 0 : 1}`,
    "\tpath = /test/home/brain.plist",
    "\ttype = LaunchAgent",
    `\tstate = ${state}`,
    "",
    "\tprogram = /test/Electron",
    "\targuments = {",
    "\t\t/test/Electron",
    "\t\t/test/home/brain.mjs",
    "\t\tspaces & <angles> 雪",
    "\t}",
    "",
    "\tinherited environment = {",
    "\t\tSSH_AUTH_SOCK => /test/Listeners",
    "\t}",
    "",
    "\tdefault environment = {",
    "\t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin",
    "\t}",
    "",
    "\tenvironment = {",
    "\t\tFABRIKA_HOME => /test/home",
    "\t\tFABRIKA_BUILD => build-a",
    "\t\tELECTRON_RUN_AS_NODE => 1",
    "\t\tXPC_SERVICE_NAME => test.p19.brain",
    "\t}",
    "",
    "\tdomain = gui/501 [100016]",
    "\tasid = 100016",
    "\tminimum runtime = 2",
    "\texit timeout = 5",
    "\truns = 1",
    ...(pid === null
      ? ["\tlast exit code = 0"]
      : [
          `\tpid = ${pid}`,
          "\timmediate reason = speculative",
          "\tforks = 0",
          "\texecs = 1",
          "\tinitialized = 1",
          "\ttrampolined = 1",
          "\tstarted suspended = 0",
          "\tproxy started suspended = 0",
          "\tlast exit code = (never exited)",
        ]),
    "",
    "\tsemaphores = {",
    "\t\tsuccessful exit => 0",
    "\t}",
    "",
    "\tspawn type = daemon (3)",
    "\tjetsam priority = 40",
    "\tjetsam memory limit (active) = (unlimited)",
    "\tjetsam memory limit (inactive) = (unlimited)",
    "\tjetsamproperties category = daemon",
    "\tjetsam thread limit = 32",
    "\tcpumon = default",
    "\tprobabilistic guard malloc policy = {",
    "\t\tactivation rate = 1/1000",
    "\t\tsample rate = 1/0",
    "\t}",
    "",
    "\tproperties = runatload | inferred program | system service | tle system",
    "}",
    "",
  ].join("\n");

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
  { arbitrary: { seed: 119120, runs: 200 } },
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
  { arbitrary: { seed: 119120, runs: 200 } },
);

it.effect.each([
  // vector: the output the laws were first written against, without a first line.
  `Could not find service "test.p19.brain" in domain for user gui: 501\n`,
  // vector: what a real Mac on macOS 14.3.1 printed on 2026-11-13, found by the L13 host run.
  `Bad request.\nCould not find service "test.p19.brain" in domain for user gui: 501\n`,
])("vector: L3 a real Mac's missing-service output with code 113 confirms absence", (missing) =>
  Effect.gen(function* () {
    expect(yield* decode(113, "", missing)).toEqual({ _tag: "absent" });

    // The first line is accepted only as that exact line, before the exact missing-service line.
    for (const err of [
      `${missing}Bad request.\n`,
      `Bad request.\n${missing}`.replace("501", "502"),
      `Bad request\n${missing}`,
      "Bad request.\n",
    ]) {
      const failure = error(yield* decode(113, "", err).pipe(Effect.exit));
      expect(failure).toMatchObject({ _tag: "BrainControlError", reason: { _tag: "Command", code: 113 } });
    }
  }),
);

it.effect.each([
  // vector: the four states the L13 host run saw: spawning, running, being stopped, and exited.
  ["xpcproxy", 81],
  ["running", 81],
  ["SIGTERMed", 81],
  ["not running", null],
] as const)("vector: L3 a real Mac's print of a job in state %s is a loaded job", ([state, pid]) =>
  Effect.gen(function* () {
    expect(yield* decode(0, real(state, pid))).toEqual({
      _tag: "loaded",
      executable: "/test/Electron",
      args: ["/test/home/brain.mjs", "spaces & <angles> 雪"],
      home: "/test/home",
      configuration: "build-a",
      pid,
    });
    // A state no Mac has shown us is still refused.
    const failure = error(yield* decode(0, real(`${state} later`, pid)).pipe(Effect.exit));
    expect(failure).toMatchObject({ _tag: "BrainControlError", reason: { _tag: "Unsupported" } });
  }),
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
