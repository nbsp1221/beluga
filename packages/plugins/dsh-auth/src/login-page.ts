type PageMode = "login" | "setup";

interface LoginPageOptions {
  error?: string;
  formToken: string;
  mode: PageMode;
  next?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function loginPage(options: LoginPageOptions): string {
  const setup = options.mode === "setup";
  const title = setup ? "Set owner password" : "Welcome back";
  const description = setup
    ? "Create the password that protects this DeepSeek Harness."
    : "Enter your owner password to continue.";
  const action = setup ? "/auth/setup" : "/auth/login";
  const button = setup ? "Protect this harness" : "Continue";
  const autocomplete = setup ? "new-password" : "current-password";
  const confirmation = setup
    ? `
      <label for="confirmPassword">Confirm password</label>
      <input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
      >`
    : "";
  const next =
    options.next === undefined ? "" : `<input type="hidden" name="next" value="${escapeHtml(options.next)}">`;
  const error = options.error === undefined ? "" : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · dotdsh</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0b0d;
      color: #f4f4f5;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 20% 10%, rgba(70, 91, 255, 0.18), transparent 36rem),
        #0a0b0d;
    }
    main {
      width: min(100%, 390px);
      padding: 34px;
      border: 1px solid #27282d;
      border-radius: 18px;
      background: rgba(18, 19, 23, 0.94);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      margin-bottom: 28px;
      border-radius: 10px;
      background: #5865f2;
      font-weight: 750;
      letter-spacing: -0.04em;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.15;
      letter-spacing: -0.03em;
    }
    .description {
      margin: 10px 0 26px;
      color: #a3a3ad;
      font-size: 14px;
      line-height: 1.55;
    }
    form { display: grid; gap: 12px; }
    label {
      margin-top: 3px;
      color: #d7d7dc;
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid #34353c;
      border-radius: 10px;
      padding: 0 13px;
      background: #111216;
      color: inherit;
      font: inherit;
      outline: none;
    }
    input:focus {
      border-color: #6f78ff;
      box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
    }
    button {
      height: 44px;
      margin-top: 10px;
      border: 0;
      border-radius: 10px;
      background: #5865f2;
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #6975f5; }
    .error {
      margin: 0 0 8px;
      border: 1px solid rgba(248, 113, 113, 0.35);
      border-radius: 9px;
      padding: 10px 12px;
      background: rgba(127, 29, 29, 0.24);
      color: #fecaca;
      font-size: 13px;
      line-height: 1.4;
    }
    .footnote {
      margin: 22px 0 0;
      color: #71717a;
      font-size: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">d</div>
    <h1>${title}</h1>
    <p class="description">${description}</p>
    ${error}
    <form method="post" action="${action}">
      <input type="hidden" name="formToken" value="${escapeHtml(options.formToken)}">
      ${next}
      <label for="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="${autocomplete}"
        minlength="12"
        autofocus
        required
      >
      ${confirmation}
      <button type="submit">${button}</button>
    </form>
    <p class="footnote">dotdsh · private owner access</p>
  </main>
</body>
</html>`;
}
