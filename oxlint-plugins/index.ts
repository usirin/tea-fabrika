// The repo's custom lint rules, one per file, loaded by `.oxlintrc.json`. README.md says where each
// came from and what it was measured against.
import type {Plugin} from "@oxlint/plugins";
import {noBareTell} from "./no-bare-tell.ts";
import {noContextTag} from "./no-context-tag.ts";
import {noDataTaggederror} from "./no-data-taggederror.ts";
import {noEffectPromise} from "./no-effect-promise.ts";
import {noExpectInIf} from "./no-expect-in-if.ts";
import {noImplicitEffectConcurrency} from "./no-implicit-effect-concurrency.ts";
import {noNumericDuration} from "./no-numeric-duration.ts";
import {noProjectSettings} from "./no-project-settings.ts";
import {noRawTryCatch} from "./no-raw-try-catch.ts";
import {noRedactedValue} from "./no-redacted-value.ts";
import {noSecretEnv} from "./no-secret-env.ts";
import {noThrowInEffectGen} from "./no-throw-in-effect-gen.ts";
import {noTypeAssertions} from "./no-type-assertions.ts";
import {useImportExtensions} from "./use-import-extensions.ts";

const plugin: Plugin = {
	meta: {name: "fabrika"},
	rules: {
		"no-bare-tell": noBareTell,
		"no-context-tag": noContextTag,
		"no-data-taggederror": noDataTaggederror,
		"no-effect-promise": noEffectPromise,
		"no-expect-in-if": noExpectInIf,
		"no-implicit-effect-concurrency": noImplicitEffectConcurrency,
		"no-numeric-duration": noNumericDuration,
		"no-project-settings": noProjectSettings,
		"no-raw-try-catch": noRawTryCatch,
		"no-redacted-value": noRedactedValue,
		"no-secret-env": noSecretEnv,
		"no-throw-in-effect-gen": noThrowInEffectGen,
		"no-type-assertions": noTypeAssertions,
		"use-import-extensions": useImportExtensions,
	},
};

export default plugin;
