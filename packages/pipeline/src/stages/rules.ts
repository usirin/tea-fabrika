import {Schema} from "effect";

// The repository's own rules for agents: its top `CLAUDE.md` and `AGENTS.md`,
// as they stand on the base branch. Code reads them (a Gather, beside the
// ticket or the pull request) as text.
//
// Every Claude run on the Agent SDK also reads the rule files of the folder
// it works in itself, the way Claude Code ships it: subfolder files, the
// nearest one winning, and `@file` imports (`ownRules` in
// @kampus/fabrika/agents/sandbox, experiment 155,
// docs/direction/agents-read-rules-the-normal-way.md). It reads none of that
// folder's settings: `.claude/settings.json` ran its hooks, handed its env to
// the agent and ran its `apiKeyHelper` in experiment 155, so settings come
// from an empty folder.
//
// What the text here is still for:
//   - the reviewer is handed it, marked as the rules the pull request is
//     judged by. A change can rewrite its own rule files, which the reviewer
//     loads too; the base's copy wins, so a change cannot loosen the rules it
//     is held to. GitHub reads CODEOWNERS from the base for the same reason.
//   - the ACP builder (./build/builder-acp.ts) loads no settings at all, so
//     it is handed the files as text in its prompt.
//
// A `@file` line in CLAUDE.md (an import) is not followed here: it is text.
// AGENTS.md is read on its own because it is where such an import most often
// points.

/** The files read, in the order they are shown. */
export const RULE_FILES = ["CLAUDE.md", "AGENTS.md"] as const;
export type RuleFile = (typeof RULE_FILES)[number];

/** One rules file, as it stands on the base branch. */
export const RepoRule = Schema.Struct({file: Schema.Literals(RULE_FILES), text: Schema.String});
export type RepoRule = typeof RepoRule.Type;

/** The most characters of one file handed on. More is cut, and the cut is said. */
export const MOST_RULE_CHARS = 40_000;

/** The GraphQL fields that read the two files at `$claudeMd` and `$agentsMd`, each `<branch>:<file>`. */
export const RULES_FIELDS = `claudeMd: object(expression: $claudeMd) { ... on Blob { text } }
    agentsMd: object(expression: $agentsMd) { ... on Blob { text } }`;

/** The variables the fields above take, for a base branch. */
export const rulesAt = (base: string) => ({
	claudeMd: `${base}:CLAUDE.md`,
	agentsMd: `${base}:AGENTS.md`,
});

/** One file's text from a GraphQL answer: `null` or no text when it is not there. */
export const RuleBlob = Schema.NullOr(
	Schema.Struct({text: Schema.optional(Schema.NullOr(Schema.String))}),
);
type RuleBlob = typeof RuleBlob.Type;

/** The files that are there and say something, in order, each cut at {@link MOST_RULE_CHARS}. */
export function repoRulesOf(found: {
	readonly claudeMd: RuleBlob;
	readonly agentsMd: RuleBlob;
}): readonly RepoRule[] {
	const texts: readonly [RuleFile, string | null | undefined][] = [
		["CLAUDE.md", found.claudeMd?.text],
		["AGENTS.md", found.agentsMd?.text],
	];
	return texts.flatMap(([file, text]) => {
		if (text === null || text === undefined || text.trim() === "") return [];
		return [
			{
				file,
				text:
					text.length <= MOST_RULE_CHARS
						? text
						: `${text.slice(0, MOST_RULE_CHARS)}\n\n[cut here: the file goes on past ${MOST_RULE_CHARS} characters]`,
			},
		];
	});
}
