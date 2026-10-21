import {Schema} from "effect";

// The repository's own rules for agents: its `CLAUDE.md` and `AGENTS.md`, as
// they stand on the base branch. Code reads them (a Gather, beside the ticket
// or the pull request) and hands the text to the builder and the reviewer in
// their briefs, marked as the repository's rules.
//
// Why not the Agent SDK's own way (`settingSources: ["project"]`): it loads
// CLAUDE.md only together with the repository's `.claude/settings.json`, and
// that file can turn on plugins and hooks. In a repository that runs today's
// fabrika it does: the agents here would get fabrika's skills and hooks. And
// a pull request's own head could add a hook that runs a command. So no
// settings are loaded, and the two files are read as text, from the base, so
// a change cannot rewrite the rules it is held to.
//
// A `@file` line in CLAUDE.md (an import) is not followed: it is text here.
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
