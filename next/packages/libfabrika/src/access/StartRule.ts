/**
 * Who may start a program: the rule a start is checked by, against the member whose letter caused
 * it, never the program that asked (0170). The check and its protocol live in the runner; only this
 * rule changes when the rule grows.
 *
 * @stability unstable
 */

/**
 * Whether `member` may start a process of `program`. 0170's first rule: any member may start any
 * program, whatever their role.
 *
 * **Details**
 *
 * `member` is the sender of the letter that caused the start: a person's id for a person, and an
 * agent's own key for an agent, never the person the agent works for (0261). A sender that is no
 * member never reaches this rule: its start is refused `forbidden` before it.
 *
 * @stability unstable
 * @category predicates
 */
export const mayStart = (_member: string, _program: string): boolean => true;
