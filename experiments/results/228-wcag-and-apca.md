# WCAG 2.2 and APCA on today's pairs

Written by experiments/228-wcag-and-apca.ts.

- text: 365 pairs; WCAG fail 1; APCA fail 19; both pass 345; pass WCAG but fail APCA 19; reach Lc 75 186
- non-text: 22 pairs; WCAG fail 0; APCA fail 10; both pass 12; pass WCAG but fail APCA 10

## Pass WCAG, fail APCA

| test | look | kind | pair | fg | bg | WCAG | Lc | WCAG | APCA |
|---|---|---|---|---|---|---|---|---|---|
| src/themes.test.ts | dark | non-text | --tile-focus on --surface | #d9edff5d | #111113 | 3.01 | 20.1 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface-sunken | #dfebfd6d | #0c0d0e | 3.67 | 25.1 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface | #dfebfd6d | #111113 | 3.68 | 25.8 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --turn-fill on --surface | #3e63dd | #111113 | 3.62 | 25.9 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface-raised | #dfebfd6d | #18191b | 3.68 | 27.3 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface-sunken | #dfebfd6d | #1c1e20 | 3.64 | 27.9 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface | #dfebfd6d | #212225 | 3.57 | 28.3 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface-raised | #dfebfd6d | #27292c | 3.47 | 29.0 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a selected row on --surface-raised | #dfebfd6d | #34383c | 3.16 | 29.6 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a selected row on --surface | #dfebfd6d | #2e3135 | 3.32 | 29.6 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 1 | #e5484d | #111113 | 4.82 | 35.8 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 4 | #0090ff | #111113 | 5.78 | 42.1 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 2 | #46a758 | #111113 | 6.22 | 44.5 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 6 | #00a2c7 | #111113 | 6.28 | 45.2 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-selected over --surface-raised | #ff9592 | #34383c | 5.61 | 54.2 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-selected over --surface-raised | #ff9592 | #34383c | 5.61 | 54.2 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-selected over --surface-raised | #9eb1ff | #34383c | 5.73 | 55.0 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-selected over --surface | #ff9592 | #2e3135 | 6.20 | 56.0 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-selected over --surface | #ff9592 | #2e3135 | 6.20 | 56.0 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-selected over --surface | #9eb1ff | #2e3135 | 6.34 | 56.9 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-hover over --surface-raised | #ff9592 | #27292c | 6.92 | 57.7 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-hover over --surface-raised | #ff9592 | #27292c | 6.92 | 57.7 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-hover over --surface-raised | #9eb1ff | #27292c | 7.08 | 58.5 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-hover over --surface | #ff9592 | #212225 | 7.55 | 58.9 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-hover over --surface | #ff9592 | #212225 | 7.55 | 58.9 | pass | FAIL |
| src/themes.test.ts | dark | text | --done on --surface-selected over --surface-raised | #71d083 | #34383c | 6.22 | 59.4 | pass | FAIL |
| window/colors.test.ts | dark | text | --open on --surface-selected over --surface-raised | #71d083 | #34383c | 6.22 | 59.4 | pass | FAIL |
| window/colors.test.ts | dark | text | button: var(--text-secondary) on var(--line) over --surface-raised | #f1f7feb5 | #3c4146 | 5.74 | 59.5 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-hover over --surface | #9eb1ff | #212225 | 7.72 | 59.7 | pass | FAIL |

## All pairs

