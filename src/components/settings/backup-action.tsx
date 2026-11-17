"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/alert-dialog";
import { Button } from "@/components/shadcn/button";
import { toast } from "sonner";

export function BackupAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createBackup() {
    setPending(true);
    setError(null);

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

      toast.success("备份已创建", {
        description: result.data.backupDirectory,
      });
    } catch {
      setError("本机数据库备份失败，请检查磁盘空间和目录权限。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        className="min-h-12"
        disabled={pending}
        onClick={createBackup}
        type="button"
      >
        {pending ? "正在备份…" : "创建备份"}
      </Button>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setError(null);
        }}
        open={error !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>备份失败</AlertDialogTitle>
            <AlertDialogDescription>{error}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">知道了</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
