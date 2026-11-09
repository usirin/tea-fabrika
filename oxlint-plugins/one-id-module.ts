// T518 A8, next/. P17a's second Id module is retired, including an empty forwarding file.
import type {CreateRule} from "@oxlint/plugins";
import {pathIn} from "./match.ts";

export const oneIdModule: CreateRule = {
	create(context) {
		if (pathIn(context) !== "next/packages/libfabrika/src/data/id.ts") return {};
		return {
			Program(node) {
				context.report({node, message: "Delete data/id.ts. The one Id module is src/id.ts."});
			},
		};
	},
};
