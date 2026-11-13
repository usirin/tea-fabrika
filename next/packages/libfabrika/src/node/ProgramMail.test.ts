// next/: the store laws each acquire a fresh scoped SQLite driver (0062).
import * as ProgramMailTest from "../processes/ProgramMailTest.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";

ProgramMailTest.suite(ProgramMailTestSupport.store);
