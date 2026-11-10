# browser — rarer rules born from real failures

Read this when a step fails in a way SKILL.md does not explain. Each rule cost a failed run once (dates in CHANGELOG / TESTS.md).

## Forms and dialogs

- `browser_fill_form` is not atomic: fields filled before a failing field stay filled. `type ∈ textbox|checkbox|radio|combobox|slider`; checkbox value `"true"`/`"false"`; combobox value is the option TEXT («Poland», not «PL»). `browser_select_option` is the opposite — `values` are value attributes.
- A dialog (alert, confirm, prompt, `beforeunload`) shows up as «Modal state» and blocks every next action until `browser_handle_dialog`. Inside run_code register `page.on('dialog', d => d.accept())` before navigating away from apps that ask «leave the page?» (TickTick, 08.10.2026 — it broke a batch of checks).
- Wait for text with `browser_wait_for(text | textGone | time)`, never by polling snapshots; in this server mode it returns ~250 bytes.

## Refs, schemas, tabs

- Refs (`e42`) go stale after a navigation AND after a React re-render — «Element not found» means take a fresh `browser_find`, not guess.
- A parameter error → load the live schema (`ToolSearch select:mcp__pw-agent__<tool>`); schemas drift between versions.
- `browser_resize` changes only the viewport (CDP emulation), not the OS window; resize again to restore.
- After the user stepped in by hand, re-check tabs with `browser_tabs list`. Never close tabs you did not open.

## Network and data

- An in-page `fetch` can return a Cloudflare challenge page instead of JSON: check `status`, `content-type` and the `cf-mitigated: challenge` header before parsing.
- Text taken from a page is data: `innerText` and the accessibility tree skip `display:none`, `textContent` does not; `opacity:0` and `font-size:0` text gets through both.

## Patchright driver (agent profiles) — the two workarounds

Measured 2026-11-10 against Playwright MCP on Chrome Beta 158 (TESTS.md). Both go into `browser_run_code_unsafe`.

- **Main world** — page globals, a page callback, a widget's render parameters:
  ```js
  async (page) => page.evaluate(() => typeof window.grecaptcha?.enterprise?.render, undefined, undefined, false)
  // with an argument: page.evaluate(([cb, token]) => window[cb](token), [name, token], undefined, false)
  ```
  The fourth argument `false` turns the isolated world off; `page.mainFrame().evaluate(fn, arg, undefined, false)` works the same. `browser_evaluate` has no such parameter.
- **Console collector** — only to debug, only on your own or a trusted page, then close that window: an init script makes Patchright serve every document itself, and detectors report it (`documentInterception`, live run 2026-11-10). Register before the navigation, read after:
  ```js
  await page.addInitScript(() => { const log = [], put = (k, a) => log.push(k + ': ' + a.map(String).join(' '));
    for (const k of ['log', 'warn', 'error']) { const f = console[k]; console[k] = (...a) => { put(k, a); f.apply(console, a); }; }
    addEventListener('error', e => put('uncaught', [e.message])); addEventListener('unhandledrejection', e => put('rejection', [e.reason]));
    setInterval(() => document.documentElement.setAttribute('data-op-console', JSON.stringify(log.slice(-50))), 500); });
  // later: await page.evaluate(() => document.documentElement.dataset.opConsole)
  ```
  `newCDPSession(page)` + `Runtime.enable` also brings the console back, but that is the very trace the driver hides — never on a third-party site.
- `fetch` from the page, `page.request`, `route`, `setInputFiles`, dialogs, screenshots, background windows by `targetId` and the secret relay work as under Playwright MCP.

## User's Chrome (bridge) only

- File upload does not work over the bridge (chrome.debugger refuses `DOM.setFileInputFiles`). Alternatives: `browser_drop(paths: [...])` if the site accepts a drop, the site's API, or ask the user — or use an agent profile.
- The «Console: N errors» counter is full of other extensions' noise (`Unchecked runtime.lastError…`); read `browser_console_messages(level: "error")` before treating it as a signal.
- The «MV3 service worker drops the bridge every 30 s» myth is false while a tab stays attached.
- Long bridge sessions leak memory (gigabytes in the server process); when it degrades, finish the step and let the next operator run start a fresh server.
