// land.ts: the lead session lands one lane. Today's lead tooling, run on our own laptop; it is not
// product (ticket 652).
//
// A lane agent never runs a lead-only step: the session's permission check refuses it the lead
// key, and rightly (0056). So the lane agent's last act is `ready`, and the lead session runs the
// mechanical tail with `run`:
//
//   land.ts ready <lane> --tree <dir> [--body <file> --loosening <file> --mutation <file>]
//       [--lead <sha>]... [--plan <file>]
//     the lane agent. Records "ready to land" in BOXES/state/<lane>.land.json and one line in
//     BOXES/state/<lane>.md. The tree must be clean. `--lead` names the lane's own lead commits
//     (field rows, plan rows, a lockfile), made with `stepcommit.sh --commit-only lead`. The three
//     PR files come together or not at all: without them it is a mid-lane handover (a lockfile, a
//     merge of main), which goes only to the branch's -wip backup. It reads no key, pushes nothing
//     and opens nothing.
//
//   land.ts run <lane> <ticket>
//     the lead session, in the background:
//       check        the tree is clean, on the ready branch, at the ready head
//       leak         the PR body that will be posted, through leakgrep.sh --text
//       fetch        origin main
//       merge        main in as the bot, never a rebase; on a conflict, stop and name each file
//                    with the step that owns it in the plan's files table
//       leak         the branch's net change and each commit to send, through leakgrep.sh
//       sign         each named lead commit, oldest first, then the merge, as lead, through main's
//                    own signer; only that signer reads the key
//       push         botpush.mjs, to the branch (to its -wip backup for a mid-lane handover, and
//                    stop there)
//       pr           open the PR from the body file, or update the open one
//       catchup      catchup.sh <pr> <ticket>, which waits for CI and squash-lands
//
// Every refusal before the push puts the tree's HEAD and refs/notes/fabrika back where they were,
// so a refused run changes nothing. It never resolves a conflict and never reads a key.
//
// Each part is an exported Effect (readReady, checkTree, draftPr, mergeMain, leakCheck, signLead,
// push, openPr, catchup), so the lead's flows (0064, ticket 656) can run them as steps; `run` only
// calls them in order.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, DateTime, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";

const Check = Schema.Literals(["env", "ready", "check", "leak", "fetch", "merge", "sign", "push", "pr", "catchup"]);

class Refused extends Schema.TaggedError<Refused>()("Refused", {
  check: Check,
  reason: Schema.String,
  output: Schema.String,
}) {}

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** The files a PR is made of: its body (first line the title) and both exam outputs (0014). */
const PrFiles = Schema.Struct({ body: Schema.String, loosening: Schema.String, mutation: Schema.String });

/** What a lane agent hands the lead: the lane, its tree and head, its lead commits, and the PR, if any. */
class Ready extends Schema.Class<Ready>("Ready")({
  lane: Schema.String,
  tree: Schema.String,
  branch: Schema.String,
  head: Sha,
  pr: Schema.optional(PrFiles),
  lead: Schema.Array(Sha),
  plan: Schema.optional(Schema.String),
  sentAt: Schema.String,
}) {}

const ReadyJson = Schema.fromJsonString(Ready);

const BOT = ["-c", "user.name=fabrikalfa[bot]", "-c", "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com"];

type Ran = { readonly code: number; readonly out: string; readonly err: string };

const text = (s: Stream.Stream<Uint8Array, unknown>) => Stream.mkString(Stream.decodeText(s));

/** One command, run to its end in `cwd`; `stdin` is fed to it when given. */
const sh = Effect.fn("land.sh")(
  function* (cwd: string, cmd: string, args: ReadonlyArray<string>, stdin?: string) {
    const ran = yield* ChildProcess.make(cmd, args, {
      cwd,
      ...(stdin === undefined ? {} : { stdin: Stream.make(new TextEncoder().encode(stdin)) }),
    });
    const [out, err, code] = yield* Effect.all([text(ran.stdout), text(ran.stderr), ran.exitCode], {
      concurrency: 3,
    });
    return { code: Number(code), out, err } satisfies Ran;
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed<Ran>({ code: 127, out: "", err: "the command could not start" })),
);

