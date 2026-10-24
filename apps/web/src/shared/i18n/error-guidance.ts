type ErrorKind = "key" | "model" | "quota" | "rate" | "policy" | "network" | "timeout" | "server" | "size" | "reference" | "endpoint" | "permission" | "cancelled";

const guidance: Record<"en", Record<ErrorKind, string>> = {
  en: {
    key: "The API key is invalid or expired. Check the key for this service in Settings, then try again.",
    model: "This service cannot find the model, or your account cannot access it. Use the provider's exact model ID in Settings, including casing, rather than its display name.",
    quota: "The service has insufficient quota. Check your provider balance or usage limit before retrying.",
    rate: "The service is rate limiting requests. Wait briefly or reduce simultaneous image generation.",
    policy: "The service declined this request under its content rules. Review the prompt and reference images against the provider's requirements and adjust the request.",
    network: "Cannot connect to the generation service. Check your network and the API address in Settings, then retry.",
    timeout: "The generation service timed out. Retry later, or reduce resolution or image count.",
    server: "The generation service is temporarily unavailable. Retry later; check the provider's status if it persists.",
    size: "This model does not support the selected size. Adjust the aspect ratio or resolution and try again.",
    reference: "The service could not read the reference images or they exceeded its limits. Check formats, file sizes, and the provider's reference count limit.",
    endpoint: "The API endpoint was not found. Check the API address and whether the service supports image generation.",
    permission: "Your account does not have access. Check provider permissions, model access, and the API key's project.",
    cancelled: "Generation was cancelled. Start a new request when ready."
  }
};

export function generationErrorGuidance(message: string, locale: "en", status = 0): string | undefined {
  const text = message.toLowerCase();
  const httpStatus = status || Number(/^\s*(?:error:?\s*)?(4\d\d|5\d\d)\b/u.exec(text)?.[1] ?? 0);
  let kind: ErrorKind | undefined;
  if (/content.?policy|safety|moderation|content_filter|内容.*(?:限制|审核)|安全策略/u.test(text)) kind = "policy";
  else if (/insufficient_quota|quota.*(?:exceed|insufficient)|billing|credit.*(?:insufficient|exhaust)|余额不足|额度不足/u.test(text)) kind = "quota";
  else if (/model.*(?:not exist|not found|not available|access|unknown)|model_not_found|invalid model|模型.*(?:不存在|找不到)/u.test(text)) kind = "model";
  else if (httpStatus === 401 || /invalid_api_key|incorrect api key|invalid.*api.?key|unauthorized|authentication/u.test(text)) kind = "key";
  else if (httpStatus === 429 || /rate.?limit|too many requests|限流/u.test(text)) kind = "rate";
  else if (httpStatus === 408 || httpStatus === 504 || /timeout|timed out|etimedout|超时/u.test(text)) kind = "timeout";
  else if (/failed to fetch|network|econnrefused|econnreset|enotfound|fetch failed|无法连接/u.test(text)) kind = "network";
  else if (/size.*(?:unsupported|invalid)|invalid.*(?:size|dimension)|dimensions.*(?:not supported|invalid)|尺寸.*(?:不支持|无效)/u.test(text)) kind = "size";
  else if (httpStatus === 413 || /invalid_image|image.*(?:too large|unsupported format)|too many (?:reference )?images|参考图.*(?:超过|格式)/u.test(text)) kind = "reference";
  else if (httpStatus === 403) kind = "permission";
  else if (httpStatus === 404) kind = "endpoint";
  else if (httpStatus >= 500 || /service unavailable|internal server error|bad gateway/u.test(text)) kind = "server";
  else if (/\bcancelled\b|\bcanceled\b|已取消/u.test(text)) kind = "cancelled";
  return kind ? guidance[locale][kind] : undefined;
}
