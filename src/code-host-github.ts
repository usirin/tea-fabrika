import { Effect, Layer, Option, Schedule, Schema, Stream } from "effect";
import { everyOwner, ownersOf, parseCodeowners, teamOf } from "./codeowners.ts";
import { isMachines, sh } from "./operator-live.ts";
import { CodeHost } from "./services.ts";
import { type Rerun, type ReviewKind, reviewsOf, ShipFacts } from "./stages/ship/facts.ts";
import { verdictsIn } from "./verdict.ts";

// `CodeHost` on GitHub, the read side only. Everything the ship gate needs
// about a pull request comes from GraphQL calls through `gh`, at one head
// commit. Nothing here writes: no enqueue, no label, no comment, no merge.
// The writes are in `code-host-github-writes.ts`, behind a service of their
// own.
//
// Two things here wait: the checks, and the merge queue. Each is a read asked
// again every `pollMs`, because GitHub does not push to a command-line tool.
//
// Two calls, and a third when a team owns a protected file:
//   1. the head commit and the base branch's name
//   2. the pull request, with three files read beside it: the base branch's
//      `.github/CODEOWNERS`, and `.fabrika.jsonc` at the base and at the head
//   3. the members of each team the CODEOWNERS file names
//
// Each fact is read the plainest honest way. Where the reading cannot say, the
// fact is `unknown`, never a guess. Where a value is less than it looks,
// `NOT_READ` says so, in words a person can read beside the facts.

const WHERE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid baseRefName } }
}`;

const QUERY = `
query($owner: String!, $name: String!, $number: Int!, $codeowners: String!, $baseConfig: String!, $headConfig: String!) {
  repository(owner: $owner, name: $name) {
    codeowners: object(expression: $codeowners) { ... on Blob { text } }
    baseConfig: object(expression: $baseConfig) { ... on Blob { text } }
    headConfig: object(expression: $headConfig) { ... on Blob { text } }
    pullRequest(number: $number) {
      state
      isDraft
      headRefOid
      body
      author { __typename login }
      mergeable
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      files(first: 100) { pageInfo { hasNextPage } nodes { path } }
      reviews(last: 100) { nodes { state author { __typename login } commit { oid } } }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { id isResolved comments(first: 50) { nodes { body author { __typename login } } } }
      }
      comments(last: 100) { nodes { createdAt body author { __typename login } } }
    }
  }
}`;

const TEAM = `
query($org: String!, $team: String!) {
  organization(login: $org) { team(slug: $team) { members(first: 100) { pageInfo { hasNextPage } nodes { login } } } }
}`;

/** `null`: the account is gone. */
const Author = Schema.NullOr(Schema.Struct({ __typename: Schema.String, login: Schema.String }));
type Author = typeof Author.Type;

/** A file read beside the pull request. `null`: no such file. */
const Blob = Schema.NullOr(Schema.Struct({ text: Schema.optional(Schema.NullOr(Schema.String)) }));
const textOf = (blob: typeof Blob.Type): string | null => blob?.text ?? null;

/** The pull request as the query above answers. */
const Pr = Schema.Struct({
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRefOid: Schema.String,
  body: Schema.String,
  author: Author,
  mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          oid: Schema.String,
          /** `null`: no check has reported on the commit. */
          statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.Literals(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]) })),
        }),
      }),
    ),
  }),
  files: Schema.Struct({ pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }), nodes: Schema.Array(Schema.Struct({ path: Schema.String })) }),
  reviews: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ state: Schema.String, author: Author, commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })) })),
  }),
  reviewThreads: Schema.Struct({
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        isResolved: Schema.Boolean,
        comments: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ body: Schema.String, author: Author })) }),
      }),
    ),
  }),
  comments: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ createdAt: Schema.String, body: Schema.String, author: Author })) }),
});
type Pr = typeof Pr.Type;

const Where = Schema.Struct({
  data: Schema.Struct({ repository: Schema.Struct({ pullRequest: Schema.Struct({ headRefOid: Schema.String, baseRefName: Schema.String }) }) }),
});
const Answer = Schema.Struct({
  data: Schema.Struct({ repository: Schema.Struct({ codeowners: Blob, baseConfig: Blob, headConfig: Blob, pullRequest: Pr }) }),
});
const Team = Schema.Struct({
  data: Schema.Struct({
    organization: Schema.Struct({
      team: Schema.Struct({
        members: Schema.Struct({ pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }), nodes: Schema.Array(Schema.Struct({ login: Schema.String })) }),
      }),
    }),
  }),
});

/**
 * What this reading cannot say, though the fact has a value. Shown beside the
 * facts wherever they are printed, so nobody takes a value for more than it is.
 */
export const NOT_READ: readonly string[] = [
  "reviews: which kinds a pull request needs is worked out here, by a copy of today's fabrika's rules (its file-to-kind map and its default governed folders) over the repo's own `.fabrika.jsonc`. It is not asked of fabrika, so the two can drift.",
  "reviews, approval: the first 100 changed files. With more, both read `unknown`.",
  "checks: every check on the head commit, required or not. `stuck` is never answered: nothing here says how long is too long.",
  "comments: unresolved review threads only. An agent that comments from a person's account with no hidden mark reads as that person.",
];

/** `owner`, `name` and the number, from a pull request's URL. */
export function prOf(url: string): { readonly owner: string; readonly name: string; readonly number: number } | null {
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(url);
  return m === null ? null : { owner: m[1] as string, name: m[2] as string, number: Number(m[3]) };
}

const ISSUE = String.raw`(?:(?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)`;
/** GitHub's own closing words: close, fix, resolve, in their three forms. */
const CLOSES = new RegExp(String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+${ISSUE}`, "i");
const PART_OF = new RegExp(String.raw`\bpart of\s+${ISSUE}`, "i");

