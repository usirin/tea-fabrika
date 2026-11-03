// A Claude run loads a project's settings only through `ownRules`
// (packages/fabrika/src/agents/claude/rules.ts): `settingSources: ["project"]`
// for the rule files, with `projectConfigRoot` on the system's empty folder.
//
// Why: `settingSources: ["project"]` alone also loads the project's
// `.claude/settings.json`. In experiment 155 that ran the project's hooks
// outside the sandbox, handed its env to the agent and to Claude Code, and ran
// its `apiKeyHelper`. Agents write the repository too, so a hook added by
// mistake, or by text injected into an agent, would run on the next agent's run.
// The owner's ruling of 2026-10-26 keeps that out even where only trusted people
// work (docs/direction/agents-read-rules-the-normal-way.md).
//
// So, anywhere but rules.ts and tests (`.oxlintrc.json`'s overrides leave those
// out: a test writes the options' shape to check it, and starts no live run),
// this refuses:
//   - an object's `settingSources` whose value is anything but `[]`, and the
//     shorthand `{settingSources}`;
//   - an object's `projectConfigRoot`, whatever its value, so nothing points it
//     at another folder after `...ownRules(...)`;
//   - the same two set by assignment (`options.settingSources = ...`);
//   - the CLI's own flags: `"--setting-sources"` followed by anything but `""`
//     in a list of arguments, `"--setting-sources=<some>"`, and any
//     `--project-config-root`, also as an `extraArgs` key.
//
// What it cannot see: options that leave `settingSources` out, which makes the
// Agent SDK load every settings file. A live run's own check refuses those
// (`startRefusal`, rules.ts). A list that says `"--setting-sources", ""` first and
// gives the flag again after that (only the first in a list is looked at). A run
// that loads the project's settings on purpose (an experiment that measures them,
// the old operator) carries
// `// oxlint-disable-next-line fabrika/no-project-settings -- <why>`.
//
// This repo's own rule, not a copy. It blocks. When it was added
// it fired 17 times: 12 on runs that load the project's settings on purpose
// (experiment 155's variants, experiment 43's spike, the old operator in
// legacy/), each now carrying its reason; 4 in tests that write the options'
// shape, which is why tests are left out; and 1 on experiment 127's
// `settingSources: ["project"]`. That line was safe only because a spread
// beside it already held the empty folder, so 127 no longer loaded the
// project hook it measures. It now drops the folder on purpose and says so.
// Each of the 13 fires outside tests led to a change or a written reason.
import type {CreateRule} from "@oxlint/plugins";
import {grouped, isEmptyString, type Node, quoted} from "./match.ts";

const ON_PURPOSE = "On purpose: // oxlint-disable-next-line fabrika/no-project-settings -- <why>.";

/** A key as written, with its quotes. A computed key has none: `[x]` is not `x`. */
const written = (key: Node, computed: boolean): string | null => {
	if (computed) return null;
	if (key.type === "Identifier") return key.name;
	return quoted(key);
};