/** A command that must succeed; else the run is refused at `check`. */
const must = Effect.fnUntraced(function* (
  check: typeof Check.Type,
  reason: string,
  cwd: string,
  cmd: string,
  args: ReadonlyArray<string>,
  stdin?: string,
) {
  const ran = yield* sh(cwd, cmd, args, stdin);

  if (ran.code !== 0) {
    return yield* new Refused({ check, reason, output: `${ran.out}${ran.err}` });
  }

  return ran.out.trim();
});

const HERE = import.meta.dirname;

/** The paths env.sh gives every lead script. */
const loadEnv = Effect.gen(function* () {
  const out = yield* must("env", "env.sh failed", HERE, "sh", [
    "-c",
    '. "$0" && printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO" "$FABRIKA_COAUTHOR" "$HOME"',
    `${HERE}/env.sh`,
  ]);
  const [MAIN = "", BOXES = "", GH_REPO = "", COAUTHOR = "", HOME = ""] = out.split("\n");
  return { MAIN, BOXES, GH_REPO, COAUTHOR, HOME };
});

const lastLines = (output: string) => output.trimEnd().split("\n").slice(-30).join("\n");

/** One line in the lane's state file, the one the status page and the next agent read. */
const note = Effect.fnUntraced(function* (boxes: string, lane: string, line: string) {
  const fs = yield* FileSystem.FileSystem;
  const at = DateTime.formatIso(yield* DateTime.now);
  yield* fs.writeFileString(`${boxes}/state/${lane}.md`, `- ${at} ${line}\n`, { flag: "a" }).pipe(Effect.ignore);
});

/** The step that owns a path in the plan's files table: a row ending in / owns what is under it. */
const stepOwning = (owners: Readonly<Record<string, string>>, path: string): string => {
  const exact = owners[path];

  if (exact !== undefined) {
    return exact;
  }

  const under = Object.keys(owners)
    .filter((row) => row.endsWith("/") && path.startsWith(row))
    .toSorted((a, b) => b.length - a.length)[0];
  return under === undefined ? "no row in the plan" : (owners[under] ?? "no row in the plan");
};

const Owners = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

/** The plan's files table, or none when the lane has no plan that reads. */
const planOwners = Effect.fnUntraced(function* (main: string, plan: string | undefined) {
  if (plan === undefined) {
    return {};
  }

  const ran = yield* sh(main, "sh", [`${main}/.agents/skills/plan/scripts/plancheck.sh`, "--owners-json", plan]);
  return ran.code === 0 ? Schema.decodeUnknownOption(Owners)(ran.out).pipe(Option.getOrElse(() => ({}))) : {};
});

