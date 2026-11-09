// P12, next/. These are type checks. Generated plants prove the checker sees the secret read.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import * as fc from "fast-check";
import {API} from "typescript/unstable/sync";
import {expect, it} from "vitest";
import {checkSecretTypes} from "./secret-types.ts";

const root = resolve(import.meta.dirname, "../../../../..");
it("[secrets] actual P12 sources keep their secret values Redacted from the read", () => {
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
