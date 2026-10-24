import {
  type GenerationPlan,
  type WorkflowClientMessage,
  type WorkflowErrorEvent,
  type WorkflowServerEvent
} from "@insboard/shared";
import { type WSContext, type WSEvents, type WSMessageReceive } from "hono/ws";
import { randomUUID } from "node:crypto";
import { parseWorkflowClientMessage, WORKFLOW_WORK_MESSAGE_TYPES } from "./client-message.js";
import {
  type StoredWorkflowGenerationPlan,
  executeGenerationPlan,
  isExecutableGenerationPlan
} from "./executor.js";

const OPEN_READY_STATE = 1;

const WORKFLOW_SOCKET_SERVER_HEARTBEAT_INTERVAL_MS = 10_000;

const WORKFLOW_ACTIVE_DISCONNECT_GRACE_MS = 2 * 60 * 60 * 1000;

const WORKFLOW_IDLE_DISCONNECT_GRACE_MS = 5 * 60 * 1000;

const WORKFLOW_PENDING_EVENT_LIMIT = 500;

interface ActiveWorkflowRun {
  id: string;
  controller: AbortController;
  cancelled: boolean;
}

interface WorkflowSocketSession {
  connectionId: string;
  ws?: WSContext;
  activeRun?: ActiveWorkflowRun;
  lastExecutionRunId?: string;
  plans: Map<string, StoredWorkflowGenerationPlan>;
  previousPlan?: GenerationPlan;
  pendingEvents: WorkflowServerEvent[];
  keepAliveTimer?: ReturnType<typeof setInterval>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, WorkflowSocketSession>();

export function createWorkflowWebSocketEvents(connectionId?: string, runId?: string): WSEvents {
  const { resumeFailedRunId, session } = resolveWorkflowSocketSession(connectionId, runId);

  return {
    onOpen(_event, ws) {
      attachWorkflowSocket(session, ws);
      sendDirectEvent(ws, {
        type: "connected",
        connectionId: session.connectionId,
        timestamp: new Date().toISOString()
      });
      if (resumeFailedRunId) {
        sendSessionError(session, {
          code: "workflow_session_expired",
          message: "Workflow session expired before the browser could reconnect. Start a new Workflow run.",
          runId: resumeFailedRunId,
          recoverable: true
        });
        sendSessionEvent(session, {
          type: "run_done",
          runId: resumeFailedRunId,
          status: "failed",
          timestamp: new Date().toISOString()
        });
      }
      flushPendingSessionEvents(session);
      const completedPlan = session.previousPlan;
      if (runId && runId === session.lastExecutionRunId && !session.activeRun && completedPlan) {
        sendDirectEvent(ws, { type: "plan_updated", runId, plan: completedPlan, timestamp: new Date().toISOString() });
        sendDirectEvent(ws, { type: "run_done", runId, status: completedPlan.status === "succeeded" ? "succeeded" : completedPlan.status === "cancelled" ? "cancelled" : "failed", timestamp: new Date().toISOString() });
      }
    },
    onMessage(event, ws) {
      handleWorkflowMessage(event.data, ws, session);
    },
    onClose(_event, ws) {
      detachWorkflowSocket(session, ws, "socket_disconnected");
    },
    onError(_event, ws) {
      detachWorkflowSocket(session, ws, "socket_error");
    }
  };
}

export function closeAllWorkflowSessions(reason = "server_shutdown"): void {
  for (const session of sessions.values()) {
    cancelActiveRun(session, reason);
    disposeWorkflowSession(session);
  }
  sessions.clear();
}

function createWorkflowSocketSession(): WorkflowSocketSession {
  return {
    connectionId: randomUUID(),
    plans: new Map(),
    pendingEvents: []
  };
}

function resolveWorkflowSocketSession(
  requestedConnectionId?: string,
  requestedRunId?: string
): { session: WorkflowSocketSession; resumeFailedRunId?: string; } {
  const connectionId = requestedConnectionId?.trim();
  const runId = requestedRunId?.trim();
  if (connectionId) {
    const existingSession = sessions.get(connectionId);
    if (existingSession) {
      return { session: existingSession, resumeFailedRunId: runId && existingSession.activeRun?.id !== runId && existingSession.lastExecutionRunId !== runId ? runId : undefined };
    }
  }

  if (runId) {
    const activeRunSession = [...sessions.values()].find((session) => session.activeRun?.id === runId || session.lastExecutionRunId === runId);
    if (activeRunSession) {
      return { session: activeRunSession };
    }
  }

  const session = createWorkflowSocketSession();
  return {
    session,
    resumeFailedRunId: runId
  };
}

function attachWorkflowSocket(session: WorkflowSocketSession, ws: WSContext): void {
  clearSessionDisconnectTimer(session);
  if (session.ws && session.ws !== ws) {
    closeWorkflowSocket(session.ws, 1012, "workflow_session_replaced");
  }

  session.ws = ws;
  sessions.set(session.connectionId, session);
  startSessionKeepAlive(session);
}

function detachWorkflowSocket(session: WorkflowSocketSession, ws: WSContext, reason: string): void {
  if (session.ws !== ws) {
    return;
  }

  session.ws = undefined;
  stopSessionKeepAlive(session);
  scheduleDisconnectedSessionCleanup(session, reason);
}

function scheduleDisconnectedSessionCleanup(session: WorkflowSocketSession, reason = "socket_disconnected"): void {
  if (session.ws) {
    clearSessionDisconnectTimer(session);
    return;
  }

  clearSessionDisconnectTimer(session);
  const timeoutMs = session.activeRun ? WORKFLOW_ACTIVE_DISCONNECT_GRACE_MS : WORKFLOW_IDLE_DISCONNECT_GRACE_MS;
  session.disconnectTimer = setTimeout(() => {
    if (session.ws) {
      return;
    }

    if (session.activeRun) {
      cancelActiveRun(session, reason);
    }
    disposeWorkflowSession(session);
  }, timeoutMs);
}

function clearSessionDisconnectTimer(session: WorkflowSocketSession): void {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = undefined;
  }
}

