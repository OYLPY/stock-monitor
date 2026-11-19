"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { toast } from "sonner";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/shadcn/field";
import { Switch } from "@/components/shadcn/switch";

type NotificationCursor = { createdAtMs: number; id: string };

const PREFERENCE_KEY = "stock-monitor:desktop-notifications:v1";
const NOTIFICATION_STATE_CHANGE_EVENT =
  "stock-monitor:notification-state-change";
const POLL_INTERVAL_MS = 30_000;
const POLL_FAILURE_MESSAGE = "暂时无法读取新的本机提醒；已保存的记录不会丢失。";
const notificationResponseSchema = z.object({
  data: z.strictObject({
    notifications: z.array(
      z.strictObject({
        id: z.string().uuid(),
        created_at_ms: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        summary: z.string(),
        market_code: z.enum(["JP", "US"]).nullable(),
      }),
    ),
  }),
});

function subscribeToNotificationState(onChange: () => void) {
  window.addEventListener("focus", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(NOTIFICATION_STATE_CHANGE_EVENT, onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NOTIFICATION_STATE_CHANGE_EVENT, onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function getNotificationPermissionSnapshot():
  NotificationPermission | "unsupported" {
  return "Notification" in window
    ? window.Notification.permission
    : "unsupported";
}

function getServerNotificationPermissionSnapshot() {
  return "checking" as const;
}

function getNotificationEnabledSnapshot() {
  if (
    !("Notification" in window) ||
    window.Notification.permission !== "granted"
  ) {
    return false;
  }
  try {
    return localStorage.getItem(PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

function getServerNotificationEnabledSnapshot() {
  return false;
}

export function LocalDesktopNotifications({
  latestNotification,
}: {
  latestNotification: NotificationCursor | null;
}) {
  const permissionState = useSyncExternalStore(
    subscribeToNotificationState,
    getNotificationPermissionSnapshot,
    getServerNotificationPermissionSnapshot,
  );
  const persistedEnabled = useSyncExternalStore(
    subscribeToNotificationState,
    getNotificationEnabledSnapshot,
    getServerNotificationEnabledSnapshot,
  );
  const [sessionEnabled, setSessionEnabled] = useState<boolean | null>(null);
  const [constructionUnsupported, setConstructionUnsupported] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const enabled = sessionEnabled ?? persistedEnabled;
  const support = constructionUnsupported
    ? "unsupported"
    : permissionState === "checking"
      ? "checking"
      : permissionState === "unsupported"
        ? "unsupported"
        : "supported";
  const permission =
    permissionState === "checking" ? "default" : permissionState;
  const deliveryGenerationRef = useRef(0);
  const cursorRef = useRef<NotificationCursor>({
    createdAtMs: latestNotification?.createdAtMs ?? 0,
    id: latestNotification?.id ?? "",
  });

  useEffect(() => {
    if (!enabled) {
      cursorRef.current = {
        createdAtMs: latestNotification?.createdAtMs ?? 0,
        id: latestNotification?.id ?? "",
      };
    }
  }, [enabled, latestNotification]);

  useEffect(() => {
    if (support !== "supported") return;

    let stopped = false;
    let requestInFlight = false;
    let timer: number | undefined;
    let failureToastShown = false;

    async function pollNotifications() {
      if (stopped || requestInFlight) return;
      requestInFlight = true;
      const deliveryGeneration = deliveryGenerationRef.current;
      try {
        const query = new URLSearchParams({
          afterCreatedAtMs: String(cursorRef.current.createdAtMs),
          afterId: cursorRef.current.id,
        });
        const response = await fetch(`/api/v1/notifications?${query}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("notifications_unavailable");
        const parsed = notificationResponseSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error("notifications_response_invalid");

        setFailure((currentFailure) =>
          currentFailure === POLL_FAILURE_MESSAGE ? null : currentFailure,
        );
        failureToastShown = false;
        for (const item of parsed.data.data.notifications) {
          if (stopped) return;
          cursorRef.current = {
            createdAtMs: item.created_at_ms,
            id: item.id,
          };
          if (
            !enabled ||
            deliveryGeneration !== deliveryGenerationRef.current
          ) {
            continue;
          }

          if (window.Notification.permission !== "granted") {
            setSessionEnabled(false);
            try {
              localStorage.setItem(PREFERENCE_KEY, "off");
              setSessionEnabled(null);
            } catch {
              setFailure("浏览器权限已变化；桌面通知已停止。");
            }
            window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
            break;
          }

          try {
            const market =
              item.market_code === "JP"
                ? "日股"
                : item.market_code === "US"
                  ? "美股"
                  : "市场级";
            const notification = new window.Notification(`${market}重大事件`, {
              body: item.summary.slice(0, 180),
              tag: `stock-monitor-${item.id}`,
            });
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          } catch {
            setConstructionUnsupported(true);
            setSessionEnabled(false);
            setFailure("此浏览器无法显示系统通知；提醒仍保存在本机列表。");
            try {
              localStorage.setItem(PREFERENCE_KEY, "off");
              setSessionEnabled(null);
            } catch {
              // The in-memory quiet state still prevents another display attempt.
            }
            window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
            toast.error("系统通知不可用", {
              description: "事件仍保存在任务与通知页面。",
            });
            break;
          }
        }
      } catch {
        setFailure(POLL_FAILURE_MESSAGE);
        if (enabled && !failureToastShown) {
          toast.error("无法读取本机提醒", {
            description: "本页稍后会重试；提醒仍保存在本机。",
          });
          failureToastShown = true;
        }
      } finally {
        requestInFlight = false;
        if (!stopped) {
          timer = window.setTimeout(
            () => void pollNotifications(),
            POLL_INTERVAL_MS,
          );
        }
      }
    }

    void pollNotifications();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, support]);

  async function handleEnabledChange(nextEnabled: boolean) {
    deliveryGenerationRef.current += 1;
    if (!nextEnabled) {
      setSessionEnabled(false);
      setFailure(null);
      try {
        localStorage.setItem(PREFERENCE_KEY, "off");
        setSessionEnabled(null);
        window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
      } catch {
        setFailure("本页已静默，但浏览器未允许保存此偏好。");
      }
      return;
    }

    if (support !== "supported") return;

    try {
      const browserPermission =
        window.Notification.permission === "default"
          ? await window.Notification.requestPermission()
          : window.Notification.permission;
      window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
      if (browserPermission !== "granted") {
        setSessionEnabled(false);
        try {
          localStorage.setItem(PREFERENCE_KEY, "off");
          setSessionEnabled(null);
        } catch {
          setFailure("浏览器权限未授予；桌面通知已保持静默。");
        }
        window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
        setFailure(
          browserPermission === "denied"
            ? "浏览器已拒绝系统通知；可在本机站点权限中更改。"
            : "浏览器未授予系统通知权限。",
        );
        toast.error("系统通知未授权", {
          description: "本机提醒仍会保存在任务与通知页面。",
        });
        return;
      }

      let preferenceSaved = true;
      try {
        localStorage.setItem(PREFERENCE_KEY, "on");
        setSessionEnabled(null);
      } catch {
        preferenceSaved = false;
        setSessionEnabled(true);
      }
      window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
      setFailure(
        preferenceSaved ? null : "本页已开启通知，但浏览器未允许保存此偏好。",
      );
      toast.success("桌面通知已开启", {
        description: "仅显示新加入本机记录的重大事件。",
      });
    } catch {
      setSessionEnabled(false);
      setFailure("无法读取浏览器通知权限；本机提醒仍会保存。");
      window.dispatchEvent(new Event(NOTIFICATION_STATE_CHANGE_EVENT));
      toast.error("无法启用系统通知", {
        description: "请检查浏览器的本机站点权限。",
      });
    }
  }

  const description =
    failure ??
    (support === "checking"
      ? "正在检查浏览器通知支持。"
      : support === "unsupported"
        ? "当前浏览器不支持桌面通知；提醒仍保存在本机列表。"
        : permission === "denied"
          ? "浏览器已拒绝权限；可在本机站点权限中更改。"
          : enabled
            ? "已开启。仅在本页运行时检查新提醒；关闭页面、电脑休眠或关机时不会送达。"
            : "默认静默。仅在你开启并授权后显示新提醒；静默期间的提醒只保存在本机列表。");

  return (
    <Field orientation="horizontal" className="w-auto">
      <Switch
        id="desktop-notifications"
        aria-describedby="desktop-notifications-description"
        checked={enabled}
        disabled={support !== "supported"}
        onCheckedChange={(checked) => void handleEnabledChange(checked)}
        size="sm"
      />
      <FieldContent>
        <FieldLabel htmlFor="desktop-notifications">桌面通知</FieldLabel>
        <FieldDescription id="desktop-notifications-description">
          {description}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}
