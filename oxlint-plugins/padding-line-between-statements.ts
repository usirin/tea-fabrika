// A blank line between top-level statements, between class members, and around every control
// statement in any block (owner, 2026-11-09).
//
// ESLint's names for these are `padding-line-between-statements` and `lines-between-class-members`,
// both moved to @stylistic. Oxlint 1.90.0 has neither, and oxfmt keeps blank lines but never adds
// one, so a file of declarations with no blank between them passed every check and was hard to read.
// Inside any block it is ESLint's `{blankLine: "always", prev: "*", next: [<control>]}` and the
// same with prev and next swapped, where a control statement is an `if` (with its whole `else`
// chain), a loop, a `switch` or a `try`. The first and last statement of a block have no neighbor on
// that side, so they need no blank line there.
//
// At the top of a file and in a class body it is also ESLint's
// `{blankLine: "always", prev: "*", next: "*"}`, with three exceptions:
//
// - between two statements that are each one line, such as a run of one-line types or consts, or a
//   class's fields, which read as a group (ESLint's `exceptAfterSingleLine`, asked of both sides);
// - between two imports, or two re-exports (`export ... from`), which read as one list;
// - between the overloads of one function or method, and between a value and the type of the same
//   name right after it (`const Row = Schema.Struct(...)` then `type Row = typeof Row.Type`), each one
//   declaration.
//
// A comment above a statement belongs to it: the blank line may sit anywhere between the two
// statements. Two statements on one line are oxfmt's to split, so they are left alone.
//
// It has a whitespace autofix, which `pnpm format` applies: a newline after the line where the first
// statement ends.
import type {Context, CreateRule} from "@oxlint/plugins";
import type {Node} from "./match.ts";

type Source = Context["sourceCode"];

const isOneLine = (node: Node): boolean => node.loc.start.line === node.loc.end.line;

const isListed = (node: Node): boolean =>
	node.type === "ImportDeclaration" ||
	node.type === "TSImportEqualsDeclaration" ||
	node.type === "ExportAllDeclaration" ||
	(node.type === "ExportNamedDeclaration" && node.source != null);

/** The declared name of a function or method, seen through `export`, or `null`. */
const callable = (node: Node): string | null => {
	const inner =
		(node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") &&
		node.declaration != null
			? node.declaration
			: node;

	if (
		(inner.type === "FunctionDeclaration" || inner.type === "TSDeclareFunction") &&
		inner.id != null
	) {
		return `function ${inner.id.name}`;
	}

	if (
		(inner.type === "MethodDefinition" || inner.type === "TSAbstractMethodDefinition") &&
		!inner.computed &&
		inner.key.type === "Identifier"
	) {
		return `${inner.static ? "static " : ""}method ${inner.kind} ${inner.key.name}`;
	}

	return null;
};

/** A signature with no body: a `declare function`, or a method overload. */
const isSignature = (node: Node): boolean => {
	const inner = unexported(node);

	if (inner.type === "TSDeclareFunction") {
		return true;
	}

	return (
		(inner.type === "MethodDefinition" || inner.type === "TSAbstractMethodDefinition") &&
		inner.value.body == null
	);
};

const unexported = (node: Node): Node =>
	node.type === "ExportNamedDeclaration" && node.declaration != null ? node.declaration : node;

/** `const Row = ...` then `type Row = ...`: one name, as a value and as a type. */
const isTypeOfValue = (prev: Node, next: Node): boolean => {
	const value = unexported(prev);
	const type = unexported(next);

	if (type.type !== "TSTypeAliasDeclaration" || value.type !== "VariableDeclaration") {
		return false;
	}

	return value.declarations.some((d) => d.id.type === "Identifier" && d.id.name === type.id.name);
};

const isOverload = (prev: Node, next: Node): boolean => {
	const name = callable(prev);
	return name !== null && isSignature(prev) && callable(next) === name;
};

const CONTROL = new Set([
	"IfStatement",
	"ForStatement",
	"ForOfStatement",
	"ForInStatement",
	"WhileStatement",
	"DoWhileStatement",
	"SwitchStatement",
	"TryStatement",
]);

/** An `if` (its whole `else` chain is one node), a loop, a `switch` or a `try`, labeled or not. */
const isControl = (node: Node): boolean =>
	CONTROL.has(node.type) || (node.type === "LabeledStatement" && isControl(node.body));

/** Whether two neighbors at the top of a file or in a class body may sit with no blank line. */
const mayTouch = (prev: Node, next: Node): boolean =>
	(isOneLine(prev) && isOneLine(next)) ||
	(isListed(prev) && isListed(next)) ||
	isOverload(prev, next) ||
	isTypeOfValue(prev, next);

const check = (
	source: Source,
	report: (prev: Node, next: Node, at: number) => void,
	body: readonly Node[],
	top: boolean,
) => {
	for (const [i, next] of body.entries()) {
		const prev = body[i - 1];

		if (prev === undefined) {
			continue;
		}

		const control = isControl(prev) || isControl(next);

		if (!control && (!top || mayTouch(prev, next))) {
			continue;
		}

		const between = source.text.slice(prev.range[1], next.range[0]);
		const firstBreak = between.indexOf("\n");

		if (firstBreak === -1) {
			continue;
		}

		if (/\n[ \t]*\r?\n/.test(between)) {
			continue;
		}

		report(prev, next, prev.range[1] + firstBreak + 1);
	}
};

export const paddingLineBetweenStatements: CreateRule = {
	meta: {type: "layout", fixable: "whitespace"},
	create(context) {
		const report = (_prev: Node, next: Node, at: number) =>
			context.report({
				node: next,
				message:
					"Leave a blank line before this statement: top-level statements, class members, and every if, loop, switch and try each stand apart (owner, 2026-11-09). Fix: `pnpm format` adds it.",
				fix: (fixer) => fixer.insertTextAfterRange([at, at], "\n"),
			});
		return {
			Program(node) {
				check(context.sourceCode, report, node.body, true);
			},
			ClassBody(node) {
				check(context.sourceCode, report, node.body, true);
			},
			BlockStatement(node) {
				check(context.sourceCode, report, node.body, false);
			},
			StaticBlock(node) {
				check(context.sourceCode, report, node.body, false);
			},
			SwitchCase(node) {
				check(context.sourceCode, report, node.consequent, false);
			},
			TSModuleBlock(node) {
				check(context.sourceCode, report, node.body, false);
			},
		};
	},
};
