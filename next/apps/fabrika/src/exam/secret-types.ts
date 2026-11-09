// P12, next/. Type proof at the three secret sources found by the whole-change sweep.
// This reads types, not spellings of Redacted.make or a particular helper's name.
import {relative} from "node:path";
import * as ts from "typescript/unstable/ast";
import type {Project} from "typescript/unstable/sync";

export const checkSecretTypes = (project: Project, root: string) => {
	const {program, checker} = project;
	const findings: Array<{file: string; line: number; why: string}> = [];
	for (const path of program.getSourceFileNames()) {
		const file = relative(root, path).replaceAll("\\", "/");
		if (
			!file.startsWith("next/") ||
			/\/(?:exam|e2e)\//.test(file) ||
			/\.(?:test|test-support|d)\.tsx?$/.test(file)
		)
			continue;
		const source = program.getSourceFile(path);
		if (!source) continue;
		const entropy = new Set<string>();
		for (const statement of source.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				!["node:crypto", "crypto"].includes(statement.moduleSpecifier.text)
			)
				continue;
			const bindings = statement.importClause?.namedBindings;
			if (bindings && ts.isNamedImports(bindings))
				for (const spec of bindings.elements)
					if ((spec.propertyName ?? spec.name).text === "randomBytes") entropy.add(spec.name.text);
		}
		const reads: Array<{node: ts.Node; why: string; ancestors: Array<ts.Node>}> = [];
		const visit = (node: ts.Node): void => {
			let why: string | undefined;
			if (ts.isCallExpression(node)) {
				const argument = node.arguments[0];
				if (ts.isIdentifier(node.expression) && entropy.has(node.expression.text))
					why = "random secret";
				if (
					ts.isPropertyAccessExpression(node.expression) &&
					node.expression.name.text === "get" &&
					argument !== undefined &&
					ts.isStringLiteral(argument) &&
					argument.text.toLowerCase() === "authorization"
				)
					why = "Authorization read";
			}
			if (
				ts.isPropertyAccessExpression(node) &&
				node.name.text === "token" &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "props"
			)
				why = "control binding read";
			if (why) {
				const ancestors: Array<ts.Node> = [];
				for (let parent: ts.Node = node; !ts.isStatement(parent); parent = parent.parent) {
					ancestors.push(ts.isVariableDeclaration(parent) ? parent.name : parent);
					if (parent === source) break;
				}
				reads.push({node, why, ancestors});
			}
			node.forEachChild(visit);
		};
		visit(source);
		const nodes = reads.flatMap((read) => read.ancestors);
		const types = checker.getTypeAtLocation(nodes);
		let index = 0;
		for (const read of reads) {
			const protectedRead = read.ancestors
				.map(() => types[index++])
				.some((type) => {
					return (
						type !== undefined && checker.getPropertyOfType(type, "~effect/Redacted") !== undefined
					);
				});
			if (!protectedRead)
				findings.push({
					file,
					line: source.getLineAndCharacterOfPosition(read.node.getStart(source)).line + 1,
					why: `${read.why} must enter Redacted at its source`,
				});
		}
	}
	return findings;
};
