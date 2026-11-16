"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function BackupAction() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function createBackup() {
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/backup", { method: "POST" });
      if (!response.ok) throw new Error("backup_failed");

      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("data" in result) ||
        typeof result.data !== "object" ||
        result.data === null ||
        !("backupDirectory" in result.data) ||
        typeof result.data.backupDirectory !== "string"
      ) {
        throw new Error("backup_response_invalid");
      }

      setMessage(`备份已创建：${result.data.backupDirectory}`);
    } catch {
      setMessage("本机数据库备份失败，请检查磁盘空间和目录权限。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div aria-busy={pending} className="space-y-2">
      <Button
        className="min-h-11"
        disabled={pending}
        onClick={createBackup}
        type="button"
      >
        {pending ? "正在备份…" : "创建备份"}
      </Button>
      <p
        aria-atomic="true"
        className="max-w-full break-all text-sm"
        role="status"
      >
        {message}
      </p>
    </div>
  );
}
