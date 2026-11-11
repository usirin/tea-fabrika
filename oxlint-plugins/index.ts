// The repo's custom lint rules, one per file, loaded by `.oxlintrc.json`. README.md says where each
// came from and what it was measured against.
import type { Plugin } from "@oxlint/plugins";
import { doorIsLibrary } from "./door-is-library.ts";
import { edgeComment } from "./edge-comment.ts";
import { effectFunctions } from "./effect-functions.ts";
import { lawShape } from "./law-shape.ts";
import { modules } from "./modules.ts";
import { noBareDisable } from "./no-bare-disable.ts";
import { noBareTell } from "./no-bare-tell.ts";
import { noClockInView } from "./no-clock-in-view.ts";
import { noContextTag } from "./no-context-tag.ts";
import { noDataTaggederror } from "./no-data-taggederror.ts";
import { noEffectPromise } from "./no-effect-promise.ts";
import { noEffectRunOutsideEdge } from "./no-effect-run-outside-edge.ts";
import { noExpectInIf } from "./no-expect-in-if.ts";
import { noHandTag } from "./no-hand-tag.ts";
import { noImplicitEffectConcurrency } from "./no-implicit-effect-concurrency.ts";
import { noLedgerSql } from "./no-ledger-sql.ts";
import { noNodeFilesystem } from "./no-node-filesystem.ts";
import { noNodeImports } from "./no-node-imports.ts";
import { noNumericDuration } from "./no-numeric-duration.ts";
import { noOf } from "./no-of.ts";
import { noProjectSettings } from "./no-project-settings.ts";
import { noPromises } from "./no-promises.ts";
import { noRawTryCatch } from "./no-raw-try-catch.ts";
import { noRedactedValue } from "./no-redacted-value.ts";
import { noSecretEnv } from "./no-secret-env.ts";
import { noStageWord } from "./no-stage-word.ts";
import { noThrowInEffectGen } from "./no-throw-in-effect-gen.ts";
import { noTypeAssertions } from "./no-type-assertions.ts";
import { noWhyKey } from "./no-why-key.ts";
import { oneIdModule } from "./one-id-module.ts";
import { oneStoreHook } from "./one-store-hook.ts";
import { outsideInputConstructor } from "./outside-input-constructor.ts";
import { paddingLineBetweenStatements } from "./padding-line-between-statements.ts";
import { preferSchemaArbitrary } from "./prefer-schema-arbitrary.ts";
import { programPackageLayout } from "./program-package-layout.ts";
import { serviceId } from "./service-id.ts";
import { useImportExtensions } from "./use-import-extensions.ts";

const plugin: Plugin = {
  meta: { name: "fabrika" },
  rules: {
    "door-is-library": doorIsLibrary,
    "edge-comment": edgeComment,
    "effect-functions": effectFunctions,
    "law-shape": lawShape,
    modules,
    "no-bare-disable": noBareDisable,
    "no-bare-tell": noBareTell,
    "no-clock-in-view": noClockInView,
    "no-context-tag": noContextTag,
    "no-data-taggederror": noDataTaggederror,
    "no-effect-promise": noEffectPromise,
    "no-effect-run-outside-edge": noEffectRunOutsideEdge,
    "no-expect-in-if": noExpectInIf,
    "no-hand-tag": noHandTag,
    "no-implicit-effect-concurrency": noImplicitEffectConcurrency,
    "no-ledger-sql": noLedgerSql,
    "no-node-filesystem": noNodeFilesystem,
    "no-node-imports": noNodeImports,
    "no-numeric-duration": noNumericDuration,
    "no-of": noOf,
    "no-project-settings": noProjectSettings,
    "no-promises": noPromises,
    "no-raw-try-catch": noRawTryCatch,
    "no-redacted-value": noRedactedValue,
    "no-secret-env": noSecretEnv,
    "no-stage-word": noStageWord,
    "no-throw-in-effect-gen": noThrowInEffectGen,
    "no-type-assertions": noTypeAssertions,
    "no-why-key": noWhyKey,
    "one-store-hook": oneStoreHook,
    "program-package-layout": programPackageLayout,
    "one-id-module": oneIdModule,
    "outside-input-constructor": outsideInputConstructor,
    "padding-line-between-statements": paddingLineBetweenStatements,
    "prefer-schema-arbitrary": preferSchemaArbitrary,
    "service-id": serviceId,
    "use-import-extensions": useImportExtensions,
  },
};

export default plugin;
