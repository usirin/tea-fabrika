// P12, next/. These are type checks. Generated plants prove the checker sees the secret read.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve} from "node:path";
import * as fc from "fast-check";
import * as ts from "typescript/unstable/ast";
import type {Project} from "typescript/unstable/sync";
import {API} from "typescript/unstable/sync";
import {expect, it} from "vitest";

// Type proof at the three secret sources found by the whole-change sweep.
// This reads types, not spellings of Redacted.make or a particular helper's name.
const checkSecretTypes = (project: Project, root: string) => {
	const {program, checker} = project;
	const findings: Array<{file: string; line: number; reason: string}> = [];

	for (const path of program.getSourceFileNames()) {
		const file = relative(root, path).replaceAll("\\", "/");

		if (
			!file.startsWith("next/") ||
			/\/(?:exam|e2e)\//.test(file) ||
			/\.(?:test|test-support|d)\.tsx?$/.test(file)
		) {
			continue;
		}

		const source = program.getSourceFile(path);

		if (!source) {
			continue;
		}

		const entropy = new Set<string>();

		for (const statement of source.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				!["node:crypto", "crypto"].includes(statement.moduleSpecifier.text)
			) {
				continue;
			}

			const bindings = statement.importClause?.namedBindings;

			if (bindings && ts.isNamedImports(bindings)) {
				for (const spec of bindings.elements) {
					if ((spec.propertyName ?? spec.name).text === "randomBytes") {
						entropy.add(spec.name.text);
					}
				}
			}
		}

		const reads: Array<{node: ts.Node; reason: string; ancestors: Array<ts.Node>}> = [];
		const visit = (node: ts.Node): void => {
			let reason: string | undefined;

			if (ts.isCallExpression(node)) {
				const argument = node.arguments[0];

				if (ts.isIdentifier(node.expression) && entropy.has(node.expression.text)) {
					reason = "random secret";
				}

				if (
					ts.isPropertyAccessExpression(node.expression) &&
					node.expression.name.text === "get" &&
					argument !== undefined &&
					ts.isStringLiteral(argument) &&
					argument.text.toLowerCase() === "authorization"
				) {
					reason = "Authorization read";
				}
			}

			if (
				ts.isPropertyAccessExpression(node) &&
				node.name.text === "token" &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "props"
			) {
				reason = "control binding read";
			}

			if (reason) {
				const ancestors: Array<ts.Node> = [];

				for (let parent: ts.Node = node; !ts.isStatement(parent); parent = parent.parent) {
					ancestors.push(ts.isVariableDeclaration(parent) ? parent.name : parent);

					if (parent === source) {
						break;
					}
				}

				reads.push({node, reason, ancestors});
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

			if (!protectedRead) {
				findings.push({
					file,
					line: source.getLineAndCharacterOfPosition(read.node.getStart(source)).line + 1,
					reason: `${read.reason} must enter Redacted at its source`,
				});
			}
		}
	}

	return findings;
};

const root = resolve(import.meta.dirname, "../../../../..");

// Pin the P12 source-read gap found in the whole-change sweep, on the actual workspace types.
it("pinned: [secrets] P12 source-read gap, actual sources keep secret values Redacted from the read", () => {
	const api = new API({cwd: root});

	try {
		const snapshot = api.updateSnapshot({
			openProjects: [
				join(root, "next/apps/fabrika/tsconfig.json"),
				join(root, "next/packages/libfabrika/tsconfig.json"),
			],
		});

		try {
			const findings = [
				...new Map(
					snapshot
						.getProjects()
						.flatMap((project) => checkSecretTypes(project, root))
						.map((f) => [`${f.file}:${f.line}`, f]),
				).values(),
			];
			expect(findings).toEqual([]);
		} finally {
			snapshot.dispose();
		}
	} finally {
		api.close();
	}
});

it("[secrets] source type plants catch plain entropy, Authorization and binding reads, including renamed wrappers", () => {
	fc.assert(
		fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), (suffix) => {
			const folder = mkdtempSync(join(tmpdir(), "p12-sec-types-"));
			const api = new API({cwd: folder});

			try {
				const file = "next/source.ts",
					path = join(folder, file),
					config = join(folder, "tsconfig.json");
				mkdirSync(dirname(path), {recursive: true});
				writeFileSync(
					join(folder, "crypto.d.ts"),
					'declare module "node:crypto" {export function randomBytes(n: number): {toString(encoding: string): string};}',
				);
				const prelude = `import {randomBytes as bytes${suffix}} from "node:crypto";\ninterface Redacted {readonly "~effect/Redacted": never}\ndeclare function wrap${suffix}(value: unknown): Redacted;\ndeclare const request: {headers: {get(name: string): string | null}};\ndeclare const ctx: {props: {token: string}};\n`;
				const lines = [
					`export const entropy = bytes${suffix}(32).toString("base64url");`,
					'export const header = request.headers.get("authorization");',
					"export const binding = ctx.props.token;",
					`export const safeEntropy = wrap${suffix}(bytes${suffix}(32).toString("base64url"));`,
					`export const safeHeader = wrap${suffix}(request.headers.get("authorization"));`,
					`export const safeBinding = wrap${suffix}(ctx.props.token);`,
				];
				writeFileSync(path, prelude + lines.join("\n"));
				writeFileSync(
					config,
					JSON.stringify({
						compilerOptions: {strict: true, target: "ES2023", types: []},
						include: ["**/*.ts"],
					}),
				);
				const snapshot = api.updateSnapshot({openProjects: [config]});

				try {
					const project = snapshot.getProject(config)!;
					expect(project.program.getSemanticDiagnostics()).toEqual([]);
					expect(checkSecretTypes(project, folder).map((f) => f.line)).toEqual([6, 7, 8]);
				} finally {
					snapshot.dispose();
				}
			} finally {
				api.close();
				rmSync(folder, {recursive: true, force: true});
			}
		}),
		{seed: 119120, numRuns: 5},
	);
});
