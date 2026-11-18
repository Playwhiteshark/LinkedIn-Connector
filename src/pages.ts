export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

const SECURITY_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.linkedin.com; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

export function page(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1b1f24;--muted:#5b6470;--accent:#0a66c2;--line:#d9dde3}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1f25;--fg:#e8ebef;--muted:#9aa4b0;--accent:#70b5f9;--line:#2c333b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:460px;width:100%;padding:28px}
h1{font-size:1.25rem;margin:0 0 12px}p,li{color:var(--muted)}code{font-size:.9em;word-break:break-all}
button{background:var(--accent);color:#fff;border:0;border-radius:999px;padding:10px 20px;font-weight:600;font-size:1rem;cursor:pointer}
@media (prefers-color-scheme:dark){button{color:#0b1520}}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

export function consentPage(clientName: string, redirectUri: string, stateId: string): Response {
  return page(
    "Connect your LinkedIn",
    `<p><strong>${escapeHtml(clientName)}</strong> wants to act on your LinkedIn account through LinkedIn Connector.</p>
<ul><li>Read your name, photo and email</li><li>Create and delete posts as you</li></ul>
<p>Redirects back to <code>${escapeHtml(redirectUri)}</code>.</p>
<form method="post" action="/authorize"><input type="hidden" name="state_id" value="${escapeHtml(stateId)}">
<button type="submit">Continue with LinkedIn</button></form>`,
  );
}
