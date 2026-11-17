import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Badge } from "@/components/shadcn/badge";
import { Separator } from "@/components/shadcn/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/shadcn/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
          <SidebarTrigger
            aria-label="切换主导航"
            className="min-h-12 min-w-12"
          />
          <Separator className="h-5" orientation="vertical" />
          <p className="truncate text-sm font-medium">研究工作台</p>
          <Badge className="ml-auto hidden sm:inline-flex" variant="outline">
            本机运行
          </Badge>
        </header>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
