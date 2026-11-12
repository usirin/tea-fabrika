// P36, next/: 0138 applies the email addition and its drops in one Access fold.
import { expect, it } from "@effect/vitest";
import { beforeAll } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import type { Add, Signed, MemberEvent } from "./Access.ts";

const EPOCH = 1_800_000_000_000;
const PURE = { arbitrary: { seed: 119120, runs: 100, size: 40, maxDiscards: 500, maxShrinks: 200, concurrency: 1 } };
const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const Flow = Schema.Struct({
  live: integer(1, 4),
  devices: integer(1, 4),
  skew: integer(-604800000, 604800000),
  label: Schema.String.check(Schema.isMaxLength(64)),
  location: Schema.String.check(Schema.isMaxLength(128)),
  capabilities: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16))).check(
    Schema.isMaxLength(4),
  ),
  old: Schema.Literals(["lost", "kept"]),
});
type Flow = typeof Flow.Type;
const VerificationFlow = Arbitrary.schema(Flow);
const MembershipFlow = VerificationFlow;
const AuthorityFlow = VerificationFlow;
type Row = { readonly fact: unknown; readonly arrivedAt: number | null; readonly parent: string | null };

function pureModule<A>(load: () => Promise<A>): () => A {
  let loaded: A;
  beforeAll(async () => {
    loaded = await load();
  });
  return () => loaded;
}

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const LEDGER = "ledger_01m6v5270hf3c8x2q7w9z4k5mn";
const input = (n: number) => `in-process_01m6v5270hf3c8x2q7w9z4k5mn-${n}`;

const signed = (signer: string): typeof Signed.Type => ({
  signer,
  text: "checked by test door",
  armored: "test-only",
});

type EmailAddition = typeof Add.Type & {
  readonly verified: string;
  readonly saw: typeof Add.Type.saw & { readonly label: string };
};

const added = (flow: Flow, n = 0): EmailAddition => ({
  id: input(100 + n),
  for: PERSON,
  to: LEDGER,
  adds: {
    _tag: "person",
    key: `new-person-${n % flow.devices}`,
    window: `new-window-${n % flow.devices}`,
  },
  drops: flow.old === "lost" ? ["person-0"] : [],
  verified: input(1),
  saw: {
    method: "email",
    label: flow.label,
    check: "touch",
    location: flow.location,
    has: flow.capabilities,
    typed: false,
    kept: null,
    old: flow.old,
  },
  sentAt: new Date(EPOCH + flow.skew).toISOString(),
});

const founded = (flow: Flow): MemberEvent => ({
  _tag: "founded",
  id: PERSON,
  name: "test home",
  keys: Array.from({ length: flow.live }, (_, n) => `person-${n}`),
  window: "window-0",
});

const initial = (flow: Flow): ReadonlyArray<MemberEvent> => [
  founded(flow),
  ...Array.from({ length: flow.live }, (_, n): MemberEvent => ({
    _tag: "granted",
    grant: {
      id: input(10 + n),
      for: PERSON,
      to: LEDGER,
      key: `agent-${n}`,
      as: "agent",
      sentAt: new Date(EPOCH).toISOString(),
      saw: {
        code: "",
        label: flow.label,
        location: flow.location,
        method: "command",
        check: "none",
        has: flow.capabilities,
      },
    },
    signed: signed(`person-${n}`),
  })),
];

const access = pureModule(() => import("./Access.ts"));
const fold = pureModule(() => import("./AccessFold.ts"));
const domain = pureModule(() => import("./Text.ts"));
const EMAIL = "email-key";

const verification = (flow: Flow) => ({
  _tag: "verified" as const,
  verified: {
    id: input(1),
    for: PERSON,
    to: LEDGER,
    email: "email_checked",
    key: EMAIL,
    sentAt: new Date(EPOCH + flow.skew).toISOString(),
  },
  signed: signed("person-0"),
});

const history = (flow: Flow): Row[] => [
  ...initial(flow).map((fact) => ({ fact, arrivedAt: EPOCH - 2, parent: null })),
  { fact: verification(flow), arrivedAt: EPOCH - 1, parent: null },
];

