// An ignore comment names its rules and says why: `// oxlint-disable-next-line <rule> -- <why>`.
//
// Why: oxlint takes `// oxlint-disable-next-line` with no rule as "every rule", and asks for no
// reason. So a bare comment would silence the secret rules with exit 0. Biome failed on a missing
// reason, and this keeps that. `eslint-disable` does the same job in oxlint, so it is refused
// outright: one spelling, which a search can find.
//
// What it refuses: any comment that oxlint reads as a disable, in all three forms (the file from
// here on, the next line, this line), with no rule named, with no ` -- <why>`, or spelled `eslint-`.
//
// What it cannot see: whether the reason is a good one. `-- x` passes. A person reads those.
//
// Where it reports, and why there: at the very start of the file, with the real line in the message.
// A report on the comment's own line would be silenced by that same comment. Oxlint never silences
// an empty range at offset 0, and `plants.test.ts` fails if a new version does.
import type {CreateRule} from "@oxlint/plugins";

// No word boundary after the keyword: oxlint reads `oxlint-disablefoo` as naming a rule `foo`.
const DISABLE = /^\s*(oxlint|eslint)-disable(?:-next-line|-line)?(.*)$/s;
const NAMED_WITH_WHY = /^\s+[\w@./-]+(?:\s*,\s*[\w@./-]+)*\s+--\s+\S/s;

const START = {line: 1, column: 0};

const problem = (comment: string): string | null => {
	const found = DISABLE.exec(comment);
	if (found === null) return null;
	const [, tool = "", rest = ""] = found;
	if (tool === "eslint") return "says `eslint-disable`. Write `oxlint-disable`, the one spelling";
	return NAMED_WITH_WHY.test(rest) ? null : "needs its rules and a reason";
};

export const noBareDisable: CreateRule = {
	create: (context) => ({
		Program() {
			for (const comment of context.sourceCode.getAllComments()) {
				const wrong = problem(comment.value);
				if (wrong === null) continue;
				context.report({
					loc: {start: START, end: START},
					message: `The ignore comment on line ${context.sourceCode.getLocFromIndex(comment.range[0]).line} ${wrong}: \`// oxlint-disable-next-line <rule> -- <why>\`.`,
				});
			}
		},
	}),
};
