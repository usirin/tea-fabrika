import type { Scope } from "effect";
import { Clock, Effect, FileSystem, Option, Path, Queue, Schema, Stream } from "effect";
import { watch, type RolldownWatcherEvent } from "rolldown";
import * as Id from "../../Id.ts";
import { CodeEvent, Installed, type Install } from "../../runtime/Code.ts";
import { buildPrograms, type Selection } from "../build/build.ts";
import { compile } from "../build/compiler.ts";
import { ControlError } from "./dev.ts";

type Failed = (typeof CodeEvent.cases)["code.failed"]["Type"];

type Reloaded =
  | (Exclude<Installed, typeof Installed.cases.failed.Type> & { readonly program: string; readonly hash: string })
  | (typeof Installed.cases.failed.Type & {
      readonly program: string;
      readonly hash: string | null;
      readonly path?: string;
      readonly line?: number;
    });

const InstallId = Id.make("install");
const Location = Schema.Struct({ file: Schema.optionalKey(Schema.String), line: Schema.optionalKey(Schema.Int) });

const Diagnostic = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Int),
  loc: Schema.optionalKey(Location),
});

const Errors = Schema.Struct({ errors: Schema.Array(Diagnostic) });

const details = (raw: unknown, root: string, path: Path.Path) => {
  const many = Schema.decodeUnknownOption(Errors)(raw);
  const list = Schema.decodeUnknownOption(Schema.Array(Diagnostic))(raw);
  const one = Schema.decodeUnknownOption(Diagnostic)(raw);
  const item = Option.isSome(many)
    ? many.value.errors[0]
    : Option.isSome(list)
      ? list.value[0]
      : Option.getOrUndefined(one);
  const file = item?.loc?.file ?? item?.id ?? item?.path;

  if (file === undefined) {
    return {};
  }

  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {};
  }

  const line = item?.loc?.line ?? item?.line;
  return { path: relative, ...(line === undefined ? {} : { line }) };
};

