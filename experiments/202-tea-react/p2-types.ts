import type {EffectRuntime} from "@demlik/tea/effect";
import {useRuntime} from "@demlik/tea/react";
declare const rt: EffectRuntime<{count: number}, {type: "inc"}>;
const _tryIt = () => useRuntime(rt);
