// next/. A fresh scoped on-disk SQLite store per property run, with real reopen.
import * as QuotasTest from "../processes/QuotasTest.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";
QuotasTest.suite(ProgramMailTestSupport.store);