export const watchPrograms = (options: {
  readonly root: string;
  readonly entry: string;
  readonly programs: ReadonlyArray<Selection>;
  readonly install: (code: Install) => Effect.Effect<Installed, ControlError>;
  readonly failed: (fact: Failed) => Effect.Effect<void, ControlError>;
}): Stream.Stream<Reloaded, never, Scope.Scope | FileSystem.FileSystem | Path.Path> => {
  const program = (selected: Selection) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const generated = path.join(path.dirname(options.entry), "program.watch.generated.ts");
      const events = yield* Queue.unbounded<RolldownWatcherEvent>();
      // Results are owned as soon as the callback receives them, including during interruption.
      const results = new Set<Extract<RolldownWatcherEvent, { code: "BUNDLE_END" | "ERROR" }>["result"]>();
      const close = (result: Extract<RolldownWatcherEvent, { code: "BUNDLE_END" | "ERROR" }>["result"]) =>
        // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown result cleanup returns a Promise
        Effect.tryPromise({ try: () => result.close(), catch: () => new ControlError({ reason: "watch_close" }) })
          .pipe(Effect.orDie)
          .pipe(Effect.tap(() => Effect.sync(() => results.delete(result))));
      const received = Effect.fnUntraced(function* (event: RolldownWatcherEvent) {
        if ((event.code === "BUNDLE_END" || event.code === "ERROR") && event.result !== undefined) {
          yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              results.add(event.result);
              return event.result;
            }),
            () => Effect.void,
            close,
          );
        }

        Queue.offerUnsafe(events, event);
      });
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const watcher = watch({
            input: "fabrika:watch",
            cwd: options.root,
            platform: "browser",
            external: ["cloudflare:workers"],
            logLevel: "silent",
            watch: { skipWrite: true, exclude: [path.join(import.meta.dirname, "../../../**")] },
            output: { format: "esm" },
            plugins: [
              {
                name: "fabrika-watch",
                resolveId(id) {
                  if (id === "fabrika:watch") {
                    return generated;
                  }
                },
                load(id) {
                  if (id === generated) {
                    return `export {${selected.export}} from ${JSON.stringify(selected.package)};`;
                  }
                },
                transform(code, id) {
                  if (id.endsWith(".tsx")) {
                    return { code: compile(id, code).code };
                  }
                },
              },
            ],
          });
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Rolldown awaits its listener before END
          watcher.on("event", (event) => Effect.runPromise(received(event)));
          return watcher;
        }),
        (watcher) =>
          Effect.gen(function* () {
            const failed = () => new ControlError({ reason: "watch_close" });
            // oxlint-disable-next-line fabrika/no-promises -- edge: closing Rolldown stops its event callbacks
            yield* Effect.tryPromise({ try: () => watcher.close(), catch: failed }).pipe(Effect.orDie);

            for (const result of results) {
              yield* close(result);
            }
          }),
      );
      const root = yield* fs.realPath(options.root).pipe(Effect.orElseSucceed(() => options.root));
      const ids = yield* Id.Generator.pipe(Effect.provide(Id.Generator.layer));
      const failure = Effect.fn("watch.failed")(function* (reason: Failed["reason"], cause: unknown) {
        const fact = CodeEvent.cases["code.failed"].make({
          program: selected.name,
          hash: null,
          reason,
          ...details(cause, root, path),
        });
        yield* options.failed(fact).pipe(Effect.ignore);
        return {
          ...Installed.cases.failed.make({ reason }),
          program: selected.name,
          hash: null,
          ...details(cause, root, path),
        };
      });
      return Stream.fromQueue(events).pipe(
        Stream.split((event) => event.code === "END"),
        Stream.map((events) => events.find((event) => event.code === "ERROR") ?? { code: "END" as const }),
        Stream.mapAccumEffect(
          () => 0,
          Effect.fn("watch.rebuild")(function* (
            index: number,
            event: Extract<RolldownWatcherEvent, { code: "ERROR" }> | { readonly code: "END" },
          ): Effect.fn.Return<readonly [number, ReadonlyArray<Reloaded>], never, FileSystem.FileSystem | Path.Path> {
            const started = yield* Clock.currentTimeMillis;
            const finish = Effect.fnUntraced(function* (result: readonly [number, ReadonlyArray<Reloaded>], bytes = 0) {
              yield* Effect.annotateCurrentSpan({
                program: selected.name,
                bytes,
                ms: (yield* Clock.currentTimeMillis) - started,
                outcome: result[1][0]?._tag ?? "failed",
              });
              return result;
            });

            if (event.code === "ERROR") {
              return yield* finish([index, [yield* failure("bundle", event.error)]]);
            }

            const built = yield* Effect.result(buildPrograms({ root, entry: options.entry, programs: [selected] }));

            if (built._tag === "Failure") {
              return yield* finish([
                index,
                [yield* failure(built.failure.reason === "compiler" ? "compiler" : "bundle", built.failure.cause)],
              ]);
            }

            const code = built.success[selected.name];

            if (code === undefined) {
              return yield* finish([index, [yield* failure("bundle", null)]]);
            }

            const answer = yield* options
              .install({
                id: yield* ids.next(InstallId).pipe(Effect.orDie),
                program: selected.name,
                ...code,
                from: index === 0 ? "boot" : "watch",
              })
              .pipe(Effect.catch(() => Effect.succeed(Installed.cases.failed.make({ reason: "load" }))));
            return yield* finish(
              [index + 1, [{ ...answer, program: selected.name, hash: code.hash }]],
              new TextEncoder().encode(code.source).byteLength,
            );
          }),
        ),
      );
    });
  return Stream.unwrap(
    Effect.map(Effect.forEach(options.programs, program, { concurrency: 1 }), (streams) =>
      Stream.mergeAll(streams, { concurrency: "unbounded" }),
    ),
  );
};