/**
 * The ticket a body serves, by today's fabrika's rule: a closing word if the
 * body has one, else `Part of #N`. Any other mention (`Refs #N`, `Re: #N`)
 * serves no ticket.
 */
export const ticketOf = (body: string): ShipFacts["ticket"] => (CLOSES.test(body) ? "closes_it" : PART_OF.test(body) ? "part_of_it" : "none");

/** Whether an account is one of a list. GitHub logins do not tell case apart. */
const isOneOf = (author: Author, logins: readonly string[]): boolean =>
  author !== null && logins.some((login) => login.toLowerCase() === author.login.toLowerCase());
/** Whether a commit, written whole or short, is this head. */
const isHead = (head: string, written: string): boolean => written.length >= 7 && head.startsWith(written);

// ---------------------------------------------------------------- which reviews a pull request needs

/** `.fabrika.jsonc` as a value: JSON with comments and trailing commas. `undefined`: it does not parse. */
export function parseJsonc(text: string): unknown {
  // Strings are kept whole; a comment is dropped; a comma before a closing bracket is dropped.
  const bare = text.replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_all, string?: string) => string ?? "");
  try {
    return JSON.parse(bare.replace(/("(?:[^"\\\n]|\\.)*")|,(?=\s*[}\]])/g, (_all, string?: string) => string ?? ""));
  } catch {
    return undefined;
  }
}

/** The two keys of a repo's `.fabrika.jsonc` that say which reviews a change needs. */
interface Rules {
  /** A change under one of these needs the governance review. */
  readonly governed: readonly string[];
  /** A change under one of these needs the rendered review. */
  readonly ui: readonly string[];
}

