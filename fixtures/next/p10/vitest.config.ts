// Test writer can run the app's new tests before the builder adds its public package imports.
// These aliases resolve real services, with no substitute implementation.
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {mergeConfig} from "vitest/config";
import base from "../../../vitest.config.ts";

const fromLibrary = createRequire(
	new URL("../../../next/packages/libfabrika/package.json", import.meta.url),
);
const source = (path: string) =>
	fileURLToPath(new URL(`../../../next/packages/libfabrika/src/${path}`, import.meta.url));

export default mergeConfig(base, {
	test: {includeTaskLocation: true},
	resolve: {
		alias: {
			"@effect/vitest": fromLibrary.resolve("@effect/vitest"),
			"@kampus/libfabrika/data": source("data/index.ts"),
			"@kampus/libfabrika/coordination": source("coordination/index.ts"),
			"@kampus/libfabrika/transport": source("transport/index.ts"),
			"@kampus/libfabrika/sqlite": source("ledger/NodeSqlite.ts"),
		},
	},
});
