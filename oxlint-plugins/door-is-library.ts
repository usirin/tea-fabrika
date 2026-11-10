// P17a. Retired app door files may only forward the library's exports.
import type {CreateRule} from "@oxlint/plugins";
import {pathIn} from "./match.ts";

export const doorIsLibrary: CreateRule = {
	create(context) {
		if (!/^next\/apps\/fabrika\/src\/door(?:-store|-nonce)?\.ts$/.test(pathIn(context))) {
			return {};
		}

		return {
			Program(node) {
				for (const statement of node.body) {
					if (
						(statement.type === "ExportAllDeclaration" ||
							statement.type === "ExportNamedDeclaration") &&
						statement.source?.value === "@kampus/libfabrika/door" &&
						!("declaration" in statement && statement.declaration !== null)
					) {
						continue;
					}

					context.report({
						node: statement,
						message:
							"The door belongs in libfabrika. This retired app file may only re-export @kampus/libfabrika/door.",
					});
				}
			},
		};
	},
};
