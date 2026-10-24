import { type GenerationRecord } from "@insboard/shared";
import { type Translate } from "../../shared/i18n";

export function showGenerationCompleteNotification(record: GenerationRecord, insertedCount: number, failedCount: number, t: Translate): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const isPartial = record.status === "partial" || failedCount > 0;
  const body = isPartial ? t("generationInsertedPartialBody", { inserted: insertedCount, failed: failedCount }) : t("generationImageInserted", { count: insertedCount });

  try {
    new Notification(isPartial ? t("generationNotificationPartialTitle") : t("generationNotificationTitle"), {
      body,
      icon: "/app-icon.png",
      tag: `generation-${record.id}`
    });
  } catch {
    // Optional notifications must not turn a completed generation into an error.
  }
}
