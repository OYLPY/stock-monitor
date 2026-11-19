"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/shadcn/alert-dialog";
import { Button } from "@/components/shadcn/button";

export function InitializePaperAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function initialize() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/v1/paper-account/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!response.ok) throw new Error("paper_account_initialization_failed");

      setOpen(false);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!pending) {
          setOpen(nextOpen);
          if (nextOpen) setFailed(false);
        }
      }}
      open={open}
    >
      <AlertDialogTrigger render={<Button type="button" />}>
        建立纸面账户
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {failed ? "建立纸面账户失败" : "确认建立本机纸面账户"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {failed
              ? "本机账本未能确认开户结果。可以安全重试；已有开户现金不会重复记入。"
              : "将在本机账本记入 1,000,000 JPY 初始现金，不创建持仓、成交或收益。开户后不可重置。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void initialize();
            }}
            type="button"
          >
            {pending ? "正在建立…" : failed ? "重试开户" : "确认开户"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
