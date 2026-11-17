# UI-COMP-01 Six-field Handoff

## Objective

Complete [UI-COMP-01 / Issue #89](https://github.com/OYLPY/stock-monitor/issues/89): replace the app's hand-built controls and navigation shell with components installed by the shadcn CLI, preserving page routes and business behavior, and close the Issue only after matching Quality CI succeeds.

## Established facts

- Started on `main` at `9baca6adfd3de0eb664417d1ee52c02563463431`; `git fetch --prune origin` confirmed no main divergence and GitHub had no open PRs.
- Issue #89 is open and its acceptance requires all seven pages, the official Sidebar primitives, accessible Select/filter behavior, unchanged protected sources, and Quality CI.
- The previous Sidebar implementation and UI controls were app-authored. The shadcn CLI config now points `ui` to `@/components/shadcn`; `pnpm exec shadcn info --json` confirms base-nova and the installed component set.
- The original `src/components/ui/*` files were not changed. Business pages no longer import from that directory or render native select/table/button/input controls.
- The [Modern Web Guidance navigation drawer guide](../../.agents/skills/modern-web-guidance/guides/ui-components/navigation-drawer.md) says, “The browser makes the rest of the page inert”; narrow-screen Sidebar behavior uses the generated Sheet primitive and was verified open/close in Playwright.

## Applied changes

- Installed Alert, AlertDialog, Badge, Button, Card, Chart, Collapsible, Empty, Field, Input, InputGroup, Label, Select, Separator, Sheet, Sidebar, Skeleton, Sonner, Table, Textarea, and Tooltip using the shadcn CLI. Generated source under `src/components/shadcn` and `src/hooks/shadcn` remains unmodified.
- Replaced the app shell/navigation with the CLI-generated `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, and `SidebarMenu` primitives. Composed pages from standard shadcn controls for cards, fields, selects, disclosures, feedback, charts, and tables; retained routes, source/status semantics, filters, and risk/data behavior.
- Added the shadcn CLI-only boundary to `AGENTS.md` and `docs/design/UI_DESIGN.md`. Implementation commit [`bb5902c3d85ab97ad1ef47b3895dea4e5911e002`](https://github.com/OYLPY/stock-monitor/commit/bb5902c3d85ab97ad1ef47b3895dea4e5911e002) is pushed to `main`; matching [Quality CI run 43991694623](https://github.com/OYLPY/stock-monitor/actions/runs/43991694623) succeeded.

## Verification

- `pnpm exec shadcn info --json` — exit 0; CLI resolved the configured alias and reported the installed component list.
- `pnpm format:check` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm typecheck` — exit 0.
- `pnpm test` — exit 0, 25 files / 132 tests.
- `pnpm build` — exit 0.
- `pnpm test:e2e` — exit 0, 3 Playwright tests. Verified desktop Sidebar collapse/expand, mobile Sidebar open/close, all seven pages at desktop and 320px without horizontal overflow, Select keyboard open/Escape, report/event GET filters, and backup success/error feedback.
- `git diff --check` — exit 0; `git diff -- src/components/ui` — empty.
- Matching [Quality CI run 43991694623](https://github.com/OYLPY/stock-monitor/actions/runs/43991694623) for implementation commit `bb5902c3d85ab97ad1ef47b3895dea4e5911e002` — success. Closure remains gated on the evidence commit's CI.

## Dead ends

- Earlier SSR assertions expected native `<select>` values; shadcn Select renders a combobox button. Assertions were updated to its actual accessible trigger and selected values.
- One Playwright assertion expected `role=status` on Sonner's notification item. The installed Sonner exposes its notification within the accessible Notifications live region; the test now asserts the real region and passes.
- No alternate component implementation was retained. A failed initial shadcn CLI alias placement left untracked duplicate files in the protected `src/components/ui`; those exact untracked duplicates were removed, and the original tracked files remain untouched.

## Remaining plan

1. Commit and push this handoff, current state, Issue index, document index, and traceability updates to `main`; verify the evidence commit's matching Quality CI.
2. Add the verified evidence commit/CI to Issue #89 and close it.
3. Update the persisted Issue status after closure.
