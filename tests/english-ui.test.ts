import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationRecord } from "@insboard/shared";
import { generationFailureMessage } from "../apps/web/src/features/generation/records.ts";
import { enMessages } from "../apps/web/src/shared/i18n/en.ts";
import { generationErrorGuidance } from "../apps/web/src/shared/i18n/error-guidance.ts";
import type { Translate } from "../apps/web/src/shared/i18n/types.ts";

const t = ((key: keyof typeof enMessages) => enMessages[key]) as Translate;

test("legacy Chinese generation errors produce English feedback", () => {
  const record = { outputs: [], error: "旧版本无法完成操作" } as unknown as GenerationRecord;
  assert.equal(generationFailureMessage(record, t), enMessages.generationNoSuccessfulImage);
  assert.match(generationErrorGuidance("请求超时", "en")!, /timed out/);
  record.outputs = [{ id: "failed", status: "failed", error: "旧版本无法完成操作" }];
  const translated = ((key: keyof typeof enMessages, params: never) => {
    const value = enMessages[key];
    return typeof value === "function" ? (value as (params: never) => string)(params) : value;
  }) as Translate;
  assert.doesNotMatch(generationFailureMessage(record, translated), /\p{Script=Han}/u);
});
