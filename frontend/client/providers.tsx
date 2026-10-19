"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { LanguageProvider } from "@/frontend/client/language";
import { ThemeProvider } from "@/frontend/client/theme-provider";
import type { Locale } from "@/lib/i18n/locale";

export function Providers({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
          },
        },
      }),
  );

  return (
    <LanguageProvider locale={locale}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
