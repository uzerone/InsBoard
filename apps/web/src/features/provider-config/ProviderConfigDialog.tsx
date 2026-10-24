import {
  IMAGE_MODEL,
  type AuthStatusResponse,
  type ProviderConfigResponse,
  type SaveProviderConfigRequest
} from "@insboard/shared";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

interface ProviderConfigDialogProps {
  onClose: () => void;
  onRefreshAuthStatus: () => Promise<AuthStatusResponse | null>;
}

interface LocalProviderFormState {
  apiKey: string;
  baseUrl: string;
}

const defaultBaseUrl = "https://api.openai.com/v1";

export function ProviderConfigDialog({ onClose, onRefreshAuthStatus }: ProviderConfigDialogProps) {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<ProviderConfigResponse | null>(null);
  const [form, setForm] = useState<LocalProviderFormState>({ apiKey: "", baseUrl: defaultBaseUrl });
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const hasSavedLocalKey = Boolean(config?.localOpenAI.apiKey.hasSecret);

  const loadProviderConfig = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/provider-config", { signal });
      if (!response.ok) throw new Error(await readProviderConfigError(response, locale, t));
      const body = (await response.json()) as ProviderConfigResponse;
      if (signal?.aborted) return;
      setConfig(body);
      setIsReplacingKey(false);
      setForm({
        apiKey: "",
        baseUrl: body.localOpenAI.baseUrl || defaultBaseUrl
      });
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : t("providerConfigLoadFailed"));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    const controller = new AbortController();
    void loadProviderConfig(controller.signal);
    return () => {
      controller.abort();
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [loadProviderConfig]);

  useEffect(() => {
    if (isReplacingKey) keyRef.current?.focus();
  }, [isReplacingKey]);

  function updateForm(patch: Partial<LocalProviderFormState>): void {
    setForm((current) => ({ ...current, ...patch }));
    setError("");
  }

  async function saveProviderConfig(): Promise<void> {
    if (!config || isSaving) return;
    const baseUrl = form.baseUrl.trim() || defaultBaseUrl;
    try {
      const url = new URL(baseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      setError(t("settingsAddressInvalid"));
      return;
    }
    if (isReplacingKey && !form.apiKey.trim()) {
      setError(t("settingsReplacementRequired"));
      keyRef.current?.focus();
      return;
    }
    setIsSaving(true);
    setError("");
    const apiKey = form.apiKey.trim();
    const body: SaveProviderConfigRequest = {
      sourceOrder: config.sourceOrder,
      localOpenAI: {
        apiKey,
        preserveApiKey: !apiKey && hasSavedLocalKey,
        baseUrl,
        model: config.localOpenAI.model || IMAGE_MODEL,
        timeoutMs: config.localOpenAI.timeoutMs
      }
    };
    try {
      const response = await fetch("/api/provider-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await readProviderConfigError(response, locale, t));
      await onRefreshAuthStatus();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("providerConfigSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="provider-config-title" className="provider-config-dialog provider-config-dialog--simple" data-testid="provider-config-dialog"
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveProviderConfig();
        }
      }}
      onCancel={(event) => { event.preventDefault(); if (!isSaving) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || isSaving) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <form onSubmit={(event) => { event.preventDefault(); void saveProviderConfig(); }} noValidate>
        <header className="provider-config-dialog__header">
          <h2 id="provider-config-title">{t("navSettings")}</h2>
          <button aria-label={t("providerCloseConfig")} className="provider-config-dialog__close" disabled={isSaving} type="button" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="provider-config-dialog__body" aria-busy={isLoading}>
          {isLoading ? <p className="settings-hint" role="status">{t("providerConfigLoading")}</p> : config && <section aria-label={t("settingsImageApi")} data-testid="provider-image-panel">

            <fieldset className="settings-fields" disabled={isSaving}>
              <div className="settings-row settings-row--key">
                <span>API Key</span>
                {hasSavedLocalKey && !isReplacingKey ? <div className="settings-key-status">
                  <span><Check size={14} aria-hidden="true" />{t("settingsKeySaved")}</span>
                  <button className="settings-text-button" type="button" data-testid="provider-replace-key" onClick={() => setIsReplacingKey(true)}>{t("settingsReplaceKey")}</button>
                </div> : <div className="settings-key-entry">
                  <input ref={keyRef} id="provider-api-key" aria-label="API Key" autoComplete="off" spellCheck={false} type="password" className="provider-field__control" data-testid="provider-local-api-key" placeholder="sk-…" value={form.apiKey} onChange={(event) => updateForm({ apiKey: event.target.value })} />
                  {isReplacingKey && <button className="settings-text-button" type="button" onClick={() => { updateForm({ apiKey: "" }); setIsReplacingKey(false); }}>{t("settingsCancelReplacement")}</button>}
                </div>}
              </div>
              <label className="settings-row"><span>{t("settingsAddress")}</span><input autoComplete="off" spellCheck={false} type="url" className="provider-field__control" data-testid="provider-local-base-url" placeholder={defaultBaseUrl} value={form.baseUrl} onChange={(event) => updateForm({ baseUrl: event.target.value })} /></label>
            </fieldset>
            {config.activeSource?.id === "env-openai" && <p className="settings-source">{t("settingsEnvironmentActive")}</p>}

          </section>}
          {error && <p className="settings-error" role="alert">{error}</p>}
          {!isLoading && !config && <button className="settings-text-button" type="button" onClick={() => void loadProviderConfig()}>{t("providerRefresh")}</button>}
        </div>
        <footer className="provider-config-dialog__footer">

          <button className="primary-action" data-testid="provider-config-save" disabled={isLoading || isSaving || !config} type="submit">{isSaving ? t("saveStatusSaving") : t("providerSave")}</button>
        </footer>
      </form>
    </dialog>, document.querySelector(".app-root") ?? document.body
  );
}

async function readProviderConfigError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; }; };
    return localizedApiErrorMessage({ code: body.error?.code, fallbackMessage: body.error?.message, fallbackText: t("providerConfigRequestFailed", { status: response.status }), locale, status: response.status });
  } catch {
    return t("providerConfigRequestFailed", { status: response.status });
  }
}
