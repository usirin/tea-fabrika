// Remove: the box rm command, which removes one box (its work folder and its git data folder) only
// when every commit and file it saved is somewhere MAIN keeps. Deletion needs proof for every saved
// state, so anything unknown keeps the pair. Today's lead tooling, run on our own laptop.
//
//   absent    neither folder is there                         "absent box <name>"        exit 0
//   kept      any check could not prove the pair is safe     "kept box <name>: <reason>" exit 1
//             (a bad name is exit 2, shown as Python's repr showed it, so one line holds it)
//   removed   both folders are gone, runs/ moved to MAIN      "removed box <name>"       exit 0
//
// The order of the checks is the contract: the first that fails names the reason. Paths are read the
// way Python's pathlib read them before this port: "." parts drop, ".." stays, and a link is
// followed by hand, so every link and its target count as MAIN's storage.
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { BoxGit, type Inspection } from "./BoxGit.ts";
import { Runs } from "./Runs.ts";

export const Verdict = Schema.TaggedUnion({
  removed: {},
  absent: {},
  kept: { reason: Schema.String, code: Schema.Literals([1, 2]) },
});
export type Verdict = typeof Verdict.Type;

/** One rm: the name as its line shows it, what keepruns.sh said first ("" for nothing), the verdict. */
export type Removal = { readonly shown: string; readonly runs: string; readonly verdict: Verdict };

/** The one result line. */
export const line = ({ shown, verdict }: Removal): string =>
  Verdict.match(verdict, {
    removed: () => `removed box ${shown}`,
    absent: () => `absent box ${shown}`,
    kept: ({ reason }) => `kept box ${shown}: ${reason}`,
  });

export const exitCode = (verdict: Verdict): number => (verdict._tag === "kept" ? verdict.code : 0);

/** A check said no: the pair stays, for this reason. */
class Keep extends Schema.TaggedError<Keep>()("Keep", { reason: Schema.String, code: Schema.Literals([1, 2]) }) {}

/** Metadata in a shape nobody proved safe. Its words are the reason the line shows. */
class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", { reason: Schema.String }) {}

/** The disk could not be read or changed as asked. */
class Unreadable extends Schema.TaggedError<Unreadable>()("Unreadable", { cause: Schema.optional(Schema.Defect()) }) {}

const keep = (reason: string) => new Keep({ reason, code: 1 });
const unsupported = (reason: string) => new Unsupported({ reason });

// Paths, as pathlib reads an absolute one.
const normal = (path: string) =>
  `/${path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/")}`;

const joined = (base: string, rest: string) => normal(rest.startsWith("/") ? rest : `${base}/${rest}`);
const above = (path: string) => (path === "/" ? "/" : normal(path.slice(0, path.lastIndexOf("/"))));
const last = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const lineage = (path: string) => {
  const out = [path];

  for (let at = path; at !== "/";) {
    at = above(at);
    out.push(at);
  }

  return out;
};

/** Bytes as one character each, so a byte pattern reads them exactly. */
const latin1 = (bytes: Uint8Array) => {
  let out = "";

  for (let at = 0; at < bytes.length; at += 8192) {
    out += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }

  return out;
};

const utf8 = (bytes: Uint8Array) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: () => unsupported("'utf-8' codec can't decode the text"),
  });

/** bytes.splitlines(): \n, \r and \r\n. */
const byteLines = (text: string) => {
  const out = text.split(/\r\n|\n|\r/);
  return out.at(-1) === "" ? out.slice(0, -1) : out;
};

/** str.splitlines(), with every separator Python's has. */
const textLines = (text: string) => {
  const out = text.split(SEPARATORS);
  return out.at(-1) === "" ? out.slice(0, -1) : out;
};

const hex = (code: number, width: number) => code.toString(16).padStart(width, "0");

/** A name as Python's repr() showed it: quoted, with control characters escaped. */
const pythonRepr = (name: string) => {
  const quote = name.includes("'") && !name.includes('"') ? '"' : "'";
  const escapes: Record<string, string> = {
    "\\": "\\\\",
    "\t": "\\t",
    "\n": "\\n",
    "\r": "\\r",
    [quote]: `\\${quote}`,
  };
  let out = "";

  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      escapes[char] ??
      (char !== " " && /[\p{C}\p{Z}]/u.test(char)
        ? code <= 0xff
          ? `\\x${hex(code, 2)}`
          : code <= 0xffff
            ? `\\u${hex(code, 4)}`
            : `\\U${hex(code, 8)}`
        : char);
  }

  return `${quote}${out}${quote}`;
};

