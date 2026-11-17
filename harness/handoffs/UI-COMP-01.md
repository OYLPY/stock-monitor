# UI-COMP-01 Six-field Handoff

## Objective

Complete the reopened [UI-COMP-01 / Issue #89](https://github.com/OYLPY/stock-monitor/issues/89): use official shadcn CLI components throughout all seven pages, improve information grouping and page UX, keep the sidebar as generated shadcn primitives, and avoid a visible duplicate page title when the sidebar already identifies the page. Preserve routes and business behavior; close the Issue only after current changes pass the required checks and matching Quality CI.

## Established facts

- Started on `main` at `9baca6adfd3de0eb664417d1ee52c02563463431`; `git fetch --prune origin` confirmed no main divergence and GitHub had no open PRs.
- Issue #89 was reopened after user visual review. Feedback covers hand-styled controls, oversized buttons, the sidebar and non-sticky header, date selection, and unrelated content grouped together. Its acceptance requires all seven pages, official shadcn primitives, accessible Select/filter behavior, unchanged protected sources, improved page grouping, and Quality CI.
- The previous Sidebar implementation and UI controls were app-authored. The shadcn CLI config now points `ui` to `@/components/shadcn`; `pnpm exec shadcn info --json` confirms base-nova and the installed component set.
- The original `src/components/ui/*` files were not changed. Business pages no longer import from that directory or render native select/table/button/input controls.
- The [Modern Web Guidance navigation drawer guide](../../.agents/skills/modern-web-guidance/guides/ui-components/navigation-drawer.md) says, “The browser makes the rest of the page inert”; narrow-screen Sidebar behavior uses the generated Sheet primitive and was verified open/close in Playwright.
- The user-provided reference app is `D:\dev\self\ai-enhance-hrm\frontend`; its shell uses the generated shadcn Sidebar with `collapsible="offcanvas"` and standard nav button sizes.
- The completed UI change separates backtest research from the paper account with the CLI-provided Tabs, groups report history by type, splits task runtime from notifications, uses a required shadcn InputGroup with the Calendar/Popover date picker, and keeps the shared header sticky. Commit `523431e0f1d71dc78502900b95e6da9991bf8d48` is pushed to `main`; matching [Quality CI run 44007310184](https://github.com/OYLPY/stock-monitor/actions/runs/44007310184) succeeded; Issue #89 is closed.

## Applied changes

- Installed Alert, AlertDialog, Badge, Button, Card, Chart, Collapsible, Empty, Field, Input, InputGroup, Label, Select, Separator, Sheet, Sidebar, Skeleton, Sonner, Table, Textarea, and Tooltip using the shadcn CLI. Generated source under `src/components/shadcn` and `src/hooks/shadcn` remains unmodified.
- Replaced the app shell/navigation with the CLI-generated `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, and `SidebarMenu` primitives. Composed pages from standard shadcn controls for cards, fields, selects, disclosures, feedback, charts, and tables; retained routes, source/status semantics, filters, and risk/data behavior.
- Added the shadcn CLI-only boundary to `AGENTS.md` and `docs/design/UI_DESIGN.md`. Implementation commit [`bb5902c3d85ab97ad1ef47b3895dea4e5911e002`](https://github.com/OYLPY/stock-monitor/commit/bb5902c3d85ab97ad1ef47b3895dea4e5911e002) is pushed to `main`; matching [Quality CI run 43991694623](https://github.com/OYLPY/stock-monitor/actions/runs/43991694623) succeeded.
- After the visual review, the shared Sidebar now uses the generated off-canvas mode, its navigation uses default shadcn sizes, and the shared header is sticky. The active page title remains an accessible `h1` while its duplicate large visual title stays hidden.
- `pnpm exec shadcn add tabs --yes` exited 0 and skipped `src/components/shadcn/tabs.tsx` because it already matches the registry source; no generated component source was edited.
- Reorganized the backtest page into “回测研究” and “纸面账户” tabs; report history is grouped by report type; task runtime and notifications have separate cards. Date fields now compose the generated InputGroup, Popover, and Calendar while keeping a visible required field and preserving GET values.
- Split the overview empty state into separate market, event, and report cards, each with its own NOT_VERIFIED status, truthful empty copy, and shadcn Button navigation to its page.
- Replaced hand-styled report/event subpanels and separators with CLI-installed `Item` and `Separator`, and rendered form-range and report-contract errors with shadcn `Alert`.
- Updated DOC-0017, its requirement traceability entry, the document keywords, and the Issue index to record the categorization and title hierarchy rules.

## Verification

- `pnpm exec shadcn info --json` — exit 0; CLI resolved the configured alias and reported the installed component list.
- `pnpm format:check` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm typecheck` — exit 0.
- `pnpm test` — exit 0, 25 files / 132 tests.
- `pnpm build` — exit 0.
- `pnpm install --frozen-lockfile` — exit 0 (`Already up to date`).
- `pnpm format:check` — exit 0 after formatting `docs/design/UI_DESIGN.md` with Prettier.
- `pnpm lint` — exit 0.
- `pnpm typecheck` — exit 0.
- `pnpm test` — exit 0, 25 files / 132 tests.
- `pnpm build` — exit 0 with Next.js 16.4.6.
- `pnpm test:e2e` — exit 0, 5 Playwright tests. Verified all routes at desktop/320px, Sidebar off-canvas state and narrow-screen open/close, shadcn Select keyboard/filter behavior, date picker calendar, paper-account Tab, sticky header, and settings backup/task navigation.
- `git diff --check` — exit 0; `git diff -- src/components/ui` — empty.

## Latest UI change

- Updated the overview to separate market monitoring, event records, and research reports into shadcn Cards with `Empty` states and route buttons. Rechecked business source for raw controls and imports from protected `src/components/ui`; none were found.
- 2026-11-17: The user reported a Base UI runtime warning because a navigation `Link` was rendered through `Button`. The current source uses a plain Next `Link` with `buttonVariants`; the active Next dev RSC chunk has recompiled to that markup. No browser or Playwright recheck was run, per the user's instruction to focus on UI changes first. Issue #89 is open again and remains unaccepted until its full UI verification is completed.

## Dead ends

- Earlier SSR assertions expected native `<select>` values; shadcn Select renders a combobox button. Assertions were updated to its actual accessible trigger and selected values.
- One Playwright assertion expected `role=status` on Sonner's notification item. The installed Sonner exposes its notification within the accessible Notifications live region; the test now asserts the real region and passes.
- No alternate component implementation was retained. A failed initial shadcn CLI alias placement left untracked duplicate files in the protected `src/components/ui`; those exact untracked duplicates were removed, and the original tracked files remain untouched.

## Remaining plan

1. Issue #89 remains open; the runtime warning fix is present in the active P10-02 working tree, but the current UI diff has not received browser/Playwright verification.
2. P10-02 / Issue #65 is the active implementation task; its dependencies P10-01 / #64 and P03-03 / #30 are closed.
