import "server-only";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale";
import { translate, type TranslateVars } from "@/lib/i18n/translate";

export async function getLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    const value = jar.get(LOCALE_COOKIE)?.value;
    return isLocale(value) ? value : "en";
  } catch (error) {
    unstable_rethrow(error);
    return "en";
  }
}

export async function getTranslator() {
  const locale = await getLocale();
  const t = (message: string, vars?: TranslateVars) => translate(locale, message, vars);
  return { locale, t };
}
