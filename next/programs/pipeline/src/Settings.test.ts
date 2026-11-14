import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, SchemaIssue } from "effect";
import * as fc from "fast-check";
import { merger } from "./Merger.ts";
import * as Settings from "./Settings.ts";

const positive = fc.oneof(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }));

const invalid = fc.oneof(
  fc.integer({ max: 0 }),
  fc.constantFrom(0.5, Number.NaN, Infinity, -Infinity, "no", false, []),
);

const name = fc.string({ unit: "binary", minLength: 1, maxLength: 24 });
const checks = fc.array(fc.record({ name, source: name }), { maxLength: 5 });

it("L11: a person's nested table supplies values or defaults and refuses only bad keys", () => {
  const values = fc.record({
    wait: positive,
    poll: positive,
    backoff: positive,
    rounds: positive,
    most: positive,
    rows: checks,
    docs: checks,
    code: checks,
    glob: fc.constantFrom("docs/**", "rows/*.json", ".hidden/**"),
  });
  fc.assert(
    fc.property(
      values,
      fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
      fc.nat(),
      invalid,
      (values, omitted, pick, bad) => {
        const read = (settings: unknown) =>
          Effect.runSyncExit(
            Settings.all.parse(
              ConfigProvider.fromUnknown({ pack: { pipeline: { settings } } }, { preserveEmptyStrings: true }).pipe(
                ConfigProvider.nested("settings"),
                ConfigProvider.nested("pipeline"),
                ConfigProvider.nested("pack"),
              ),
            ),
          );
        const table = {
          queue: {
            ...(omitted[5] ? {} : { most: values.most }),
            ...(omitted[0] ? {} : { kinds: { rows: [values.glob], docs: [values.glob] } }),
            ...(omitted[1] ? {} : { checks: { rows: values.rows, docs: values.docs, code: values.code } }),
          },
          merger: {
            ...(omitted[2] ? {} : { wait: values.wait }),
            ...(omitted[3] ? {} : { poll: values.poll }),
            ...(omitted[4] ? {} : { backoff: values.backoff }),
            ...(omitted[6] ? {} : { rounds: values.rounds }),
          },
        };
        const defaults = Object.fromEntries(
          Object.entries(Settings.all.settings).map(([key, setting]) => [key, setting.default]),
        );
        const empty = read({});
        expect(Exit.isSuccess(empty)).toBe(true);

        if (Exit.isSuccess(empty)) {
          expect(empty.value).toEqual(defaults);
          // pinned: the approved settings table starts with five rounds and a 256-entry line.
          expect(empty.value).toMatchObject({ rounds: 5, most: 256 });
          const checksDeclaration = Settings.all.declarations.find((d) => d.path === "queue.checks")!;
          expect(checksDeclaration.default).toEqual({ rows: [], docs: [], code: [] });
        }

        const decoded = read(table);
        expect(Exit.isSuccess(decoded)).toBe(true);

        if (Exit.isSuccess(decoded)) {
          for (const [key, setting] of Object.entries(Settings.all.settings)) {
            const from = setting.segments.reduce<unknown>(
              (value, segment) =>
                value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined,
              table,
            );
            expect(Reflect.get(decoded.value, key)).toEqual(from ?? setting.default);
          }

          expect(merger(decoded.value).machine).toBeDefined();
        }

        for (const declaration of Settings.all.declarations) {
          expect(declaration.scope).toEqual(["repo"]);
          expect(declaration.reload).toBe("restart");
          expect(declaration.doc.length).toBeGreaterThan(0);
        }

        for (const kind of ["rows", "docs", "code"] as const) {
          expect(Settings.key(kind)).toBe(`queue.checks.${kind}`);
        }

        const broken = structuredClone(table) as { queue: Record<string, unknown>; merger: Record<string, unknown> };
        const paths = [
          "merger.wait",
          "merger.poll",
          "merger.backoff",
          "merger.rounds",
          "queue.most",
          "queue.kinds",
          "queue.checks",
        ];
        const path = paths[pick % paths.length]!;

        if (path.startsWith("merger.")) {
          broken.merger[path.split(".")[1]!] = bad;
        } else if (path === "queue.most") {
          broken.queue.most = bad;
        } else if (path === "queue.kinds") {
          broken.queue.kinds = {
            rows: [pick % 3 === 0 ? "" : pick % 3 === 1 ? "!docs/**" : "x".repeat(65_537)],
            docs: [],
          };
        } else {
          broken.queue.checks = {
            rows: [],
            docs: [],
            code: [pick % 2 === 0 ? { name: "" } : { name: "check", source: "" }],
          };
        }

        // A zero poll was once missed by this generated table's invalid-value draw.
        expect(Exit.isFailure(read({ ...table, merger: { ...table.merger, poll: 0 } }))).toBe(true);
        expect(Exit.isFailure(read({ ...table, merger: { ...table.merger, rounds: 0 } }))).toBe(true);
        expect(Exit.isFailure(read({ ...table, queue: { ...table.queue, most: 0 } }))).toBe(true);
        const refused = read(broken);
        expect(Exit.isFailure(refused)).toBe(true);

        if (Exit.isFailure(refused)) {
          const keys = refused.cause.reasons.flatMap((reason) =>
            reason._tag === "Fail" && reason.error.cause._tag === "SchemaError"
              ? SchemaIssue.makeFormatterStandardSchemaV1()(reason.error.cause.issue).issues.map((issue) =>
                  (issue.path ?? []).map((part) => String(typeof part === "object" ? part.key : part)).join("."),
                )
              : [],
          );
          expect(keys.length).toBeGreaterThan(0);

          for (const key of keys) {
            expect(key).toContain(path);

            for (const good of paths.filter((p) => p !== path)) {
              expect(key).not.toContain(good);
            }
          }
        }
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("L11: every declared numeric setting refuses zero, negatives and fractions at its own path", () => {
  fc.assert(
    fc.property(invalid, fc.nat(), (bad, pick) => {
      const declarations = Settings.all.declarations.filter((d) => typeof d.default === "number");
      expect(declarations.length).toBeGreaterThan(0);
      const declaration = declarations[pick % declarations.length]!;
      const [group, key] = declaration.path.split(".") as [string, string];
      const parse = (value: unknown) =>
        Effect.runSyncExit(Settings.all.parse(ConfigProvider.fromUnknown({ [group]: { [key]: value } })));

      for (const value of [bad, 0]) {
        const refused = parse(value);
        expect(Exit.isFailure(refused)).toBe(true);

        if (Exit.isFailure(refused)) {
          const paths = refused.cause.reasons.flatMap((reason) =>
            reason._tag === "Fail" && reason.error.cause._tag === "SchemaError"
              ? SchemaIssue.makeFormatterStandardSchemaV1()(reason.error.cause.issue).issues.map((issue) =>
                  (issue.path ?? []).map((part) => String(typeof part === "object" ? part.key : part)).join("."),
                )
              : [],
          );
          expect(paths.some((path) => path.includes(declaration.path))).toBe(true);
        }
      }
    }),
    { seed: 119120, numRuns: 100 },
  );
});
