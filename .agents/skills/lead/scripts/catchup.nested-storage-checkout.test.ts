import { describe, it } from "vitest";
import { keepsNestedStorage, nestedStorage } from "./catchup.test-support.ts";

describe("catchup, today's tooling", () => {
  it.each(nestedStorage("catchup-900"))(
    "T318 review3 $worktree keeps nested MAIN $root $kind in its $location storage",
    keepsNestedStorage,
  );
});
