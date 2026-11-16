import Link from "next/link";
import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  FileText,
  FlaskConical,
  House,
  Settings2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const plannedModules = [
  { icon: Activity, label: "市场监测" },
  { icon: Bell, label: "异常与事件" },
  { icon: FileText, label: "晨报与策略研究" },
  { icon: FlaskConical, label: "回测与模拟账户" },
  { icon: Settings2, label: "设置与任务" },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <Link className="flex min-w-0 items-center gap-3" href="/">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChartNoAxesCombined aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">
                量化研究工作台
              </span>
              <span className="text-xs text-muted-foreground">
                本地研究工具
              </span>
            </span>
          </Link>
          <SidebarTrigger aria-label="关闭主导航" className="md:hidden" />
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
                    aria-current="page"
                    isActive
                    render={<Link href="/" />}
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
          <SidebarGroupLabel>后续模块</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {plannedModules.map(({ icon: Icon, label }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton aria-disabled="true">
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>待开放</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex flex-col gap-2 rounded-lg border bg-sidebar-accent/50 p-3">
          <Badge className="w-fit" variant="secondary">
            无需登录
          </Badge>
          <p className="text-xs leading-5 text-muted-foreground">
            本工具不会连接证券账户或提交真实订单。
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