const addition = (flow: Flow): Row => ({
  fact: { _tag: "added", add: added(flow), signed: signed(EMAIL) },
  arrivedAt: EPOCH,
  parent: null,
});

// Plants after build: trust sentAt; accept a verification appended after the addition.
it.prop(
  "P36.06 only an earlier ledger verification permits recovery, regardless of sentAt",
  { flow: VerificationFlow },
  ({ flow }) => {
    const add = addition(flow);
    const rows = history(flow);
    expect(
      fold()
        .foldAccessEntries([...rows, add], LEDGER)
        .keys.get("new-person-0")?.live,
    ).toBe(true);
    const verified = rows.pop()!;

    for (const arrivedAt of [EPOCH - 1, EPOCH, EPOCH + 1]) {
      // Equal referee clocks are legal; the ledger's order still decides earlier.
      const before = fold().foldAccessEntries([...rows, { ...verified, arrivedAt }, add], LEDGER);
      expect(before.keys.get("new-person-0")?.live).toBe(arrivedAt <= EPOCH);
      const after = fold().foldAccessEntries([...rows, add, { ...verified, arrivedAt }], LEDGER);
      expect(after.keys.has("new-person-0")).toBe(false);
    }

    expect(
      fold()
        .foldAccessEntries([...rows, add], LEDGER)
        .keys.has("new-person-0"),
    ).toBe(false);
    expect(
      fold()
        .foldAccessEntries(
          [...history(flow), add].map((r) => ({ ...r, arrivedAt: null })),
          LEDGER,
        )
        .keys.has("new-person-0"),
    ).toBe(false);
  },
  PURE,
);

// Plants after build: defer drops; drop a second root; keep a descendant admitted.
it.prop(
  "P36.15 the added applies selected drops at once, cascades, and keeps equal roots and founding",
  { flow: MembershipFlow },
  ({ flow }) => {
    const before = history(flow);
    const members = fold().foldAccessEntries([...before, addition(flow)], LEDGER);
    expect(access().admitted(members, "new-window-0")).toEqual({
      key: "new-window-0",
      person: PERSON,
      as: "window",
    });
    expect(members.keys.get("new-person-0")).toEqual({ rank: "person", live: true, under: null });

    for (let n = 0; n < flow.live; n++) {
      const live = flow.old === "kept" || n !== 0;
      expect(members.keys.get(`person-${n}`)?.live).toBe(live);
      expect("as" in access().admitted(members, `agent-${n}`)).toBe(live);
      expect(members.keys.get(`person-${n}`)?.under).toBeNull();
    }

    expect("as" in access().admitted(members, "window-0")).toBe(flow.old === "kept");
    expect(members.person).toBe(PERSON);
    expect(members.name).toBe("test home");
  },
  PURE,
);

// Plant after build: give email the authority of a person key.
it.prop(
  "P36.14 email rank permits only a person added naming this person's earlier verification",
  { flow: AuthorityFlow },
  ({ flow }) => {
    const rows = history(flow);
    const baseline = fold().foldAccessEntries(rows, LEDGER);
    const add = added(flow);
    expect(
      fold()
        .foldAccessEntries([...rows, addition(flow)], LEDGER)
        .keys.get("new-person-0")?.live,
    ).toBe(true);
    const badAdds = [
      { ...add, verified: input(999) },
      { ...add, verified: undefined },
      { ...add, for: "another-person" },
      { ...add, to: "another-ledger" },
      { ...add, saw: { ...add.saw, method: "device" } },
      { ...add, adds: { _tag: "recovery", key: "new-sheet", v: 1 } },
    ];
    const forbidden = [
      ...badAdds.map((value) => ({ _tag: "added", add: value, signed: signed(EMAIL) })),
      { ...initial(flow)[1]!, signed: signed(EMAIL) },
      { ...verification(flow), signed: signed(EMAIL) },
      {
        _tag: "revoked",
        revoke: {
          id: input(444),
          key: "person-0",
          for: PERSON,
          to: LEDGER,
          saw: { label: flow.label, location: flow.location, method: "panel", check: "touch" },
          sentAt: new Date(EPOCH).toISOString(),
        },
        signed: signed(EMAIL),
      },
    ];

    for (const fact of forbidden) {
      const members = fold().foldAccessEntries([...rows, { fact, arrivedAt: EPOCH, parent: null }], LEDGER);
      expect(members).toEqual(baseline);
    }
  },
  PURE,
);

