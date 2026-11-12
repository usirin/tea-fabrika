// P17b slice 2, next/. Composition belongs to the app (0062, plan amendment A2).
import * as RunnerTest from "@kampus/chaos/RunnerTest";
import { checklist } from "@kampus/checklist";
import * as ChaosTest from "@kampus/libfabrika/node/Chaos.test-support";

RunnerTest.suite(ChaosTest.open, checklist);
