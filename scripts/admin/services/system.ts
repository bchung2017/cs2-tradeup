/**
 * System service — process/host level info (uptime, DB size, port bindings).
 * Stub for now.
 */
import { notImplemented } from "../http";
import type { AdminRequest, AdminResult } from "../types";

export function systemStatus(_req: AdminRequest): AdminResult {
  return notImplemented("system status");
}