/** The PR body as it will be posted: the lane's body file, then both exam outputs (0014). */
const prBody = (body: string, loosening: string, mutation: string) => {
  const [first = "", ...rest] = body.split("\n");
  const fence = (t: string) => ["```text", t.trimEnd() || "(empty)", "```"];
  return {
    title: first.replace(/^#+\s*/, "").trim(),
    body: [
      rest.join("\n").trim(),
      "",
      "## Loosening",
      "",
      ...fence(loosening),
      "",
      "## Mutation, arm a vs arm b",
      "",
      ...fence(mutation),
      "",
    ].join("\n"),
  };
};

const ready = Command.make(
  "ready",
  {
    lane: Argument.String("lane"),
    tree: Flag.String("tree"),
    body: Flag.String("body").pipe(Flag.optional),
    loosening: Flag.String("loosening").pipe(Flag.optional),
    mutation: Flag.String("mutation").pipe(Flag.optional),
    lead: Flag.String("lead").pipe(Flag.atLeast(0)),
    plan: Flag.String("plan").pipe(Flag.optional),
  },
  Effect.fn("land.ready")(function* (ask) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const env = yield* loadEnv;
    const tree = path.resolve(ask.tree);
    const branch = yield* must("ready", "the tree is on no branch", tree, "git", ["symbolic-ref", "--short", "HEAD"]);

    if (!branch.startsWith("fabrikalfa/")) {
      return yield* new Refused({ check: "ready", reason: `branch ${branch} is not fabrikalfa/<name>`, output: "" });
    }

    const dirty = yield* must("ready", "git status failed", tree, "git", ["status", "--porcelain"]);

    if (dirty !== "") {
      return yield* new Refused({ check: "ready", reason: "the tree has changes: commit them first", output: dirty });
    }

    const given = Option.all({ body: ask.body, loosening: ask.loosening, mutation: ask.mutation });
    const some = [ask.body, ask.loosening, ask.mutation].filter(Option.isSome).length;

    if (some !== 0 && Option.isNone(given)) {
      return yield* new Refused({
        check: "ready",
        reason: "give --body, --loosening and --mutation together",
        output: "",
      });
    }

    const pr = Option.getOrUndefined(
      Option.map(given, (files) => ({
        body: path.resolve(files.body),
        loosening: path.resolve(files.loosening),
        mutation: path.resolve(files.mutation),
      })),
    );

    for (const [name, file] of Object.entries(pr ?? {})) {
      const read = yield* fs.readFileString(file).pipe(Effect.option);

      if (Option.isNone(read) || read.value.trim() === "") {
        return yield* new Refused({ check: "ready", reason: `--${name} ${file} is missing or empty`, output: "" });
      }
    }

    if (pr !== undefined && prBody(yield* fs.readFileString(pr.body), "", "").title === "") {
      return yield* new Refused({ check: "ready", reason: "the body file's first line is the PR title", output: "" });
    }

    const head = yield* must("ready", "HEAD does not read", tree, "git", ["rev-parse", "HEAD"]);
    const lead: string[] = [];

    for (const sha of ask.lead) {
      lead.push(yield* must("ready", `--lead ${sha} is not a commit`, tree, "git", ["rev-parse", `${sha}^{commit}`]));
    }

    const record = new Ready({
      lane: ask.lane,
      tree,
      branch,
      head,
      lead,
      pr,
      plan: Option.getOrUndefined(Option.map(ask.plan, (p) => path.resolve(p))),
      sentAt: DateTime.formatIso(yield* DateTime.now),
    });
    yield* fs.makeDirectory(`${env.BOXES}/state`, { recursive: true });
    yield* fs.writeFileString(`${env.BOXES}/state/${ask.lane}.land.json`, Schema.encodeSync(ReadyJson)(record));
    yield* note(
      env.BOXES,
      ask.lane,
      `lane agent: ready ${pr ? "to land" : "for the -wip push of"} ${branch} at ${head.slice(0, 8)}; the lead runs land.ts run`,
    );
    yield* Console.log(`ready to land: ${ask.lane} ${branch} at ${head.slice(0, 8)}`);
  }),
);

// The steps, one exported Effect each, so a flow (0064, ticket 656) can run them one by one. Each
// takes the lane's facts and gives back what the next one needs; `run` below is a thin caller.

/** The lane as the lead lands it: what the lane agent recorded, the ticket, and env.sh's paths. */
export type Lane = {
  readonly lane: string;
  readonly ticket: string;
  readonly ready: Ready;
  readonly env: Effect.Success<typeof loadEnv>;
};

const gitIn =
  (tree: string) =>
  (check: typeof Check.Type, reason: string, ...args: ReadonlyArray<string>) =>
    must(check, reason, tree, "git", args);

/** Reads what the lane agent recorded with `land.ts ready`. */
export const readReady = Effect.fn("land.readReady")(function* (lane: string, ticket: string) {
  const fs = yield* FileSystem.FileSystem;
  const env = yield* loadEnv;
  const ready = yield* fs.readFileString(`${env.BOXES}/state/${lane}.land.json`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ReadyJson)),
    Effect.mapError(
      () =>
        new Refused({ check: "ready", reason: `no readable state/${lane}.land.json: run land.ts ready`, output: "" }),
    ),
  );
  return { lane, ticket, ready, env } satisfies Lane;
});