const FLAG = /^["'](?:--project-config-root.*|--setting-sources=.+)/;

/** A string that is a value, not a name: not a key, an import's source, a type or an attribute. */
const isValue = (node: Node & {readonly parent: Node}): boolean => {
	const {parent} = node;
	switch (parent.type) {
		case "Property":
			return parent.computed || parent.key !== node;
		case "PropertyDefinition":
		case "MethodDefinition":
		case "AccessorProperty":
			return parent.computed || parent.key !== node;
		case "TSEnumMember":
			return parent.id !== node;
		case "TSPropertySignature":
		case "TSMethodSignature":
			return parent.computed || parent.key !== node;
		case "TSLiteralType":
		case "JSXAttribute":
		case "ImportDeclaration":
		case "ExportNamedDeclaration":
		case "ExportAllDeclaration":
		case "ImportSpecifier":
		case "ExportSpecifier":
		case "ImportAttribute":
		case "TSExternalModuleReference":
		case "TSModuleDeclaration":
		case "TSImportType":
			return false;
		case "ExpressionStatement":
			return parent.directive == null;
		default:
			return true;
	}
};

export const noProjectSettings: CreateRule = {
	create(context) {
		const source = context.sourceCode;
		const isEmptyList = (node: Node): boolean =>
			node.type === "ArrayExpression" && node.elements.length === 0 && grouped(source, node) === 0;
		return {
			Property(node) {
				if (node.parent.type !== "ObjectExpression") return;
				if (node.method || node.kind !== "init") return;
				if (node.shorthand) {
					const name = written(node.key, false);
					if (name === "settingSources" || name === "projectConfigRoot") {
						context.report({
							node,
							message: `Where a Claude run's settings come from is said only by \`ownRules\` (@kampus/fabrika-old/agents/sandbox), or \`settingSources: []\`, written out. ${ON_PURPOSE}`,
						});
					}
					return;
				}
				const name = written(node.key, node.computed);
				if (name === null) return;
				const bare = name.replace(/^["']|["']$/g, "");
				if (bare === "settingSources" && !isEmptyList(node.value)) {
					context.report({
						node: node.key,
						message: `\`settingSources\` with a source in it can load the project's hooks, env and apiKeyHelper (experiment 155). Load a folder's rule files with \`...ownRules(...)\` from @kampus/fabrika-old/agents/sandbox, or no settings with \`settingSources: []\`. ${ON_PURPOSE}`,
					});
				}
				if (bare === "projectConfigRoot") {
					context.report({
						node: node.key,
						message: `\`projectConfigRoot\` is set only by \`ownRules\` (@kampus/fabrika-old/agents/sandbox), on the system's empty folder: pointed anywhere else, a run reads that folder's settings and hooks (experiment 155). ${ON_PURPOSE}`,
					});
				}
				const isFlagKey =
					name !== bare && (bare === "setting-sources" || bare === "project-config-root");
				if (isFlagKey && !isEmptyString(source, node.value)) {
					context.report({
						node: node.key,
						message: `Where a Claude run's settings come from is said only by \`ownRules\` (@kampus/fabrika-old/agents/sandbox), not by \`extraArgs\` (experiment 155). ${ON_PURPOSE}`,
					});
				}
			},
			AssignmentExpression(node) {
				if (node.operator !== "=" || node.left.type !== "MemberExpression") return;
				if (node.left.computed || node.left.optional) return;
				const name = node.left.property.type === "Identifier" ? node.left.property.name : null;
				if (name === "settingSources" && !isEmptyList(node.right)) {
					context.report({
						node,
						message: `\`settingSources\` with a source in it can load the project's hooks, env and apiKeyHelper (experiment 155). Use \`...ownRules(...)\` from @kampus/fabrika-old/agents/sandbox, or \`settingSources: []\`. ${ON_PURPOSE}`,
					});
				}
				if (name === "projectConfigRoot") {
					context.report({
						node,
						message: `\`projectConfigRoot\` is set only by \`ownRules\` (@kampus/fabrika-old/agents/sandbox), on the system's empty folder (experiment 155). ${ON_PURPOSE}`,
					});
				}
			},
			ArrayExpression(node) {
				const at = node.elements.findIndex(
					(element) =>
						element !== null &&
						element.type === "Literal" &&
						element.value === "--setting-sources" &&
						grouped(source, element) === 0,
				);
				const flag = node.elements[at];
				if (at === -1 || flag == null || at + 1 >= node.elements.length) return;
				if (isEmptyString(source, node.elements[at + 1] ?? null)) return;
				context.report({
					node: flag,
					message: `\`--setting-sources\` with a source in it can load the project's hooks, env and apiKeyHelper (experiment 155). Pass an empty string, or run through the Agent SDK with \`...ownRules(...)\`. ${ON_PURPOSE}`,
				});
			},
			Literal(node) {
				const raw = quoted(node);
				if (raw === null || !FLAG.test(raw) || !isValue(node)) return;
				context.report({
					node,
					message: `Where a Claude run's settings come from is said only by \`ownRules\` (@kampus/fabrika-old/agents/sandbox), not by a CLI flag (experiment 155). ${ON_PURPOSE}`,
				});
			},
		};
	},
};
