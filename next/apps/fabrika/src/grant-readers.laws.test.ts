// P12, next/. The real command is captured at its NodeRuntime edge; no process or socket starts.
import { grantText } from "@kampus/libfabrika/access/Text";
import { Cause, Effect, Exit, Layer, Option, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  work: undefined as Effect.Effect<unknown, unknown> | undefined,
  layer: undefined as Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> | undefined,
}));

vi.mock("@effect/platform-node", async (original) => {
  const actual = await original<typeof import("@effect/platform-node")>();
  return {
    ...actual,
    NodeServices: {
      get layer() {
        return Layer.merge(actual.NodeServices.layer, cli.layer ?? Layer.empty);
      },
    },
    NodeRuntime: {
      runMain: (work: Effect.Effect<unknown, unknown>) => {
        cli.work = work;
      },
    },
  };
});

const typed = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.hasFails(cause)).toBe(true);
  const error = Cause.findErrorOption(cause);
  expect(error).toMatchObject({ _tag: "Some", value: { _tag: "GrantError", reason } });
  expect(Option.getOrUndefined(error)).toBeInstanceOf(Error);
};

it("grant command rejects malformed outside URLs as GrantError before fetching or signing", async () => {
  const invalid = fc.oneof(
    fc.string().map((s) => `relative-${encodeURIComponent(s)}`),
    fc.constantFrom("http://[", "http://%", "http://[::1", "https://"),
  );
  await fc.assert(
    fc.asyncProperty(invalid, async (url) => {
      const argv = process.argv;
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
      process.argv = [
        process.execPath,
        "grant.ts",
        "client",
        url,
        "public-fingerprint",
        "--code=made-up",
        "--key=unused-key-path",
      ];

      try {
        cli.work = undefined;
        vi.resetModules();
        await import("../grant.ts");
        expect(cli.work).toBeDefined();
        typed(await Effect.runPromiseExit(cli.work!), "bad_url");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        process.argv = argv;
        fetch.mockRestore();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [["http://["]] },
  );
});

const usage = "usage: grant.ts client URL KEY --code=CODE --key=PATH";

it("grant usage guard names the error for each missing argument or flag", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), fc.integer({ min: 0, max: 4 }), async (text, missing) => {
      const args = ["client", "http://127.0.0.1:18787", "public-fingerprint", `--code=${text}`, "--key=unused-path"];

      if (missing === 0) {
        args[0] = `wrong-${text}`;
      } else if (missing === 1) {
        args.splice(1, 2);
      } else {
        args.splice(missing, 1);
      }

      // Removing the URL also removes its following positional argument so the CLI cannot shift it.
      const argv = process.argv;
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
      process.argv = [process.execPath, "grant.ts", ...args];

      try {
        vi.resetModules();
        await import("../grant.ts");
        typed(await Effect.runPromiseExit(cli.work!), usage);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        process.argv = argv;
        fetch.mockRestore();
      }
    }),
    { seed: 119120, numRuns: 25 },
  );
});

const generated = fc.record({
  fingerprint: fc.string(),
  code: fc.string(),
  label: fc.option(fc.string(), { nil: undefined }),
  target: fc.record({
    key: fc.string(),
    for: fc.string(),
    to: fc.string(),
    code: fc.string(),
    label: fc.string(),
  }),
  armored: fc.string(),
  exit: fc.integer({ min: 1, max: 255 }),
  badTarget: fc.jsonValue().filter(
    (raw) =>
      raw !== null &&
      !Schema.is(
        Schema.Struct({
          key: Schema.String,
          for: Schema.String,
          to: Schema.String,
          code: Schema.String,
          label: Schema.String,
        }),
      )(raw),
  ),
  badReply: fc.jsonValue().filter((raw) => !Schema.is(Schema.Record(Schema.String, Schema.Json))(raw)),
});

const results = {
  get: "unreachable",
  json: "bad_target",
  target: "bad_target",
  waiting: "not_waiting",
  sign: "sign_failed",
  post: "unreachable",
  status: "refused",
  replyJson: "bad_reply",
  reply: "bad_reply",
  refused: "refused",
  applied: null,
} as const;

