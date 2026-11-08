# P10 door test type audit

`next/`, test writer, after commit `750fa71b`. These are pre-build results.

## Fixed test mistakes

- The app's lockfile entry selects Effect **4.1.1**. Its installed
  `Schema.RedactedFromValue` accepts `disallowEncode`. The similarly named
  `disallowJsonEncode` belongs to `Schema.Redacted`, not this function.
- The world helper's success type is `Effect.Success<ReturnType<typeof world>>`.
  There is no `Effect.Effect.Success` namespace.
- Wrappers around Ledger, ClientManager, RecordManager and SpanSink use each
  existing service's own `Service` type. Reader helpers keep those types too.
- The recovery winner satisfies `typeof C.Add.Type`, so its `saw.how` stays
  the allowed literal `"recovery"`.
- The delivery check permits its real reader services and `SinkError`.
  Its signer error and context come from the internal `writeId` return type.
  That part still depends on the unbuilt door.

No assertion, plant or expected result changed. There is no new cast or
suppressed diagnostic. No product code or dependency was added.

## Check used

The [scoped config](./tsconfig.json) names only `door.test.ts` as a root file.
It inherits the app's strict options and Effect checks. Like the Vitest
fixture config, its paths resolve real package sources. It supplies no fake
door, service, declaration or passkey schema.

```sh
env -u TYPESAFE_API_KEY GOMAXPROCS=1 nice -n 19 pnpm exec tsc \
  --singleThreaded --noEmit --pretty false -p fixtures/next/p10/tsconfig.json
```

