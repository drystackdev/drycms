import { path } from "./config.js";

export const CSRF_COOKIE_NAME = "drycms_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

function readCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === CSRF_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function createCsrfToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

export function csrfCookieHeader(context: { url: URL }, token: string): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${path}; SameSite=Lax${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

export function clearCsrfCookieHeader(context: { url: URL }): string {
  return `${CSRF_COOKIE_NAME}=; Path=${path}; SameSite=Lax; Max-Age=0${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

export function requiresCsrf(request: Request, segment: string, slug?: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return false;
  if (segment !== "auth") return true;
  return slug !== "login";
}

export function hasValidCsrf(request: Request): boolean {
  const cookie = readCookie(request);
  const header = request.headers.get(CSRF_HEADER_NAME);
  return !!cookie && !!header && constantTimeEqual(cookie, header);
}
