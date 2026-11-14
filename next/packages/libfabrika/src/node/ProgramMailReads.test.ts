// T936 slice 1, next/: L1 and L2 on node:sqlite, each law on a fresh scoped store (0062).
import * as ProgramMailReadsTest from "../processes/ProgramMailReadsTest.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";

ProgramMailReadsTest.suite(ProgramMailTestSupport.store);
