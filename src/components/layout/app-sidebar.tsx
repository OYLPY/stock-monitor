"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  FileText,
  FlaskConical,
  House,
  ListChecks,
  Settings2,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/shadcn/sidebar";

const availableModules = [
  { icon: Activity, label: "市场监测", href: "/markets" },
  { icon: Bell, label: "异常与事件", href: "/events" },
  { icon: FileText, label: "晨报与策略研究", href: "/reports" },
  { icon: FlaskConical, label: "回测与模拟账户", href: "/backtests" },
  { icon: Settings2, label: "设置", href: "/settings" },
  { icon: ListChecks, label: "任务与通知", href: "/tasks" },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/" />}
                size="lg"
                tooltip="量化研究工作台"
              >
                <ChartNoAxesCombined aria-hidden="true" />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="truncate font-semibold">量化研究工作台</span>
                  <span className="text-xs text-muted-foreground">
                    本地研究工具
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger
            aria-label="关闭主导航"
            className="min-h-12 min-w-12 md:hidden"
          />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel>研究工作区</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="主导航">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-current={pathname === "/" ? "page" : undefined}
                    isActive={pathname === "/"}
                    render={<Link href="/" />}
                    size="lg"
                  >
                    <House aria-hidden="true" />
                    <span>总览</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>功能模块</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {availableModules.map(({ href, icon: Icon, label }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    aria-current={pathname === href ? "page" : undefined}
                    isActive={pathname === href}
                    render={<Link href={href} />}
                    size="lg"
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
