export class ProjectStoreUnavailableError extends Error {
  readonly code = "project_unavailable";
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectStoreUnavailableError";
    this.cause = cause;
  }
}

export class ProjectSnapshotOverwriteRejectedError extends Error {
  readonly code = "project_snapshot_overwrite_rejected";
}
