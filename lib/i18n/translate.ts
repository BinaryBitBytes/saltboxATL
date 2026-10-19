import { ES } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

export type TranslateVars = Record<string, string | number>;

function normalize(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

export function translate(
  locale: Locale,
  message: string,
  vars?: TranslateVars,
): string {
  const normalized = normalize(message);
  if (!normalized) return message;
  const template = locale === "es" ? (ES[normalized] ?? message) : message;
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : "",
  );
}
