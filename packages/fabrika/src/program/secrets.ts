import {Redacted} from "effect";

// A kept state never holds a secret (docs/direction/secrets-are-redacted.md). Storage asks this
// before every save, on every storage, and refuses a state that holds one.
//
//   holdsSecret({total: 3})                                 false
//   holdsSecret({login: {key: Redacted.make("...")}})       true
//
// Refusing is the only answer that cannot leak. How a schema encodes a `Redacted` decides what
// would be written, and no way keeps a secret that can be read back:
//
//   Schema.Redacted(Schema.String)            encodes to the Redacted itself: JSON says "<redacted>",
//                                             and the state does not decode again
//   Schema.RedactedFromValue(Schema.String)   encodes to the secret's text: written as it is
//   ... {disallowEncode: true}                fails to encode
//
// So a run keeps where to find a secret (a name, a path), never the secret. The check reads the
// state as the program holds it, before its schema encodes it, so a schema that turns a secret
// into text is caught too. It never reads a secret's value.

/** `value`, or anything inside it, is a `Redacted`. */
export const holdsSecret = (value: unknown): boolean => {
	const seen = new Set<object>();
	const walk = (v: unknown): boolean => {
		if (typeof v !== "object" || v === null) return false;
		if (Redacted.isRedacted(v)) return true;
		if (seen.has(v)) return false;
		seen.add(v);
		if (v instanceof Map) {
			for (const [k, inner] of v) if (walk(k) || walk(inner)) return true;
			return false;
		}
		if (v instanceof Set || Array.isArray(v)) {
			for (const inner of v) if (walk(inner)) return true;
			return false;
		}
		for (const inner of Object.values(v)) if (walk(inner)) return true;
		return false;
	};
	return walk(value);
};
