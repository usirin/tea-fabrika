/**
 * Fabrika's one permission model, declared once in code (0526), and the rights checked on it.
 *
 * @stability unstable
 */
import * as Rebac from "./Rebac.ts";

/**
 * Fabrika's model: a person, and a fabrika with 0290's three roles as relations. Starting a
 * program needs any of the three, 0170's first rule.
 *
 * @stability unstable
 * @category models
 */
export const Model = Rebac.make("fabrika")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: { start: (p) => p.union("owner", "admin", "member") },
  });

/**
 * The right to start a program on a fabrika (0170): its check gives the proof a child start's
 * write needs.
 *
 * @stability unstable
 * @category rights
 */
export class StartProgram extends Rebac.Permission<StartProgram>()("permissions/StartProgram", {
  model: Model,
  on: "fabrika",
  permission: "start",
}) {}
