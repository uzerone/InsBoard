import { type WorkflowClientMessage, type WorkflowClientMessageType } from "@insboard/shared";
import { type WSMessageReceive } from "hono/ws";

const CLIENT_MESSAGE_TYPES: readonly WorkflowClientMessageType[] = [
  "execute_plan",
  "cancel_run",
  "retry_failed",
  "ping"
];

export const WORKFLOW_WORK_MESSAGE_TYPES = new Set<WorkflowClientMessageType>([
  "execute_plan",
  "retry_failed"
]);

interface ParsedMessage {
  ok: true;
  value: WorkflowClientMessage;
}

interface MessageParseError {
  ok: false;
  code: string;
  message: string;
}

export function parseWorkflowClientMessage(data: WSMessageReceive): ParsedMessage | MessageParseError {
  if (typeof data !== "string") {
    return {
      ok: false,
      code: "invalid_workflow_message",
      message: "Workflow WebSocket messages must be JSON text."
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Workflow WebSocket message must be valid JSON."
    };
  }

  if (!isRecord(value) || typeof value.type !== "string" || !isWorkflowClientMessageType(value.type)) {
    return {
      ok: false,
      code: "invalid_workflow_message",
      message: `Workflow WebSocket message type must be one of: ${CLIENT_MESSAGE_TYPES.join(", ")}.`
    };
  }

  if (value.requestId !== undefined && typeof value.requestId !== "string") {
    return {
      ok: false,
      code: "invalid_workflow_message",
      message: "Workflow WebSocket requestId must be a string when provided."
    };
  }

  if (value.runId !== undefined && typeof value.runId !== "string") {
    return {
      ok: false,
      code: "invalid_workflow_message",
      message: "Workflow WebSocket runId must be a string when provided."
    };
  }

  return {
    ok: true,
    value: value as unknown as WorkflowClientMessage
  };
}

function isWorkflowClientMessageType(value: string): value is WorkflowClientMessageType {
  return (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
