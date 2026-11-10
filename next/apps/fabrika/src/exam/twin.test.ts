// P12, next/. Laws for the lint command, using installed provider registrations.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scanner } from "./twin.ts";

const check = await Effect.runPromise(scanner.pipe(Effect.provide(NodeServices.layer)));
const contract = 'export class Brain extends Cloudflare.Worker<Brain, {}, RecordPart>()("Brain") {}';
const scan = (file: string, body: string) => check(file, body, contract);

const stack = resolve(import.meta.dirname, "../../alchemy.run.ts");
const text = () => readFileSync(stack, "utf8");

const generated = fc.record({
  alias: fc
    .stringMatching(/^[A-Z][a-zA-Z0-9]{0,10}$/)
    .filter((alias) => !["Cloudflare", "Alchemy", "Context", "Effect", "Layer"].includes(alias)),
  name: fc.string(),
});

const law = (name: string, check: (input: ReturnType<typeof generated.generate>["value"]) => void) =>
  it(name, () =>
    fc.assert(fc.property(generated, check), {
      seed: 119120,
      numRuns: 20,
      examples: [
        [{ alias: "Zone", name: "test.invalid" }],
        [{ alias: "CF", name: "x" }],
        [{ alias: "C", name: "Brain" }],
      ],
    }),
  );

