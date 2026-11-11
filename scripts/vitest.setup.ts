// Today's tooling. Every test file gets fresh homes without reading inherited paths.
import { tmpdir } from "node:os";
import { testHomes } from "./testhome.ts";

testHomes(process.env, tmpdir());
