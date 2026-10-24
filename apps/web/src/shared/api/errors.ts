import { type Locale, type Translate, localizedApiErrorMessage } from "../i18n";

export async function readErrorMessage(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; }; };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("errorFallback", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("errorFallback", { status: response.status });
  }
}
