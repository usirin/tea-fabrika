// next/. The real scoped SQLite store and a recording archive double run Q9.
import * as QuotaRefusalTest from "../telemetry/QuotaRefusalTest.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";
QuotaRefusalTest.suite(ProgramMailTestSupport.store);
