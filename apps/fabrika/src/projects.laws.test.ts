import { applyCell } from "@demlik/tea";
import { arbMsgSequence } from "@demlik/tea/pbt";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { CREDENTIALS, RECORD_FIELDS, SECRET_OUTPUTS, secretsCheck } from "../projects-e2e.ts";
import { go, home, options, plant, repo, source } from "./project.test-support.ts";
import { type ProjectsCmd, projectsMachine, restored, start_host } from "./projects.ts";

type Machine = typeof projectsMachine;
type Fixture = Awaited<ReturnType<typeof fixture>>["projects"];

/** The real machine with some handlers or its init replaced: a plant fed through its real Msgs. */
const planted = (update: Partial<Machine["update"]>, init?: Machine["init"]): Machine => ({
  ...projectsMachine,
  update: { ...projectsMachine.update, ...update } as Machine["update"],
  ...(init === undefined ? {} : { init }),
});

/** A plant's projects: made once per plant, in its own app home. */
const once = () => {
  let made: Promise<Fixture> | null = null;
  return () => (made ??= fixture().then((f) => f.projects));
};

const operations = fc.array(
  fc.record({
    project: fc.integer({ min: 0, max: 1 }),
    action: fc.constantFrom("open", "focus", "close", "cancel", "quit"),
    source,
  }),
  { minLength: 1, maxLength: 30 },
);

const unique = (keys: readonly string[]) => expect(new Set(keys).size).toBe(keys.length);

const noStart = (cmds: readonly { type: string }[]) => {
  expect(cmds.filter((cmd) => /start_host|start_tsh|stop_host|stop_job/.test(cmd.type))).toEqual([]);
};

const fixture = async () => {
  const { Project } = await import("./project.ts");
  const app = home();
  return {
    app,
    projects: await Promise.all(["left/repo", "right/repo"].map((name) => go(Project.check(repo(app, name))))),
  };
};

const openRequests = fc.array(
  fc.record({
    source,
    alias: fc.constantFrom("root", "link", "subfolder"),
    finish: fc.boolean(),
  }),
  { minLength: 2, maxLength: 30 },
);

/** P3's check: however the opens of one root interleave, one host and one window start. */
const reservesOnce = (
  projectsMachine: Machine,
  projects: Fixture,
  requests: typeof openRequests extends fc.Arbitrary<infer A> ? A : never,
) => {
  const project = projects[0]!;
  let model = projectsMachine.init(null, undefined)[0];
  const commands: { readonly type: string }[] = [];

  for (const request of requests) {
    const [next, out] = applyCell(projectsMachine, model, {
      type: "open",
      project,
      source: request.source,
      said: 1,
      by: "user:fixture",
    });
    model = next;
    commands.push(...out);

    if (request.finish) {
      model = applyCell(projectsMachine, model, {
        type: "opened",
        key: project.key,
        window: "window-left",
      })[0];
    }
  }

  expect(commands.filter((cmd) => cmd.type === "start_host")).toHaveLength(1);
  expect(commands.filter((cmd) => cmd.type === "open_window")).toHaveLength(1);
  expect(Object.keys(model.projects)).toEqual([project.key]);
};

it("P3: linked and interleaved opens reserve one canonical key before starting", async () => {
  const { projects } = await fixture();
  fc.assert(
    fc.property(openRequests, (requests) => reservesOnce(projectsMachine, projects, requests)),
    options,
  );
});

// The plant: an open looks for a reservation only after it starts, so a second open starts again.
const p3 = once();

plant("P3 reserve after starting", openRequests, async (requests) =>
  reservesOnce(
    planted({
      open: (s, m) => {
        const { [m.project.key]: _reserved, ...others } = s.projects;
        return projectsMachine.update.open({ ...s, projects: others }, m);
      },
    }),
    await p3(),
    requests,
  ),
);

const launchFlows = fc.array(fc.constantFrom("launch", "choose_folder", "cancel"), { maxLength: 30 });

/** P5's check: launch shows welcome and starts nothing; cancel keeps the recents. */
const welcomeFirst = (projectsMachine: Machine, flow: typeof launchFlows extends fc.Arbitrary<infer A> ? A : never) => {
  let [model, cmds] = projectsMachine.init(null, undefined);
  noStart(cmds);
  expect(model.look._tag).toBe("welcome");

  for (const type of flow) {
    const before = model;
    [model, cmds] = applyCell(projectsMachine, model, { type });
    noStart(cmds);
    expect(model.look._tag).toBe("welcome");
    expect(model.projects).toEqual({});

    if (type === "cancel") {
      expect(model.recent).toEqual(before.recent);
    }
  }
};

