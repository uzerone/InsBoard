import { type AuthStatusResponse } from "@insboard/shared";
import { useCallback, useEffect, useState } from "react";
import { readErrorMessage } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";

export function useProviderStatus() {
  const { locale, t } = useI18n();
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);

  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [authError, setAuthError] = useState("");

  const loadAuthStatus = useCallback(async (signal?: AbortSignal): Promise<AuthStatusResponse | null> => {
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/status", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const status = (await response.json()) as AuthStatusResponse;
      setAuthStatus(status);
      return status;
    } catch (error) {
      if (signal?.aborted) {
        return null;
      }

      setAuthError(error instanceof Error ? error.message : t("authStatusLoadFailed"));
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsAuthLoading(false);
      }
    }
  }, [locale, t]);

  useEffect(() => {
    const controller = new AbortController();

    void loadAuthStatus(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadAuthStatus]);

  return { authStatus, isAuthLoading, authError, loadAuthStatus };
}
