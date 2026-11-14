import * as WritePolicyTest from "../ledger/WritePolicyTest.ts";
// next/. Reuse the scoped Node SQLite store, including its real close/open operation.
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";
WritePolicyTest.suite(ProgramMailTestSupport.store);
