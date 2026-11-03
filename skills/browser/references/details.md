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

## User's Chrome (bridge) only

- File upload does not work over the bridge (chrome.debugger refuses `DOM.setFileInputFiles`). Alternatives: `browser_drop(paths: [...])` if the site accepts a drop, the site's API, or ask the user — or use an agent profile.
- The «Console: N errors» counter is full of other extensions' noise (`Unchecked runtime.lastError…`); read `browser_console_messages(level: "error")` before treating it as a signal.
- The «MV3 service worker drops the bridge every 30 s» myth is false while a tab stays attached.
- Long bridge sessions leak memory (gigabytes in the server process); when it degrades, finish the step and let the next operator run start a fresh server.
