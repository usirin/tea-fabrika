import { readFile } from "node:fs/promises";
import { DEFAULT_JEV_MODEL } from "@demlik/tea/jev";
import { Context, Effect, Layer } from "effect";
import { parse, TomlError } from "smol-toml";
import { z } from "zod";

/**
 * The numbers a person may tune without touching code, read from
 * `fabrika.toml`. Only data lives here: floors, limits, a model name. The order
 * of the steps, and what each answer leads to, stay in code.
 *
 * Every key has today's value as its default, so an empty file changes
 * nothing. An unknown key is an error, so a typo cannot be silently ignored.
 */
const floor = z.number().min(0).max(1);
const count = z.number().int().positive();

// Each table may be left out, and fills in from its own keys' defaults.
export const settingsSchema = z.strictObject({
  jev: z.strictObject({
    /** The Jev model every question goes to. */
    model: z.string().min(1).default(DEFAULT_JEV_MODEL),
    /** How often a busy Jev (a 429, a 529, no reply) is asked again before a reader gives up. */
    retries: z.number().int().min(0).default(3),
  }).prefault({}),
  review: z.strictObject({
    /** Below this, the router's answer is unsure, and the lane stops instead of guessing. */
    route_floor: floor.default(0.8),
    /**
     * Below this, the matcher says "no match". Higher than the router's, because
     * a match is the one answer that lets a finding pass unrouted.
     */
    match_floor: floor.default(0.9),
  }).prefault({}),
  comments: z.strictObject({
    /** Below this, a comment the reader says changes a rule, or adds one, is unsure. */
    floor: floor.default(0.8),
    /**
     * Below this, "changes nothing" is unsure. It is the one answer that lets a
     * comment pass without a person, so it gets the matcher's high floor.
     */
    no_change_floor: floor.default(0.9),
  }).prefault({}),
  failure: z.strictObject({
    /** Below this, the failure reader's answer is unsure, and the work goes back to the builder. */
    floor: floor.default(0.8),
    /** How much of the end of a failed run Jev reads: a runner sums up at the end. */
    output_chars: count.default(20_000),
    /** How much of the start of the diff Jev reads: a diff names its files at the start. */
    diff_chars: count.default(20_000),
  }).prefault({}),
});

export type SettingsShape = z.output<typeof settingsSchema>;

/** Today's values: what every key falls back to. */
export const DEFAULT_SETTINGS: SettingsShape = settingsSchema.parse({});

/** A `fabrika.toml` that could not be read, is not TOML, or holds a value out of range. */
export interface SettingsInvalid {
  readonly _tag: "settings_invalid";
  readonly reason: string;
}

const invalid = (reason: string): SettingsInvalid => ({ _tag: "settings_invalid", reason });

/** Read a `fabrika.toml` text: parse it, then hold every value to the schema. */
export function settingsFromToml(text: string): Effect.Effect<SettingsShape, SettingsInvalid> {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => parse(text),
      catch: (error) => invalid(error instanceof TomlError ? `not TOML: ${error.message}` : String(error)),
    });
    const checked = settingsSchema.safeParse(raw);
    if (!checked.success) return yield* Effect.fail(invalid(z.prettifyError(checked.error)));
    return checked.data;
  });
}

/** The settings every Jev reader is built with. */
export class Settings extends Context.Service<Settings, SettingsShape>()("Settings") {}

/** Today's values, with nothing read. */
export const defaultSettings = Layer.succeed(Settings, DEFAULT_SETTINGS);

/** The settings in a TOML file. A missing file fails too: a path was given, so a person meant one. */
export const settingsFile = (path: string) =>
  Layer.effect(
    Settings,
    Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (error) => invalid(`cannot read ${path}: ${String(error)}`),
    }).pipe(Effect.flatMap(settingsFromToml)),
  );