it("P5: launch without a folder shows welcome and recents; every cancelled opening keeps state", async () => {
  fc.assert(
    fc.property(launchFlows, (flow) => welcomeFirst(projectsMachine, flow)),
    options,
  );
  const { projects } = await fixture();
  const [reopened, cmds] = projectsMachine.init(
    // The machine's init takes the app's saved session; `restored` makes the model it reads.
    restored({
      recent: projects.map((project) => ({
        project,
        name: "repo",
        path: project.root,
        at: 10,
        open: false,
      })),
      restore: projects.map((project) => project.key),
    }),
    undefined,
  );
  expect(reopened.look._tag).toBe("welcome");
  expect(reopened.recent).toHaveLength(2);
  noStart(cmds); // PR 2 alone adds automatic reopening.
});

// The plant: launch starts the app home's own host, as the single-desk app did.
plant("P5 start the legacy host at launch", launchFlows, (flow) =>
  welcomeFirst(
    planted({}, (loaded, ctx) => {
      const [model, cmds] = projectsMachine.init(loaded, ctx);
      return [model, [...cmds, start_host({ project: { root: "/fixture/app-home", key: "legacy" } })]];
    }),
    flow,
  ),
);

/**
 * P6's check: close and quit stop no host or job, and close leaves the other window alone.
 * `finalize` is what a window's close does beyond the machine's own Cmds: nothing in the product.
 */
const closesOnlyWindows = (
  projectsMachine: Machine,
  projects: Fixture,
  flow: typeof operations extends fc.Arbitrary<infer A> ? A : never,
  finalize: (key: string) => readonly { readonly type: string }[] = () => [],
) => {
  let model = projectsMachine.init(null, undefined)[0];

  for (const project of projects) {
    model = applyCell(projectsMachine, model, {
      type: "open",
      project,
      source: "welcome",
      said: 1,
      by: "user:fixture",
    })[0];
    model = applyCell(projectsMachine, model, {
      type: "opened",
      key: project.key,
      window: project.key,
    })[0];
  }

  for (const op of flow) {
    const key = projects[op.project]!.key;

    if (op.action !== "close" && op.action !== "quit") {
      model = applyCell(projectsMachine, model, {
        type: op.action,
        key,
        project: projects[op.project]!,
        source: op.source,
        said: 1,
        by: "user:fixture",
      })[0];

      if (op.action === "open") {
        model = applyCell(projectsMachine, model, { type: "opened", key, window: key })[0];
      }

      continue;
    }

    const before = model;
    const [next, cmds] = applyCell(projectsMachine, model, {
      type: op.action,
      key,
      source: op.source,
    });
    expect([...cmds, ...finalize(key)].filter((cmd) => /stop_host|stop_job|kill/.test(cmd.type))).toEqual([]);

    if (op.action === "close") {
      const other = projects[1 - op.project]!.key;
      expect(next.projects[other]?.window).toEqual(before.projects[other]?.window);
    }

    model = next;
  }
};

it("P6: close and quit close only their windows and never stop hosts or jobs", async () => {
  const { projects } = await fixture();
  fc.assert(
    fc.property(operations, (flow) => closesOnlyWindows(projectsMachine, projects, flow)),
    options,
  );
});

// The plant: closing a window stops its host as it goes.
const p6 = once();

plant("P6 stop a host in a window finalizer", operations, async (flow) =>
  closesOnlyWindows(projectsMachine, await p6(), [...flow, { project: 0, action: "close", source: "box" }], (key) => [
    { type: "stop_host", key },
  ]),
);

const sessionMessages = arbMsgSequence(
  fc.record({
    type: fc.constantFrom("open", "focus", "close"),
    index: fc.integer({ min: 0, max: 1 }),
    source,
  }),
  { maxLength: 30 },
);

const restoreCheck = (saved: readonly string[], expected: readonly string[]) => {
  unique(saved);
  expect(new Set(saved)).toEqual(new Set(expected));
};

