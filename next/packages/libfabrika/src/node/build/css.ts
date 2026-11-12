// One stylesheet with its local `@import`s inlined by lightningcss's own bundler, which keeps the
// cascade: layer order, source order, and a refusal when a remote import follows a bundled one.
// Each file it reads is checked first (`check`), since the bundler would keep a local `url()` and
// wrap a `layer` or `supports()` import that the build does not accept.
// A window's stylesheet is served from the brain's table, which holds scripts and stylesheets only,
// so any other local file a stylesheet names stops the build instead of answering 404 later.
// Every file is found and read through Effect's FileSystem and Path, which the caller provides.
import { Effect, FileSystem, Path } from "effect";
import { bundleAsync, transform } from "lightningcss";
import { BuildError } from "../../runtime/Built.ts";

/** A reference to a scheme (`https:`, `data:`), a host (`//`) or a fragment is not a local file. */
const remote = (ref: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref);
const unsupported = "unsupported @import condition";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// lightningcss names the bad token in its message; the build's errors name what is broken.
const refusal = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const known = message.match(/(?:unsupported @import condition|stylesheet [^:]*)$/)?.[0];

  if (known !== undefined) {
    return new BuildError({ reason: "bundle", message: known, cause: error });
  }

  if (message.includes("BadString")) {
    return new BuildError({ reason: "bundle", message: "stylesheet has a broken string", cause: error });
  }

  if (message.includes("BadUrl")) {
    return new BuildError({ reason: "bundle", message: "stylesheet has a broken url()", cause: error });
  }

  return new BuildError({ reason: "bundle", message: `stylesheet has a broken @import: ${message}`, cause: error });
};

// lightningcss reports a rule's start as a 0-based line and a 1-based UTF-16 column, and counts
// LF, CRLF, CR and form feed as one line break each, as CSS input preprocessing does.
const offsets = (text: string) => {
  const starts = [0];

  for (const m of text.matchAll(/\r\n|[\n\r\f]/g)) {
    starts.push(m.index + m[0].length);
  }

  return ({ line, column }: { readonly line: number; readonly column: number }) =>
    (starts[line] ?? text.length) + column - 1;
};

// 1.33.0 gives `layer: null` both for no layer and for a bare `layer`, so the import's own raw text
// is printed alone, where the printer writes the url as one string and keeps the bare keyword.
const bareLayer = (rule: string) =>
  /^@import "(?:[^"\\]|\\.)*" layer[ ;]/.test(decode(transform({ filename: "import.css", code: encode(rule) }).code));

// lightningcss's own parse of one file, with each rule's start and each import's start. Its visitor
// stops the parse only by throwing; `check` runs this inside Effect.try, which takes the throw.
const parse = (file: string, text: string) => {
  const at = offsets(text),
    starts: number[] = [],
    imports: number[] = [];
  const result = transform({
    filename: file,
    code: encode(text),
    analyzeDependencies: true,
    errorRecovery: false,
    visitor: {
      Rule(rule) {
        // Neither has a place in the source to start from.
        if (rule.type === "ignored" || rule.type === "custom") {
          return;
        }

        const start = at(rule.value.loc);
        starts.push(start);

        if (rule.type !== "import") {
          return;
        }

        // `layer` and `supports()` would need their own wrapper; a media query is not one.
        if ((rule.value.layer ?? rule.value.supports ?? null) !== null) {
          throw new Error(unsupported);
        }

        imports.push(start);
      },
    },
  });
  return { dependencies: result.dependencies ?? [], starts, imports };
};

// One file's own checks, run as the bundler reads it: the token errors, the import conditions it
// cannot keep, and any local file a `url()` names.
const check = Effect.fn("build.css.check")(function* (file: string, text: string) {
  const { dependencies, starts, imports } = yield* Effect.try({
    try: () => parse(file, text),
    catch: refusal,
  });

  for (const start of imports) {
    const end = Math.min(text.length, ...starts.filter((next) => next > start));
    const bare = yield* Effect.try({ try: () => bareLayer(text.slice(start, end)), catch: refusal });

    if (bare) {
      return yield* new BuildError({ reason: "bundle", message: unsupported });
    }
  }

  for (const dependency of dependencies) {
    if (dependency.type === "url" && !remote(dependency.url)) {
      return yield* new BuildError({ reason: "bundle", message: "stylesheet references a file" });
    }
  }
});

// The bundler drops an import it has already entered, so a cycle is found from the edges it resolved.
const cyclic = (edges: ReadonlyMap<string, ReadonlySet<string>>) => {
  const done = new Set<string>(),
    open = new Set<string>();
  const visit = (file: string): boolean => {
    if (open.has(file)) {
      return true;
    }

    if (done.has(file)) {
      return false;
    }

    open.add(file);
    const found = [...(edges.get(file) ?? [])].some(visit);
    open.delete(file);
    done.add(file);
    return found;
  };
  return [...edges.keys()].some(visit);
};

export const inlineStylesheet = Effect.fn("build.css")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const edges = new Map<string, Set<string>>();
  // A resolver's failure reaches the bundler as an Error with our message; `refusal` reads it back.
  const plain = (error: { readonly message?: string | undefined }) => new Error(error.message ?? "");
  const found = (specifier: string, from: string): Effect.Effect<string | { external: string }, Error> =>
    remote(specifier)
      ? Effect.succeed({ external: specifier })
      : fs.realPath(path.resolve(path.dirname(from), specifier)).pipe(
          Effect.tap((target) =>
            Effect.sync(() => {
              edges.set(from, (edges.get(from) ?? new Set()).add(target));
            }),
          ),
          Effect.mapError(plain),
        );
  const checked = (target: string) =>
    fs.readFileString(target).pipe(
      Effect.tap((text) => check(target, text)),
      Effect.mapError(plain),
    );
  const bundling = {
    filename: yield* fs.realPath(file).pipe(Effect.mapError(refusal)),
    errorRecovery: false,
    resolver: {
      resolve: (specifier: string, from: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: lightningcss awaits its resolver's answer
        Effect.runPromiseWith(context)(found(specifier, from)),
      read: (target: string) =>
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: lightningcss awaits each file it reads
        Effect.runPromiseWith(context)(checked(target)),
    },
  };
  // oxlint-disable-next-line fabrika/no-promises -- edge: lightningcss takes a resolver only in bundleAsync
  const result = yield* Effect.tryPromise({ try: () => bundleAsync(bundling), catch: refusal });

  if (cyclic(edges)) {
    return yield* new BuildError({ reason: "bundle", message: "stylesheet imports itself" });
  }

  return decode(result.code);
});