/** Fabrika's own default for `governedRoots`, copied from fabrika 0.9: used when a repo's config leaves the key out. */
const DEFAULT_GOVERNED = [".decisions/", ".claude/", ".github/", ".fabrika.jsonc"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The rules one `.fabrika.jsonc` gives. `null`: the text is not a config this can read. */
export function rulesOf(text: string): Rules | null {
  const config = parseJsonc(text);
  if (!isRecord(config)) return null;
  const { governedRoots = DEFAULT_GOVERNED, uiSurfaces = [] } = config;
  if (!Array.isArray(governedRoots) || !governedRoots.every((root) => typeof root === "string")) return null;
  if (!Array.isArray(uiSurfaces) || !uiSurfaces.every((s) => isRecord(s) && typeof s.prefix === "string")) return null;
  return { governed: governedRoots, ui: uiSurfaces.map((s) => s.prefix as string) };
}

/**
 * The kinds of review a set of changed files needs, by today's fabrika's
 * rules (copied from fabrika 0.9, see `NOT_READ`). Each file is skill-page
 * text, a doc, or code; a file under a rendered surface adds the rendered
 * review; a file under a governed folder adds the governance review.
 */
export function kindsNeeded(files: readonly string[], rules: Rules): readonly ReviewKind["kind"][] {
  const under = (path: string, roots: readonly string[]) => roots.some((root) => (root.endsWith("/") ? path.startsWith(root) : path === root));
  const skill = (p: string) => p.startsWith("claude-plugins/") || p.startsWith(".claude/") || p.startsWith("skills/") || p === "SKILL.md" || p.endsWith("/SKILL.md");
  const needs = {
    "review-code": files.some((p) => !skill(p) && !p.endsWith(".md")),
    "review-doc": files.some((p) => !skill(p) && p.endsWith(".md")),
    "review-skill": files.some(skill),
    "review-ui": files.some((p) => under(p, rules.ui) && !/\.(?:test|spec)\.tsx?$/.test(p)),
    // A governed root is a prefix, folder or not, as fabrika reads it.
    governance: files.some((p) => rules.governed.some((root) => p.startsWith(root))),
  };
  return (Object.keys(needs) as (keyof typeof needs)[]).filter((kind) => needs[kind]);
}

/**
 * The last verdict of each kind of review that binds to this head and was
 * posted by an account whose verdicts count. A verdict for an older commit is
 * not one for this head, however many passed there.
 */
export function verdictsAt(head: string, comments: Pr["comments"]["nodes"], reviewers: readonly string[]): ReadonlyMap<string, "PASS" | "FAIL"> {
  const last = new Map<string, "PASS" | "FAIL">();
  for (const comment of [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (!isOneOf(comment.author, reviewers)) continue;
    const [standing] = verdictsIn(comment.body);
    if (standing === undefined) continue;
    const at = standing.marker.head ?? standing.marker.range?.tip ?? null;
    if (at === null || !isHead(head, at)) continue;
    last.set(standing.marker.namespace, standing.marker.polarity);
  }
  return last;
}

/**
 * Each kind of review this pull request needs, and how it stands at the head.
 * A failing verdict of a kind it does not need is listed too: a review that
 * ran and failed is not passed over. `null`: what it needs cannot be told.
 */
export function reviewKindsOf(pr: Pr, configs: readonly (string | null)[], reviewers: readonly string[]): readonly ReviewKind[] | null {
  const files = pr.files.nodes.map((file) => file.path);
  // The base's rules and the head's, together: a change cannot take itself out of a review.
  const rules = configs.flatMap((text) => (text === null ? [] : (rulesOf(text) ?? [])));
  // A config that is not there, or does not read, on either side: the rules are not known.
  if (rules.length !== configs.length || rules.length === 0 || files.length === 0 || pr.files.pageInfo.hasNextPage) return null;
  const all: Rules = { governed: rules.flatMap((r) => r.governed), ui: rules.flatMap((r) => r.ui) };
  const verdicts = verdictsAt(pr.headRefOid, pr.comments.nodes, reviewers);
  const needed = kindsNeeded(files, all);
  const alsoFailed = [...verdicts].flatMap(([kind, verdict]) => (verdict === "FAIL" && !needed.includes(kind as ReviewKind["kind"]) ? [kind as ReviewKind["kind"]] : []));
  return [...needed, ...alsoFailed].map((kind) => {
    const verdict = verdicts.get(kind);
    return { kind, verdict: verdict === undefined ? "missing" : verdict === "PASS" ? "passed" : "failed" };
  });
}

// ---------------------------------------------------------------- the owner's approval

/** The words a repo's one owner leaves on their own pull request, with the commit they are for. */
const SELF_APPROVAL = /control-plane-self-approval @ ([0-9a-f]{7,40})/;

/**
 * Whose approval a pull request needs, from the base branch's CODEOWNERS:
 * nobody's when no changed file has an owner, else any one of the owners the
 * file names. `unknown`: no CODEOWNERS, so no boundary was declared, or more
 * changed files than were read.
 */
export function approvalNeeded(pr: Pr, codeowners: string | null): { readonly kind: "not_needed" | "unknown" } | { readonly kind: "one_of"; readonly owners: readonly string[] } {
  if (codeowners === null) return { kind: "unknown" };
  const rows = parseCodeowners(codeowners);
  if (pr.files.nodes.some((file) => ownersOf(rows, file.path).length > 0)) return { kind: "one_of", owners: everyOwner(rows) };
  return { kind: pr.files.pageInfo.hasNextPage || pr.files.nodes.length === 0 ? "unknown" : "not_needed" };
}

/**
 * Whether one of the owners approved this head, by today's fabrika's rule. A
 * repo's one owner on their own pull request approves with a comment that
 * names the commit. Anyone else: an approving review of this head by an owner
 * who did not open the pull request.
 */
export function approvedBy(pr: Pr, owners: readonly string[]): "given" | "missing" {
  const soleAuthor = owners.length === 1 && isOneOf(pr.author, owners);
  if (soleAuthor) {
    const said = pr.comments.nodes.some((c) => isOneOf(c.author, owners) && isHead(pr.headRefOid, SELF_APPROVAL.exec(c.body)?.[1] ?? ""));
    return said ? "given" : "missing";
  }
  const approved = pr.reviews.nodes.some(
    (r) => r.state === "APPROVED" && r.commit?.oid === pr.headRefOid && isOneOf(r.author, owners) && r.author?.login.toLowerCase() !== pr.author?.login.toLowerCase(),
  );
  return approved ? "given" : "missing";
}

// ---------------------------------------------------------------- the facts

const CHECKS = { SUCCESS: "green", FAILURE: "red", ERROR: "red", PENDING: "pending", EXPECTED: "pending" } as const;
const MERGEABLE = { MERGEABLE: "clean", CONFLICTING: "conflicts", UNKNOWN: "unknown" } as const;

/** Who is who, as settings of the run: nothing here names an account. */
export interface Accounts {
  /** The accounts the repo treats as its own: who may open a pull request this machine lands. */
  readonly own: readonly string[];
  /** The accounts whose review verdicts count. */
  readonly reviewers: readonly string[];
}

/** The facts in one answer. `null`: the answer does not hold them all at one head, and nothing is guessed. */
export function factsOf(pr: Pr, accounts: Accounts, approval: ShipFacts["approval"], configs: readonly (string | null)[]): ShipFacts | null {
  const [last] = pr.commits.nodes;
  // The checks must be the head's own, and every thread must be in hand.
  if (last === undefined || last.commit.oid !== pr.headRefOid || pr.reviewThreads.pageInfo.hasNextPage) return null;
  const rollup = last.commit.statusCheckRollup;
  const kinds = reviewKindsOf(pr, configs, accounts.reviewers);
  return {
    head: pr.headRefOid,
    state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open",
    ours: isOneOf(pr.author, accounts.own),
    ticket: ticketOf(pr.body),
    approval,
    reviews: kinds === null ? "unknown" : reviewsOf(kinds),
    reviewKinds: kinds ?? [],
    // No check has reported: it cannot be told from "none will", so it waits.
    checks: rollup === null ? "pending" : CHECKS[rollup.state],
    mergeable: MERGEABLE[pr.mergeable],
    comments: pr.reviewThreads.nodes
      .filter((thread) => !thread.isResolved)
      .map((thread) => ({
        id: thread.id,
        // A thread a person wrote or joined is the person's. A bot account, or a comment with a machine's mark, is not one.
        by: thread.comments.nodes.some((c) => c.author?.__typename !== "Bot" && !isMachines(c.body)) ? ("person" as const) : ("bot" as const),
      })),
  };
}

const failed = Effect.fail({ _tag: "unknown" as const });

/** One `gh` call, by its arguments: its stdout. */
export type Gh = (args: readonly string[]) => Effect.Effect<string, { readonly _tag: "unknown" }>;

/** One `gh` call whose stdout is JSON, decoded. Text that is not JSON, or JSON that does not fit, is the same failure as a call that broke. */
export const answerOf = <A>(gh: Gh, schema: Schema.Codec<A, unknown>, args: readonly string[]) =>
  Effect.gen(function* () {
    const out = yield* gh(args);
    const parsed = yield* Effect.try({ try: () => JSON.parse(out) as unknown, catch: () => ({ _tag: "unknown" as const }) });
    const answer = Schema.decodeUnknownOption(schema)(parsed);
    return Option.isNone(answer) ? yield* failed : answer.value;
  });

/** One GraphQL call, decoded. */
export const ask = <A>(gh: Gh, schema: Schema.Codec<A, unknown>, query: string, fields: Readonly<Record<string, string | number>>) => {
  // `-F` reads a number as a number; `-f` keeps a text as it is.
  const args = Object.entries(fields).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
  return answerOf(gh, schema, ["api", "graphql", ...args, "-f", `query=${query}`]);
};

/**
 * The accounts behind a list of owners: an account is itself, a team is its
 * members. `null`: a team could not be read whole. A list missing one team is
 * not a shorter list, it is an unknown one.
 */
const accountsOf = (gh: Gh, owners: readonly string[]) =>
  Effect.forEach(owners, (owner) => {
    const team = teamOf(owner);
    if (team === null) return Effect.succeed<readonly string[] | null>([owner.replace(/^@/, "")]);
    return ask(gh, Team, TEAM, team).pipe(
      Effect.map(({ data }) => data.organization.team.members),
      Effect.match({ onSuccess: (m): readonly string[] | null => (m.pageInfo.hasNextPage ? null : m.nodes.map((n) => n.login)), onFailure: () => null }),
    );
  }).pipe(Effect.map((lists) => (lists.some((list) => list === null) ? null : lists.flatMap((list) => list ?? []))));

/**
 * Read one pull request's facts through `gh`. An answer that does not parse,
 * does not fit, or does not hold the facts at one head is the same failure
 * as a call that broke: `unknown`, never a throw and never a guess.
 */
export const readPrFacts =
  (gh: Gh, accounts: Accounts) =>
  (url: string): Effect.Effect<ShipFacts, { readonly _tag: "unknown" }> =>
    Effect.gen(function* () {
      const at = prOf(url);
      if (at === null) return yield* failed;
      const { headRefOid: head, baseRefName: base } = (yield* ask(gh, Where, WHERE, at)).data.repository.pullRequest;
      const { repository } = (yield* ask(gh, Answer, QUERY, {
        ...at,
        // The protected files and their owners are the base branch's: a change cannot take itself out of them.
        codeowners: `${base}:.github/CODEOWNERS`,
        baseConfig: `${base}:.fabrika.jsonc`,
        headConfig: `${head}:.fabrika.jsonc`,
      })).data;
      const pr = repository.pullRequest;
      // The head moved between the two calls: the files beside it are another commit's.
      if (pr.headRefOid !== head) return yield* failed;
      const need = approvalNeeded(pr, textOf(repository.codeowners));
      const owners = need.kind === "one_of" ? yield* accountsOf(gh, need.owners) : null;
      const approval = need.kind !== "one_of" ? need.kind : owners === null ? "unknown" : approvedBy(pr, owners);
      const facts = factsOf(pr, accounts, approval, [textOf(repository.baseConfig), textOf(repository.headConfig)]);
      const checked = facts === null ? Option.none() : Schema.decodeUnknownOption(ShipFacts)(facts);
      return Option.isNone(checked) ? yield* failed : checked.value;
    });

// ---------------------------------------------------------------- the two waits

const CHECKS_NOW = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { headRefOid commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } }
  }
}`;
const ChecksNow = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Struct({
        headRefOid: Schema.String,
        commits: Schema.Struct({
          nodes: Schema.Array(Schema.Struct({ commit: Schema.Struct({ oid: Schema.String, statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })) }) })),
        }),
      }),
    }),
  }),
});
/** One run of a workflow, as GitHub's REST API answers. `run_attempt`: which try it is on. */
const RunNow = Schema.Struct({ status: Schema.String, run_attempt: Schema.Number });

/**
 * Whether the checks of `head` have settled, read once. A head that is no
 * longer this one counts as settled: this wait is over, and the fresh read
 * that follows finds the new head. A re-run has settled only when each run
 * started again has finished a later try than the one it was on: until
 * then GitHub still shows the old red run, which must not be taken for the
 * answer. A read that fails says "not yet".
 */
export const checksSettledNow = (gh: Gh, url: string, head: string, after: readonly Rerun[]): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const at = prOf(url);
    if (at === null) return false;
    const pr = (yield* ask(gh, ChecksNow, CHECKS_NOW, at)).data.repository.pullRequest;
    if (pr.headRefOid !== head) return true;
    const [last] = pr.commits.nodes;
    const state = last?.commit.oid === head ? last.commit.statusCheckRollup?.state : undefined;
    // No check has reported, or one is still running or still expected.
    if (state === undefined || state === "PENDING" || state === "EXPECTED") return false;
    for (const { run, attempt } of after) {
      const now = yield* answerOf(gh, RunNow, ["api", `repos/${at.owner}/${at.name}/actions/runs/${run}`]);
      if (now.run_attempt <= attempt || now.status !== "completed") return false;
    }
    return true;
  }).pipe(Effect.match({ onSuccess: (settled) => settled, onFailure: () => false }));

const QUEUE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { state isInMergeQueue mergeCommit { oid } } }
}`;
const QueueNow = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Struct({
        state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
        isInMergeQueue: Schema.Boolean,
        mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
      }),
    }),
  }),
});