const invalid = (name: string) =>
  name === "" || name === "." || name === ".." || /[/\\]/.test(name) || /\p{Cc}/u.test(name);

const ORDINARY = new Set([
  "HEAD",
  "ORIG_HEAD",
  "index",
  "config",
  "config.worktree",
  "description",
  "hooks",
  "info",
  "logs",
  "refs",
  "objects",
  "packed-refs",
  "branches",
  "FETCH_HEAD",
  "COMMIT_EDITMSG",
]);

const OID = "[0-9a-f]{40}";
/** A byte a ref name may hold: no control byte, space or DEL. */
const REF_CHARS = "[^\\x00-\\x20\\x7f]";
/** A byte inside one line of metadata: no NUL and no line break. */
const LINE_CHARS = "[^\\x00\\r\\n]";
/** Every line break Python's str.splitlines() knows. */
// oxlint-disable-next-line eslint/no-control-regex -- str.splitlines() breaks at these control characters too
const SEPARATORS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const ZERO = "0".repeat(40);

/** Following links by hand ends after this many, as Python's recursion limit ended it. */
const HOPS = 1000;

/** The file reads rm needs, each failing as Unreadable. */
const disk = (fs: FileSystem.FileSystem) => {
  const kind = (path: string) =>
    fs.stat(path).pipe(
      Effect.map((info) => Option.some(info.type)),
      Effect.orElseSucceed(Option.none),
    );
  const isDir = (path: string) => Effect.map(kind(path), (type) => Option.contains(type, "Directory"));
  const isFile = (path: string) => Effect.map(kind(path), (type) => Option.contains(type, "File"));
  const exists = (path: string) => Effect.map(kind(path), Option.isSome);
  const isLink = (path: string) =>
    fs.lstat(path).pipe(
      Effect.map((info) => info.type === "SymbolicLink"),
      Effect.orElseSucceed(() => false),
    );
  const lexists = (path: string) =>
    fs.lstat(path).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  const identity = (path: string) =>
    fs.stat(path).pipe(
      Effect.map((info) => Option.some(`${info.dev}:${Option.getOrElse(info.ino, () => -1n)}`)),
      Effect.orElseSucceed(Option.none<string>),
    );
  const failed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(effect, (cause) => new Unreadable({ cause }));
  return {
    isDir,
    isFile,
    exists,
    isLink,
    lexists,
    identity,
    read: (path: string) => failed(fs.readFile(path)),
    list: (path: string) => failed(fs.readDirectory(path)),
    stat: (path: string) => failed(fs.stat(path)),
    readLink: (path: string) => failed(fs.readLink(path)),
    realPath: (path: string) => failed(fs.realPath(path)),
    failed,
  };
};

type Disk = ReturnType<typeof disk>;

/**
 * Whether a root holds any of these paths: is one of them or of their parent folders, by name or by
 * file identity (another casing on a case-insensitive disk is the same folder).
 */
const holdsAny = Effect.fnUntraced(function* (d: Disk, roots: ReadonlyArray<string>, paths: Iterable<string>) {
  const candidates = new Set<string>();

  for (const path of paths) {
    for (const parent of lineage(path)) {
      candidates.add(parent);
    }
  }

  const known = new Map<string, Option.Option<string>>();
  const identity = Effect.fnUntraced(function* (path: string) {
    const seen = known.get(path);

    if (seen !== undefined) {
      return seen;
    }

    const got = yield* d.identity(path);
    known.set(path, got);
    return got;
  });

  for (const root of roots) {
    if (candidates.has(root)) {
      return true;
    }

    const own = yield* identity(root);

    if (Option.isNone(own)) {
      continue;
    }

    const same = yield* Effect.forEach(
      candidates,
      (candidate) => Effect.map(identity(candidate), (id) => Option.contains(id, own.value)),
      { concurrency: 16 },
    );

    if (same.includes(true)) {
      return true;
    }
  }

  return false;
});