function startSessionKeepAlive(session: WorkflowSocketSession): void {
  stopSessionKeepAlive(session);
  session.keepAliveTimer = setInterval(() => {
    const ws = session.ws;
    if (!ws) {
      return;
    }

    const heartbeat: WorkflowServerEvent = {
      type: "pong",
      requestId: `workflow-server-heartbeat-${session.connectionId}-${Date.now()}`,
      runId: session.activeRun?.id,
      timestamp: new Date().toISOString()
    };
    if (!sendDirectEvent(ws, heartbeat)) {
      detachWorkflowSocket(session, ws, "socket_send_failed");
    }
  }, WORKFLOW_SOCKET_SERVER_HEARTBEAT_INTERVAL_MS);
}

function stopSessionKeepAlive(session: WorkflowSocketSession): void {
  if (session.keepAliveTimer) {
    clearInterval(session.keepAliveTimer);
    session.keepAliveTimer = undefined;
  }
}

function disposeWorkflowSession(session: WorkflowSocketSession): void {
  clearSessionDisconnectTimer(session);
  stopSessionKeepAlive(session);
  session.pendingEvents = [];
  session.ws = undefined;
  sessions.delete(session.connectionId);
}

function closeWorkflowSocket(ws: WSContext, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // The socket may already be closed by the underlying adapter.
  }
}

function flushPendingSessionEvents(session: WorkflowSocketSession): void {
  const ws = session.ws;
  if (!ws || session.pendingEvents.length === 0) {
    return;
  }

  const events = session.pendingEvents;
  session.pendingEvents = [];
  for (let index = 0; index < events.length; index += 1) {
    if (!sendDirectEvent(ws, events[index])) {
      session.pendingEvents = events.slice(index);
      detachWorkflowSocket(session, ws, "socket_flush_failed");
      return;
    }
  }
}