describe("P12 local twin lint", () => {
  // Review 6 sweep: every way a function value can leave a checked direct call.
  // Rejected syntax is a finding even when the constructor or decorator is never called here.
  const forms: ReadonlyArray<readonly [string, (ref: string, alias: string, args: string) => string]> = [
    ["computed literal", (r, _a, args) => `${r.replace(/\.([^.]+)$/, '["$1"]')}(${args});`],
    ["computed expression", (r, _a, args) => `${r.replace(/\.([^.]+)$/, '[String("$1")]')}(${args});`],
    ["optional member", (r, _a, args) => `${r.replace(/\.([^.]+)$/, "?.$1")}(${args});`],
    ["optional call", (r, _a, args) => `${r}?.(${args});`],
    [
      "bare destructure",
      (r, _a, args) =>
        `const {${r.split(".").at(-1)}} = ${r.slice(0, r.lastIndexOf("."))}; ${r.split(".").at(-1)}(${args});`,
    ],
    [
      "bare default destructure",
      (r, _a, args) =>
        `const {${r.split(".").at(-1)} = () => null} = ${r.slice(0, r.lastIndexOf("."))}; ${r.split(".").at(-1)}(${args});`,
    ],
    [
      "renamed destructure",
      (r, a, args) =>
        `const {${r.split(".").at(-1)}: outside${a}} = ${r.slice(0, r.lastIndexOf("."))}; outside${a}(${args});`,
    ],
    [
      "default destructure",
      (r, a, args) =>
        `const {${r.split(".").at(-1)}: outside${a} = () => null} = ${r.slice(0, r.lastIndexOf("."))}; outside${a}(${args});`,
    ],
    [
      "computed destructure",
      (r, a, args) =>
        `const {[${JSON.stringify(r.split(".").at(-1))}]: outside${a}} = ${r.slice(0, r.lastIndexOf("."))}; outside${a}(${args});`,
    ],
    [
      "rest destructure",
      (r, a, args) =>
        `const {...outside${a}} = ${r.slice(0, r.lastIndexOf("."))}; outside${a}[${JSON.stringify(r.split(".").at(-1))}](${args});`,
    ],
    [
      "assignment destructure",
      (r, a, args) =>
        `let outside${a}; ({${r.split(".").at(-1)}: outside${a}} = ${r.slice(0, r.lastIndexOf("."))}); outside${a}(${args});`,
    ],
    [
      "namespace spread",
      (r, a, args) =>
        `const outside${a} = {...${r.slice(0, r.lastIndexOf("."))}}; outside${a}[${JSON.stringify(r.split(".").at(-1))}](${args});`,
    ],
    ["array spread", (r, a, args) => `const outside${a} = [...[${r}]]; outside${a}[0](${args});`],
    ["call", (r, _a, args) => `${r}.call(null, ${args});`],
    ["apply", (r, _a, args) => `${r}.apply(null, [${args}]);`],
    ["Reflect.apply", (r, _a, args) => `Reflect.apply(${r}, null, [${args}]);`],
    [
      "Reflect.get",
      (r, _a, args) =>
        `Reflect.get(${r.slice(0, r.lastIndexOf("."))}, ${JSON.stringify(r.split(".").at(-1))})(${args});`,
    ],
    ["bound reference", (r, a, args) => `const outside${a} = ${r}.bind(null); outside${a}(${args});`],
    ["argument", (r, _a, args) => `((make) => make(${args}))(${r});`],
    ["returned reference", (r, _a, args) => `(() => ${r})()(${args});`],
    ["object property", (r, a, args) => `const outside${a} = {make: ${r}}; outside${a}.make(${args});`],
    ["conditional", (r, _a, args) => `(true ? ${r} : (() => null))(${args});`],
    ["sequence", (r, _a, args) => `(0, ${r})(${args});`],
    ["tagged template", (r) => `${r}\`hidden\`;`],
    ["exported reference", (r, a) => `export const outside${a} = ${r};`],
  ];

  for (const kind of ["remote", "resource"] as const) {
    for (const [form, plant] of forms) {
      law(`review 6: ${kind} ${form} fails closed beside the valid stack`, ({ alias, name }) => {
        const ref = kind === "remote" ? "Alchemy.remote" : "Cloudflare.Zone.Zone";
        const args = kind === "remote" ? "" : `${JSON.stringify(name)}, {name: "test.invalid"}`;
        const findings = scan(stack, `${text()}\n${plant(ref, alias, args)}`);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.every((f) => /^(remote override|no local provider:|unsupported-case:)/.test(f.reason))).toBe(
          true,
        );
      });
    }
  }

  for (const [form, plant] of [
    ["remote re-export", 'export {remote as outside} from "alchemy";'],
    ["resource re-export", 'export {Zone as outside} from "@alchemy.run/cloudflare";'],
    ["star re-export", 'export * from "@alchemy.run/cloudflare";'],
    ["namespace re-export", 'export * as outside from "alchemy";'],
    ["local re-export", 'export {outside} from "./remote-helper.ts";'],
    ["imported reference passed on", 'import {outside} from "./remote-helper.ts"; consume(outside);'],
    ["namespace import passed on", 'import * as outside from "./remote-helper.ts"; consume(outside);'],
    ["default import passed on", 'import outside from "./remote-helper.ts"; consume(outside);'],
    ["side effect import", 'import "./remote-helper.ts";'],
    ["external helper", 'import {outside} from "unfollowed-package"; consume(outside);'],
    ["dynamic import", 'const outside = await import("alchemy"); outside.remote();'],
    ["require", 'const outside = require("alchemy"); outside.remote();'],
    ["alchemy subpath", 'import {remote as outside} from "alchemy/Remote"; outside();'],
  ] as const) {
    law(`review 6: ${form} is followed or fails closed`, () => {
      expect(scan(stack, `${text()}\n${plant}`).length).toBeGreaterThan(0);
    });
  }

  // Review 5: each plant used to hide beside a valid local stack with zero findings.
  for (const wrap of ["assertion", "non-null", "parentheses", "satisfies", "nested wrappers"] as const) {
    law(`wrapped remote-only callee beside the valid stack: ${wrap}`, ({ name }) => {
      const resource = "Cloudflare.Zone.Zone";
      const callee = {
        assertion: `(${resource} as typeof ${resource})`,
        "non-null": `${resource}!`,
        parentheses: `((${resource}))`,
        satisfies: `(${resource} satisfies typeof ${resource})`,
        "nested wrappers": `(((${resource})! as typeof ${resource}))!`,
      }[wrap];
      const findings = scan(stack, `${text()}\n${callee}("Remote", {name: ${JSON.stringify(name)}});`);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => /^(no local provider:|unsupported-case:)/.test(f.reason))).toBe(true);
    });
  }

  for (const wrap of ["plain", "assertion", "non-null", "parentheses"] as const) {
    law(`namespace remote alias beside the valid stack: ${wrap}`, ({ alias, name }) => {
      const callee = {
        plain: "Alchemy.remote",
        assertion: "(Alchemy.remote as typeof Alchemy.remote)",
        "non-null": "Alchemy.remote!",
        parentheses: "((Alchemy.remote))",
      }[wrap];
      const findings = scan(
        stack,
        `${text()}\nconst make${alias} = ${callee};\nCloudflare.Workers.Worker(${JSON.stringify(name)}, {main: "brain.mjs"}).pipe(make${alias}());`,
      );
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => /remote|unsupported-case:/.test(f.reason))).toBe(true);
    });
  }

  for (const reason of ["computed resource", "aliased resource"]) {
    law(`named import plant beside the valid stack: ${reason}`, ({ alias, name }) => {
      const call =
        reason === "computed resource"
          ? `${alias}["Zone"]("Remote", {name: ${JSON.stringify(name)}});`
          : `const resourceAlias = ${alias}.Zone; resourceAlias("Remote", {name: ${JSON.stringify(name)}});`;
      const body = `${text()}\nimport {Zone as ${alias}} from "@alchemy.run/cloudflare";\n${call}`;
      expect(scan(stack, body).map((f) => f.reason)).toContainEqual(
        expect.stringContaining(`unsupported-case: ${reason}`),
      );
    });
  }

  law("every named Cloudflare namespace is checked alongside valid local resources", ({ alias, name }) => {
    for (const [imported, call] of [
      ["Zone", "Zone.Zone"],
      [`Zone as ${alias}`, `${alias}.Zone`],
    ]) {
      const body = `${text()}\nimport {${imported}} from "@alchemy.run/cloudflare";\n${call}("Remote", {name: ${JSON.stringify(name)}});`;
      expect(scan(stack, body).map((f) => f.reason)).toContain("no local provider: Cloudflare.Zone.Zone");
    }
  });
  law("a called stack helper is inspected or reported as unsupported", ({ alias }) => {
    const body = `${text()}\nimport {extraResources as ${alias}} from "./unfollowed-stack-helper.ts";\n${alias}();`;
    expect(scan(stack, body).some((f) => f.reason.startsWith("unsupported-case:"))).toBe(true);
  });
  law("the actual stack has no findings, with no second resource list", ({ name }) => {
    expect(scan(stack, `${text()}\nconst checkedName = ${JSON.stringify(name)};`)).toEqual([]);
  });
  // T502: the installed scanner is extended, not a second parser. Cases: aliases, quoted keys,
  // wrong target, omitted key, and a matching key in another Worker. Plant: remove RecordPart:.
  law("every hosted object has its own class-name binding in the same Worker", ({ alias }) => {
    const source = (bindings: string | undefined, other = "") =>
      `import * as ${alias} from "@alchemy.run/cloudflare";
       ${alias}.Workers.Worker("Brain", {main:"brain.mjs", ${bindings === undefined ? "" : `env:{${bindings}}`}}); ${other}`;
    const binding = `${alias}.DurableObject("RecordPart")`;
    expect(scan("binding.ts", source(undefined).replace('"Brain"', '"Other"'))).toEqual([]);
    expect(
      scan("binding.ts", source(undefined).replace('"Brain"', "workerName")).some((f) =>
        f.reason.startsWith("unsupported-case:"),
      ),
    ).toBe(true);
    expect(scan("binding.ts", source(`PROJECT:${alias}.DurableObject("Project"), RecordPart:${binding}`))).toEqual([]);

    for (const broken of [undefined, "", "export class Brain {}", contract.replace("RecordPart", "Unknown[]")]) {
      expect(
        check("binding.ts", source(`RECORD:${binding}`), broken).some(
          (f) => f.reason === "unsupported-case: cannot read host contract",
        ),
      ).toBe(true);
    }

    for (const key of ["RecordPart", '"RecordPart"']) {
      expect(scan("binding.ts", source(`RECORD:${binding}, ${key}:${binding}`))).toEqual([]);
    }

    // Pinned review-2 escapes: later keys and spreads can replace a valid binding.
    for (const overwritten of ["undefined", '"Other"', "replacement"]) {
      expect(
        scan("binding.ts", source(`RecordPart:${binding}, RecordPart:${overwritten}`)).some((f) =>
          f.reason.startsWith("unsupported-case:"),
        ),
      ).toBe(true);
    }

    for (const props of [
      `env:{RecordPart:${binding}}, env:{}`,
      `env:{RecordPart:${binding}}, ...replacement`,
      `env:{RecordPart:${binding}, ...replacement}`,
    ]) {
      expect(
        scan(
          "binding.ts",
          `import * as ${alias} from "@alchemy.run/cloudflare";
           ${alias}.Workers.Worker("Brain", {main:"brain.mjs", ${props}});`,
        ).some((f) => f.reason.startsWith("unsupported-case:")),
      ).toBe(true);
    }

    for (const [bindings, other] of [
      [undefined, ""],
      ["", ""],
      [`RECORD:${binding}`, ""],
      [`RECORD:${binding}, RecordPart:${alias}.DurableObject("Other")`, ""],
      [`RECORD:${binding}`, `${alias}.Workers.Worker("Other", {main:"other.mjs", env:{RecordPart:${binding}}});`],
    ]) {
      expect(scan("binding.ts", source(bindings!, other)).some((f) => f.reason.includes("class-name binding"))).toBe(
        true,
      );
    }
  });
  law("plant: a remote-only resource and remote override both fail", ({ alias, name }) => {
    const body = [
      `import * as ${alias} from "@alchemy.run/cloudflare";`,
      'import * as Alchemy from "alchemy";',
      `const remote = ${alias}.Zone.Zone("Zone", {name: ${JSON.stringify(name)}});`,
      "remote.pipe(Alchemy.remote());",
    ].join("\n");
    expect(scan("plant.ts", body).map((f) => f.reason)).toEqual([
      "no local provider: Cloudflare.Zone.Zone",
      "remote override",
    ]);
  });
  law("plant: unknown resources and computed calls never silently count as local", ({ alias, name }) => {
    for (const call of [
      `${alias}.Unknown(${JSON.stringify(name)}, {})`,
      `${alias}["Workers"](${JSON.stringify(name)}, {})`,
    ]) {
      const findings = scan("plant.ts", `import * as ${alias} from "@alchemy.run/cloudflare";\n${call};`);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.reason).toMatch(/^unsupported-case:/);
    }
  });
  law("uses installed Worker and R2 local registrations, including import aliases", ({ alias, name }) => {
    const body = [
      `import * as ${alias} from "@alchemy.run/cloudflare";`,
      // A generated name may be the host's, so include its binding.
      `const worker = ${alias}.Workers.Worker(${JSON.stringify(name)}, {main: "brain.mjs", env: {RecordPart: ${alias}.DurableObject("RecordPart")}});`,
      `const bucket = ${alias}.R2.Bucket("Health", {name: "health"});`,
    ].join("\n");
    expect(scan("plant.ts", body)).toEqual([]);
  });
  law("plant: aliased constructors, subpath imports and named remote overrides fail closed", ({ alias, name }) => {
    for (const body of [
      `import * as ${alias} from "@alchemy.run/cloudflare"; const W = ${alias}.Worker; W(${JSON.stringify(name)}, {});`,
      `import * as ${alias} from "@alchemy.run/cloudflare/Workers"; ${alias}.Worker(${JSON.stringify(name)}, {});`,
      `import {remote as ${alias}} from "alchemy"; ${alias}();`,
      "export const stack = {};",
    ]) {
      expect(scan("plant.ts", body).length).toBeGreaterThan(0);
    }
  });
  law("the command exits nonzero and counts every planted finding", ({ alias, name }) => {
    const home = mkdtempSync(join(tmpdir(), "p12-twin-"));

    try {
      const file = join(home, "alchemy.run.ts");
      writeFileSync(
        file,
        `import * as ${alias} from "@alchemy.run/cloudflare"; ${alias}.Zone.Zone(${JSON.stringify(name)}, {});`,
      );
      const ran = spawnSync(process.execPath, [join(import.meta.dirname, "twin.ts"), file], {
        encoding: "utf8",
      });
      expect(ran.status).toBe(1);
      expect(ran.stdout).toContain("lint:twin: 1 findings");
      expect(ran.stderr).toContain("no local provider: Cloudflare.Zone.Zone");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("scenario: pnpm lint:twin checks the real stack and prints its count", () => {
    const ran = spawnSync("pnpm", ["-s", "lint:twin"], {
      cwd: resolve(import.meta.dirname, "../../../../.."),
      encoding: "utf8",
    });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("lint:twin: 0 findings");
  });
});
