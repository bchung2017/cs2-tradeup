/**
 * Shared contracts for the admin backend.
 *
 * These are the boundary types between the HTTP server (scripts/admin-server.ts),
 * the route table (routes.ts), and the domain services (services/*). Keeping
 * them here lets services depend on the contract without importing the route
 * table (which would be a cycle).
 */

/** Uniform JSON envelope every handler returns. */
export interface AdminResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** What a handler receives: parsed query + (for POST) parsed JSON body. */
export interface AdminRequest {
  query: URLSearchParams;
  body: unknown;
}

/** A domain handler: takes a request, returns a result (sync or async). */
export type AdminHandler = (req: AdminRequest) => Promise<AdminResult> | AdminResult;

export type AdminSection = "Pricing" | "Cache" | "Catalog" | "System";

/** Display + dispatch order of the dashboard sections. */
export const SECTIONS: AdminSection[] = ["Pricing", "Cache", "Catalog", "System"];

/** One control: transport metadata (method/path), UI metadata, and its handler. */
export interface AdminRoute {
  method: "GET" | "POST";
  /** Path under the obscure base, e.g. "/api/pricing/sync". */
  path: string;
  /** Human label shown on the dashboard button. */
  label: string;
  /** Which dashboard section this control belongs to. */
  section: AdminSection;
  /** Short description rendered under the button. */
  hint: string;
  /** Destructive controls get a confirm gate + red styling in the UI. */
  danger?: boolean;
  /** The backend handler — lives in services/*, never inline here. */
  handler: AdminHandler;
}
