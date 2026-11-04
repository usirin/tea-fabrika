import type {Schema} from "effect";
import type {Spelled, Spelling} from "./spelling.ts";

// A sketch, next/. The registry of programs, as TanStack Router's `Register`: an empty interface
// that each program fills from its own file by declaration merging. The line checker and `open`
// read it. Nothing here imports a program, and no program imports another (G6).
//
//   // programs/ticket.ts
//   declare module "../register.ts" {
//   	interface Register {
//   		ticket: typeof ticket;
//   	}
//   }

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- empty on purpose: each program adds its own key
export interface Register {}

/** One flag, input or output: its schema and what it is for, as tea-program declares each. */
export interface Part<S extends Schema.Top = Schema.Top> {
	readonly schema: S;
	readonly description: string;
}

/** What a program declares about its parts. A stand-in for tea-program's `defineProgram`, parts only. */
export interface Declared {
	readonly name: string;
	readonly flags: Readonly<Record<string, Part>>;
	readonly inputs: Readonly<Record<string, Part>>;
	readonly outputs: Readonly<Record<string, Part>>;
}

const part = <S extends Schema.Top>(schema: S, description: string): Part<S> => ({
	schema,
	description,
});

/**
 * What a flag's value can be: free text, a few fixed words, or a spelled value. A plain number
 * cannot be a flag: the compiler would read it as `${number}`, which takes `01`, `1e3` and `0x10`,
 * so a number says how it is spelled (./spelling.ts). A string with a check of its own is the one
 * hole the type cannot see; ./agree.test.ts checks that no flag has one.
 */
type Typeable = string | Spelled<Spelling> | undefined;

/** tea-program's three words for a part. A flag is a part whose value can be typed. */
export const flag = <S extends Schema.Top & {readonly Type: Typeable}>(
	schema: S,
	description: string,
): Part<S> => part(schema, description);
export const input = part;
export const output = part;

export const defineProgram = <const P extends Declared>(program: P): P => program;