/**
 * Every path MAIN's Git storage reaches: its gitdir, common dir and object folders with their
 * alternates, each entry below them at any depth, and both ends of each link on the way. Other
 * worktrees' admin folders are their own storage, not MAIN's. A pair holding any of them stays.
 */
const protectMain = Effect.fnUntraced(function* (d: Disk, main: string, roots: ReadonlyArray<string>) {
  const kept = new Set<string>();

  const follow = (path: string, hops: number): Effect.Effect<string, Unreadable> =>
    Effect.gen(function* () {
      if (path === "/") {
        return path;
      }

      if (hops > HOPS) {
        return yield* new Unreadable({});
      }

      const parent = yield* follow(above(path), hops + 1);
      const current = joined(parent, last(path));
      kept.add(current);

      if (yield* d.isLink(current)) {
        return yield* follow(joined(parent, yield* d.readLink(current)), hops + 1);
      }

      yield* d.stat(current);
      return last(path) === ".." ? above(parent) : current;
    });
  const resolve = (path: string) => follow(path, 0);

  const readPath = Effect.fnUntraced(function* (path: string) {
    const raw = yield* utf8(yield* d.read(yield* resolve(path)));
    const value = raw.endsWith("\n") ? raw.slice(0, -1) : raw;

    if (value === "" || /[\0\r\n]/.test(value)) {
      return yield* unsupported("unsupported MAIN storage path");
    }

    return value;
  });

  let gitdir = yield* resolve(joined(main, ".git"));

  if (yield* d.isFile(gitdir)) {
    const pointer = yield* readPath(joined(main, ".git"));

    if (!pointer.startsWith("gitdir: ")) {
      return yield* unsupported("unsupported MAIN gitdir");
    }

    gitdir = yield* resolve(joined(main, pointer.slice(8)));
  }

  let common = gitdir;

  if (yield* d.lexists(joined(gitdir, "commondir"))) {
    common = yield* resolve(joined(gitdir, yield* readPath(joined(gitdir, "commondir"))));
  }

  const pending = [joined(common, "objects")];
  const objects = new Set<string>();

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const folder = yield* resolve(next);

    if (!(yield* d.isDir(folder))) {
      return yield* unsupported("unsupported MAIN object directory");
    }

    if (objects.has(folder)) {
      continue;
    }

    objects.add(folder);
    const info = joined(folder, "info");

    if (yield* d.lexists(info)) {
      const alternates = joined(yield* resolve(info), "alternates");

      if (yield* d.lexists(alternates)) {
        for (const value of textLines(yield* utf8(yield* d.read(yield* resolve(alternates))))) {
          if (value === "" || value.startsWith('"') || value.includes("\0")) {
            return yield* unsupported("unsupported MAIN alternate");
          }

          pending.push(joined(folder, value));
        }
      }
    }
  }

  const others = joined(common, "worktrees");
  const stack = [gitdir, common, ...objects];
  const walked = new Set<string>();

  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const real = yield* resolve(next);

    if (walked.has(real) || !(yield* d.isDir(real))) {
      continue;
    }

    walked.add(real);

    for (const child of [...(yield* d.list(real))].sort()) {
      const entry = joined(real, child);
      kept.add(entry);

      if (entry === others && entry !== gitdir) {
        continue;
      }

      if ((yield* d.isLink(entry)) || (yield* d.isDir(entry))) {
        stack.push(entry);
      }
    }
  }

  if (yield* holdsAny(d, roots, kept)) {
    return yield* keep("pair holds MAIN Git storage");
  }
});

/** A plain file's bytes: a link or anything but a regular file is metadata nobody proved safe. */
const plain = Effect.fnUntraced(function* (d: Disk, path: string) {
  if ((yield* d.isLink(path)) || !(yield* d.isFile(path))) {
    return yield* unsupported("missing or unsupported metadata");
  }

  return yield* d.read(path);
});

/** One folder of a walk: its sub-folders (links to folders included, as os.walk lists them) and files. */
const entries = Effect.fnUntraced(function* (d: Disk, folder: string) {
  const folders: Array<{ readonly name: string; readonly link: boolean }> = [];
  const files: Array<string> = [];

  for (const name of yield* d.list(folder)) {
    const path = joined(folder, name);

    if (yield* d.isDir(path)) {
      folders.push({ name, link: yield* d.isLink(path) });
    } else {
      files.push(name);
    }
  }

  return { folders, files };
});

