# browser — Playwright CLI (`playwright-cli`) reference

Headless branch of the hybrid: own browser, no cookies, never the user's Chrome. For own landing pages (screenshots, mobile width, dark mode, console, network) and public pages that need JS rendering. Logged-in work stays on the MCP servers — Patchright MCP in the agent's Chrome profiles, Playwright MCP on the bridge (SKILL.md). `playwright-cli` is plain Playwright: `eval` runs in the page's main world, the console arrives.

Checked live: `@playwright/cli` 0.1.22 (npm global, `playwright-core` 1.64.0-alpha), macOS, 30.09.2026 — pilot (`attach`, parallel sessions, extension incident) and a smoke of two parallel headless sessions.

## Model

- `playwright-cli <cmd>` is a thin client; each named session (`-s=<name>`) gets its own detached daemon (`cliDaemon.js <name>`) and its own browser. The daemon keeps the browser between calls, so a session outlives the agent turn — any agent or the main session can continue it by name.
- Commands map 1:1 to MCP tools (`goto` = `browser_navigate`, `fill` = `browser_type`, `type` = press-sequentially, `eval` = `browser_evaluate`, `run-code` = `browser_run_code_unsafe`). Missing vs MCP: `fill_form` (batch), `wait_for`, auto-reconnect.
- Default browser is the system Google Chrome launched `--headless` (channel `chrome`) — no `install-browser` needed. Profile is in memory unless `--persistent` / `--profile=<dir>`.
- Headless sessions close themselves after 1 h idle (`--idle-timeout`); headed/attached never do.

## Working directory

The CLI writes `.playwright-cli/page-*.yml` (auto-snapshots) and every relative `--filename` into **cwd**. Run it from a scratch dir outside any repo or the vault — the operator uses `~/.claude/operator-runs/playwright-files/cli-<slug>/`.

## Recipes

```bash
# two sessions in parallel — each its own browser, cookies isolated
playwright-cli -s=lp-ru open https://example.com &
playwright-cli -s=lp-en open https://example.org --mobile &
wait

playwright-cli -s=lp-ru snapshot --filename=lp-ru.yml          # tree to file; bare `snapshot` prints it (HN ≈ 48 KB)
playwright-cli -s=lp-ru snapshot main --depth=3                 # scoped
playwright-cli -s=lp-ru find "Pricing"                          # cheapest read; --regex "/total/i", --filename for big results
playwright-cli -s=lp-ru --raw eval "() => location.href"        # value only
playwright-cli -s=lp-ru screenshot --full-page --filename=lp-ru.webp
playwright-cli -s=lp-ru set-color-scheme dark                   # also set-reduced-motion, set-media print
playwright-cli -s=lp-ru console error
playwright-cli -s=lp-ru requests                                # then response-body <n>
playwright-cli list                                             # sessions of all workspaces: list --all
playwright-cli -s=lp-ru close ; playwright-cli -s=lp-en close   # always close what you opened
```

- Mobile: `open --mobile` (Pixel 10, 360×732) or `--device="iPhone 15"` — per session.
- Instead of `wait_for`: `run-code "async page => { await page.waitForSelector('text=Done'); }"` or an `eval` poll.
- Instead of `fill_form`: `fill` / `select` / `check` one by one, then verify with `eval`.
- `--json` and `--raw` make output scriptable; `state-save` / `state-load` move storage between sessions.
- Refs in frames carry a frame prefix (`f2e51`, not `e51`) — copy them from the snapshot as is.

## Gotchas

- **One session = one stream.** Two commands into the SAME session at once race (`Execution context was destroyed`). Parallelism is across sessions only.
- **False click error on slow navigation.** A click that starts a navigation longer than the 5 s action timeout returns rc=1 `TimeoutError … waiting for scheduled navigations to finish`, while the click did happen. Verify with `snapshot` / `--raw eval "() => location.href"` before retrying (a retry can double-submit).
- **Extension overlays eat clicks.** `<div id="immersive-translate-image-tools"> intercepts pointer events` (Immersive Translate in the user's Chrome) — raising the window does not help; on a trusted page click via JS: `eval "el => el.click()" <ref>`. Headless sessions have no user extensions, so this hits only attached Chrome.
- **Extension attach (`attach --extension=chrome`) — do not use while the MCP bridge may be up.** Two extension clients at once (CLI+CLI, and presumably CLI+MCP — same relay) hung the user's Chrome on 30.09.2026; the next attach relaunched Chrome and killed the hung one with an open window. Allowed only as a single client, when no browser operator is running.
  - In 0.1.22 the bare flag is broken: `attach --extension` → `no target specified`; use `--extension=chrome`. The token comes from `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in env (no click, ~1 s).
  - **The token leaks into stdout**: the seed tab URL `connect.html?…&token=…` is printed in every «Open tabs» listing. Never echo it into a log, report or memory — pipe output through `sed -E 's/token=[^&" )]+/token=<redacted>/g'`, and right after attach do `tab-new <url>` then `tab-close 0` (the seed) so the listing stops showing it.
  - No auto-reconnect: closing the last tab kills the session — attach again. Clean up with `detach` (not `close`, not `kill-all`) for attached sessions.
- `list --all` also lists chrome-beta/dev/canary/msedge because their data dirs exist — the apps are not installed.
- `run-code` cannot be switched off and has timers, `fetch`, `Buffer`, `crypto` — RCE-equivalent, trusted pages only.
