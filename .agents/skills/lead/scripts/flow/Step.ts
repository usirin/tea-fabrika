// Step.ts: one step of a flow, as data (0064). Today's lead tooling, read through its module:
// `Step.act("format", { dir })`. A step's kind is one of the six pipeline primitives
// (packages/pipeline/src/primitives.ts names them):
//
//   gather  code reads           act    code writes        listen  code waits on an outside event
//   draft   an agent's one turn  check  code judges        judge   a small classifier, one question
//
// A step holds no function: its `name` picks the runner a `Runners` layer gives for it, and its
// `args` are plain JSON the runner reads with its own schema. So a whole flow is saved to its state
// file before it starts. `lead` marks a step the runner may only do in the lead session's name (a
// lead sign, a catch-up that signs); started without `--lead`, the flow parks there with `ask`.

import { Schema } from "effect";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));

const fields = { name: Name, args: Schema.JsonObject, lead: Schema.Boolean };

export const Step = Schema.TaggedUnion({
  gather: fields,
  act: fields,
  listen: fields,
  draft: fields,
  check: fields,
  judge: fields,
});
export type Step = typeof Step.Type;
export type Kind = Step["_tag"];

/** Options a step may take: `lead` for a step only the lead session may run. */
export type Options = { readonly lead?: boolean };

const stepFields = (name: string, args: Schema.JsonObject, options: Options) => ({
  name,
  args,
  lead: options.lead ?? false,
});

export const gather = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.gather.make(stepFields(name, args, options));

export const act = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.act.make(stepFields(name, args, options));

export const listen = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.listen.make(stepFields(name, args, options));

export const draft = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.draft.make(stepFields(name, args, options));

export const check = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.check.make(stepFields(name, args, options));

export const judge = (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
  Step.cases.judge.make(stepFields(name, args, options));