/** P7's check: quit saves the open windows before it closes them, and its close events keep that list. */
const quitKeepsRestore = (
  projectsMachine: Machine,
  projects: Fixture,
  messages: typeof sessionMessages extends fc.Arbitrary<infer A> ? A : never,
) => {
  let model = projectsMachine.init(null, undefined)[0];

  for (const m of [...messages, { type: "open", index: 0, source: "box" }]) {
    const project = projects[m.index]!;
    model = applyCell(projectsMachine, model, {
      type: m.type,
      project,
      key: project.key,
      source: m.source,
      said: 1,
      by: "user:fixture",
    })[0];

    if (m.type === "open") {
      model = applyCell(projectsMachine, model, {
        type: "opened",
        key: project.key,
        window: project.key,
      })[0];
    }
  }

  const expected = Object.values(model.projects)
    .filter((p) => p.window !== null)
    .map((p) => p.project.key);
  const [quitting, cmds] = applyCell(projectsMachine, model, { type: "quit" });
  const save = cmds.findIndex((cmd) => cmd.type === "save_session");
  const close = cmds.findIndex((cmd) => cmd.type === "close_window");
  expect(save).toBeGreaterThanOrEqual(0);
  expect(close === -1 || save < close).toBe(true);
  model = quitting;

  for (const key of expected) {
    model = applyCell(projectsMachine, model, { type: "closed", key })[0];
  }

  restoreCheck(model.restore, expected);
  // PR 1 checks saved data only. No automatic launch or Dock restore.
};

it("P7: quit saves the pre-close restore list once; quit close events cannot erase it", async () => {
  const { projects } = await fixture();
  fc.assert(
    fc.property(sessionMessages, (messages) => quitKeepsRestore(projectsMachine, projects, messages)),
    options,
  );
});

// The plant: each close event, quit's included, takes its project off the restore list.
const p7 = once();

plant("P7 let quit's close events erase restore", sessionMessages, async (messages) =>
  quitKeepsRestore(
    planted({
      closed: (s, m) => {
        const [next, cmds] = projectsMachine.update.closed(s, m);
        return [{ ...next, restore: next.restore.filter((key) => key !== m.key) }, cmds];
      },
    }),
    await p7(),
    messages,
  ),
);

const crossFlows = fc.array(
  fc.record({
    index: fc.integer({ min: 0, max: 1 }),
    action: fc.constantFrom("asks", "notification", "page"),
    trusted: fc.boolean(),
    ticket: fc.nat({ max: 20 }),
  }),
  { minLength: 1, maxLength: 30 },
);

/** P14's check: asks, notices and pages of one project never change the other's entry or count. */
const staysLocal = (
  projectsMachine: Machine,
  projects: Fixture,
  flow: typeof crossFlows extends fc.Arbitrary<infer A> ? A : never,
) => {
  let model = projectsMachine.init(null, undefined)[0];

  for (const project of projects) {
    model = applyCell(projectsMachine, model, {
      type: "open",
      project,
      source: "welcome",
      said: 0,
      by: "user:fixture",
    })[0];
    model = applyCell(projectsMachine, model, {
      type: "opened",
      key: project.key,
      window: project.key,
    })[0];
  }

  const counts = [0, 0];

  for (const op of flow) {
    const key = projects[op.index]!.key;
    const before = model;
    const [next, cmds] = applyCell(projectsMachine, model, {
      type: op.action,
      key,
      sender: op.trusted ? key : "unknown-page",
      asks: [{ key: `${op.ticket}/ask`, ticket: op.ticket }],
      m: { type: "run", does: "counter" },
    });

    if (op.action === "asks") {
      counts[op.index] = 1;
    }

    if (op.action === "page" && !op.trusted) {
      expect(cmds.filter((c) => c.type === "to_host")).toEqual([]);
    }

    if (op.action === "notification") {
      expect(cmds.filter(isCmd("focus_window", "open_window")).every((c) => c.key === key)).toBe(true);
    }

    expect(next.projects[projects[1 - op.index]!.key]).toEqual(before.projects[projects[1 - op.index]!.key]);
    model = next;
  }

  expect(model.badge).toBe(counts.reduce((a, b) => a + b, 0));
};

it("P14: equal ticket numbers stay local; notices and untrusted senders never cross projects", async () => {
  const { projects } = await fixture();
  fc.assert(
    fc.property(crossFlows, (flow) => staysLocal(projectsMachine, projects, flow)),
    options,
  );
});

// The plant: asks are keyed by ticket number alone, so one project's asks land on every project.
const p14 = once();

plant("P14 key asks only by ticket number", crossFlows, async (flow) =>
  staysLocal(
    planted({
      asks: (s, m) => {
        let [next, cmds] = projectsMachine.update.asks(s, m);

        for (const key of Object.keys(s.projects).filter((k) => k !== m.key)) {
          [next, cmds] = projectsMachine.update.asks(next, { ...m, key });
        }

        return [next, cmds];
      },
    }),
    await p14(),
    [...flow, { index: 0, action: "asks", trusted: true, ticket: 1 }],
  ),
);

/** A command of the machine, narrowed by its type, so its fields read as the product declares them. */
const isCmd =
  <T extends ProjectsCmd["type"]>(...types: readonly T[]) =>
  (cmd: { readonly type: string }): cmd is Extract<ProjectsCmd, { type: T }> =>
    types.some((type) => type === cmd.type);

