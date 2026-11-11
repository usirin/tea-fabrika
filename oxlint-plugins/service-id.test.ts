// Ticket 737, G2. `fabrika/service-id` asks a libfabrika service ID for the package, its file's path,
// then `.Name` when the service is named otherwise (decision 0023). The fixtures are the rule's own
// inputs (0093), planted at real libfabrika paths with the repo's config; the replay reads the tree.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "fabrika(service-id)";
const P = "@kampus/libfabrika";
const SRC = "next/packages/libfabrika/src";
const root = resolve(import.meta.dirname, "..");

const word = fc.stringMatching(/^[a-z]{2,6}$/);
const Pascal = word.map((w) => `${w[0]!.toUpperCase()}${w.slice(1)}Svc`);

/** A file of numbered lines, and the lines the rule must fire on. */
const file = (lines: ReadonlyArray<readonly [string, boolean]>) => ({
  text: `${lines.map(([line]) => line).join("\n")}\n`,
  fires: lines.flatMap(([, fires], i) => (fires ? [i + 1] : [])),
});

describe("T737 G2 service IDs carry the package and the file's path", () => {
  it("fires on exactly the IDs that miss the package, the path or the name, through every import form", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Two service names in one file must differ, or the file does not parse and nothing fires.
        fc
          .record({ alias: word.map((w) => `C${w}`), folder: word, name: Pascal, other: Pascal })
          .filter(({ name, other }) => name !== other),
        async ({ alias, folder, name, other }) => {
          const at = `${SRC}/${folder}/${name}.ts`;
          const base = `${P}/${folder}/${name}`;
          const files = {
            // Barrel import, the curried class form, a second service in the file, and a Reference.
            [at]: file([
              ['import { Context, Effect } from "effect";', false],
              [`export class ${name} extends Context.Service<${name}, {}>()("${base}") {}`, false],
              [`export class ${other} extends Context.Service<${other}, {}>()("${base}.${other}") {}`, false],
              // The package or the folder is missing, or the name is not the class's.
              [`export class A${name} extends Context.Service<A${name}, {}>()("${P}/A${name}") {}`, true],
              [`export class B${name} extends Context.Service<B${name}, {}>()("${P}/${name}.B${name}") {}`, true],
              [`export class C${name} extends Context.Service<C${name}, {}>()("${folder}/${name}.C${name}") {}`, true],
              [`export class D${name} extends Context.Service<D${name}, {}>()("${base}.${other}") {}`, true],
              // A package with the same prefix, and a path that only starts the same.
              [
                `export class E${name} extends Context.Service<E${name}, {}>()("${P}-old/${folder}/${name}.E${name}") {}`,
                true,
              ],
              [`export class F${name} extends Context.Service<F${name}, {}>()("${base}X.F${name}") {}`, true],
              // The class named as its file needs no suffix, and must not repeat it.
              [`export class G${name} extends Context.Service<G${name}, {}>()(\`${base}.G${name}\`) {}`, false],
              // A Reference or a direct Service names nothing the rule trusts: the path, then any one name.
              [
                `export const make = () => Context.Reference<number>("${base}.Notes", { defaultValue: () => 0 });`,
                false,
              ],
              [`export const bad = () => Context.Reference<number>("fabrika/Notes", { defaultValue: () => 0 });`, true],
              [`export const direct = Context.Service<{ readonly n: number }>("${base}");`, false],
              [`export const wrong = Context.Service<{ readonly n: number }>("${base}.a.b");`, true],
              [
                `export const near = () => Context.Reference<number>("${base}X.Notes", { defaultValue: () => 0 });`,
                true,
              ],
              // An ID the rule cannot read is reported as unproved.
              [`const tail = "${name}";`, false],
              [`export class H${name} extends Context.Service<H${name}, {}>()(\`${P}/${folder}/\${tail}\`) {}`, true],
              // Type-only uses and unrelated calls pass.
              ["export type T = typeof Context.Service;", false],
              ["export const other = Effect.Service;", false],
            ]),
            // A renamed import, a computed member and an optional member.
            [`${SRC}/${folder}/Renamed.ts`]: file([
              [`import { Context as ${alias} } from "effect";`, false],
              [`export class Renamed extends ${alias}.Service<Renamed, {}>()("${P}/${folder}/Renamed") {}`, false],
              [`export class Bad extends ${alias}["Service"]<Bad, {}>()("${P}/Bad") {}`, true],
              [`export const ref = ${alias}?.Reference<number>("${P}/Ref", { defaultValue: () => 0 });`, true],
            ]),
            // The module imported as a namespace, and its members imported by name.
            [`${SRC}/${folder}/Module.ts`]: file([
              [`import * as ${alias} from "effect/Context";`, false],
              ['import { Reference as R, Service } from "effect/Context";', false],
              [`export class Module extends ${alias}.Service<Module, {}>()("${P}/Module") {}`, true],
              [`export class Named extends Service<Named, {}>()("${P}/${folder}/Module.Named") {}`, false],
              [`export const r = R<number>("${P}/r", { defaultValue: () => 0 });`, true],
            ]),
            // The barrel imported as a namespace.
            [`${SRC}/${folder}/internal/deep.ts`]: file([
              [`import * as ${alias} from "effect";`, false],
              [
                `export class Deep extends ${alias}.Context.Service<Deep, {}>()("${P}/${folder}/internal/deep.Deep") {}`,
                false,
              ],
              [`export class Flat extends ${alias}.Context.Service<Flat, {}>()("${P}/${folder}/deep.Flat") {}`, true],
            ]),
            // A root file, as `Id.ts` holds `Generator`.
            [`${SRC}/${name}.ts`]: file([
              ['import { Context } from "effect";', false],
              [`export class ${other} extends Context.Service<${other}, {}>()("${P}/${name}.${other}") {}`, false],
              [`export class X${other} extends Context.Service<X${other}, {}>()("${P}/X${other}") {}`, true],
            ]),
            // A shadowed Context, and a parameter named Context, are not Effect's.
            [`${SRC}/${folder}/Shadow.ts`]: file([
              ['import { Context as Effectful } from "effect";', false],
              ["const Context = { Service: () => (id: string) => class { id = id; } };", false],
              [`export class Shadow extends Context.Service()("anything") {}`, false],
              [
                `export const f = (Effectful: { Reference: (id: string) => string }) => Effectful.Reference("x");`,
                false,
              ],
            ]),
            // Outside libfabrika's source the rule says nothing.
            "next/apps/fabrika/src/Outside.ts": file([
              ['import { Context } from "effect";', false],
              ['export class Outside extends Context.Service<Outside, {}>()("t/Outside") {}', false],
            ]),
            "packages/fabrika/src/Old.ts": file([
              ['import { Context } from "effect";', false],
              ['export class Old extends Context.Service<Old, {}>()("old/Old") {}', false],
            ]),
          };
          const linted = await plant(Object.fromEntries(Object.entries(files).map(([path, f]) => [path, f.text])));

          for (const [path, f] of Object.entries(files)) {
            expect(linted(CODE, path), path).toEqual(f.fires);
          }
        },
      ),
      { seed: 119120, numRuns: 4 },
    );
  });

  // The plan's mapping, old to new, kept here because diagnostics can hold either spelling.
  // `ProgramRunner` is the next slice's and has no row.
  const mapping = [
    ["Id.ts", "Generator", "Id.Generator", "Id.Generator"],
    ["access/ClientManager.ts", "ClientManager", "ClientManager", "access/ClientManager"],
    ["access/SessionManager.ts", "SignRequest", "SignRequest", "access/SessionManager.SignRequest"],
    ["access/SessionManager.ts", "SessionManager", "SessionManager", "access/SessionManager"],
    ["cloudflare/connection.ts", "ConnectionService", "fabrika/Connection", "cloudflare/connection.ConnectionService"],
    ["cloudflare/platform.ts", "ProjectClient", "fabrika/ProjectClient", "cloudflare/platform.ProjectClient"],
    ["cloudflare/platform.ts", "ProcessClient", "fabrika/ProcessClient", "cloudflare/platform.ProcessClient"],
    ["cloudflare/platform.ts", "GatewayClient", "fabrika/GatewayClient", "cloudflare/platform.GatewayClient"],
    ["cloudflare/platform.ts", "RecordClient", "fabrika/RecordClient", "cloudflare/platform.RecordClient"],
    ["cloudflare/platform.ts", "StorageClient", "fabrika/StorageClient", "cloudflare/platform.StorageClient"],
    ["cloudflare/platform.ts", "BucketClient", "fabrika/BucketClient", "cloudflare/platform.BucketClient"],
    ["cloudflare/runtime.ts", null, "fabrika/WriteNotifications", "cloudflare/runtime.WriteNotifications"],
    ["cloudflare/runtime.ts", "ProjectService", "fabrika/Project", "cloudflare/runtime.ProjectService"],
    ["cloudflare/runtime.ts", "ProcessService", "fabrika/Process", "cloudflare/runtime.ProcessService"],
    ["gateway/Gateway.ts", "Gateway", "Gateway", "gateway/Gateway"],
    ["ledger/Ledger.ts", "Doorbell", "Doorbell", "ledger/Ledger.Doorbell"],
    ["ledger/Ledger.ts", "Ledger", "Ledger", "ledger/Ledger"],
    ["ledger/LedgerTransaction.ts", "LedgerTransaction", "LedgerTransaction", "ledger/LedgerTransaction"],
    ["ledger/Referee.ts", "Referee", "Referee", "ledger/Referee"],
    ["presence/Connections.ts", "Connections", "Connections", "presence/Connections"],
    ["processes/Mailbox.ts", "RunnerMail", "RunnerMail", "processes/Mailbox.RunnerMail"],
    ["processes/Mailbox.ts", "Mailbox", "Mailbox", "processes/Mailbox"],
    ["processes/ProcessIdGenerator.ts", "ProcessIdGenerator", "ProcessIdGenerator", "processes/ProcessIdGenerator"],
    ["processes/ProcessManager.ts", "ProcessManager", "ProcessManager", "processes/ProcessManager"],
    ["runtime/Entry.ts", "ProgramLoader", "ProgramLoader", "runtime/Entry.ProgramLoader"],
    ["runtime/Entry.ts", "CheckedWriter", "CheckedWriter", "runtime/Entry.CheckedWriter"],
    ["runtime/Entry.ts", "WatcherManager", "WatcherManager", "runtime/Entry.WatcherManager"],
    ["runtime/Entry.ts", "Alarm", "Alarm", "runtime/Entry.Alarm"],
    ["runtime/Entry.ts", "Recording", "Recording", "runtime/Entry.Recording"],
    ["runtime/Execution.ts", "ExecutionClient", "fabrika/ExecutionClient", "runtime/Execution.ExecutionClient"],
    ["runtime/ProcessStore.ts", "ProcessStore", "ProcessStore", "runtime/ProcessStore"],
    ["runtime/RecoveryStore.ts", "RecoveryStore", "RecoveryStore", "runtime/RecoveryStore"],
    ["runtime/Runner.test.ts", "ViewedRunner", "test/P11ViewedRunner", "runtime/Runner.test.ViewedRunner"],
    ["telemetry/Archive.ts", "Archive", "Archive", "telemetry/Archive"],
    ["telemetry/Records.ts", "RecordManager", "RecordManager", "telemetry/Records.RecordManager"],
    ["telemetry/Sink.ts", "SpanSink", "SpanSink", "telemetry/Sink.SpanSink"],
  ] as const;

  /** An old ID as it was written: bare names had the package in front. */
  const written = (old: string) => (old.includes("/") ? old : `${P}/${old}`);

  it("vector: the plan's mapping is what the rule asks for, and every old spelling but Id.Generator fires", async () => {
    const files = new Map<string, Array<readonly [string, boolean]>>();

    for (const [path, name, old, next] of mapping) {
      const lines = files.get(path) ?? [['import { Context } from "effect";', false]];
      const declare = (id: string, n: number) =>
        name === null
          ? `export const notes${n} = () => Context.Reference<number>("${id}", { defaultValue: () => 0 });`
          : `export class ${name}${n === 0 ? "" : "Old"} extends Context.Service<${name}, {}>()("${id}") {}`;
      lines.push([declare(`${P}/${next}`, 0), false]);

      // The old spelling, as a second class of the same name in its file, so the expected ID is the same.
      if (name !== null) {
        lines.push([
          `export const ${name}Old = class ${name} extends Context.Service<${name}, {}>()("${written(old)}") {};`,
          written(old) !== `${P}/${next}`,
        ]);
      } else {
        lines.push([declare(written(old), 1), true]);
      }

      files.set(path, lines);
    }

    const planted = [...files].map(([path, lines]) => [`${SRC}/${path}`, file(lines)] as const);
    const linted = await plant(Object.fromEntries(planted.map(([path, f]) => [path, f.text])));

    for (const [path, f] of planted) {
      expect(linted(CODE, path), path).toEqual(f.fires);
    }
  });

  it("scenario: replayed over libfabrika's own source, the rule finds only the next slice's ProgramRunner ID", () => {
    const ran = spawnSync(
      join(root, "node_modules/.bin/oxlint"),
      [`--config=${join(root, ".oxlintrc.json")}`, "--disable-nested-config", "--no-ignore", "--format=json", SRC],
      { cwd: root, encoding: "utf8", maxBuffer: 2 ** 30, timeout: 120_000 },
    );
    const report: { readonly diagnostics: ReadonlyArray<{ readonly code?: string; readonly filename: string }> } =
      JSON.parse(ran.stdout);
    const hits = report.diagnostics.filter((d) => d.code === CODE).map((d) => d.filename);
    // The decision 0023 sweep leaves only Runner's ID, which the next slice renames with its other sites.
    expect(hits).toEqual([`${SRC}/runtime/Runner.ts`]);
  });
});
