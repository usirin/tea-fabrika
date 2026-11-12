// PullRequestsGh.layer: the PullRequests service on `gh`, the one way the lead tooling reaches
// GitHub. `gh pr edit` fails here with a classic Projects error (AGENTS.md), so an edit goes
// through `gh api -X PATCH`. Every call names the repo, so the checkout it runs in does not pick it.
import { Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "./command.ts";
import { type PullRequest, PullRequests, PullRequestsError, type Text } from "./PullRequests.ts";

/** The most pull requests one `all` read takes; a repo with this many fails it, never cuts it. */
export const LIMIT = 5000;

const Listed = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      headRefName: Schema.String,
      headRefOid: Schema.String,
      state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
      isDraft: Schema.Boolean,
    }),
  ),
);

const FIELDS = "number,headRefName,headRefOid,state,isDraft";

/** `owner/name` from an origin URL GitHub serves, https or ssh; `null` for any other. */
export const repoFromUrl = (url: string): string | null =>
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  )?.[1] ?? null;

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<PullRequests, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One gh call; any exit but 0 fails it with gh's own last line. */
      const gh = Effect.fn("PullRequestsGh.gh")(
        function* (args: ReadonlyArray<string>) {
          const ran = yield* run("gh", args, cwd);

          if (ran.code !== 0) {
            return yield* new PullRequestsError({
              reason: `gh ${args.slice(0, 2).join(" ")} exited ${ran.code}: ${lastLine(ran)}`,
            });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new PullRequestsError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const list = Effect.fn("PullRequestsGh.list")(function* (args: ReadonlyArray<string>) {
        const out = yield* gh(["pr", "list", "-R", repo, "--json", FIELDS, ...args]);
        const rows = yield* Schema.decodeUnknownEffect(Listed)(out.trim() || "[]").pipe(
          Effect.mapError(() => new PullRequestsError({ reason: "gh pr list answered a shape we do not read" })),
        );
        return rows.map((r): PullRequest => ({
          number: r.number,
          head: r.headRefName,
          oid: r.headRefOid,
          state: r.state,
          draft: r.isDraft,
        }));
      });

      const openOn = (branch: string) =>
        Effect.map(list(["--head", branch, "--state", "open"]), (prs) =>
          Option.fromNullishOr(prs.find((pr) => pr.head === branch)),
        );

      const all = Effect.flatMap(list(["--state", "all", "--limit", String(LIMIT)]), (prs) =>
        prs.length >= LIMIT
          ? Effect.fail(new PullRequestsError({ reason: `${LIMIT} or more pull requests: one read cannot hold all` }))
          : Effect.succeed(prs),
      );

      const draft = Effect.fn("PullRequestsGh.draft")(function* (branch: string, text: Text) {
        const args = ["--draft", "--base", "main", "--head", branch, "--title", text.title, "--body", text.body];
        const out = yield* gh(["pr", "create", "-R", repo, ...args]);
        const number = Number(/\/pull\/(\d+)/.exec(out)?.[1]);

        if (!Number.isInteger(number)) {
          return yield* new PullRequestsError({ reason: `gh pr create named no pull request: ${out.trim()}` });
        }

        return number;
      });

      const edit = (number: number, text: Text) =>
        Effect.asVoid(
          gh([
            "api",
            "-X",
            "PATCH",
            `repos/${repo}/pulls/${number}`,
            "-f",
            `title=${text.title}`,
            "-f",
            `body=${text.body}`,
          ]),
        );

      const ready = (number: number) => Effect.asVoid(gh(["pr", "ready", String(number), "-R", repo]));

      return PullRequests.of({ openOn, all, draft, edit, ready });
    }),
  );
