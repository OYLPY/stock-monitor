import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@/components/shadcn/sonner";
import { TooltipProvider } from "@/components/shadcn/tooltip";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "量化研究工作台",
  description: "本地优先的美日股研究应用。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html className="scroll-pt-12" lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
