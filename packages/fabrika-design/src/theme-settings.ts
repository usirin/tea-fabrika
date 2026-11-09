// Today's app: one policy for the app, cursor and drawn terminal text.
import {Exit, Result, Schema} from "effect";
import {parse, TomlError} from "smol-toml";
import {ThemeName, type Diagnostic} from "./theme.ts";

const Fix = Schema.Literals(["nudge", "off"]);
const Contrast = Schema.Number.check(
	Schema.isFinite(),
	Schema.isBetween({minimum: 4.5, maximum: 21}),
);
const Policy = Schema.Struct({fix: Fix, contrast: Contrast});
type Policy = typeof Policy.Type;

/** The same three file settings, for the generated editor schema. */
export const Settings = Schema.Struct({
	theme: Schema.optionalKey(ThemeName),
	"theme-fix": Schema.optionalKey(Fix),
	"theme-contrast": Schema.optionalKey(Contrast),
});

interface ThemeSettings {
	readonly pick: string;
	readonly policy: Policy;
	readonly diagnostics: readonly Diagnostic[];
}

/** Read just these settings. Invalid values get a default and one value-free diagnostic each. */
export const readThemeSettings = (document: Readonly<Record<string, unknown>>): ThemeSettings => {
	const diagnostics: Diagnostic[] = [];
	const read = <S extends Schema.ConstraintDecoder<unknown>>(
		field: string,
		schema: S,
		fallback: S["Type"],
	): S["Type"] => {
		if (!Object.hasOwn(document, field)) return fallback;
		const decoded = Schema.decodeUnknownExit(schema)(document[field]);
		if (Exit.isSuccess(decoded)) return decoded.value;
		diagnostics.push({
			file: "fabrika.toml",
			field,
			line: 1,
			message: "invalid setting; using the default",
		});
		return fallback;
	};
	const raw = document["theme-contrast"];
	const underFloor = typeof raw === "number" && Number.isFinite(raw) && raw < 4.5;
	if (underFloor)
		diagnostics.push({
			file: "fabrika.toml",
			field: "theme-contrast",
			line: 1,
			message: "contrast must be at least 4.5; using 4.5",
		});
	return {
		pick: read("theme", ThemeName, "fabrika"),
		policy: Policy.make({
			fix: read("theme-fix", Fix, "nudge"),
			contrast: underFloor ? 4.5 : read("theme-contrast", Contrast, 4.5),
		}),
		diagnostics,
	};
};

/** Standard TOML only. A parser failure never includes its source excerpt. */
export const decodeThemeSettings = (text: string): Result.Result<ThemeSettings, Diagnostic> => {
	try {
		return Result.succeed(readThemeSettings(parse(text)));
	} catch (error) {
		return Result.fail({
			file: "fabrika.toml",
			field: "toml",
			line: error instanceof TomlError ? error.line : 1,
			message: "invalid TOML",
		});
	}
};
