import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationRecord } from "@insboard/shared";
import { showGenerationCompleteNotification } from "../apps/web/src/features/generation/notifications.ts";
import type { Translate } from "../apps/web/src/shared/i18n/types.ts";

test("a denied or unavailable desktop notification never fails completed generation", () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  class BrokenNotification {
    static permission = "granted";
    constructor() { throw new Error("OS notification service unavailable"); }
  }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { Notification: BrokenNotification } });
    Object.defineProperty(globalThis, "Notification", { configurable: true, value: BrokenNotification });
    const record = { id: "completed", status: "succeeded" } as GenerationRecord;
    assert.doesNotThrow(() => showGenerationCompleteNotification(record, 1, 0, (() => "done") as Translate));
    BrokenNotification.permission = "denied";
    assert.doesNotThrow(() => showGenerationCompleteNotification(record, 1, 0, (() => "done") as Translate));
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldNotification) Object.defineProperty(globalThis, "Notification", oldNotification); else Reflect.deleteProperty(globalThis, "Notification");
  }
});
