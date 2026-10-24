import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { enMessages } from "./en";
import { generationErrorGuidance } from "./error-guidance";
import { commonApiErrorMessages } from "./labels";
import { type I18nMessages, type Locale, type Translate } from "./types";

const messages: Record<Locale, I18nMessages> = {
  en: enMessages
};

interface I18nContextValue {
  locale: Locale;
  t: Translate;
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode; }) {
  const locale: Locale = "en";
  const t = useMemo(() => createTranslate(locale), [locale]);
  const formatDateTime = useCallback(
    (value: string, options: Intl.DateTimeFormatOptions = defaultDateTimeOptions): string => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return new Intl.DateTimeFormat(locale, options).format(date);
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      t,
      formatDateTime
    }),
    [formatDateTime, locale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within LanguageProvider.");
  }

  return context;
}

export function localizedApiErrorMessage(input: {
  code?: string;
  fallbackMessage?: string;
  fallbackText: string;
  includeHttpSuffix?: boolean;
  locale: Locale;
  status: number;
}): string {
  const mapped = input.code ? commonApiErrorMessages[input.locale][input.code] : undefined;
  const rawFallback = input.fallbackMessage?.trim();
  const fallbackMessage = rawFallback && !/\p{Script=Han}/u.test(rawFallback) ? rawFallback : undefined;
  const guidance = generationErrorGuidance(`${input.code ?? ""} ${rawFallback ?? ""}`, input.locale, input.status);
  if (!mapped && !fallbackMessage && !guidance) {
    return input.fallbackText;
  }
  const suffix = guidance || input.includeHttpSuffix === false || input.status <= 0 ? "" : messages[input.locale].errorHttpSuffix({ status: input.status });
  return `${guidance ?? mapped ?? fallbackMessage}${suffix}`;
}

function createTranslate(locale: Locale): Translate {
  return ((key: keyof I18nMessages, params?: unknown) => {
    const value = messages[locale][key];
    if (typeof value === "function") {
      return value(params as never);
    }
    return value;
  }) as Translate;
}

const defaultDateTimeOptions: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
};

export type { Locale } from "./types";

export type { Translate } from "./types";
