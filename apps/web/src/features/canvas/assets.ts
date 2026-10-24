import { type AssetMetadataResponse, type GeneratedAsset, type ImageSize } from "@insboard/shared";
import { type Translate } from "../../shared/i18n";
import { type TLAsset, type TLAssetStore, type TLImageShape } from "./editor/types";

export const assetMetadataCache = new Map<string, ImageSize>();

const assetMetadataRequests = new Map<string, Promise<ImageSize | undefined>>();

export const canvasAssetStore: TLAssetStore = {
  async upload(_asset, file) {
    const uploaded = await uploadCanvasAsset(file);
    return {
      src: uploaded.url
    };
  },
  resolve(asset) {
    return typeof asset.props.src === "string" ? asset.props.src : null;
  }
};

async function uploadCanvasAsset(file: File): Promise<GeneratedAsset> {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      dataUrl: await blobToDataUrl(file),
      fileName: file.name
    })
  });

  const body = (await response.json().catch(() => undefined)) as { asset?: GeneratedAsset; error?: { message?: string; }; } | undefined;
  if (!response.ok || !body?.asset) {
    throw new Error(body?.error?.message ?? "Asset upload failed.");
  }

  rememberAssetMetadata(body.asset.id, {
    width: body.asset.width,
    height: body.asset.height
  });
  return body.asset;
}

export function getLocalAssetId(asset: TLAsset | undefined, sourceUrl?: string): string | undefined {
  const localAssetId = asset?.meta && typeof asset.meta.localAssetId === "string" ? asset.meta.localAssetId : undefined;
  if (localAssetId) {
    return localAssetId;
  }

  if (!sourceUrl) {
    return undefined;
  }

  try {
    const url = new URL(sourceUrl, window.location.origin);
    if (url.origin === window.location.origin) {
      const match = /^\/api\/assets\/([^/?#]+)(?:\/(?:download|preview))?$/u.exec(url.pathname);
      return match?.[1];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function fallbackImageSize(imageShape: TLImageShape, asset: TLAsset | undefined): ImageSize {
  if (asset?.type === "image" && isUsableImageSize(asset.props)) {
    return {
      width: asset.props.w,
      height: asset.props.h
    };
  }

  return {
    width: imageShape.props.w,
    height: imageShape.props.h
  };
}

function isUsableImageSize(size: { width?: unknown; height?: unknown; w?: unknown; h?: unknown; }): boolean {
  const width = typeof size.width === "number" ? size.width : size.w;
  const height = typeof size.height === "number" ? size.height : size.h;
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

export function rememberAssetMetadata(assetId: string, size: ImageSize): void {
  if (isUsableImageSize(size)) {
    assetMetadataCache.set(assetId, size);
  }
}

export async function fetchAssetMetadata(assetId: string): Promise<ImageSize | undefined> {
  const cached = assetMetadataCache.get(assetId);
  if (cached) {
    return cached;
  }

  const existingRequest = assetMetadataRequests.get(assetId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = fetch(`/api/assets/${encodeURIComponent(assetId)}/metadata`)
    .then(async (response) => {
      if (!response.ok) {
        return undefined;
      }

      const body = (await response.json()) as AssetMetadataResponse;
      const size = {
        width: body.width,
        height: body.height
      };

      if (body.id !== assetId || !isUsableImageSize(size)) {
        return undefined;
      }

      rememberAssetMetadata(assetId, size);
      return size;
    })
    .catch(() => undefined)
    .finally(() => {
      assetMetadataRequests.delete(assetId);
    });

  assetMetadataRequests.set(assetId, request);
  return request;
}

export function fileNameWithImageExtension(name: string, mimeType: string): string {
  if (/\.(png|jpe?g|webp|gif)$/iu.test(name)) {
    return name;
  }

  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `${name}.${extension}`;
}

export async function blobToDataUrl(blob: Blob, t?: Translate): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    };
    reader.readAsDataURL(blob);
  });
}
