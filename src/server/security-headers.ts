/** Admin-shell CSP. Previewed tenant code runs in sandboxed, opaque-origin
 * iframes; blob scripts/workers remain necessary for the in-browser TSX
 * compiler and editor language service. */
export const ADMIN_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join("; ");
