/**
 * Narrow decoding of launchctl's non-API print output.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { BrainControlError, Command, Status, Unsupported } from "../../desktop/BrainControl.ts";

const Response = Schema.Struct({
  target: Schema.String.check(Schema.isPattern(/^gui\/[0-9]+\/[a-zA-Z0-9._-]+$/u)),
  code: Schema.Int,
  stdout: Schema.Redacted(Schema.String),
  stderr: Schema.Redacted(Schema.String),
});

const scalar = (value: string) => value.length > 0 && !/["\\{}\p{Cc}]/u.test(value) && value === value.trim();

/**
 * Accepts exact absence or a complete, unambiguous job description.
 *
 * @stability unstable
 * @category decoding
 */
export const decode = Effect.fnUntraced(function* (input: typeof Response.Type) {
  const failed = (cause: unknown) =>
    new BrainControlError({ reason: new Unsupported({ cause: Redacted.make(cause) }) });
  const response = yield* Schema.decodeUnknownEffect(Response)(input).pipe(Effect.mapError(failed));
  // oxlint-disable-next-line fabrika/no-redacted-value -- edge: parse protected native output; return checked job fields and keep failures protected
  const out = Redacted.value(response.stdout);
  // oxlint-disable-next-line fabrika/no-redacted-value -- edge: compare the exact absence response without exposing native diagnostics
  const err = Redacted.value(response.stderr);
  const [, uid, label] = response.target.split("/");

  if (response.code !== 0) {
    if (
      response.code === 113 &&
      out === "" &&
      err === `Could not find service "${label}" in domain for user gui: ${uid}\n`
    ) {
      return Status.cases.absent.make({});
    }

    return yield* new BrainControlError({
      reason: new Command({ code: response.code, cause: Redacted.make(response) }),
    });
  }

  if (err !== "") {
    return yield* failed(response);
  }

  const lines = out.trimEnd().split("\n");

  if (lines.shift() !== `${response.target} = {` || lines.pop() !== "}") {
    return yield* failed(response);
  }

  const fields = new Map<string, string>();
  const sections = new Set<string>();
  const args: Array<string> = [];
  const env = new Map<string, string>();
  const stack: Array<string> = [];
  let argumentPrefix = "";

  for (const line of lines) {
    const text = line.trimStart();

    if (text === "") {
      continue;
    }

    if (text === "}") {
      if (stack.length === 0) {
        return yield* failed(response);
      }

      stack.pop();
      continue;
    }

    const section = /^([^=]+?)\s*=\s*\{$/u.exec(text);

    if (section !== null) {
      const name = (section[1] ?? "").trim();

      if (stack.length === 0) {
        if (sections.has(name) || fields.has(name)) {
          return yield* failed(response);
        }

        sections.add(name);

        if (name === "arguments") {
          const indentation = line.slice(0, line.length - text.length);

          if (!/^\t+$/u.test(indentation)) {
            return yield* failed(response);
          }

          argumentPrefix = `${indentation}\t`;
        }
      } else if (stack[0] === "arguments" || stack[0] === "environment") {
        return yield* failed(response);
      }

      stack.push(name);
      continue;
    }

    if (stack.length === 1 && stack[0] === "arguments") {
      const argument = line.slice(argumentPrefix.length);

      if (!line.startsWith(argumentPrefix) || !scalar(argument)) {
        return yield* failed(response);
      }

      args.push(argument);
      continue;
    }

    if (stack.length === 1 && stack[0] === "environment") {
      const pair = /^([^=]+?)\s*=> (.*)$/u.exec(text);

      if (pair === null || env.has((pair[1] ?? "").trim()) || !scalar(pair[2] ?? "")) {
        return yield* failed(response);
      }

      env.set((pair[1] ?? "").trim(), pair[2] ?? "");
      continue;
    }

    if (stack.length === 0) {
      const pair = /^([^=]+?)\s*= (.*)$/u.exec(text);

      if (pair === null || fields.has((pair[1] ?? "").trim()) || sections.has((pair[1] ?? "").trim())) {
        return yield* failed(response);
      }

      fields.set((pair[1] ?? "").trim(), pair[2] ?? "");
    }
  }

  const executable = fields.get("program"),
    home = env.get("FABRIKA_HOME"),
    configuration = env.get("FABRIKA_BUILD");
  const pid = fields.get("pid");

  if (
    stack.length !== 0 ||
    executable === undefined ||
    !scalar(executable) ||
    !sections.has("arguments") ||
    args[0] !== executable ||
    args.length < 2 ||
    home === undefined ||
    configuration === undefined ||
    env.get("ELECTRON_RUN_AS_NODE") !== "1" ||
    !["running", "waiting"].includes(fields.get("state") ?? "") ||
    (pid !== undefined && !/^[1-9][0-9]*$/u.test(pid))
  ) {
    return yield* failed(response);
  }

  const checkedPid = yield* Schema.decodeUnknownEffect(Status.cases.loaded.fields.pid)(
    pid === undefined ? null : Number(pid),
  ).pipe(Effect.mapError(failed));
  return Status.cases.loaded.make({
    executable,
    args: args.slice(1),
    home,
    configuration,
    pid: checkedPid,
  });
});