/** The tips a box's reflogs save. Remote reflogs are fetched copies, so they are not walked. */
const reflogTips = Effect.fnUntraced(function* (d: Disk, logs: string, tips: Set<string>) {
  const visit = (folder: string): Effect.Effect<void, Keep | Unsupported | Unreadable> =>
    Effect.gen(function* () {
      const { folders, files } = yield* entries(d, folder);

      if (folders.some((entry) => entry.link)) {
        return yield* keep("symlinked reflog metadata");
      }

      for (const name of files) {
        for (const entry of byteLines(latin1(yield* plain(d, joined(folder, name))))) {
          const match = new RegExp(`^(${OID}) (${OID}) ${LINE_CHARS}+$`).exec(entry);

          if (match === null) {
            return yield* keep("unsupported reflog entry");
          }

          for (const oid of match.slice(1)) {
            if (oid !== ZERO) {
              tips.add(oid);
            }
          }
        }
      }

      for (const { name } of folders) {
        if (!(folder === joined(logs, "refs") && name === "remotes")) {
          yield* visit(joined(folder, name));
        }
      }
    });
  yield* visit(logs);
});

/**
 * Copy the box's refs into the inspection folder, and note the tips and symbolic refs they save.
 * Remote refs are copied, since git reads them, but they save nothing.
 */
const copyRefs = Effect.fnUntraced(function* (
  d: Disk,
  fs: FileSystem.FileSystem,
  data: string,
  into: string,
  tips: Set<string>,
  symbolic: Set<string>,
) {
  const visit = (relative: ReadonlyArray<string>): Effect.Effect<void, Unsupported | Unreadable> =>
    Effect.gen(function* () {
      const folder = joined(data, relative.join("/"));
      const saved = !(relative[0] === "refs" && relative[1] === "remotes");
      yield* d.failed(fs.makeDirectory(joined(into, relative.join("/")), { recursive: true }));
      const { folders, files } = yield* entries(d, folder);

      if (folders.some((entry) => entry.link)) {
        return yield* unsupported("symlinked ref metadata");
      }

      for (const name of files) {
        const bytes = yield* plain(d, joined(folder, name));
        const value = latin1(bytes);

        if (new RegExp(`^${OID}\\n?$`).test(value)) {
          if (saved) {
            tips.add(value.trim());
          }
        } else if (new RegExp(`^ref: refs/${REF_CHARS}+\\n?$`).test(value)) {
          if (saved) {
            symbolic.add((yield* utf8(bytes)).slice(5).trim());
          }
        } else {
          return yield* unsupported("unsupported ref metadata");
        }

        yield* d.failed(fs.writeFile(joined(into, [...relative, name].join("/")), bytes));
      }

      for (const { name } of folders) {
        yield* visit([...relative, name]);
      }
    });
  yield* visit(["refs"]);
});

/** Every check that needs no Git: the pair, its pointer, HEAD, its metadata names and saved tips. */
const checkMetadata = Effect.fnUntraced(function* (d: Disk, work: string, data: string, tips: Set<string>) {
  const pointer = new RegExp(`^gitdir: (${LINE_CHARS}+)\\n?$`).exec(latin1(yield* plain(d, joined(work, ".git"))));

  if (pointer === null) {
    return yield* keep("invalid gitdir pointer");
  }

  const named = yield* utf8(Uint8Array.from(pointer[1] ?? "", (char) => char.charCodeAt(0)));

  if ((yield* d.realPath(joined(work, named))) !== data) {
    return yield* keep("gitdir pointer does not name this pair");
  }

  const head = yield* plain(d, joined(data, "HEAD"));

  if (!new RegExp(`^(?:ref: refs/heads/${REF_CHARS}+|${OID})\\n?$`).test(latin1(head))) {
    return yield* keep("unsupported HEAD");
  }

  for (const folder of ["refs", "objects"]) {
    if ((yield* d.isLink(joined(data, folder))) || !(yield* d.isDir(joined(data, folder)))) {
      return yield* keep("missing or unsupported metadata");
    }
  }

  const names = yield* d.list(data);
  const shared = yield* Effect.forEach(
    ["commondir", "shallow", "info/grafts"],
    (path) => d.lexists(joined(data, path)),
    {
      concurrency: "unbounded",
    },
  );

  if (shared.includes(true) || names.some((name) => name.startsWith("sharedindex."))) {
    return yield* keep("unsupported shared, shallow or graft metadata");
  }

  // Operation state and linked worktrees can hold commits and staged files outside this index.
  if (names.some((name) => !ORDINARY.has(name))) {
    return yield* keep("operation, linked worktree or unknown metadata");
  }

  const original = joined(data, "ORIG_HEAD");

  if (yield* d.lexists(original)) {
    const value = latin1(yield* plain(d, original));

    if (!new RegExp(`^${OID}\\n?$`).test(value)) {
      return yield* keep("unsupported ORIG_HEAD");
    }

    tips.add(value.trim());
  }

  const logs = joined(data, "logs");

  if (yield* d.lexists(logs)) {
    if ((yield* d.isLink(logs)) || !(yield* d.isDir(logs))) {
      return yield* keep("unsupported reflog metadata");
    }

    yield* reflogTips(d, logs, tips);
  }

  // FETCH_HEAD records fetched copies, not saved work, but its shape is still checked.
  const fetched = joined(data, "FETCH_HEAD");

  if (yield* d.lexists(fetched)) {
    for (const entry of byteLines(latin1(yield* plain(d, fetched)))) {
      if (!new RegExp(`^${OID}\\t(?:not-for-merge)?\\t${LINE_CHARS}*$`).test(entry)) {
        return yield* keep("unsupported fetch metadata");
      }
    }
  }

  return head;
});