for (const mode of Object.keys(results) as Array<keyof typeof results>) {
  it(`grant ${mode} path preserves the signed fields and exact error reason`, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async (data) => {
        const commands: Array<ChildProcess.Command> = [];
        const signed: Array<string> = [];
        cli.layer = Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) =>
            Effect.gen(function* () {
              commands.push(command);

              if (!ChildProcess.isStandardCommand(command) || !Stream.isStream(command.options.stdin)) {
                return yield* Effect.die("expected streamed signing input");
              }

              signed.push(yield* Stream.mkString(Stream.decodeText(command.options.stdin)));
              const stdout = Stream.make(new TextEncoder().encode(data.armored));
              return ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(27000),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(mode === "sign" ? data.exit : 0)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout,
                stderr: Stream.empty,
                all: stdout,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              });
            }),
          ),
        );
        const calls: Array<[unknown, RequestInit | undefined]> = [];
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
          calls.push([url, options]);

          if (options?.method === "POST") {
            if (mode === "post") {
              throw new Error("post unavailable");
            }

            if (mode === "status") {
              return new Response("refused", { status: 403 });
            }

            if (mode === "replyJson") {
              return new Response("{");
            }

            return Response.json(
              mode === "reply" ? data.badReply : { _tag: mode === "refused" ? "refused" : "applied" },
            );
          }

          if (mode === "get") {
            throw new Error("get unavailable");
          }

          if (mode === "json") {
            return new Response("{");
          }

          return Response.json(mode === "target" ? data.badTarget : mode === "waiting" ? null : data.target);
        });
        const argv = process.argv;
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        process.argv = [
          process.execPath,
          "grant.ts",
          "client",
          "http://127.0.0.1:18787/ignored?q=ignored",
          data.fingerprint,
          `--code=${data.code}`,
          "--key=unused-signing-path",
          ...(data.label === undefined ? [] : [`--label=${data.label}`]),
        ];

        try {
          vi.resetModules();
          await import("../grant.ts");
          const before = Date.now();
          const exit = await Effect.runPromiseExit(cli.work!);
          const reason = results[mode];

          if (reason === null) {
            expect(Exit.isSuccess(exit)).toBe(true);
          } else {
            typed(exit, reason);
          }

          expect(calls[0]).toEqual([
            `http://127.0.0.1:18787/grant/client/${encodeURIComponent(data.fingerprint)}?code=${encodeURIComponent(data.code)}`,
            undefined,
          ]);
          const signs = !["get", "json", "target", "waiting"].includes(mode);
          expect(commands).toHaveLength(signs ? 1 : 0);

          if (signs) {
            expect(commands[0]).toMatchObject({
              command: "ssh-keygen",
              args: ["-Y", "sign", "-n", "fabrika-client", "-f", "unused-signing-path"],
            });
            const text = signed[0]!;
            const change = JSON.parse(text);
            expect(change._tag).toBe("granted");
            const grant = change.grant;
            expect(grant).toEqual({
              id: expect.stringMatching(/^[0-9a-f-]{36}$/),
              key: data.target.key,
              for: data.target.for,
              to: data.target.to,
              as: "window",
              saw: {
                code: data.target.code,
                label: data.label ?? data.target.label,
                location: "local",
                method: "command",
                check: "none",
                has: [],
              },
              sentAt: expect.any(String),
            });
            expect(Date.parse(grant.sentAt)).toBeGreaterThanOrEqual(before);
            expect(Date.parse(grant.sentAt)).toBeLessThanOrEqual(Date.now());
            expect(text).toBe(grantText(grant));
          }

          const posts = signs && mode !== "sign";
          expect(calls).toHaveLength(posts ? 2 : 1);

          if (posts) {
            expect(calls[1]).toEqual([
              "http://127.0.0.1:18787/grant",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: signed[0], armored: data.armored }),
              },
            ]);
          }

          if (mode === "applied") {
            expect(log).toHaveBeenCalledWith(`Granted ${data.fingerprint} to ${data.target.for}`);
          } else {
            expect(log).not.toHaveBeenCalled();
          }
        } finally {
          process.argv = argv;
          cli.layer = undefined;
          fetch.mockRestore();
          log.mockRestore();
        }
      }),
      { seed: 119120, numRuns: 12 },
    );
  });
}

it("grant reports bad_args when the CLI refuses unknown flags", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (flag) => {
      const argv = process.argv;
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
      process.argv = [process.execPath, "grant.ts", `--unknown-${flag}`];

      try {
        vi.resetModules();
        await import("../grant.ts");
        typed(await Effect.runPromiseExit(cli.work!), "bad_args");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        process.argv = argv;
        fetch.mockRestore();
      }
    }),
    { seed: 119120, numRuns: 10 },
  );
});
