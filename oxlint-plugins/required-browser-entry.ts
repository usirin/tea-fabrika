// P13, next/. Check once at the plugin entry, which pnpm lint always reads. Checking notes'
// sources alone would miss a deleted package or entry. Browser bundling still belongs to P12.
import {readFileSync, statSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import type {CreateRule} from "@oxlint/plugins";

const target = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (typeof value !== "object" || value === null) return undefined;
	const fields = new Map(Object.entries(value));
	if (fields.has(".")) return target(fields.get("."));
	return target(fields.get("browser") ?? fields.get("import") ?? fields.get("default"));
};

export const requiredBrowserEntry: CreateRule = {
	create(context) {
		const file = context.filename;
		if (!file.endsWith(`${sep}oxlint-plugins${sep}index.ts`)) return {};
		return {
			Program(node) {
				const dir = join(dirname(dirname(file)), "next/programs/notes");
				let valid = false;
				try {
					const manifest: {exports?: unknown} = JSON.parse(
						readFileSync(join(dir, "package.json"), "utf8"),
					);
					const entry = target(manifest.exports);
					if (entry !== undefined && entry.startsWith("./")) {
						const path = resolve(dir, entry);
						const inside = relative(dir, path);
						valid =
							!inside.startsWith(`..${sep}`) && !isAbsolute(inside) && statSync(path).isFile();
					}
				} catch {
					// A missing or broken manifest/target must fail closed.
				}
				if (!valid)
					context.report({
						node,
						message:
							"@kampus/notes needs a top-level browser export pointing to an existing file. P12's browser check must not skip it.",
					});
			},
		};
	},
};
