// T878, next/, L13. The compiler checks the contract; the lead runs typecheck after build.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Context, type Effect, Schema } from "effect";
import {
  DefaultUnknown,
  MissingPath,
  ReadFailed,
  Repositories,
  RepositoriesError,
  type Repository,
  type Source,
} from "./Repositories.ts";

const contract = (reader: Repository, service: Context.Service.Shape<typeof Repositories>) => {
  expectTypeOf<ReturnType<typeof service.open>>().toEqualTypeOf<Effect.Effect<Repository, RepositoriesError>>();
  expectTypeOf<ReturnType<typeof reader.read>>().toEqualTypeOf<Effect.Effect<Uint8Array | null, RepositoriesError>>();
  expectTypeOf<ReturnType<typeof reader.resolve>>().toEqualTypeOf<Effect.Effect<Source, RepositoriesError>>();
  expectTypeOf<ReturnType<Source["read"]>>().toEqualTypeOf<Effect.Effect<Uint8Array | null, RepositoriesError>>();
  expectTypeOf<RepositoriesError["reason"]["_tag"]>().toEqualTypeOf<"DefaultUnknown" | "ReadFailed" | "MissingPath">();
  expectTypeOf<"layer" extends keyof typeof Repositories ? true : false>().toEqualTypeOf<false>();
  // @ts-expect-error a repository read is not a platform-free synchronous value
  const bytes: Uint8Array | null = reader.read(".fabrika/fabrika.toml");
  // @ts-expect-error a reason must be the contract's tagged fact
  const textReason: RepositoriesError["reason"] = "ReadFailed";
  // @ts-expect-error an explicit repository needs both read operations
  const incomplete: Repository = { snapshot: reader.snapshot, read: reader.read };
  return [bytes, textReason, incomplete];
};

void contract;

it.prop(
  "L13: repository errors keep tagged reasons and no static layer",
  { tag: Schema.Literals(["DefaultUnknown", "ReadFailed", "MissingPath"]) },
  ({ tag }) => {
    const constructors = { DefaultUnknown, ReadFailed, MissingPath };
    const error = new RepositoriesError({ reason: new constructors[tag]({ cause: undefined }) });
    expect(error.reason._tag).toBe(tag);
    expect(Object.hasOwn(Repositories, "layer")).toBe(false);
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
