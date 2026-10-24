import type { AuthStatusResponse } from "@insboard/shared";
import { useI18n } from "../../shared/i18n";
import { saveStatusLabel, type SaveStatus } from "../project/SaveStatus";

export function WorkspaceStatus({ authStatus, authError, isAuthLoading, saveStatus, onOpenSettings }: {
  authStatus: AuthStatusResponse | null;
  authError: string;
  isAuthLoading: boolean;
  saveStatus: SaveStatus;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const provider = isAuthLoading ? "loading" : authStatus?.provider === "openai" ? "openai" : "none";
  const apiLabel = t(isAuthLoading ? "studioApiLoading" : provider === "openai" ? "studioApiReady" : "studioApiMissing");
  const saveLabel = saveStatusLabel(saveStatus, t);
  const failed = Boolean(authError) || saveStatus === "error";
  return <button className="studio-status" data-provider={provider} data-state={failed ? "error" : "normal"}
    data-testid="workspace-status" type="button" title={authError || t("navSettings")}
    aria-label={`${apiLabel} · ${saveLabel}. ${t("navOpenProviderConfig")}`} onClick={onOpenSettings}>
    <span className="studio-status__dot" aria-hidden="true" />
    <span className="studio-status__text" role="status" aria-live="polite">
      <span data-testid="auth-provider-card">{apiLabel}</span>
      <span aria-hidden="true"> · </span>
      <span data-testid="save-status">{saveLabel}</span>
    </span>
  </button>;
}
