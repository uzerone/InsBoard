import type { AssetMetadataResponse } from "@insboard/shared";
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { CanvasDialog } from "./CanvasDialog";

export interface ImageInfo {
  nodeNumber?: number;
  localAssetId?: string;
  name: string;
  width: number;
  height: number;
  prompt?: string;
  effectivePrompt?: string;
}

export function ImageInfoDialog({ info, onClose }: { info: ImageInfo; onClose: () => void; }) {
  const { t } = useI18n();
  const [metadata, setMetadata] = useState<AssetMetadataResponse>();
  const [loading, setLoading] = useState(Boolean(info.localAssetId));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const prompt = metadata?.prompt ?? info.prompt;
  const effectivePrompt = metadata?.effectivePrompt ?? info.effectivePrompt;

  useEffect(() => {
    if (!info.localAssetId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/assets/${encodeURIComponent(info.localAssetId!)}/metadata`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        setMetadata(await response.json() as AssetMetadataResponse);
      } catch {
        if (!controller.signal.aborted) setError(t("canvasImageInfoFailed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [info.localAssetId, t]);

  return <CanvasDialog title={t("canvasImageInfo")} onClose={onClose}>
    <p className="canvas-image-info-name">{info.nodeNumber ? `${t("canvasNodeNumber", { number: info.nodeNumber })} · ` : ""}{info.name}</p>
    <p>{metadata?.width ?? info.width} × {metadata?.height ?? info.height}</p>
    {loading && <p role="status">{t("canvasImageInfoLoading")}</p>}
    {error && <p className="canvas-dialog-error" role="alert">{error}</p>}
    {prompt ? <section className="canvas-image-info-prompt">
      <h3>{t("canvasImagePrompt")}</h3>
      <p data-testid="image-info-prompt">{prompt}</p>
    </section> : !loading && !error && <p>{t("canvasImageNoPrompt")}</p>}
    {effectivePrompt && effectivePrompt !== prompt && <section className="canvas-image-info-prompt">
      <h3>{t("canvasImageEffectivePrompt")}</h3>
      <p data-testid="image-info-effective-prompt">{effectivePrompt}</p>
    </section>}
    <div className="canvas-dialog-actions">
      {prompt && <button type="button" className="secondary-action" onClick={() => {
        void navigator.clipboard.writeText(prompt).then(() => setCopied(true), () => setError(t("generationCopyFailed")));
      }}>{t(copied ? "canvasImagePromptCopied" : "canvasImageCopyPrompt")}</button>}
      <button type="button" className="secondary-action" autoFocus onClick={onClose}>{t("commonClose")}</button>
    </div>
  </CanvasDialog>;
}