/**
 * Read the box through a private copy of its small metadata, its objects reached through an
 * alternate, so neither its config nor its hooks run and its own index is never written.
 */
const inspect = Effect.fn("Remove.inspect")(function* (
  d: Disk,
  work: string,
  data: string,
  head: Uint8Array,
  tips: Set<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* BoxGit;
  const temporary = yield* d.failed(fs.makeTempDirectoryScoped({ prefix: "box-inspect-" }));
  const into = normal(temporary);
  const write = (path: string, bytes: Uint8Array) => d.failed(fs.writeFile(joined(into, path), bytes));
  const symbolic = new Set<string>();

  yield* write("HEAD", head);
  yield* write("index", yield* plain(d, joined(data, "index")));
  // Keep Git's racy-index check: a fresh timestamp could hide a same-size edit. The copy's time is
  // never later than the original's (a Date holds milliseconds), so git only checks more.
  const stamp = yield* d.stat(joined(data, "index"));
  const now = new Date(0);
  yield* d.failed(
    fs.utimes(
      joined(into, "index"),
      Option.getOrElse(stamp.atime, () => now),
      Option.getOrElse(stamp.mtime, () => now),
    ),
  );
  yield* d.failed(fs.writeFileString(joined(into, "config"), "[core]\nrepositoryformatversion = 0\nbare = false\n"));
  yield* copyRefs(d, fs, data, into, tips, symbolic);

  const packed = joined(data, "packed-refs");

  if ((yield* d.exists(packed)) || (yield* d.isLink(packed))) {
    const value = yield* plain(d, packed);
    const shape = new RegExp(`^(?:${OID} refs/${REF_CHARS}+|\\^${OID})$`);

    if (byteLines(latin1(value)).some((entry) => !entry.startsWith("#") && !shape.test(entry))) {
      return yield* unsupported("unsupported packed refs");
    }

    yield* write("packed-refs", value);
  }

  const objects = joined(data, "objects");

  if (/[\n\r]/.test(objects)) {
    return yield* keep("unsupported object path");
  }

  yield* d.failed(fs.makeDirectory(joined(into, "objects/info"), { recursive: true }));
  yield* d.failed(fs.writeFileString(joined(into, "objects/info/alternates"), `${objects}\n`));

  const at: Inspection = { gitDir: into, work };
  const asked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(effect, () => unsupported("Git inspection failed"));
  const index = yield* asked(git.indexEntries(at));

  if (index.some((entry) => entry !== "" && !entry.startsWith("H "))) {
    return yield* keep("unsupported index flags");
  }

  // Status must never enter a submodule and read its own config or hooks.
  if (index.some((entry) => entry.startsWith("H 160000 "))) {
    return yield* keep("unsupported submodule metadata");
  }

  if (yield* asked(git.trackedChanges(at))) {
    return yield* keep("tracked changes");
  }

  for (const { ref, oid } of yield* asked(git.refs(at))) {
    if (ref.startsWith("refs/remotes/")) {
      continue;
    }

    tips.add(oid);

    // A replace ref also saves the original object's name in its path.
    if (ref.startsWith("refs/replace/")) {
      tips.add(ref.slice("refs/replace/".length));
    }
  }

  for (const ref of new Set([...symbolic, "HEAD"])) {
    for (const oid of yield* asked(git.objectsAt(at, ref))) {
      tips.add(oid);
    }
  }

  // Only MAIN's retained history counts. Mere object presence and remote refs prove nothing.
  const reachable = yield* asked(Effect.flatMap(git.retained, git.reachable));

  if ([...tips].some((tip) => !reachable.has(tip))) {
    return yield* keep("tip not retained in MAIN");
  }
}, Effect.scoped);