/** Refuses unless the tree is clean, on the ready branch and at the ready head. */
export const checkTree = Effect.fn("land.checkTree")(function* ({ ready }: Lane) {
  const git = gitIn(ready.tree);
  const on = yield* git("check", "the tree is on no branch", "symbolic-ref", "--short", "HEAD");
  const head = yield* git("check", "HEAD does not read", "rev-parse", "HEAD");
  const dirty = yield* git("check", "git status failed", "status", "--porcelain");

  if (on !== ready.branch || head !== ready.head) {
    return yield* new Refused({
      check: "check",
      reason: `the tree is at ${on} ${head.slice(0, 8)}, not the ready ${ready.branch} ${ready.head.slice(0, 8)}; run land.ts ready again`,
      output: "",
    });
  }

  if (dirty !== "") {
    return yield* new Refused({ check: "check", reason: "the tree has changes; nothing was done", output: dirty });
  }
});

/** Writes the PR body as it will be posted and leak-greps it; none for a mid-lane handover. */
export const draftPr = Effect.fn("land.draftPr")(function* ({ lane, ready, env }: Lane) {
  const fs = yield* FileSystem.FileSystem;

  if (ready.pr === undefined) {
    return undefined;
  }

  const posted = prBody(
    yield* fs.readFileString(ready.pr.body),
    yield* fs.readFileString(ready.pr.loosening),
    yield* fs.readFileString(ready.pr.mutation),
  );
  const file = `${env.BOXES}/${lane}-land-body.md`;
  yield* fs.writeFileString(file, posted.body);
  yield* must("leak", "the leak grep refused the PR body", ready.tree, "sh", [`${HERE}/leakgrep.sh`, "--text", file]);
  return { title: posted.title, file };
});

/** Fetches main and merges it in as the bot, never a rebase; a conflict names each file's step. */
export const mergeMain = Effect.fn("land.mergeMain")(function* ({ ready, env }: Lane) {
  const git = gitIn(ready.tree);
  yield* git("fetch", "origin main could not be fetched", "fetch", "-q", "origin", "main");
  const main = yield* git("fetch", "the fetched main is not a commit", "rev-parse", "FETCH_HEAD^{commit}");
  const behind = (yield* sh(ready.tree, "git", ["merge-base", "--is-ancestor", main, "HEAD"])).code !== 0;

  if (behind) {
    const merged = yield* sh(ready.tree, "git", [
      ...BOT,
      "merge",
      "-q",
      "--no-ff",
      "--no-edit",
      "-m",
      `Merge main into ${ready.branch}`,
      "-m",
      `Co-authored-by: ${env.COAUTHOR}`,
      main,
    ]);

    if (merged.code !== 0) {
      const conflicts = (yield* sh(ready.tree, "git", ["diff", "--name-only", "--diff-filter=U"])).out
        .split("\n")
        .filter((p) => p !== "");
      const owners = yield* planOwners(env.MAIN, ready.plan);
      return yield* new Refused({
        check: "merge",
        reason: [
          `merging main ${main.slice(0, 8)} conflicts in ${conflicts.length} files; nothing changed. Send each to the step that owns it:`,
          ...conflicts.map((p) => `  ${p}: ${stepOwning(owners, p)}`),
        ].join("\n"),
        output: `${merged.out}${merged.err}`,
      });
    }
  }

  return { main, merged: behind };
});

/** Leak-greps the branch's net change from main and each commit a push would send (0048). */
export const leakCheck = Effect.fn("land.leakCheck")(function* ({ ready }: Lane, main: string) {
  const leakgrep = `${HERE}/leakgrep.sh`;
  const diff = yield* gitIn(ready.tree)(
    "leak",
    "the diff from main does not read",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--unified=0",
    `${main}...HEAD`,
  );
  yield* must("leak", "the leak grep refused the branch's change", ready.tree, "sh", [leakgrep], `${diff}\n`);
  yield* must("leak", "the leak grep refused a commit", ready.tree, "sh", [
    leakgrep,
    "--commits",
    "HEAD",
    "--not",
    "--remotes=origin",
  ]);
});