function handleWorkflowMessage(data: WSMessageReceive, _ws: WSContext, session: WorkflowSocketSession): void {
  const parsed = parseWorkflowClientMessage(data);
  if (!parsed.ok) {
    sendSessionError(session, {
      code: parsed.code,
      message: parsed.message,
      recoverable: true
    });
    return;
  }

  const message = parsed.value;
  if (message.type === "ping") {
    sendSessionEvent(session, {
      type: "pong",
      requestId: message.requestId,
      runId: message.runId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (message.type === "cancel_run") {
    const cancelled = cancelActiveRun(session, "client_cancelled", message.runId);
    sendSessionEvent(session, {
      type: "run_cancelled",
      requestId: message.requestId,
      runId: cancelled.runId,
      reason: cancelled.reason,
      alreadyCancelled: cancelled.alreadyCancelled,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (WORKFLOW_WORK_MESSAGE_TYPES.has(message.type)) {
    handleWorkflowWorkMessage(message, session);
    return;
  }

  sendSessionError(session, {
    code: "unsupported_workflow_message",
    message: "Unsupported Workflow WebSocket message.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

function handleWorkflowWorkMessage(message: WorkflowClientMessage, session: WorkflowSocketSession): void {
  if (message.type === "execute_plan" || message.type === "retry_failed") {
    if (session.activeRun) {
      sendSessionError(session, {
        code: "workflow_run_in_progress",
        message: "An Workflow run is already in progress for this connection.",
        requestId: message.requestId,
        runId: session.activeRun.id,
        recoverable: true
      });
      return;
    }

    const storedPlan = resolveStoredPlanForExecution(session, message);
    if (!storedPlan) {
      sendSessionError(session, {
        code: "unknown_workflow_plan",
        message: "The requested Workflow plan is not available. Regenerate the plan or execute it from the canvas node payload.",
        requestId: message.requestId,
        runId: message.runId,
        recoverable: true
      });
      return;
    }

    const runId = message.runId ?? randomUUID();
    const activeRun: ActiveWorkflowRun = {
      id: runId,
      controller: new AbortController(),
      cancelled: false
    };
    session.activeRun = activeRun;
    session.lastExecutionRunId = runId;
    void handleWorkflowPlanExecutionMessage(message, session, activeRun, storedPlan);
    return;
  }

  sendSessionError(session, {
    code: "workflow_work_unavailable",
    message: "This Workflow action is not available in this build yet.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

async function handleWorkflowPlanExecutionMessage(
  message: Extract<WorkflowClientMessage, { type: "execute_plan" | "retry_failed"; }>,
  session: WorkflowSocketSession,
  activeRun: ActiveWorkflowRun,
  storedPlan: StoredWorkflowGenerationPlan
): Promise<void> {
  let result: Awaited<ReturnType<typeof executeGenerationPlan>>;
  try {
    result = await executeGenerationPlan({
      ...storedPlan,
      mode: message.type === "execute_plan" ? "execute" : "retry_failed",
      requestId: message.requestId,
      runId: activeRun.id,
      signal: activeRun.controller.signal,
      isRunActive: () => session.activeRun?.id === activeRun.id && !activeRun.cancelled,
      sendEvent: (event) => sendWorkflowExecutionEvent(session, event)
    });
  } catch (error) {
    if (activeRun.controller.signal.aborted || activeRun.cancelled || session.activeRun?.id !== activeRun.id) {
      return;
    }

    const messageText = error instanceof Error && error.message ? error.message : "Workflow plan execution failed.";
    sendSessionError(session, {
      code: "workflow_execution_failed",
      message: messageText,
      requestId: message.requestId,
      runId: activeRun.id,
      recoverable: true
    });
    sendSessionEvent(session, {
      type: "run_done",
      requestId: message.requestId,
      runId: activeRun.id,
      status: "failed",
      timestamp: new Date().toISOString()
    });
    session.activeRun = undefined;
    scheduleDisconnectedSessionCleanup(session);
    return;
  }

  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  session.activeRun = undefined;
  scheduleDisconnectedSessionCleanup(session);
  session.previousPlan = result.plan;
  session.plans.set(result.plan.id, {
    plan: result.plan,
    selectedReferences: storedPlan.selectedReferences
  });
  sendSessionEvent(session, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: result.status,
    timestamp: new Date().toISOString()
  });
}

function sendWorkflowExecutionEvent(session: WorkflowSocketSession, event: WorkflowServerEvent): void {
  if (event.type === "plan_updated") {
    session.previousPlan = event.plan;
  }

  sendSessionEvent(session, event);
}

function resolveStoredPlanForExecution(
  session: WorkflowSocketSession,
  message: Extract<WorkflowClientMessage, { type: "execute_plan" | "retry_failed"; }>
): StoredWorkflowGenerationPlan | undefined {
  const messagePlan = isExecutableGenerationPlan(message.plan) && message.plan.id === message.planId ? message.plan : undefined;
  const storedPlan = session.plans.get(message.planId);
  const selectedReferences =
    message.selectedReferences ?? storedPlan?.selectedReferences ?? (messagePlan ? selectedReferencesFromPlan(messagePlan) : undefined);

  if (!messagePlan) {
    return storedPlan
      ? {
        ...storedPlan,
        selectedReferences: selectedReferences ?? storedPlan.selectedReferences
      }
      : undefined;
  }

  return {
    plan: messagePlan,
    selectedReferences: selectedReferences ?? selectedReferencesFromPlan(messagePlan)
  };
}

function selectedReferencesFromPlan(plan: GenerationPlan): StoredWorkflowGenerationPlan["selectedReferences"] {
  const selectedReferences = new Map<string, StoredWorkflowGenerationPlan["selectedReferences"][number]>();
  for (const job of plan.jobs) {
    for (const reference of job.references) {
      if (reference.kind !== "selected_canvas_image" || !reference.assetId) {
        continue;
      }
      selectedReferences.set(reference.assetId, {
        id: reference.assetId,
        assetId: reference.assetId,
        label: reference.label
      });
    }
  }

  return [...selectedReferences.values()];
}

function cancelActiveRun(
  session: WorkflowSocketSession,
  reason: string,
  requestedRunId?: string
): { runId?: string; alreadyCancelled: boolean; reason: string; } {
  const activeRun = session.activeRun;
  if (!activeRun || (requestedRunId && requestedRunId !== activeRun.id)) {
    return {
      runId: requestedRunId ?? activeRun?.id,
      alreadyCancelled: true,
      reason
    };
  }

  const alreadyCancelled = activeRun.cancelled;
  if (!activeRun.cancelled) {
    activeRun.cancelled = true;
    activeRun.controller.abort(reason);
  }
  session.activeRun = undefined;

  return {
    runId: activeRun.id,
    alreadyCancelled,
    reason
  };
}

function sendSessionError(
  session: WorkflowSocketSession,
  input: Omit<WorkflowErrorEvent, "type" | "timestamp">
): void {
  sendSessionEvent(session, {
    type: "error",
    timestamp: new Date().toISOString(),
    ...input
  });
}

function sendSessionEvent(session: WorkflowSocketSession, event: WorkflowServerEvent): void {
  const ws = session.ws;
  if (ws) {
    if (sendDirectEvent(ws, event)) {
      return;
    }
    detachWorkflowSocket(session, ws, "socket_send_failed");
  }

  session.pendingEvents.push(event);
  if (session.pendingEvents.length > WORKFLOW_PENDING_EVENT_LIMIT) {
    session.pendingEvents.splice(0, session.pendingEvents.length - WORKFLOW_PENDING_EVENT_LIMIT);
  }
}

function sendDirectEvent(ws: WSContext, event: WorkflowServerEvent): boolean {
  if (ws.readyState !== OPEN_READY_STATE) {
    return false;
  }

  try {
    ws.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}