/** How a pull request left the merge queue. `commit`: the commit on the base branch. */
export type LeftQueue = { readonly reading: "landed"; readonly commit: string } | { readonly reading: "ejected" };

/**
 * How the pull request left the merge queue, read once. `null`: it is still
 * in it, or the read failed. Merged is `landed`, with the commit GitHub made
 * on the base branch. Open and no longer in the queue, or closed, is `ejected`.
 */
export const leftQueueNow = (gh: Gh, url: string): Effect.Effect<LeftQueue | null> =>
  Effect.gen(function* () {
    const at = prOf(url);
    if (at === null) return null;
    const pr = (yield* ask(gh, QueueNow, QUEUE, at)).data.repository.pullRequest;
    // Merged, and GitHub has not named the commit yet: not an answer yet.
    if (pr.state === "MERGED") return pr.mergeCommit === null ? null : ({ reading: "landed", commit: pr.mergeCommit.oid } as const);
    return pr.state === "CLOSED" || !pr.isInMergeQueue ? ({ reading: "ejected" } as const) : null;
  }).pipe(Effect.match({ onSuccess: (left) => left, onFailure: () => null }));

/** A read asked now and then every `every` ms, until it has an answer. It says that answer once and ends. */
const until = <A>(every: number, read: Effect.Effect<A | null>): Stream.Stream<A> =>
  Stream.fromEffectSchedule(read, Schedule.spaced(every)).pipe(
    Stream.filter((answer): answer is A => answer !== null),
    Stream.take(1),
  );

/** The read side over one `gh`. `pollMs`: how often a wait asks again. */
export const codeHostOn = (gh: Gh, config: Accounts & { readonly pollMs?: number }): CodeHost["Service"] => {
  const every = config.pollMs ?? 30_000;
  return {
    prFacts: readPrFacts(gh, config),
    checksSettled: (pr, head, after) => until(every, Effect.map(checksSettledNow(gh, pr, head, after), (settled) => (settled ? true : null))).pipe(Stream.map(() => undefined)),
    leftQueue: (pr) => until(every, leftQueueNow(gh, pr)),
  };
};

/**
 * `CodeHost` on GitHub. The accounts are settings of the run, and so is
 * `pollMs`. `gh`: the GitHub CLI to run, for a test that stands one in.
 */
export const gitHubCodeHost = (config: Accounts & { readonly pollMs?: number; readonly gh?: string }) =>
  Layer.succeed(
    CodeHost,
    codeHostOn((args) => sh(config.gh ?? "gh", args), config),
  );