/**
 * Signs as lead through main's own signer, which alone reads the key: each named lead commit,
 * oldest first, each in the lane with one parent and no note yet, then the merge of main when there
 * is one. Gives back how many it signed.
 */
export const signLead = Effect.fn("land.signLead")(function* (
  { lane, ticket, ready, env }: Lane,
  main: string,
  merged: boolean,
) {
  const git = gitIn(ready.tree);
  const commits = (yield* git(
    "sign",
    "the lane's commits do not read",
    "rev-list",
    "--reverse",
    "--topo-order",
    `${main}..HEAD`,
  )).split("\n");
  const missing = ready.lead.filter((sha) => !commits.includes(sha));

  if (missing.length > 0) {
    return yield* new Refused({
      check: "sign",
      reason: `lead commits not on the lane: ${missing.join(" ")}`,
      output: "",
    });
  }

  const signer = `${env.MAIN}/next/apps/fabrika/src/exam/commits.ts`;
  const key = `${env.HOME}/.fabrika/step-keys/lead`;
  const sign = (at: string, what: string) =>
    must("sign", `the sign script refused ${what}`, at, "node", [
      signer,
      "sign",
      "--step",
      "lead",
      "--ticket",
      ticket,
      "--key",
      key,
    ]);

  for (const sha of commits.filter((c) => ready.lead.includes(c))) {
    const parents = (yield* git("sign", `${sha} does not read`, "rev-list", "--parents", "-n", "1", sha)).split(" ");
    const noted = yield* sh(ready.tree, "git", ["notes", "--ref=fabrika", "show", sha]);

    if (parents.length !== 2 || noted.code === 0) {
      return yield* new Refused({
        check: "sign",
        reason: `${sha} is a merge or already signed; name only unsigned lead commits`,
        output: "",
      });
    }

    // The signer signs HEAD, so each older commit gets a detached checkout of its own, given back after.
    const at = `${env.BOXES}/land-${lane}-${sha.slice(0, 8)}`;
    yield* Effect.acquireUseRelease(
      git("sign", `no checkout of ${sha}`, "worktree", "add", "-q", "--detach", at, sha),
      () => sign(at, `lead commit ${sha.slice(0, 8)}`),
      () => sh(ready.tree, "git", ["worktree", "remove", "--force", at]),
    );
  }

  if (merged) {
    yield* sign(ready.tree, "the merge of main");
  }

  return ready.lead.length + (merged ? 1 : 0);
});

/** Pushes with botpush.mjs: to the branch, or to its -wip backup for a mid-lane handover. */
export const push = Effect.fn("land.push")(function* ({ ready }: Lane) {
  const target = ready.pr === undefined ? `${ready.branch.replace(/(-wip)+$/, "")}-wip` : ready.branch;
  yield* must("push", `botpush.mjs to ${target} failed`, ready.tree, "node", [
    `${HERE}/botpush.mjs`,
    ready.tree,
    target,
    "HEAD",
  ]);
  return { target, tip: yield* gitIn(ready.tree)("push", "HEAD does not read", "rev-parse", "HEAD") };
});

