"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/alert-dialog";
import { Button } from "@/components/shadcn/button";

export function CancelTaskButton({
  label,
  taskId,
}: {
  label: string;
  taskId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function cancelTask() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("outcome" in payload.data) ||
        typeof payload.data.outcome !== "string"
      ) {
        throw new Error("task_cancel_failed");
      }

      const outcome = payload.data.outcome;
      if (outcome === "CANCELLED" || outcome === "REQUESTED") {
        toast.success(
          outcome === "CANCELLED" ? "任务已取消" : "已请求停止任务",
          { description: label },
        );
      } else {
        toast.error("任务状态已变化", { description: "队列已刷新。" });
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        disabled={pending}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        取消
      </Button>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!pending) {
            setOpen(nextOpen);
            if (!nextOpen) setError(false);
          }
        }}
        open={open}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消任务？</AlertDialogTitle>
            <AlertDialogDescription>
              {error
                ? "任务状态未能更新。请刷新队列后重试。"
                : `将取消或请求停止“${label}”。已完成的任务不会改变。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>返回</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={cancelTask}>
              {pending ? "正在处理…" : "确认取消"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