The check exits 1 with **44 diagnostics**, all listed below. It is a focused
single-thread check, not a full workspace typecheck. The ordinary app config
also reports four missing package imports at
[11](../../../next/apps/fabrika/src/door.test.ts#L11),
[12](../../../next/apps/fabrika/src/door.test.ts#L12),
[23](../../../next/apps/fabrika/src/door.test.ts#L23) and
[24](../../../next/apps/fabrika/src/door.test.ts#L24): `@effect/vitest` and the
coordination, data and sqlite public imports. P10's package dependencies
remain the builder's work. The scoped config lets the audit see their real
types before those dependencies exist.

The one-file Vitest run registered **66 cases**, all red at the absent
`./door.ts` import. It used `--maxWorkers=1` and the existing fixture config.
The sandbox denied `nice`; the single-thread and one-worker caps still held.

## Remaining build diagnostics

Every location in this table is in
[door.test.ts](../../../next/apps/fabrika/src/door.test.ts).
The two remaining implicit-any callbacks get their types from the missing
generator or door. They are not callbacks around existing test services.

| Code | Line:column | Cause left for the build |
|---|---|---|
| TS2307 | [212:25](../../../next/apps/fabrika/src/door.test.ts#L212) | Missing door module. |
| TS2307 | [214:48](../../../next/apps/fabrika/src/door.test.ts#L214) | Missing door module. |
| TS2339 | [284:17](../../../next/apps/fabrika/src/door.test.ts#L284) | P10's ProcessIdGenerator export is not built. |
| TS7006 | [284:41](../../../next/apps/fabrika/src/door.test.ts#L284) | Callback comes from missing ProcessIdGenerator. |
| TS2339 | [345:5](../../../next/apps/fabrika/src/door.test.ts#L345) | P10's ProcessIdGenerator export is not built. |
| TS2339 | [359:8](../../../next/apps/fabrika/src/door.test.ts#L359) | P10's ProcessIdGenerator export is not built. |
| TS2339 | [442:17](../../../next/apps/fabrika/src/door.test.ts#L442) | P10's grantText export is not built. |
| TS2339 | [448:38](../../../next/apps/fabrika/src/door.test.ts#L448) | P10's SignRequest export is not built. |
| TS2339 | [455:17](../../../next/apps/fabrika/src/door.test.ts#L455) | P10's addText export is not built. |
| TS2339 | [467:17](../../../next/apps/fabrika/src/door.test.ts#L467) | P10's addText export is not built. |
| TS2339 | [488:33](../../../next/apps/fabrika/src/door.test.ts#L488) | P10's enrollmentText export is not built. |
| TS2353 | [496:4](../../../next/apps/fabrika/src/door.test.ts#L496) | P10's Adds.person passkey schema extension is not built. |
| TS2339 | [510:17](../../../next/apps/fabrika/src/door.test.ts#L510) | P10's addText export is not built. |
| TS7006 | [554:23](../../../next/apps/fabrika/src/door.test.ts#L554) | Row comes from missing Door.watch. |
| TS2339 | [725:20](../../../next/apps/fabrika/src/door.test.ts#L725) | P10's grantText export is not built. |
| TS2339 | [770:20](../../../next/apps/fabrika/src/door.test.ts#L770) | P10's addText export is not built. |
| TS2339 | [815:22](../../../next/apps/fabrika/src/door.test.ts#L815) | P10's addText export is not built. |
| TS2339 | [848:20](../../../next/apps/fabrika/src/door.test.ts#L848) | P10's grantText export is not built. |
| TS2339 | [851:22](../../../next/apps/fabrika/src/door.test.ts#L851) | P10's revokeText export is not built. |
| TS2339 | [863:23](../../../next/apps/fabrika/src/door.test.ts#L863) | P10's grantText export is not built. |
| TS2339 | [912:12](../../../next/apps/fabrika/src/door.test.ts#L912) | P10's grantText export is not built. |
| TS2339 | [922:13](../../../next/apps/fabrika/src/door.test.ts#L922) | P10's revokeText export is not built. |
| TS2339 | [930:13](../../../next/apps/fabrika/src/door.test.ts#L930) | P10's addText export is not built. |
| TS2339 | [972:21](../../../next/apps/fabrika/src/door.test.ts#L972) | P10's grantText export is not built. |
| TS2339 | [1012:24](../../../next/apps/fabrika/src/door.test.ts#L1012) | P10's grantText export is not built. |
| TS2339 | [1027:21](../../../next/apps/fabrika/src/door.test.ts#L1027) | P10's grantText export is not built. |
| TS2571 | [1243:13](../../../next/apps/fabrika/src/door.test.ts#L1243) | Failure value comes from missing Door.route or Door.append. |
| TS2339 | [1321:22](../../../next/apps/fabrika/src/door.test.ts#L1321) | P10's grantText export is not built. |
| TS2339 | [1339:23](../../../next/apps/fabrika/src/door.test.ts#L1339) | P10's revokeText export is not built. |
| TS2339 | [1389:39](../../../next/apps/fabrika/src/door.test.ts#L1389) | P10's enrollmentText export is not built. |
| TS2353 | [1394:8](../../../next/apps/fabrika/src/door.test.ts#L1394) | P10's Adds.person passkey schema extension is not built. |
| TS2339 | [1394:32](../../../next/apps/fabrika/src/door.test.ts#L1394) | P10's Adds.person passkey schema extension is not built. |
| TS2339 | [1397:21](../../../next/apps/fabrika/src/door.test.ts#L1397) | P10's addText export is not built. |
| TS2339 | [1414:39](../../../next/apps/fabrika/src/door.test.ts#L1414) | P10's enrollmentText export is not built. |
| TS2339 | [1422:26](../../../next/apps/fabrika/src/door.test.ts#L1422) | P10's Adds.person passkey schema extension is not built. |
| TS2339 | [1426:22](../../../next/apps/fabrika/src/door.test.ts#L1426) | P10's addText export is not built. |
| TS2339 | [1475:21](../../../next/apps/fabrika/src/door.test.ts#L1475) | P10's revokeText export is not built. |
| TS2571 | [1491:7](../../../next/apps/fabrika/src/door.test.ts#L1491) | Failure value comes from missing Door.route or Door.append. |
| TS2339 | [1511:20](../../../next/apps/fabrika/src/door.test.ts#L1511) | P10's revokeText export is not built. |
| TS2571 | [1521:6](../../../next/apps/fabrika/src/door.test.ts#L1521) | Failure value comes from missing Door.route or Door.append. |
| TS18046 | [1560:13](../../../next/apps/fabrika/src/door.test.ts#L1560) | Failure value comes from missing Door.route or Door.append. |
| TS2571 | [1653:7](../../../next/apps/fabrika/src/door.test.ts#L1653) | Failure value comes from missing Door.route or Door.append. |
| TS2571 | [1730:6](../../../next/apps/fabrika/src/door.test.ts#L1730) | Failure value comes from missing Door.route or Door.append. |
| TS2571 | [1863:6](../../../next/apps/fabrika/src/door.test.ts#L1863) | Failure value comes from missing Door.route or Door.append. |

## Limits

This does not claim a green typecheck. The door, process-id generator,
signed-text exports, SignRequest and passkey schema extension do not exist
yet. Their final types may reveal further errors. The lead still owns the
full workspace check after the builder supplies them.
