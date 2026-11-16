import type { ReactNode } from "react";

export const metadata = {
  title: "P04-04 Worker Close Proof",
  description: "Verify a persisted task continues in an independent worker.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