/**
 * Remove the box `name` under `boxes` when MAIN keeps all it saved. Never fails: every refusal is a
 * `kept` verdict, and what keepruns.sh said comes back beside it.
 */
export const remove = Effect.fn("Remove.remove")(function* (name: string, where: { boxes: string; main: string }) {
  if (invalid(name)) {
    return { shown: pythonRepr(name), runs: "", verdict: Verdict.cases.kept.make({ reason: "invalid name", code: 2 }) };
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runs = yield* Runs;
  const d = disk(fs);
  let said = "";

  /** pathlib's non-strict resolve: follow what exists, keep the rest of the path as written. */
  const loose = (at: string): Effect.Effect<string> =>
    fs.realPath(at).pipe(
      Effect.map(normal),
      Effect.catch(() =>
        at === "/" ? Effect.succeed(at) : Effect.map(loose(above(at)), (up) => joined(up, last(at))),
      ),
    );

  const checked = Effect.gen(function* () {
    const boxes = yield* loose(normal(path.resolve(where.boxes)));
    const work = joined(boxes, name);
    const data = joined(boxes, `${name}-gitdata`);

    if ((yield* d.isLink(work)) || (yield* d.isLink(data))) {
      return yield* keep("symlinked target");
    }

    if (!(yield* d.exists(work)) && !(yield* d.exists(data))) {
      return Verdict.cases.absent.make({});
    }

    if (!(yield* d.isDir(work)) || !(yield* d.isDir(data))) {
      return yield* keep("missing or invalid pair");
    }

    const main = normal(yield* d.realPath(path.resolve(where.main)));
    const outside = [above(normal(yield* d.realPath(work))), above(normal(yield* d.realPath(data)))];

    if (outside.some((parent) => parent !== boxes)) {
      return yield* keep("target outside BOXES");
    }

    const state = joined(boxes, "state");

    if (yield* holdsAny(d, [work, data], [main, state, yield* loose(state)])) {
      return yield* keep("pair holds MAIN or saved state");
    }

    yield* protectMain(d, main, [work, data]);
    const tips = new Set<string>();
    const head = yield* checkMetadata(d, work, data, tips);
    yield* inspect(d, work, data, head, tips);

    // Raw samples live under runs/, never in git: move them to MAIN before the folder goes.
    const moved = yield* runs.keep(work);
    said = moved.said.trim() === "" ? "" : moved.said.trimEnd();

    if (!moved.kept) {
      return yield* keep("could not keep its runs/");
    }

    for (const [folder, reason] of [
      [work, "work removal failed; pair may be partly removed"],
      [data, "work removed; git data removal failed and may be partial"],
    ] as const) {
      yield* Effect.andThen(protectMain(d, main, [work, data]), fs.remove(folder, { recursive: true })).pipe(
        Effect.catchTags({ Unreadable: () => keep(reason), PlatformError: () => keep(reason) }),
      );
    }

    return Verdict.cases.removed.make({});
  });

  const verdict = yield* checked.pipe(
    Effect.catchTags({
      Keep: ({ reason, code }) => Effect.succeed(Verdict.cases.kept.make({ reason, code })),
      Unsupported: ({ reason }) => Effect.succeed(Verdict.cases.kept.make({ reason, code: 1 })),
      Unreadable: () => Effect.succeed(Verdict.cases.kept.make({ reason: "inspection or removal failed", code: 1 })),
    }),
  );
  return { shown: name, runs: said, verdict };
});
