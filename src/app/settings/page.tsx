import type { Metadata } from "next";

import { BackupAction } from "@/components/settings/backup-action";
import { Badge } from "@/components/shadcn/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "设置 | 量化研究工作台" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1
          className="text-2xl font-semibold tracking-tight"
          id="main-content"
          tabIndex={-1}
        >
          设置
        </h1>
        <p className="text-sm text-muted-foreground">本机运行状态与数据保护</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="settings-sources">数据源</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">外部数据源适配器</p>
              <p className="text-sm text-muted-foreground">
                运行时尚未接入，来源可用状态无法核验。
              </p>
            </div>
            <Badge variant="outline">NOT_VERIFIED</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="settings-model">模型</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">本机模型执行器</p>
              <p className="text-sm text-muted-foreground">
                执行器尚未接入；此页面不读取或显示凭据。
              </p>
            </div>
            <Badge variant="outline">NOT_VERIFIED</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="settings-backup">本机备份</h2>
          </CardTitle>
          <CardDescription>
            创建 SQLite 一致性快照，保存到应用本机数据目录的 backups 子目录。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupAction />
        </CardContent>
      </Card>
    </div>
  );
}