it.prop(
  "P36.14 email verification is ledger-bound and keeps an immutable private address reference",
  { flow: AuthorityFlow },
  ({ flow }) => {
    expect(
      fold()
        .foldAccessEntries([...history(flow), addition(flow)], "other-ledger")
        .keys.has("new-person-0"),
    ).toBe(false);
    const text = domain().verifiedText(verification(flow));
    expect(text).toContain("email_checked");
    expect(text).not.toContain("example.test");
  },
  PURE,
);

// Plants after build: special email rank; under the email key; hide it from Access.keys.
it.prop(
  "0138 an email-added device has the same member shape as device and sheet recovery",
  { flow: MembershipFlow },
  ({ flow }) => {
    const rows = history(flow);
    const email = fold().foldAccessEntries([...rows, addition(flow)], LEDGER);

    for (const method of ["device", "recovery"] as const) {
      const add = { ...added(flow), verified: undefined, saw: { ...added(flow).saw, method } };
      const sheet: Row = {
        fact: {
          _tag: "added",
          add: {
            ...add,
            id: input(700),
            adds: { _tag: "recovery", key: "sheet-key", v: 1 },
            saw: { ...add.saw, method: "sheet", typed: true, kept: "print", old: null },
          },
          signed: signed("person-0"),
        },
        arrivedAt: EPOCH - 1,
        parent: null,
      };
      const person = fold().foldAccessEntries(
        [
          ...rows,
          ...(method === "recovery" ? [sheet] : []),
          {
            fact: {
              _tag: "added",
              add,
              signed: signed(method === "recovery" ? "sheet-key" : "person-0"),
            },
            arrivedAt: EPOCH,
            parent: null,
          },
        ],
        LEDGER,
      );
      expect(email.keys.get("new-person-0")).toEqual(person.keys.get("new-person-0"));
    }

    expect([...email.keys].filter(([key, value]) => key === "new-person-0" && value.live)).toEqual([
      ["new-person-0", { rank: "person", under: null, live: true }],
    ]);
  },
  PURE,
);

// Plants after build: refuse Remove for email roots; permit an email-signed revoke.
it.prop(
  "0138 any other live person may Remove an email-added root and all its descendants",
  { flow: MembershipFlow },
  ({ flow }) => {
    const kept = { ...flow, old: "kept" as const };
    const rows = [...history(kept), addition(kept)];
    const grant = initial(kept).find(
      (event): event is Extract<MemberEvent, { _tag: "granted" }> => event._tag === "granted",
    )!;
    rows.push({
      fact: {
        ...grant,
        grant: { ...grant.grant, id: input(900), key: "new-agent" },
        signed: signed("new-person-0"),
      },
      arrivedAt: EPOCH + 1,
      parent: null,
    });
    const before = fold().foldAccessEntries(rows, LEDGER);
    expect("as" in access().admitted(before, "new-agent")).toBe(true);

    for (const signer of [EMAIL, ...Array.from({ length: flow.live }, (_, n) => `person-${n}`)]) {
      const revoke = {
        _tag: "revoked",
        revoke: {
          id: input(901),
          key: "new-person-0",
          for: PERSON,
          to: LEDGER,
          saw: { label: flow.label, location: flow.location, method: "panel", check: "touch" },
          sentAt: new Date(EPOCH).toISOString(),
        },
        signed: signed(signer),
      };
      const after = fold().foldAccessEntries([...rows, { fact: revoke, arrivedAt: EPOCH + 2, parent: null }], LEDGER);

      for (const key of ["new-window-0", "new-agent"]) {
        expect("as" in access().admitted(after, key)).toBe(signer === EMAIL);
      }

      expect(after.keys.get("new-person-0")?.live).toBe(signer === EMAIL);
    }
  },
  PURE,
);
