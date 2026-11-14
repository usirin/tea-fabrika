/**
 * The one-file build: every selected program as a sealed Worker Loader module, every window
 * script, chunk and stylesheet, the tab's script and page, and the brain that carries them all as
 * text. Nothing is published until every bundle and the Compiler check pass; a failure keeps the
 * last good file.
 *
 * Disk and paths go through Effect's `FileSystem` and `Path`, which the caller provides.
 *
 * @stability unstable
 */
import { unreachableChunksPlugin } from "alchemy/Bundle/UnreachableChunksPlugin";
import { Context, Effect, Exit, FileSystem, Option, Path, Schema } from "effect";
import type { OutputAsset, OutputChunk, Plugin } from "rolldown";
import { ProgramName } from "../../packs/ProgramName.ts";
import { Asset, type AssetType, Built as Tables, BuildError, type BuiltProgram, hash } from "../../runtime/Built.ts";
import { bundle, bundlePrograms } from "./bundle.ts";
import { check, compile, Row } from "./compiler.ts";
import { inlineStylesheet } from "./css.ts";

export {
  /**
   * Error for a build that stopped, re-exported from the runtime's build tables.
   *
   * @stability unstable
   * @category errors
   */
  BuildError,
} from "../../runtime/Built.ts";

/**
 * One program an app selects for its build: its `pack/program` name, its package, and the export
 * that holds its declaration.
 *
 * @stability unstable
 * @category models
 */
export type Selection = { readonly name: string; readonly package: string; readonly export: string };

/**
 * What a finished build answers: the published brain file and its hash, and the tables that file
 * carries, each program's compiled source by name and each window file by route.
 *
 * @stability unstable
 * @category models
 */
export type Built = {
  /** The SHA-256 of the brain file's bytes. */
  readonly build: string;
  /** The published brain file, `<out>/brain.mjs`. */
  readonly brain: string;
  readonly programs: Readonly<Record<string, BuiltProgram>>;
  readonly assets: Readonly<Record<string, Asset>>;
};

/**
 * What a build is given: where to publish, the repo root, the brain's entry module, the selected
 * programs and, when there is one, the tab's window.
 *
 * @stability unstable
 * @category models
 */
export type Options = {
  /** The folder the build is swapped into. The brain is published as `<out>/brain.mjs`. */
  readonly out: string;
  /** Where the Compiler ledger lives, and what its paths and the bundles' module ids are relative to. */
  readonly root: string;
  /** The brain's entry module. Package names resolve from its folder. */
  readonly entry: string;
  readonly programs: ReadonlyArray<Selection>;
  /** `.tsx` files the Compiler checks beyond those the bundles reach. Only brain.mjs is published. */
  readonly files?: ReadonlyArray<string>;
  /** The Compiler ledger. Read from `<root>/compiler-ledger.json` when absent. */
  readonly ledger?: ReadonlyArray<Row>;
  /** Recorded on the build's span. The build reads it nowhere else. */
  readonly chaos: boolean;
  /** The tab's window: its entry module, built as one script at `/window.js`, and its
   *  stylesheets in the order the page at `/index.html` applies them. Without it neither route exists. */
  readonly tab?: { readonly entry: string; readonly styles: ReadonlyArray<string> };
};

/** The module the brain imports its tables from (`build-modules.d.ts`). */
const BUILT_MODULE = "virtual:fabrika-built";
const TEXT = "\0fabrika-text:";
const WINDOW = "fabrika:window:";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const isProgramName = Schema.is(ProgramName);

const Manifest = Schema.Struct({
  exports: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)])),
});

const fail = (reason: string) => (cause: unknown) => new BuildError({ reason, cause });
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

// The window a selected package exports, if any. A path, not a package name, has no manifest.
const findWindow = Effect.fn("build.manifest")(function* (from: string, selected: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  if (selected.startsWith(".") || path.isAbsolute(selected)) {
    return Option.none<string>();
  }

  for (let dir = from; ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", selected, "package.json");

    if (yield* fs.exists(file).pipe(Effect.mapError(fail("table")))) {
      const manifest = yield* fs
        .readFileString(file)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
          Effect.mapError(fail("table")),
        );
      const exports = manifest.exports;
      return typeof exports === "object" && Object.hasOwn(exports, "./window")
        ? Option.some(`${selected}/window`)
        : Option.none<string>();
    }

    if (path.dirname(dir) === dir) {
      return Option.none<string>();
    }
  }
});

