"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { persistLocale, type Locale } from "@/lib/i18n/locale";
import { translate, type TranslateVars } from "@/lib/i18n/translate";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(locale);
  const [seenLocale, setSeenLocale] = useState(locale);
  if (locale !== seenLocale) {
    setSeenLocale(locale);
    setCurrent(locale);
  }

  const setLocale = useCallback(
    (next: Locale) => {
      setCurrent(next);
      persistLocale(next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({ locale: current, setLocale }),
    [current, setLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LanguageContext)?.locale ?? "en";
}

export function useT() {
  const locale = useLocale();
  return useCallback(
    (message: string, vars?: TranslateVars) => translate(locale, message, vars),
    [locale],
  );
}

export function T({ children }: { children: string }) {
  const t = useT();
  return t(children);
}

export function FormattedDate({ value }: { value: string | undefined }) {
  const locale = useLocale();
  return formatDateTime(value, locale);
}

export function translateNode(node: ReactNode, locale: Locale): ReactNode {
  if (typeof node === "string") return translate(locale, node);
  if (Array.isArray(node)) return node.map((child) => translateNode(child, locale));
  return node;
}

const OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function LanguageRadio({ className }: { className?: string }) {
  const locale = useLocale();
  const setLocale = useContext(LanguageContext)?.setLocale;
  const t = useT();

  return (
    <fieldset
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs",
        className,
      )}
    >
      <legend className="sr-only">{t("Language")}</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className="inline-flex cursor-pointer items-center gap-1 font-medium"
        >
          <input
            type="radio"
            name="saltbox-language"
            value={option.value}
            className="size-3.5 accent-foreground"
            checked={locale === option.value}
            onChange={() => setLocale?.(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
