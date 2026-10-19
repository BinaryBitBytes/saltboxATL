import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/frontend/client/providers";
import { PwaRegister } from "@/frontend/client/pwa-register";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { PWA_THEME_COLOR } from "@/lib/pwa/manifest";
import { getTranslator } from "@/lib/i18n/server";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: "Saltbox Inventory",
    applicationName: "Saltbox Inventory",
    description: t("Receive, put away, and ship warehouse inventory."),
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Saltbox",
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getTranslator();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <body className="flex min-h-dvh flex-col overflow-x-clip">
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <Providers locale={locale}>
          <PwaRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
