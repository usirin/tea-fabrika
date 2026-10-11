import { Effect, Layer, Option, Schema } from "effect";
import { isMachines, sh } from "./operator-live.ts";
import { CodeHost } from "./services.ts";
import { ShipFacts } from "./stages/ship/facts.ts";
import { verdictsIn } from "./verdict.ts";

// `CodeHost` on GitHub, the read side only: one GraphQL call through `gh`
// gives everything the ship gate needs about a pull request, at one head
// commit. Nothing here writes: no enqueue, no label, no comment, no merge.
//
// Each fact is read the plainest honest way. Where GitHub alone cannot say,
// the reading stops short and `NOT_READ` says so, in words a person can read
// beside the facts.

const QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      isDraft
      headRefOid
      body
      author { __typename login }
      mergeable
      reviewDecision
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { id isResolved comments(first: 50) { nodes { body author { __typename login } } } }
      }
      comments(last: 100) { nodes { createdAt body author { __typename login } } }
    }
  }
}`;

/** `null`: the account is gone. */
const Author = Schema.NullOr(Schema.Struct({ __typename: Schema.String, login: Schema.String }));
type Author = typeof Author.Type;

/** The pull request as the query above answers. */
const Pr = Schema.Struct({
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRefOid: Schema.String,
  body: Schema.String,
  author: Author,
  mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  reviewDecision: Schema.NullOr(Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])),
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

const Answer = Schema.Struct({ data: Schema.Struct({ repository: Schema.Struct({ pullRequest: Pr }) }) });

/**
 * What this reading cannot say, though the fact has a value. Shown beside the
 * facts wherever they are printed, so nobody takes a value for more than it is.
 */
export const NOT_READ: readonly string[] = [
  "approval: a stub. It knows only what GitHub itself requires. Which files are protected is not read, so where GitHub requires no review it answers `missing`, never `not_needed`: the gate then asks an owner on every pull request.",
  "reviews: a verdict comment at the head commit, posted by one of the repo's own accounts. Which reviews this pull request needs is not read: one passing verdict and no failing one reads as `passed`.",
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

/** Whether an account is one of the repo's own. GitHub logins do not tell case apart. */
const isOwn = (author: Author, own: readonly string[]): boolean =>
  author !== null && own.some((login) => login.toLowerCase() === author.login.toLowerCase());

/**
 * The reviews at this head: the last verdict of each kind of review that
 * binds to the head commit and was posted by one of the repo's own accounts.
 * One that fails is `failed`. None at this head is `missing`, however many
 * passed on an earlier commit.
 */
export function reviewsAt(head: string, comments: Pr["comments"]["nodes"], own: readonly string[]): ShipFacts["reviews"] {
  const last = new Map<string, "PASS" | "FAIL">();
  for (const comment of [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (!isOwn(comment.author, own)) continue;
    const [standing] = verdictsIn(comment.body);
    if (standing === undefined) continue;
    const at = standing.marker.head ?? standing.marker.range?.tip ?? null;
    // Old verdicts write the commit short.
    if (at === null || !head.startsWith(at)) continue;
    last.set(standing.marker.namespace, standing.marker.polarity);
  }
  if (last.size === 0) return "missing";
  return [...last.values()].includes("FAIL") ? "failed" : "passed";
}

/**
 * The owner's approval, as far as GitHub says. A stub (see `NOT_READ`): where
 * GitHub requires no review, nobody has shown that none is needed, so the
 * answer is `missing` and the gate asks. The cost is a question too many,
 * never an unapproved merge.
 */
export const approvalAsFarAsGitHubSays = (decision: Pr["reviewDecision"]): ShipFacts["approval"] => (decision === "APPROVED" ? "given" : "missing");

const CHECKS = { SUCCESS: "green", FAILURE: "red", ERROR: "red", PENDING: "pending", EXPECTED: "pending" } as const;
const MERGEABLE = { MERGEABLE: "clean", CONFLICTING: "conflicts", UNKNOWN: "unknown" } as const;

/** The facts in one answer. `null`: the answer does not hold them all at one head, and nothing is guessed. */
export function factsOf(pr: Pr, own: readonly string[]): ShipFacts | null {
  const [last] = pr.commits.nodes;
  // The checks must be the head's own, and every thread must be in hand.
  if (last === undefined || last.commit.oid !== pr.headRefOid || pr.reviewThreads.pageInfo.hasNextPage) return null;
  const rollup = last.commit.statusCheckRollup;
  return {
    head: pr.headRefOid,
    state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open",
    ours: isOwn(pr.author, own),
    ticket: ticketOf(pr.body),
    approval: approvalAsFarAsGitHubSays(pr.reviewDecision),
    reviews: reviewsAt(pr.headRefOid, pr.comments.nodes, own),
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
const readAnswer = Schema.decodeUnknownOption(Answer);
const readFacts = Schema.decodeUnknownOption(ShipFacts);

/** One `gh` call, by its arguments: its stdout. */
export type Gh = (args: readonly string[]) => Effect.Effect<string, { readonly _tag: "unknown" }>;

/**
 * Read one pull request's facts through `gh`. An answer that does not parse,
 * does not fit, or does not hold the facts at one head is the same failure
 * as a call that broke: `unknown`, never a throw and never a guess.
 */
export const readPrFacts =
  (gh: Gh, own: readonly string[]) =>
  (url: string): Effect.Effect<ShipFacts, { readonly _tag: "unknown" }> =>
    Effect.gen(function* () {
      const pr = prOf(url);
      if (pr === null) return yield* failed;
      const out = yield* gh(["api", "graphql", "-F", `owner=${pr.owner}`, "-F", `name=${pr.name}`, "-F", `number=${pr.number}`, "-f", `query=${QUERY}`]);
      const parsed = yield* Effect.try({ try: () => JSON.parse(out) as unknown, catch: () => ({ _tag: "unknown" as const }) });
      const answer = readAnswer(parsed);
      if (Option.isNone(answer)) return yield* failed;
      const facts = factsOf(answer.value.data.repository.pullRequest, own);
      const checked = facts === null ? Option.none() : readFacts(facts);
      return Option.isNone(checked) ? yield* failed : checked.value;
    });

/**
 * `CodeHost` on GitHub. `own`: the accounts the repo treats as its own, a
 * setting of the run. `gh`: the GitHub CLI to run, for a test that stands
 * one in.
 */
export const gitHubCodeHost = (config: { readonly own: readonly string[]; readonly gh?: string }) =>
  Layer.succeed(CodeHost, { prFacts: readPrFacts((args) => sh(config.gh ?? "gh", args), config.own) });