const contentType = (file: string): AssetType | undefined =>
  file.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : file.endsWith(".css")
      ? "text/css; charset=utf-8"
      : undefined;

// Each emitted window file, under its own route. Two files on one route stop the build.
const collect = Effect.fn("build.collect")(function* (output: ReadonlyArray<OutputChunk | OutputAsset>) {
  const assets: Record<string, Asset> = {};

  for (const item of output) {
    const route = `/${item.fileName}`,
      type = contentType(item.fileName);

    if (type === undefined || Object.hasOwn(assets, route)) {
      return yield* new BuildError({ reason: "bundle", message: "two window files on one route" });
    }

    const body =
      item.type === "chunk"
        ? item.code
        : typeof item.source === "string"
          ? item.source
          : new TextDecoder().decode(item.source);
    assets[route] = yield* Asset.makeEffect({ hash: yield* hash(body), type, body }).pipe(
      Effect.mapError(fail("bundle")),
    );
  }

  return assets;
});

// A stylesheet a window imports becomes one asset of its own, its local `@import`s inlined in
// order (`node/build/css.ts`), so every rule it needs is in the table and the script keeps no trace of it.
const stylesheets = (
  context: Parameters<typeof Effect.runPromiseWith<FileSystem.FileSystem | Path.Path>>[0],
  path: Path.Path,
): Plugin => ({
  name: "fabrika-css",
  load(id) {
    if (!id.endsWith(".css")) {
      return;
    }

    const emit = inlineStylesheet(id).pipe(
      Effect.map((source) => {
        this.emitFile({ type: "asset", name: path.basename(id), source });
        return { code: "", moduleType: "js" as const };
      }),
    );
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Rolldown hook answers with a Promise
    return Effect.runPromiseWith(context)(emit);
  },
});

// The brain's tables, with every compiled body as a text module: embedded, never parsed as code.
const embed = (tables: Tables): Plugin => {
  const texts: Array<string> = [];
  const text = (body: string) => `t${texts.push(body) - 1}`;
  const programs = Object.entries(tables.programs).map(
    ([name, p]) => `${JSON.stringify(name)}: {hash: ${JSON.stringify(p.hash)}, source: ${text(p.source)}}`,
  );
  const assets = Object.entries(tables.assets).map(
    ([route, a]) =>
      `${JSON.stringify(route)}: {hash: ${JSON.stringify(a.hash)}, type: ${JSON.stringify(a.type)}, body: ${text(a.body)}}`,
  );
  const imports = texts.map((_, n) => `import t${n} from ${JSON.stringify(`${TEXT}${n}`)};`);
  const code = [
    ...imports,
    `export const programs = {${programs.join(", ")}};`,
    `export const assets = {${assets.join(", ")}};`,
  ].join("\n");
  return {
    name: "fabrika-built",
    resolveId(id) {
      if (id === BUILT_MODULE) {
        return `\0${BUILT_MODULE}`;
      }

      if (id.startsWith(TEXT)) {
        return id;
      }
    },
    load(id) {
      if (id === `\0${BUILT_MODULE}`) {
        return code;
      }

      if (id.startsWith(TEXT)) {
        return { code: texts[Number(id.slice(TEXT.length))] ?? "", moduleType: "text" };
      }
    },
  };
};

/** Effect probes for Node's `async_hooks` through `globalThis.process`, which a tab never has. The
 *  probe is dead in a browser, so the tab's bundle drops it and names no Node module. */
const NODE_PROBE = 'globalThis.process?.getBuiltinModule?.("node:async_hooks")';

/** A module a tab has no way to load: Node's or the Workers runtime's. */
const PLATFORM = /^(?:node|cloudflare):/;

const browserOnly: Plugin = {
  name: "fabrika-browser-only",
  resolveId(id) {
    if (PLATFORM.test(id)) {
      this.error(`the tab reaches ${id}, which a browser cannot load`);
    }
  },
  transform(code, id) {
    if (id.includes("/effect/dist/") && code.includes(NODE_PROBE)) {
      return { code: code.replace(NODE_PROBE, "undefined") };
    }
  },
};

/** Text that cannot end the element it sits in. */
const inert = (text: string): string => text.replaceAll("</", "<\\/");