/** The fields a record of this kind keeps: the one list the built-app half in projects-e2e.ts reads too. */
const checkRecord = (kind: keyof typeof RECORD_FIELDS, row: Record<string, unknown>) => {
  for (const field of RECORD_FIELDS[kind]) {
    expect(row).toHaveProperty(field);
  }
};

const picked = fc.constantFrom("recent", "folder");

const openFlows = fc.array(fc.record({ source, picked, success: fc.boolean(), said: fc.integer() }), {
  minLength: 1,
  maxLength: 20,
});

/** P17's machine check: every opening record keeps its own fields, the source and picked pair it was sent included. */
const keepsOpenings = (
  projectsMachine: Machine,
  projects: Fixture,
  flow: typeof openFlows extends fc.Arbitrary<infer A> ? A : never,
) => {
  let model = projectsMachine.init(null, undefined)[0];
  const records: Record<string, unknown>[] = [];

  for (const [i, op] of flow.entries()) {
    const project = projects[i % 2]!;
    const [pending, first] = applyCell(projectsMachine, model, {
      type: "open",
      project,
      source: op.source,
      picked: op.picked,
      said: op.said,
      by: "user:fixture",
    } as Parameters<Machine["update"]["open"]>[1]);
    const [next, last] = applyCell(
      projectsMachine,
      pending,
      op.success
        ? { type: "opened", key: project.key, window: `window-${i}` }
        : { type: "open_failed", key: project.key, why: "missing" },
    );
    const written = [...first, ...last].filter(isCmd("record")).map((cmd) => cmd.record);
    expect(written.length).toBeGreaterThan(0);

    for (const record of written) {
      checkRecord("opening", record);
      expect(record).toMatchObject({
        project: project.key,
        root: project.root,
        source: op.source,
        picked: op.picked,
        said: op.said,
        by: "user:fixture",
      });
    }

    records.push(...written);
    model = next;
  }

  expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
};

it("P17: every successful or failed opening keeps its own record, with its source and picked pair", async () => {
  const { projects } = await fixture();
  fc.assert(
    fc.property(openFlows, (flow) => keepsOpenings(projectsMachine, projects, flow)),
    options,
  );
});

// The plant: the opening record keeps one press for every pick, as frame.tsx's `box` did.
const p17 = once();

/** The real handler, with each record it writes saying `box`. */
const sayBox =
  <M>(
    handler: (
      s: Parameters<Machine["update"]["opened"]>[0],
      m: M,
    ) => readonly [
      Machine extends unknown ? ReturnType<typeof projectsMachine.init>[0] : never,
      readonly ProjectsCmd[],
    ],
  ) =>
  (s: Parameters<Machine["update"]["opened"]>[0], m: M) => {
    const [next, cmds] = handler(s, m);
    return [
      next,
      cmds.map((cmd) => (cmd.type === "record" ? { ...cmd, record: { ...cmd.record, source: "box" as const } } : cmd)),
    ] as const;
  };

plant("P17 send box for every pick", openFlows, async (flow) =>
  keepsOpenings(
    planted({
      open: sayBox(projectsMachine.update.open),
      opened: sayBox(projectsMachine.update.opened),
      open_failed: sayBox(projectsMachine.update.open_failed),
    }),
    await p17(),
    [{ source: "welcome", picked: "recent", success: true, said: 1 }, ...flow],
  ),
);

// P17's and P29's built-app properties launch the built app, so they live in projects-e2e.ts
// (`builtLaws`), which `pnpm e2e` runs after the build. The plants below feed planted leaks to
// the very check that run makes on the real app, `secretsCheck`, over the same generated flows.

for (const output of SECRET_OUTPUTS) {
  for (const [encoding, encode] of [
    ["plain", (s: string) => s],
    ["URI", encodeURI],
    ["URL", encodeURIComponent],
    ["double URL", (s: string) => encodeURIComponent(encodeURIComponent(s))],
    ["form", (s: string) => new URLSearchParams({ key: s }).toString().slice(4)],
    ["base64", (s: string) => Buffer.from(s).toString("base64")],
    ["base64url", (s: string) => Buffer.from(s).toString("base64url")],
  ] as const) {
    plant(
      `P29 leak into ${output}, ${encoding}`,
      CREDENTIALS,
      ({ credential }) =>
        secretsCheck(
          credential,
          Object.fromEntries(SECRET_OUTPUTS.map((name) => [name, name === output ? encode(credential) : "clean"])),
        ),
      secretsCheck,
    );
  }
}
