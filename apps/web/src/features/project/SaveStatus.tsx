import { type Translate } from "../../shared/i18n";

export type SaveStatus = "loading" | "saved" | "pending" | "saving" | "error";

export function saveStatusLabel(status: SaveStatus, t: Translate): string {
  switch (status) {
    case "loading":
      return t("saveStatusLoading");
    case "pending":
      return t("saveStatusPending");
    case "saving":
      return t("saveStatusSaving");
    case "error":
      return t("saveStatusError");
    case "saved":
    default:
      return t("saveStatusSaved");
  }
}