/** Text that cannot leave the attribute it sits in. */
const attribute = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The tab's page: every stylesheet embedded in order, and the script at `/window.js`, which `build`
 *  names for the rows the tab records. No other request: the icon is empty. */
const page = (styles: ReadonlyArray<string>, build: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<meta name="fabrika-build" content="${attribute(build)}">`,
    "<title>fabrika</title>",
    '<link rel="icon" href="data:,">',
    ...styles.map((css) => `<style>${inert(css)}</style>`),
    "</head>",
    "<body>",
    '<div id="root"></div>',
    '<script type="module" src="/window.js"></script>',
    "</body>",
    "</html>",
  ].join("\n");

const asset = (type: AssetType, body: string) =>
  hash(body).pipe(
    Effect.flatMap((digest) => Asset.makeEffect({ hash: digest, type, body })),
    Effect.mapError(fail("bundle")),
  );

const PAGE = "index.html";

const tabScript = (output: ReadonlyArray<OutputChunk | OutputAsset>): string =>
  output
    .filter((o) => o.type === "chunk")
    .map((o) => o.code)
    .join("\n");

// The tab's page is an asset of the tab's own call, so the call that made the script made the page.
const tabPage = (styles: ReadonlyArray<string>): Plugin => ({
  name: "fabrika-tab-page",
  generateBundle(_options, output) {
    const emit = hash(tabScript(Object.values(output))).pipe(
      Effect.flatMap((build) =>
        Effect.sync(() => {
          this.emitFile({ type: "asset", fileName: PAGE, source: page(styles, build) });
        }),
      ),
    );
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Rolldown hook answers with a Promise
    return Effect.runPromiseWith(Context.empty())(emit);
  },
});

// The tab's script, one ES module with React's production build, and its page.
const tabAssets = Effect.fn("build.tab")(function* (
  tab: NonNullable<Options["tab"]>,
  plugins: Array<Plugin>,
  cwd: string,
) {
  const fs = yield* FileSystem.FileSystem;
  // A listed file that cannot be read fails as a read; then the window's own CSS check inlines its
  // local `@import`s and refuses any local file it names.
  const styles = yield* Effect.forEach(
    tab.styles,
    (file) => fs.readFileString(file).pipe(Effect.mapError(fail("read")), Effect.andThen(inlineStylesheet(file))),
    { concurrency: 1 },
  );
  const output = yield* bundle(tab.entry, [...plugins, browserOnly, tabPage(styles)], {
    phase: "tab",
    cwd,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    minify: true,
  });
  const html = output.output.find((o): o is OutputAsset => o.type === "asset" && o.fileName === PAGE);

  if (html === undefined || typeof html.source !== "string") {
    return yield* new BuildError({ reason: "bundle", message: "the tab's call emitted no page" });
  }

  return {
    "/window.js": yield* asset("text/javascript; charset=utf-8", tabScript(output.output)),
    "/index.html": yield* asset("text/html; charset=utf-8", html.source),
  };
});

const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  work.pipe(
    Effect.onExit((exit) =>
      Effect.annotateCurrentSpan(
        Exit.isSuccess(exit) ? { outcome: "success" } : { outcome: "failure", "error.type": "BuildError" },
      ),
    ),
  );

// Write the brain beside `out`, then swap it in: all or nothing.
const publish = Effect.fn("build.emit")(function* (
  out: string,
  brain: string,
  sizes: { readonly programs: number; readonly window: number },
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const digest = yield* hash(brain);
  yield* Effect.annotateCurrentSpan({
    "brain.hash": digest,
    "brain.bytes": bytes(brain),
    "programs.bytes": sizes.programs,
    "window.bytes": sizes.window,
  });
  const swap = Effect.gen(function* () {
    const directory = path.dirname(out);

    if (!(yield* fs.exists(directory))) {
      yield* fs.makeDirectory(directory, { recursive: true });
    }

    const pending = yield* fs.makeTempDirectory({ directory, prefix: ".fabrika-build-" });
    const backup = `${pending}.old`;
    // Once the last good file is moved aside, a failure or an interruption at any later point
    // (the final rename included, even one that landed) puts it back. The disk says how far it got.
    const restore = Effect.gen(function* () {
      if (!(yield* fs.exists(backup))) {
        return;
      }

      yield* fs.remove(out, { recursive: true, force: true });
      yield* fs.rename(backup, out);
    }).pipe(Effect.ignore);
    // Each disk step, once asked for, runs to its end: an interruption waits for it, so cleanup
    // and restore never race a write or a rename the disk is still doing.
    yield* Effect.gen(function* () {
      yield* Effect.uninterruptible(fs.writeFileString(path.join(pending, "brain.mjs"), brain));

      if (yield* fs.exists(out)) {
        yield* Effect.uninterruptible(fs.rename(out, backup));
      }

      yield* Effect.uninterruptible(fs.rename(pending, out));
    }).pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : restore)),
      Effect.ensuring(
        Effect.all(
          [fs.remove(pending, { recursive: true, force: true }), fs.remove(backup, { recursive: true, force: true })],
          { concurrency: 1 },
        ).pipe(Effect.ignore),
      ),
    );
  });
  yield* recorded(swap.pipe(Effect.mapError(fail("publish"))));
  return digest;
});

/**
 * Builds every selected program as a sealed Worker Loader module, the same bundles a start and
 * every saved-file rebuild use, and returns each program's built source by name.
 *
 * **Details**
 *
 * Every `.tsx` file a bundle reaches goes through the React Compiler check, against
 * `options.ledger` or the root's `compiler-ledger.json` when one exists. A finding fails with a
 * `BuildError` of reason `compiler` whose cause lists each finding's path and line. When given,
 * `inputs` receives every module's text by its id, and `reached`, once the check passes, each
 * checked `.tsx` file's text by its path from the root.
 *
 * @stability unstable
 * @category constructors
 */
export const buildPrograms = Effect.fn("build.programs")(function* (
  options: Pick<Options, "root" | "entry" | "programs" | "ledger">,
  reached?: Map<string, string>,
  inputs?: Map<string, string>,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.realPath(options.root).pipe(Effect.orElseSucceed(() => options.root));
  const entry = yield* fs.realPath(options.entry).pipe(Effect.orElseSucceed(() => options.entry));
  const files = new Map<string, string>();
  const compiler: Plugin = {
    name: "fabrika-program-compiler",
    // Rolldown warnings can quote source. Reload reports only the checked build's result.
    onLog() {
      return false;
    },
    transform(code, id) {
      inputs?.set(id, code);

      if (!id.endsWith(".tsx")) {
        return;
      }

      files.set(path.relative(root, id), code);
      return { code: compile(id, code).code };
    },
  };
  const ledgerFile = path.join(root, "compiler-ledger.json");
  const ledger =
    options.ledger ??
    ((yield* fs.exists(ledgerFile))
      ? yield* fs
          .readFileString(ledgerFile)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
            Effect.mapError(fail("read")),
          )
      : []);
  const programs = yield* bundlePrograms({
    root: path.dirname(entry),
    cwd: root,
    plugins: [compiler],
    programs: Object.fromEntries(options.programs.map((p) => [p.name, { module: p.package, name: p.export }])),
  });
  const findings = check(
    files,
    ledger.filter((row) => files.has(row.file)),
  );

  if (findings.length > 0) {
    return yield* new BuildError({
      reason: "compiler",
      cause: findings.map(({ file, line }) => ({ path: file, line })),
    });
  }

  for (const [file, text] of files) {
    reached?.set(file, text);
  }

  return programs;
});

/**
 * Builds one brain file: bundles every selected program as a sealed Worker Loader module, every
 * window's scripts and stylesheets, and the tab's script and page when a tab is given, then bundles
 * the brain with all of them embedded as text.
 *
 * **Details**
 *
 * Nothing is published until every bundle and the React Compiler check pass. The new folder is
 * written beside `out` and swapped in, and a failure or an interruption at any point of the swap
 * puts the last good one back. It fails with a `BuildError` whose `reason` names the step: `table`
 * (a repeated program name, a name that is not `pack/program`, or a bad export name), `read`,
 * `bundle`, `compiler` or `publish`.
 *
 * **Gotchas**
 *
 * The Compiler check covers every `.tsx` file a bundle reached and every file in `options.files`.
 * One finding fails the whole build as `compiler`, and the error does not list the findings: run
 * the check alone to read them.
 *
 * @stability unstable
 * @category constructors
 */
export const build = Effect.fn("build.build")(function* (options: Options) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  yield* Effect.annotateCurrentSpan({ chaos: options.chaos, programs: options.programs.length });
  const names = options.programs.map((p) => p.name);

  if (
    new Set(names).size !== names.length ||
    !options.programs.every((p) => isProgramName(p.name) && IDENTIFIER.test(p.export))
  ) {
    return yield* new BuildError({ reason: "table" });
  }

  // Rolldown names modules by their real paths, so the ledger's relative paths start from the real
  // root. A path the disk cannot resolve is used as given: reading through it fails on its own.
  const real = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
  const root = yield* real(options.root);
  const from = path.dirname(yield* real(options.entry));
  // Listed files and every file a bundle reaches go through the one Compiler check.
  // A listed file keeps the path it was listed by, as the ledger's rows name it.
  const files = new Map<string, string>();

  for (const listed of options.files ?? []) {
    const file = path.resolve(options.root, listed);
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(fail("read")));
    files.set(path.relative(options.root, file), text);
  }

  const ledger =
    options.ledger ??
    (yield* fs
      .readFileString(path.join(options.root, "compiler-ledger.json"))
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
        Effect.mapError(fail("read")),
      ));
  const compiler: Plugin = {
    name: "fabrika-compiler",
    transform(code, id) {
      if (!id.endsWith(".tsx")) {
        return;
      }

      files.set(path.relative(root, id), code);
      return { code: compile(id, code).code };
    },
  };
  const windows: Record<string, string> = {};

  for (const p of options.programs) {
    const found = yield* findWindow(from, p.package);

    if (Option.isSome(found)) {
      windows[p.name] = found.value;
    }
  }

  const programs = yield* buildPrograms(
    { root: options.root, entry: options.entry, programs: options.programs, ledger },
    files,
  );
  // A segment holds no `.`, so `pack.program` names one generated file per qualified name. The
  // window's entry keeps the whole name, so it is emitted at `/pack/program.js`.
  const generated = (name: string) => path.join(from, `window.${name.replace("/", ".")}.generated.ts`);
  const entries: Plugin = {
    name: "fabrika-window",
    resolveId(id) {
      if (id.startsWith(WINDOW)) {
        return generated(id.slice(WINDOW.length));
      }
    },
    load(id) {
      for (const [name, module] of Object.entries(windows)) {
        if (id === generated(name)) {
          return `export * from ${JSON.stringify(module)};`;
        }
      }
    },
  };
  const assets: Record<string, Asset> = Object.keys(windows).length
    ? yield* bundle(
        Object.fromEntries(Object.keys(windows).map((name) => [name, `${WINDOW}${name}`])),
        [entries, compiler, stylesheets(context, path)],
        {
          phase: "window",
          cwd: root,
          split: true,
          define: { "process.env.NODE_ENV": JSON.stringify("production") },
        },
      ).pipe(Effect.flatMap((o) => collect(o.output)))
    : {};

  if (options.tab !== undefined) {
    for (const [route, file] of Object.entries(yield* tabAssets(options.tab, [compiler], root))) {
      if (Object.hasOwn(assets, route)) {
        return yield* new BuildError({ reason: "bundle", message: "two window files on one route" });
      }

      assets[route] = file;
    }
  }

  const tables = yield* Tables.makeEffect({ programs, assets }).pipe(Effect.mapError(fail("table")));
  const output = yield* bundle(options.entry, [compiler, embed(tables), unreachableChunksPlugin()], {
    phase: "brain",
    cwd: root,
    define: { "globalThis.__ALCHEMY_RUNTIME__": "true" },
  });
  const brain = output.output
    .filter((o) => o.type === "chunk")
    .map((o) => o.code)
    .join("\n");

  // Every module a bundle reached is in `files` now: check them all, and the ledger for stale rows.
  if (check(files, ledger).length) {
    return yield* new BuildError({ reason: "compiler" });
  }

  const size = (bodies: ReadonlyArray<string>) => bodies.reduce((total, body) => total + bytes(body), 0);
  const digest = yield* publish(options.out, brain, {
    programs: size(Object.values(programs).map((p) => p.source)),
    window: size(Object.values(assets).map((a) => a.body)),
  });
  return {
    build: digest,
    brain: path.join(options.out, "brain.mjs"),
    programs: tables.programs,
    assets: tables.assets,
  } satisfies Built;
});
