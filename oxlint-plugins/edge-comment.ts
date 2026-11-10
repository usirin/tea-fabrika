// An edge is one line, marked where it stands: `// oxlint-disable-next-line fabrika/no-promises --
// edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge` (docs/direction/no-promises.md;
// Tier 1, P35). This rule holds every ignore comment that names either of those two rules to that
// shape:
//
// - the `-next-line` form, so it covers one line. A file-wide `oxlint-disable` would let a whole
//   file wrap Promises, the hole the owner closed when the list of edge files went (2026-11-05), and
//   `-line` is a second spelling a search would have to know;
// - only the two edge rules, so an ask about an edge never hides another exception;
// - a reason that starts `edge: ` and says something, one spelling, so a search finds every edge.
//
// It is eslint-comments' `require-description`, `no-restricted-disable` and `no-use` for two rules,
// with a fixed prefix, as clippy's `undocumented_unsafe_blocks` asks for `// SAFETY:`. An edge comment
// over a line where nothing fires fails too, through `reportUnusedDisableDirectives`.
//
// What it cannot see: whether the line holds no logic, or the reason is a good one. The owner reads
// each new one, which CI lists (next/apps/fabrika/src/exam/edges.ts).
//
// Where it reports, and why there: at the very start of the file, with the real line in the message,
// as `no-bare-disable` does. A report on the comment's own line could be silenced by a comment.
import type {CreateRule} from "@oxlint/plugins";

const EDGE_RULES: ReadonlySet<string> = new Set([
	"fabrika/no-promises",
	"fabrika/no-effect-run-outside-edge",
]);

// No word boundary after the keyword: oxlint reads `oxlint-disablefoo` as naming a rule `foo`.
const DISABLE = /^\s*(?:oxlint|eslint)-disable(-next-line|-line)?(.*)$/s;
const REASON = /\s--\s+/;
const EDGE_WHY = /^edge: \S/;

const SHAPE = "`// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`";

const START = {line: 1, column: 0};

const problem = (comment: string): string | null => {
	const found = DISABLE.exec(comment);

	if (found === null) {
		return null;
	}

	const [, form = "", rest = ""] = found;
	const at = rest.search(REASON);
	const rules = (at < 0 ? rest : rest.slice(0, at))
		.split(",")
		.map((rule) => rule.trim())
		.filter((rule) => rule !== "");

	if (!rules.some((rule) => EDGE_RULES.has(rule))) {
		return null;
	}

	if (form !== "-next-line") {
		return "is not the `-next-line` form. An edge is one line";
	}

	if (rules.some((rule) => !EDGE_RULES.has(rule))) {
		return "names a rule that is not an edge rule. Give that exception its own comment";
	}

	const why = at < 0 ? "" : rest.slice(at).replace(REASON, "");
	return EDGE_WHY.test(why) ? null : "does not give its reason as `edge: <why>`";
};

export const edgeComment: CreateRule = {
	create: (context) => ({
		Program() {
			for (const comment of context.sourceCode.getAllComments()) {
				const wrong = problem(comment.value);

				if (wrong === null) {
					continue;
				}

				context.report({
					loc: {start: START, end: START},
					message: `The edge comment on line ${context.sourceCode.getLocFromIndex(comment.range[0]).line} ${wrong}: ${SHAPE}, or the same for \`fabrika/no-effect-run-outside-edge\`.`,
				});
			}
		},
	}),
};
