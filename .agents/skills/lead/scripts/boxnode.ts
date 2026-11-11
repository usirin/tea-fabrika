// boxnode.ts: the Node a step's box finds first. Today's lead tooling, run on our own laptop; it is
// not product.
//
//   const env = yield* boxEnv(main, process.env); // the agents' parent env, pinned Node first
//   // in the box: `node --version` is v26.13.0, and `pnpm exec node --version` is too
//
// A box's commands get the host's PATH, kept to the folders the box opens (today's fabrika,
// `fencedEnv`). On it, bare `node` reached Volta's shim and bare `pnpm` reached Volta's pnpm
// package, which Volta runs on the Node it was installed with (22 on this laptop), so every step
// had to write `volta run --node 26.13.0` (field note 2026-11-10-22). So the agents start with two
// folders first on that PATH: the pinned Node's own `bin`, found through `volta run --node <pin>`
// with the pin read from the repo's root package.json (`repoNode`), and pnpm's own `bin`, found
// with `volta which pnpm`. That pnpm starts `#!/usr/bin/env node`, so it runs on the pinned Node,
// and so does every command it starts. The box opens both folders, as the toolchain of what is
// first on its PATH (`toolchain`), and drops Volta's shim folder from it: a brief writes a plain
// `node` and `pnpm`.
//
// With no Volta, no pin or an answer that is not the pin, the PATH stays as it is, and one line on
// stderr says why. A PATH here is split on `:`; this tooling runs on macOS and Linux only.

import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The repo's Node: the root package.json's `volta.node`, else its `engines.node`; `null` when neither. */
export const repoNode = Effect.fn("boxnode.repoNode")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(`${dir}/package.json`).pipe(Effect.orElseSucceed(() => ""));
  const pinned = Schema.decodeUnknownOption(Schema.fromJsonString(Pins))(text);
  return Option.isNone(pinned) ? null : (pinned.value.volta?.node ?? pinned.value.engines?.node ?? null);
});

/** An exact version, as `pnpm lint` keeps every pin: never a range for `volta run`. */
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/));

const Pins = Schema.Struct({
  volta: Schema.optional(Schema.Struct({ node: Schema.optional(Version) })),
  engines: Schema.optional(Schema.Struct({ node: Schema.optional(Version) })),
});

/** `path` with `dirs` first, in their order, and each of them gone from the rest. */
export const firstOnPath = (path: string, dirs: readonly string[]): string => {
  const front = [...new Set(dirs.filter((dir) => dir !== ""))];
  const rest = path.split(":").filter((dir) => dir !== "" && !front.includes(dir));
  return [...front, ...rest].join(":");
};

/** The folder above a program's absolute path, or `null` for a path that is not one. */
const holder = (program: string): string | null => {
  const at = program.lastIndexOf("/");
  return program.startsWith("/") && at > 0 ? program.slice(0, at) : null;
};

/**
 * The pinned Node's `bin`, from what `node -p` printed under `volta run --node <pin>`: its
 * `process.execPath`, then its `process.version`. `null` unless that version is the pin.
 */
export const pinnedBin = (said: string, pin: string): string | null => {
  const [execPath = "", version = ""] = said.trim().split("\n");
  return version.trim() === `v${pin}` && execPath.endsWith("/node") ? holder(execPath.trim()) : null;
};

/**
 * pnpm's own `bin`, from what `volta which pnpm` printed: the real program's folder. `null` for
 * anything else, a Volta shim folder (`.volta/bin`) included, since the shim picks its own Node.
 */
export const pnpmBin = (said: string): string | null => {
  const program = said.trim();
  const dir = program.includes("\n") || !program.endsWith("/pnpm") ? null : holder(program);
  return dir === null || dir.endsWith("/.volta/bin") ? null : dir;
};

type Env = Readonly<Record<string, string | undefined>>;

/** One command's stdout in `cwd`; empty when it could not start, so the reader says no. */
const said = (cwd: string, command: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* spawner.string(ChildProcess.make(command, args, { cwd, extendEnv: true, stdin: "ignore" }));
  }).pipe(Effect.orElseSucceed(() => ""));

/** `parent` with the pinned Node's and pnpm's own folders first on its PATH (see the top). */
export const boxEnv = (main: string, parent: Env) =>
  Effect.gen(function* () {
    const pin = yield* repoNode(main);
    const keep = (reason: string) =>
      Effect.sync(() => {
        console.error(`boxnode: ${reason}, so a box keeps the host's PATH as it is`);
        return parent;
      });

    if (pin === null) {
      return yield* keep("the root package.json pins no Node");
    }

    const node = pinnedBin(
      yield* said(main, "volta", ["run", "--node", pin, "node", "-p", "process.execPath + '\\n' + process.version"]),
      pin,
    );

    if (node === null) {
      return yield* keep(`volta run --node ${pin} gave no Node ${pin}`);
    }

    const pnpm = pnpmBin(yield* said(main, "volta", ["which", "pnpm"]));
    return { ...parent, PATH: firstOnPath(parent.PATH ?? "", pnpm === null ? [node] : [node, pnpm]) };
  }).pipe(Effect.provide(nodeServices));
