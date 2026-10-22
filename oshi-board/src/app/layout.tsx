import type { Metadata, Viewport } from "next";
import { Header } from "@/components/Header";
import { Toaster } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "推しボード",
    template: "%s | 推しボード",
  },
  description: "YouTube と Twitch の VTuber 配信をまとめてチェック。マルチビューで2窓・4窓視聴、切り抜きもまとめて見られる。",
};

export const viewport: Viewport = {
  themeColor: "#0b0c10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Header />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
