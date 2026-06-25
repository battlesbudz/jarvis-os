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
  <title>Signed In - JARVIS</title>
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
    <p>Taking you back to JARVIS...</p>
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

export function createMobileAuthImplicitCallbackHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Finishing Sign In - JARVIS</title>
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
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" id="icon">OK</div>
    <h2 id="title">Finishing sign-in</h2>
    <p id="message">Return to Jarvis when this finishes.</p>
  </div>
  <script>
    (async function () {
      var params = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      var accessToken = params.get('access_token');
      var state = params.get('state');
      var error = params.get('error');
      var icon = document.getElementById('icon');
      var title = document.getElementById('title');
      var message = document.getElementById('message');

      function fail(text) {
        icon.textContent = 'X';
        title.textContent = 'Sign-in failed';
        message.textContent = text || 'Return to Jarvis and try again.';
      }

      if (error) return fail(error);
      if (!accessToken || !state) return fail('Google did not return the expected sign-in token.');

      try {
        var res = await fetch('/api/auth/mobile/implicit-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: accessToken, state: state })
        });
        if (!res.ok) {
          var data = await res.json().catch(function () { return {}; });
          return fail(data.error || 'Jarvis could not finish sign-in.');
        }
        icon.textContent = 'OK';
        title.textContent = 'Signed in successfully';
        message.textContent = 'Return to Jarvis to continue.';
      } catch (e) {
        fail('Jarvis could not be reached. Return to Jarvis and try again.');
      }
    })();
  </script>
</body>
</html>`;
}
