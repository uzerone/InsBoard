import { isRecord } from "../../shared/validation";
import { type TLEditorSnapshot, type TLStoreSnapshot } from "../canvas/editor/types";
import { GENERATION_PLACEHOLDER_TYPE } from "../generation/placeholder-model";

export type PersistedSnapshot = TLEditorSnapshot | TLStoreSnapshot;

export function isPersistedSnapshot(value: unknown): value is PersistedSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoadingGenerationPlaceholderRecord(value: unknown): boolean {
  const props = isRecord(value) && isRecord(value.props) ? value.props : undefined;
  const requestId = typeof props?.requestId === "string" ? props.requestId : "";

  return (
    isRecord(value) &&
    value.typeName === "shape" &&
    value.type === GENERATION_PLACEHOLDER_TYPE &&
    props !== undefined &&
    props.status === "loading" &&
    (requestId.startsWith("agent-") || /^\d+$/u.test(requestId))
  );
}

function isLegacyPlanNodeSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.typeName === "shape" && value.type === "agent-plan-node";
}

function filterLoadingPlaceholdersFromStoreSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.store)) {
    return snapshot;
  }

  let changed = false;
  const nextStore: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(snapshot.store)) {
    if (isLoadingGenerationPlaceholderRecord(record)) {
      changed = true;
      continue;
    }

    if (isLegacyPlanNodeSnapshotRecord(record)) {
      changed = true;
      continue;
    }

    nextStore[id] = record;
  }

  return changed ? ({ ...snapshot, store: nextStore } as TSnapshot) : snapshot;
}

export function filterLoadingPlaceholdersFromSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  if (isRecord(snapshot.document)) {
    const document = filterLoadingPlaceholdersFromStoreSnapshot(snapshot.document);
    return document === snapshot.document ? snapshot : ({ ...snapshot, document } as TSnapshot);
  }

  return filterLoadingPlaceholdersFromStoreSnapshot(snapshot);
}
