import { memo } from "react";
import { localizedApiErrorMessage, useI18n } from "../../shared/i18n";
import { type GenerationPlaceholderShape } from "../generation/placeholder-model";

function conciseError(message: string, fallback: string): string {
  const trimmed = message.trim() || fallback;
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

export function GenerationLoadingArt({ label, compact = false, detail }: { label: string; compact?: boolean; detail?: string; }) {
  return <div className="generation-motion" role="status" aria-label={detail ? `${label} · ${detail}` : label}>
    <svg className="generation-motion__halo" aria-hidden="true" focusable="false">
      <rect className="generation-motion__halo-tail" x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx={compact ? 5 : 11} pathLength="100" />
      <rect className="generation-motion__halo-head" x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx={compact ? 5 : 11} pathLength="100" />
    </svg>
  </div>;
}

export const GenerationPlaceholderContent = memo(function GenerationPlaceholderContent({ shape }: { shape: GenerationPlaceholderShape; }) {
  const { t, locale } = useI18n();
  const isFailed = shape.props.status === "failed";

  return (
    <div
      className={`generation-placeholder-shape ${isFailed ? "is-failed" : "is-loading"}`}
      data-generation-placeholder-status={shape.props.status}
    >
      {isFailed ? (
        <div className="generation-placeholder-shape__content generation-placeholder-shape__content--failed">
          <div className="generation-placeholder-shape__error-mark" aria-hidden="true">
            !
          </div>
          <div className="generation-placeholder-shape__title">{t("generationCanvasFailed")}</div>
          <div className="generation-placeholder-shape__copy">
            {conciseError(localizedApiErrorMessage({ fallbackMessage: shape.props.error, fallbackText: t("generationErrorDefault"), locale, status: 0, includeHttpSuffix: false }), t("generationErrorDefault"))}
          </div>
        </div>
      ) : (
        <GenerationLoadingArt label={t("generationCanvasMagicLoading")} detail={`${shape.props.targetWidth} × ${shape.props.targetHeight}`} />
      )}
    </div>
  );
});
