// P36, next/: 0138 applies the email addition and its drops in one Access fold.
import { expect, it } from "@effect/vitest";
import {
  EPOCH,
  LEDGER,
  PERSON,
  AuthorityFlow,
  MembershipFlow,
  VerificationFlow,
  added,
  initial,
  input,
  signed,
  pureModule,
  PURE,
  type Flow,
  type Row,
} from "../email/Email.test-support.ts";
import type { MemberEvent } from "./Access.ts";

const access = pureModule(() => import("./Access.ts"));
const fold = pureModule(() => import("./AccessFold.ts"));
const domain = pureModule(() => import("../email/Email.ts"));
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
      for (const key of ["new-window-0", "new-agent"])
        expect("as" in access().admitted(after, key)).toBe(signer === EMAIL);
      expect(after.keys.get("new-person-0")?.live).toBe(signer === EMAIL);
    }
  },
  PURE,
);
