// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "EdgeVision — پلتفرم تحلیل ویدئوی بلادرنگ",
  description:
    "داشبورد فارسی EdgeVision برای پایش استریم‌های زنده، تشخیص اشیا، رویدادها و تحلیل عملکرد موتور پردازش.",
  icons: { icon: "/edgevision.svg" },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

const GLOBAL_CSS = `
body {
  font-family: Vazirmatn, Tahoma, ui-sans-serif, system-ui, sans-serif;
}
.thin-scroll { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }
.thin-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.thin-scroll::-webkit-scrollbar-track { background: transparent; }
.thin-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 9999px; }
.thin-scroll::-webkit-scrollbar-thumb:hover { background: #52525b; }
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-zinc-950 text-zinc-100">
        {/* قلم وزیرمتن از CDN — با fallback به Tahoma */}
        <link
          rel="stylesheet"
          precedence="vazirmatn"
          href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"
        />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
