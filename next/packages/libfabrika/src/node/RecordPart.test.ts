// T641 slice 1: the telemetry module's record-part laws on node:sqlite (0062). This runner holds
// only the suite, so a suite that is never called leaves an empty file, and vitest fails on it.
import * as RecordPartTest from "../telemetry/RecordPartTest.ts";
import { open } from "./RecordPart.test-support.ts";

RecordPartTest.suite(open);