/** Opens the PR, or updates the open one through the REST API (`gh pr edit` fails here, AGENTS.md). */
export const openPr = Effect.fn("land.openPr")(function* (
  { ready, env }: Lane,
  draft: { readonly title: string; readonly file: string },
) {
  const listed = yield* must("pr", "gh pr list failed", ready.tree, "gh", [
    "pr",
    "list",
    "-R",
    env.GH_REPO,
    "--head",
    ready.branch,
    "--state",
    "open",
    "--json",
    "number",
    "-q",
    ".[0].number",
  ]);
  const open = Number(listed);

  if (listed !== "" && Number.isInteger(open) && open > 0) {
    yield* must("pr", `PR ${open} could not be updated`, ready.tree, "gh", [
      "api",
      "-X",
      "PATCH",
      `repos/${env.GH_REPO}/pulls/${open}`,
      "-f",
      `title=${draft.title}`,
      "-F",
      `body=@${draft.file}`,
    ]);
    return open;
  }

  const made = yield* must("pr", "gh pr create failed", ready.tree, "gh", [
    "pr",
    "create",
    "-R",
    env.GH_REPO,
    "--head",
    ready.branch,
    "--title",
    draft.title,
    "--body-file",
    draft.file,
  ]);
  const number = Number(/\/pull\/(\d+)/.exec(made)?.[1]);

  if (!Number.isInteger(number)) {
    return yield* new Refused({ check: "pr", reason: "gh pr create named no PR", output: made });
  }

  return number;
});

/** Runs catchup.sh, which waits for CI on the pushed head and squash-lands it. */
export const catchup = Effect.fn("land.catchup")(function* ({ ticket, ready }: Lane, pr: number) {
  const code = yield* Effect.scoped(
    Effect.flatMap(
      ChildProcess.make("sh", [`${HERE}/catchup.sh`, String(pr), ticket], {
        cwd: ready.tree,
        stdout: "inherit",
        stderr: "inherit",
      }),
      (h) => h.exitCode,
    ),
  ).pipe(Effect.mapError(() => new Refused({ check: "catchup", reason: "catchup.sh could not start", output: "" })));

  if (Number(code) !== 0) {
    return yield* new Refused({ check: "catchup", reason: `catchup.sh ${pr} ${ticket} exited ${code}`, output: "" });
  }
});

/** Puts HEAD and the notes back as they were before the merge: the tree was clean, so nothing else is lost. */
const rollback = Effect.fn("land.rollback")(function* ({ ready }: Lane) {
  const notes = yield* sh(ready.tree, "git", ["rev-parse", "--verify", "-q", "refs/notes/fabrika"]);
  return Effect.gen(function* () {
    yield* sh(ready.tree, "git", ["merge", "--abort"]);
    yield* sh(ready.tree, "git", ["reset", "-q", "--hard", ready.head]);
    yield* sh(
      ready.tree,
      "git",
      notes.code === 0
        ? ["update-ref", "refs/notes/fabrika", notes.out.trim()]
        : ["update-ref", "-d", "refs/notes/fabrika"],
    );
  });
});

const run = Command.make(
  "run",
  { lane: Argument.String("lane"), ticket: Argument.String("ticket") },
  Effect.fn("land.run")(function* ({ lane: name, ticket }) {
    const lane = yield* readReady(name, ticket);
    const say = (line: string) => Effect.andThen(note(lane.env.BOXES, name, `land.ts: ${line}`), Console.log(line));
    yield* checkTree(lane);
    const draft = yield* draftPr(lane);
    const back = yield* rollback(lane);
    // Every refusal before the push changes nothing.
    const { main, signed, target, tip } = yield* Effect.gen(function* () {
      const { main, merged } = yield* mergeMain(lane);
      yield* leakCheck(lane, main);
      const signed = yield* signLead(lane, main, merged);
      return { main, signed, ...(yield* push(lane)) };
    }).pipe(Effect.onError(() => back));
    yield* say(`main at ${main.slice(0, 8)}, signed ${signed} lead commits, pushed ${target} at ${tip.slice(0, 8)}`);

    if (draft === undefined) {
      return;
    }

    const pr = yield* openPr(lane, draft);
    yield* say(`PR https://github.com/${lane.env.GH_REPO}/pull/${pr}; catchup.sh ${pr} ${ticket}`);
    yield* catchup(lane, pr);
    yield* say(`landed PR ${pr}`);
  }),
);

const land = Command.make("land").pipe(Command.withSubcommands([ready, run]));

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(land, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError((e) =>
        e instanceof Refused
          ? Console.error(
              [lastLines(e.output), `land: refused at the ${e.check} check: ${e.reason}`].filter(Boolean).join("\n"),
            )
          : Effect.void,
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