| test | look | kind | pair | fg | bg | WCAG | Lc | WCAG | APCA |
|---|---|---|---|---|---|---|---|---|---|
| src/themes.test.ts | dark | text | --text-primary on --surface-sunken | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface-hover over --surface | #edeef0 | #212225 | 13.70 | 94.3 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface-hover over --surface-raised | #edeef0 | #27292c | 12.56 | 93.1 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface-selected over --surface | #edeef0 | #2e3135 | 11.26 | 91.4 | pass | pass |
| src/themes.test.ts | dark | text | --text-primary on --surface-selected over --surface-raised | #edeef0 | #34383c | 10.18 | 89.6 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| src/themes.test.ts | dark | text | --text-faint on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| src/themes.test.ts | dark | text | --turn on --surface-sunken | #9eb1ff | #0c0d0e | 9.44 | 61.9 | pass | pass |
| src/themes.test.ts | dark | text | --turn on --surface | #9eb1ff | #111113 | 9.15 | 61.6 | pass | pass |
| src/themes.test.ts | dark | text | --turn on --surface-raised | #9eb1ff | #18191b | 8.53 | 60.9 | pass | pass |
| src/themes.test.ts | dark | text | --turn on --surface-hover over --surface | #9eb1ff | #212225 | 7.72 | 59.7 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-hover over --surface-raised | #9eb1ff | #27292c | 7.08 | 58.5 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-selected over --surface | #9eb1ff | #2e3135 | 6.34 | 56.9 | pass | FAIL |
| src/themes.test.ts | dark | text | --turn on --surface-selected over --surface-raised | #9eb1ff | #34383c | 5.73 | 55.0 | pass | FAIL |
| src/themes.test.ts | dark | text | --done on --surface-sunken | #71d083 | #0c0d0e | 10.24 | 66.3 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface | #71d083 | #111113 | 9.93 | 66.0 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface-raised | #71d083 | #18191b | 9.26 | 65.3 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface-hover over --surface | #71d083 | #212225 | 8.37 | 64.1 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface-hover over --surface-raised | #71d083 | #27292c | 7.68 | 62.9 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface-selected over --surface | #71d083 | #2e3135 | 6.88 | 61.2 | pass | pass |
| src/themes.test.ts | dark | text | --done on --surface-selected over --surface-raised | #71d083 | #34383c | 6.22 | 59.4 | pass | FAIL |
| src/themes.test.ts | dark | text | --running on --surface-sunken | #ffca16 | #0c0d0e | 12.70 | 78.5 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface | #ffca16 | #111113 | 12.32 | 78.3 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface-raised | #ffca16 | #18191b | 11.49 | 77.6 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface-hover over --surface | #ffca16 | #212225 | 10.39 | 76.4 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface-hover over --surface-raised | #ffca16 | #27292c | 9.52 | 75.2 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface-selected over --surface | #ffca16 | #2e3135 | 8.53 | 73.5 | pass | pass |
| src/themes.test.ts | dark | text | --running on --surface-selected over --surface-raised | #ffca16 | #34383c | 7.72 | 71.6 | pass | pass |
| src/themes.test.ts | dark | text | --stuck on --surface-sunken | #ff9592 | #0c0d0e | 9.23 | 61.0 | pass | pass |
| src/themes.test.ts | dark | text | --stuck on --surface | #ff9592 | #111113 | 8.95 | 60.8 | pass | pass |
| src/themes.test.ts | dark | text | --stuck on --surface-raised | #ff9592 | #18191b | 8.35 | 60.1 | pass | pass |
| src/themes.test.ts | dark | text | --stuck on --surface-hover over --surface | #ff9592 | #212225 | 7.55 | 58.9 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-hover over --surface-raised | #ff9592 | #27292c | 6.92 | 57.7 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-selected over --surface | #ff9592 | #2e3135 | 6.20 | 56.0 | pass | FAIL |
| src/themes.test.ts | dark | text | --stuck on --surface-selected over --surface-raised | #ff9592 | #34383c | 5.61 | 54.2 | pass | FAIL |
| src/themes.test.ts | dark | text | --closed on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| src/themes.test.ts | dark | text | --closed on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-sunken | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-hover over --surface | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-hover over --surface-raised | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-selected over --surface | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| src/themes.test.ts | light | text | --text-primary on --surface-selected over --surface-raised | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| src/themes.test.ts | light | text | --text-faint on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-sunken | #002bb7c5 | #f9f9fb | 5.79 | 76.4 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface | #002bb7c5 | #fcfcfd | 5.86 | 77.8 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-raised | #002bb7c5 | #fcfcfd | 5.86 | 77.8 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-hover over --surface | #002bb7c5 | #ededf1 | 5.42 | 70.5 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-hover over --surface-raised | #002bb7c5 | #ededf1 | 5.42 | 70.5 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-selected over --surface | #002bb7c5 | #dddee4 | 4.93 | 63.0 | pass | pass |
| src/themes.test.ts | light | text | --turn on --surface-selected over --surface-raised | #002bb7c5 | #dddee4 | 4.93 | 63.0 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-sunken | #203c25 | #f9f9fb | 11.51 | 94.1 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface | #203c25 | #fcfcfd | 11.81 | 95.8 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-raised | #203c25 | #fcfcfd | 11.81 | 95.8 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-hover over --surface | #203c25 | #ededf1 | 10.37 | 87.1 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-hover over --surface-raised | #203c25 | #ededf1 | 10.37 | 87.1 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-selected over --surface | #203c25 | #dddee4 | 9.02 | 78.3 | pass | pass |
| src/themes.test.ts | light | text | --done on --surface-selected over --surface-raised | #203c25 | #dddee4 | 9.02 | 78.3 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-sunken | #4f3422 | #f9f9fb | 10.81 | 92.6 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface | #4f3422 | #fcfcfd | 11.09 | 94.4 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-raised | #4f3422 | #fcfcfd | 11.09 | 94.4 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-hover over --surface | #4f3422 | #ededf1 | 9.74 | 85.6 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-hover over --surface-raised | #4f3422 | #ededf1 | 9.74 | 85.6 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-selected over --surface | #4f3422 | #dddee4 | 8.47 | 76.9 | pass | pass |
| src/themes.test.ts | light | text | --running on --surface-selected over --surface-raised | #4f3422 | #dddee4 | 8.47 | 76.9 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-sunken | #641723 | #f9f9fb | 11.83 | 93.8 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface | #641723 | #fcfcfd | 12.13 | 95.5 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-raised | #641723 | #fcfcfd | 12.13 | 95.5 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-hover over --surface | #641723 | #ededf1 | 10.65 | 86.8 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-hover over --surface-raised | #641723 | #ededf1 | 10.65 | 86.8 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-selected over --surface | #641723 | #dddee4 | 9.26 | 78.0 | pass | pass |
| src/themes.test.ts | light | text | --stuck on --surface-selected over --surface-raised | #641723 | #dddee4 | 9.26 | 78.0 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| src/themes.test.ts | light | text | --closed on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| src/themes.test.ts | dark | text | --turn-fg on --turn-fill, dark | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| src/themes.test.ts | dark | text | --turn-fg on --turn-fill, light | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| src/themes.test.ts | dark | text | --turn-fg on --turn-fill-hover, light | #ffffff | #3358d4 | 6.02 | 84.7 | pass | pass |
| src/themes.test.ts | dark | non-text | --tile-focus on --surface | #d9edff5d | #111113 | 3.01 | 20.1 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --turn-fill on --surface | #3e63dd | #111113 | 3.62 | 25.9 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface-sunken | #dfebfd6d | #0c0d0e | 3.67 | 25.1 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface | #dfebfd6d | #111113 | 3.68 | 25.8 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on --surface-raised | #dfebfd6d | #18191b | 3.68 | 27.3 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface-sunken | #dfebfd6d | #1c1e20 | 3.64 | 27.9 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface | #dfebfd6d | #212225 | 3.57 | 28.3 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a hovered row on --surface-raised | #dfebfd6d | #27292c | 3.47 | 29.0 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a selected row on --surface | #dfebfd6d | #2e3135 | 3.32 | 29.6 | pass | FAIL |
| src/themes.test.ts | dark | non-text | --focus on a selected row on --surface-raised | #dfebfd6d | #34383c | 3.16 | 29.6 | pass | FAIL |
| src/themes.test.ts | light | non-text | --tile-focus on --surface | #00051d74 | #fcfcfd | 3.27 | 59.2 | pass | pass |
| src/themes.test.ts | light | non-text | --turn-fill on --surface | #3e63dd | #fcfcfd | 5.08 | 73.6 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on --surface-sunken | #00051d74 | #f9f9fb | 3.26 | 58.3 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on --surface | #00051d74 | #fcfcfd | 3.27 | 59.2 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on --surface-raised | #00051d74 | #fcfcfd | 3.27 | 59.2 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on a hovered row on --surface-sunken | #00051d74 | #eaeaef | 3.18 | 53.4 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on a hovered row on --surface | #00051d74 | #ededf1 | 3.22 | 54.6 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on a hovered row on --surface-raised | #00051d74 | #ededf1 | 3.22 | 54.6 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on a selected row on --surface | #00051d74 | #dddee4 | 3.13 | 49.8 | pass | pass |
| src/themes.test.ts | light | non-text | --focus on a selected row on --surface-raised | #00051d74 | #dddee4 | 3.13 | 49.8 | pass | pass |
| src/themes.test.ts | dark | text | foreground | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| src/themes.test.ts | dark | non-text | cursor | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| src/themes.test.ts | dark | text | palette 1 | #e5484d | #111113 | 4.82 | 35.8 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 2 | #46a758 | #111113 | 6.22 | 44.5 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 3 | #ffc53d | #111113 | 11.95 | 76.4 | pass | pass |
| src/themes.test.ts | dark | text | palette 4 | #0090ff | #111113 | 5.78 | 42.1 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 5 | #d19dff | #111113 | 8.96 | 60.7 | pass | pass |
| src/themes.test.ts | dark | text | palette 6 | #00a2c7 | #111113 | 6.28 | 45.2 | pass | FAIL |
| src/themes.test.ts | dark | text | palette 7 | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| src/themes.test.ts | dark | text | palette 8 | #b0b4ba | #111113 | 9.06 | 61.0 | pass | pass |
| src/themes.test.ts | dark | text | palette 9 | #ff9592 | #111113 | 8.95 | 60.8 | pass | pass |
| src/themes.test.ts | dark | text | palette 10 | #71d083 | #111113 | 9.93 | 66.0 | pass | pass |
| src/themes.test.ts | dark | text | palette 11 | #ffca16 | #111113 | 12.32 | 78.3 | pass | pass |
| src/themes.test.ts | dark | text | palette 12 | #70b8ff | #111113 | 8.97 | 60.8 | pass | pass |
| src/themes.test.ts | dark | text | palette 13 | #d19dff | #111113 | 8.96 | 60.7 | pass | pass |
| src/themes.test.ts | dark | text | palette 14 | #4ccce6 | #111113 | 9.96 | 66.3 | pass | pass |
| src/themes.test.ts | dark | text | palette 15 | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| src/themes.test.ts | light | text | foreground | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| src/themes.test.ts | light | non-text | cursor | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| src/themes.test.ts | light | text | palette 0 | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| src/themes.test.ts | light | text | palette 1 | #ce2c31 | #fcfcfd | 5.08 | 72.5 | pass | pass |
| src/themes.test.ts | light | text | palette 2 | #2a7e3b | #fcfcfd | 4.94 | 72.9 | pass | pass |
| src/themes.test.ts | light | text | palette 3 | #4f3422 | #fcfcfd | 11.09 | 94.4 | pass | pass |
| src/themes.test.ts | light | text | palette 4 | #0d74ce | #fcfcfd | 4.65 | 70.7 | pass | pass |
| src/themes.test.ts | light | text | palette 5 | #8145b5 | #fcfcfd | 5.93 | 78.1 | pass | pass |
| src/themes.test.ts | light | text | palette 6 | #107d98 | #fcfcfd | 4.65 | 70.8 | pass | pass |
| src/themes.test.ts | light | text | palette 8 | #60646c | #fcfcfd | 5.79 | 78.0 | pass | pass |
| src/themes.test.ts | light | text | palette 9 | #ce2c31 | #fcfcfd | 5.08 | 72.5 | pass | pass |
| src/themes.test.ts | light | text | palette 10 | #2a7e3b | #fcfcfd | 4.94 | 72.9 | pass | pass |
| src/themes.test.ts | light | text | palette 11 | #4f3422 | #fcfcfd | 11.09 | 94.4 | pass | pass |
| src/themes.test.ts | light | text | palette 12 | #0d74ce | #fcfcfd | 4.65 | 70.7 | pass | pass |
| src/themes.test.ts | light | text | palette 13 | #8e4ec6 | #fcfcfd | 5.05 | 73.4 | pass | pass |
| src/themes.test.ts | light | text | palette 14 | #107d98 | #fcfcfd | 4.65 | 70.8 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | dark | text | --alert on --surface-sunken | #ff9592 | #0c0d0e | 9.23 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --alert on --surface | #ff9592 | #111113 | 8.95 | 60.8 | pass | pass |
| window/colors.test.ts | dark | text | --alert on --surface-raised | #ff9592 | #18191b | 8.35 | 60.1 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-sunken | #71d083 | #0c0d0e | 10.24 | 66.3 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface | #71d083 | #111113 | 9.93 | 66.0 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-raised | #71d083 | #18191b | 9.26 | 65.3 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-sunken | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-sunken | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-sunken | #641723 | #f9f9fb | 11.83 | 93.8 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface | #641723 | #fcfcfd | 12.13 | 95.5 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-raised | #641723 | #fcfcfd | 12.13 | 95.5 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-sunken | #203c25 | #f9f9fb | 11.51 | 94.1 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface | #203c25 | #fcfcfd | 11.81 | 95.8 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-raised | #203c25 | #fcfcfd | 11.81 | 95.8 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-sunken | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-sunken | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | dark | text | --alert on --surface-hover over --surface | #ff9592 | #212225 | 7.55 | 58.9 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-hover over --surface-raised | #ff9592 | #27292c | 6.92 | 57.7 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-selected over --surface | #ff9592 | #2e3135 | 6.20 | 56.0 | pass | FAIL |
| window/colors.test.ts | dark | text | --alert on --surface-selected over --surface-raised | #ff9592 | #34383c | 5.61 | 54.2 | pass | FAIL |
| window/colors.test.ts | dark | text | --faint on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| window/colors.test.ts | dark | text | --faint on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-hover over --surface | #71d083 | #212225 | 8.37 | 64.1 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-hover over --surface-raised | #71d083 | #27292c | 7.68 | 62.9 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-selected over --surface | #71d083 | #2e3135 | 6.88 | 61.2 | pass | pass |
| window/colors.test.ts | dark | text | --open on --surface-selected over --surface-raised | #71d083 | #34383c | 6.22 | 59.4 | pass | FAIL |
| window/colors.test.ts | dark | text | --soft on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| window/colors.test.ts | dark | text | --soft on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| window/colors.test.ts | dark | text | --text-muted on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| window/colors.test.ts | dark | text | --text-secondary on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-hover over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-hover over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-selected over --surface | #f1f7feb5 | #2e3135 | 6.97 | 61.7 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text on --surface-selected over --surface-raised | #f1f7feb5 | #34383c | 6.44 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-hover over --surface | #edeef0 | #212225 | 13.70 | 94.3 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-hover over --surface-raised | #edeef0 | #27292c | 12.56 | 93.1 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-selected over --surface | #edeef0 | #2e3135 | 11.26 | 91.4 | pass | pass |
| window/colors.test.ts | dark | text | --tile-text-on on --surface-selected over --surface-raised | #edeef0 | #34383c | 10.18 | 89.6 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-hover over --surface | #641723 | #ededf1 | 10.65 | 86.8 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-hover over --surface-raised | #641723 | #ededf1 | 10.65 | 86.8 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-selected over --surface | #641723 | #dddee4 | 9.26 | 78.0 | pass | pass |
| window/colors.test.ts | light | text | --alert on --surface-selected over --surface-raised | #641723 | #dddee4 | 9.26 | 78.0 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --faint on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-hover over --surface | #203c25 | #ededf1 | 10.37 | 87.1 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-hover over --surface-raised | #203c25 | #ededf1 | 10.37 | 87.1 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-selected over --surface | #203c25 | #dddee4 | 9.02 | 78.3 | pass | pass |
| window/colors.test.ts | light | text | --open on --surface-selected over --surface-raised | #203c25 | #dddee4 | 9.02 | 78.3 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --soft on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --text-muted on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --text-secondary on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-hover over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-hover over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-selected over --surface | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --tile-text on --surface-selected over --surface-raised | #0007149f | #dddee4 | 5.32 | 65.6 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-hover over --surface | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-hover over --surface-raised | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-selected over --surface | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| window/colors.test.ts | light | text | --tile-text-on on --surface-selected over --surface-raised | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| window/colors.test.ts | dark | text | html, body, #root: var(--text-secondary) on var(--surface-sunken) over --surface | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | html, body, #root: var(--text-secondary) on var(--surface-sunken) over --surface-raised | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | .strip: var(--tile-text) on var(--tile-wash) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .strip: var(--tile-text) on var(--tile-wash) over --surface-raised | #f1f7feb5 | #1f2123 | 8.17 | 62.0 | pass | pass |
| window/colors.test.ts | dark | text | .titlebar: var(--tile-text) on var(--tile-wash) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .titlebar: var(--tile-text) on var(--tile-wash) over --surface-raised | #f1f7feb5 | #1f2123 | 8.17 | 62.0 | pass | pass |
| window/colors.test.ts | dark | text | .tile.focused .titlebar: var(--tile-text-on) on var(--tile-wash-on) over --surface | #edeef0 | #212225 | 13.70 | 94.3 | pass | pass |
| window/colors.test.ts | dark | text | .tile.focused .titlebar: var(--tile-text-on) on var(--tile-wash-on) over --surface-raised | #edeef0 | #27292c | 12.56 | 93.1 | pass | pass |
| window/colors.test.ts | dark | text | .pop-why: var(--text-secondary) on var(--surface-sunken) over --surface | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | .pop-why: var(--text-secondary) on var(--surface-sunken) over --surface-raised | #f1f7feb5 | #0c0d0e | 9.23 | 60.7 | pass | pass |
| window/colors.test.ts | dark | text | .pop .chip: var(--text-muted) on var(--surface-hover) over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .pop .chip: var(--text-muted) on var(--surface-hover) over --surface-raised | #f1f7feb5 | #27292c | 7.55 | 61.8 | pass | pass |
| window/colors.test.ts | dark | text | .pop-cmd.on: var(--text-primary) on var(--row-on) over --surface | #edeef0 | #2e3135 | 11.26 | 91.4 | pass | pass |
| window/colors.test.ts | dark | text | .pop-cmd.on: var(--text-primary) on var(--row-on) over --surface-raised | #edeef0 | #34383c | 10.18 | 89.6 | pass | pass |
| window/colors.test.ts | dark | text | .tip: var(--text-primary) on var(--pop-bg) over --surface | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .tip: var(--text-primary) on var(--pop-bg) over --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | button: var(--text-secondary) on var(--line) over --surface | #f1f7feb5 | #363a3f | 6.26 | 60.5 | pass | pass |
| window/colors.test.ts | dark | text | button: var(--text-secondary) on var(--line) over --surface-raised | #f1f7feb5 | #3c4146 | 5.74 | 59.5 | pass | FAIL |
| window/colors.test.ts | dark | text | .view: var(--text-secondary) on var(--surface) over --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .view: var(--text-secondary) on var(--surface) over --surface-raised | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .markdown: var(--text-primary) on var(--ground) over --surface | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| window/colors.test.ts | dark | text | .markdown: var(--text-primary) on var(--ground) over --surface-raised | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| window/colors.test.ts | dark | text | .markdown :not(pre) > code: var(--text-primary) on var(--raised) over --surface | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .markdown :not(pre) > code: var(--text-primary) on var(--raised) over --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .markdown-keys: var(--faint) on var(--ground) over --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .markdown-keys: var(--faint) on var(--ground) over --surface-raised | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .tracker: var(--text-secondary) on var(--ground) over --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .tracker: var(--text-secondary) on var(--ground) over --surface-raised | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .tracker button.tracker-primary: var(--turn-fg) on var(--key) over --surface | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| window/colors.test.ts | dark | text | .tracker button.tracker-primary: var(--turn-fg) on var(--key) over --surface-raised | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-shows button[aria-pressed="true"]: var(--text-primary) on var(--raised) over --surface | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-shows button[aria-pressed="true"]: var(--text-primary) on var(--raised) over --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .tracker-find: var(--faint) on var(--raised) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .tracker-find: var(--faint) on var(--raised) over --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-first-areas input[type="text"]: var(--text-primary) on var(--ground) over --surface | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-first-areas input[type="text"]: var(--text-primary) on var(--ground) over --surface-raised | #edeef0 | #111113 | 16.25 | 96.2 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-composer input, .tracker .tracker-composer textarea: var(--text-primary) on var(--raised) over --surface | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .tracker .tracker-composer input, .tracker .tracker-composer textarea: var(--text-primary) on var(--raised) over --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .view .cmd: var(--text-primary) on var(--surface-sunken) over --surface | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | .view .cmd: var(--text-primary) on var(--surface-sunken) over --surface-raised | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | .view .btn: var(--text-primary) on var(--surface-raised) over --surface | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .view .btn: var(--text-primary) on var(--surface-raised) over --surface-raised | #edeef0 | #18191b | 15.15 | 95.5 | pass | pass |
| window/colors.test.ts | dark | text | .view .btn.turn: var(--turn-fg) on var(--turn-fill) over --surface | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| window/colors.test.ts | dark | text | .view .btn.turn: var(--turn-fg) on var(--turn-fill) over --surface-raised | #ffffff | #3e63dd | 5.21 | 80.7 | pass | pass |
| window/colors.test.ts | dark | text | .view .m.a: var(--text-secondary) on var(--agent-bg) over --surface | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .view .m.a: var(--text-secondary) on var(--agent-bg) over --surface-raised | #f1f7feb5 | #212225 | 8.07 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .ticket-view .noform textarea: var(--text-primary) on var(--surface-sunken) over --surface | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | .ticket-view .noform textarea: var(--text-primary) on var(--surface-sunken) over --surface-raised | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .node: var(--text-secondary) on var(--surface-raised) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .node: var(--text-secondary) on var(--surface-raised) over --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .wl: var(--text-muted) on var(--surface) over --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .wl: var(--text-muted) on var(--surface) over --surface-raised | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .cl: var(--text-faint) on var(--surface) over --surface | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .cl: var(--text-faint) on var(--surface) over --surface-raised | #f1f7feb5 | #111113 | 9.06 | 61.0 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .frame: var(--text-secondary) on color-mix(in oklab, var(--surface-raised) 35%, var(--surface)) over --surface | #f1f7feb5 | #131416 | 8.95 | 61.4 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .frame: var(--text-secondary) on color-mix(in oklab, var(--surface-raised) 35%, var(--surface)) over --surface-raised | #f1f7feb5 | #131416 | 8.95 | 61.4 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .spot: var(--text-muted) on var(--surface-raised) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .spot: var(--text-muted) on var(--surface-raised) over --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .chip: var(--text-muted) on var(--surface-raised) over --surface | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .map-view .chip: var(--text-muted) on var(--surface-raised) over --surface-raised | #f1f7feb5 | #18191b | 8.71 | 61.9 | pass | pass |
| window/colors.test.ts | dark | text | .trace-view .wf-json pre, .trace-view .wf-detail code: var(--text-primary) on var(--surface-sunken) over --surface | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | dark | text | .trace-view .wf-json pre, .trace-view .wf-detail code: var(--text-primary) on var(--surface-sunken) over --surface-raised | #edeef0 | #0c0d0e | 16.76 | 96.5 | pass | pass |
| window/colors.test.ts | light | text | html, body, #root: var(--text-secondary) on var(--surface-sunken) over --surface | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | html, body, #root: var(--text-secondary) on var(--surface-sunken) over --surface-raised | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | .strip: var(--tile-text) on var(--tile-wash) over --surface | #0007149f | #f6f6f9 | 5.75 | 75.7 | pass | pass |
| window/colors.test.ts | light | text | .strip: var(--tile-text) on var(--tile-wash) over --surface-raised | #0007149f | #f6f6f9 | 5.75 | 75.7 | pass | pass |
| window/colors.test.ts | light | text | .titlebar: var(--tile-text) on var(--tile-wash) over --surface | #0007149f | #f6f6f9 | 5.75 | 75.7 | pass | pass |
| window/colors.test.ts | light | text | .titlebar: var(--tile-text) on var(--tile-wash) over --surface-raised | #0007149f | #f6f6f9 | 5.75 | 75.7 | pass | pass |
| window/colors.test.ts | light | text | .tile.focused .titlebar: var(--tile-text-on) on var(--tile-wash-on) over --surface | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| window/colors.test.ts | light | text | .tile.focused .titlebar: var(--tile-text-on) on var(--tile-wash-on) over --surface-raised | #1c2024 | #ededf1 | 14.03 | 92.8 | pass | pass |
| window/colors.test.ts | light | text | .pop-why: var(--text-secondary) on var(--surface-sunken) over --surface | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | .pop-why: var(--text-secondary) on var(--surface-sunken) over --surface-raised | #0007149f | #f9f9fb | 5.81 | 77.0 | pass | pass |
| window/colors.test.ts | light | text | .pop .chip: var(--text-muted) on var(--surface-hover) over --surface | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | .pop .chip: var(--text-muted) on var(--surface-hover) over --surface-raised | #0007149f | #ededf1 | 5.58 | 71.8 | pass | pass |
| window/colors.test.ts | light | text | .pop-cmd.on: var(--text-primary) on var(--row-on) over --surface | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| window/colors.test.ts | light | text | .pop-cmd.on: var(--text-primary) on var(--row-on) over --surface-raised | #1c2024 | #dddee4 | 12.21 | 84.1 | pass | pass |
| window/colors.test.ts | light | text | .tip: var(--text-primary) on var(--pop-bg) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tip: var(--text-primary) on var(--pop-bg) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | button: var(--text-secondary) on var(--line) over --surface | #0007149f | #d6d6de | 5.16 | 62.3 | pass | pass |
| window/colors.test.ts | light | text | button: var(--text-secondary) on var(--line) over --surface-raised | #0007149f | #d6d6de | 5.16 | 62.3 | pass | pass |
| window/colors.test.ts | light | text | .view: var(--text-secondary) on var(--surface) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .view: var(--text-secondary) on var(--surface) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .markdown: var(--text-primary) on var(--ground) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .markdown: var(--text-primary) on var(--ground) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .markdown :not(pre) > code: var(--text-primary) on var(--raised) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .markdown :not(pre) > code: var(--text-primary) on var(--raised) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .markdown-keys: var(--faint) on var(--ground) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .markdown-keys: var(--faint) on var(--ground) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .tracker: var(--text-secondary) on var(--ground) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .tracker: var(--text-secondary) on var(--ground) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-shows button[aria-pressed="true"]: var(--text-primary) on var(--raised) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-shows button[aria-pressed="true"]: var(--text-primary) on var(--raised) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tracker-find: var(--faint) on var(--raised) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .tracker-find: var(--faint) on var(--raised) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-first-areas input[type="text"]: var(--text-primary) on var(--ground) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-first-areas input[type="text"]: var(--text-primary) on var(--ground) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-composer input, .tracker .tracker-composer textarea: var(--text-primary) on var(--raised) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .tracker .tracker-composer input, .tracker .tracker-composer textarea: var(--text-primary) on var(--raised) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .view .cmd: var(--text-primary) on var(--surface-sunken) over --surface | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | .view .cmd: var(--text-primary) on var(--surface-sunken) over --surface-raised | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | .view .btn: var(--text-primary) on var(--surface-raised) over --surface | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .view .btn: var(--text-primary) on var(--surface-raised) over --surface-raised | #1c2024 | #fcfcfd | 15.98 | 101.6 | pass | pass |
| window/colors.test.ts | light | text | .view .m.a: var(--text-secondary) on var(--agent-bg) over --surface | #0007149f | #f0f0f3 | 5.64 | 73.1 | pass | pass |
| window/colors.test.ts | light | text | .view .m.a: var(--text-secondary) on var(--agent-bg) over --surface-raised | #0007149f | #f0f0f3 | 5.64 | 73.1 | pass | pass |
| window/colors.test.ts | light | text | .ticket-view .noform textarea: var(--text-primary) on var(--surface-sunken) over --surface | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | .ticket-view .noform textarea: var(--text-primary) on var(--surface-sunken) over --surface-raised | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | .map-view .node: var(--text-secondary) on var(--surface-raised) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .node: var(--text-secondary) on var(--surface-raised) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .wl: var(--text-muted) on var(--surface) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .wl: var(--text-muted) on var(--surface) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .cl: var(--text-faint) on var(--surface) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .cl: var(--text-faint) on var(--surface) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .frame: var(--text-secondary) on color-mix(in oklab, var(--surface-raised) 35%, var(--surface)) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .frame: var(--text-secondary) on color-mix(in oklab, var(--surface-raised) 35%, var(--surface)) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .spot: var(--text-muted) on var(--surface-raised) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .spot: var(--text-muted) on var(--surface-raised) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .chip: var(--text-muted) on var(--surface-raised) over --surface | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .map-view .chip: var(--text-muted) on var(--surface-raised) over --surface-raised | #0007149f | #fcfcfd | 5.87 | 78.4 | pass | pass |
| window/colors.test.ts | light | text | .trace-view .wf-json pre, .trace-view .wf-detail code: var(--text-primary) on var(--surface-sunken) over --surface | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| window/colors.test.ts | light | text | .trace-view .wf-json pre, .trace-view .wf-detail code: var(--text-primary) on var(--surface-sunken) over --surface-raised | #1c2024 | #f9f9fb | 15.58 | 99.8 | pass | pass |
| src/themes.test.ts | light | text | --turn-fg on --turn-fill-hover (known exception, ticket 153) | #ffffff | #5472e4 | 4.28 | 74.8 | FAIL | pass |
