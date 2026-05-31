export type MobileAuthReturnTarget = "native" | "web";

export function createMobileAuthSuccessHtml(
  token: string,
  options: { returnTarget?: MobileAuthReturnTarget } = {},
): string {
  const returnTarget = options.returnTarget ?? "native";
  const encodedToken = encodeURIComponent(token);
  const tokenJson = JSON.stringify(token);
  const originFallback = `/login?auth_complete=1#auth_token=${encodedToken}`;
  const nativeScript = returnTarget === "native"
    ? `
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'gameplan-auth-token', token: ${tokenJson} }, window.location.origin);
        window.close();
      }
    } catch(e) {}
    try {
      window.location.href = 'gameplan://auth/complete?token=${encodedToken}';
    } catch(e) {}
    setTimeout(function () {
      try {
        window.location.replace('${originFallback}');
      } catch(e) {}
    }, 800);`
    : `
    try {
      window.location.replace('${originFallback}');
    } catch(e) {
      window.location.href = '${originFallback}';
    }`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signed In - GamePlan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card { text-align: center; max-width: 340px; }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #888; font-size: 15px; line-height: 1.5; }
    .dots { display: inline-flex; gap: 6px; margin-top: 24px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
           animation: pulse 1.2s ease-in-out infinite; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">OK</div>
    <h2>Signed in successfully</h2>
    <p>Taking you back to GamePlan...</p>
    <div class="dots">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  </div>
  <script>${nativeScript}
  </script>
</body>
</html>`;
}
