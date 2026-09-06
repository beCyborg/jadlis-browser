# TESTS.md — browser (Playwright MCP Extension Mode)

Живая зависимость: `@playwright/mcp@0.0.80` + Chrome + расширение Playwright MCP Bridge ≥0.3.0 (protocol v2).
Последний полный прогон: 2026-09-01, локальная тест-страница + read-only GitHub.

| Capability | State | Last run | Notes |
|---|---|---|---|
| tabs list/select/new/close | PASS | 2026-09-01 | select НЕ поднимает OS-окно |
| navigate / navigate_back | PASS | 2026-09-01 | ответ без снапшота (snapshot-mode=none) |
| find (text/regex) | PASS | 2026-09-01 | regex-форму гоняли только схемой |
| evaluate (sync/async/element/filename) | PASS | 2026-09-01 | filename только в workspace roots |
| snapshot: scoped/depth/full/boxes/filename | PASS | 2026-09-01 | boxes +43% объёма |
| take_screenshot: webp/css/fullPage/filename | PASS | 2026-09-01 | fullPage 1512×2978 ок |
| fill_form (5 типов полей) | PASS | 2026-09-01 | НЕ атомарен при сбое поля |
| click / hover / drag / drop(data) | PASS | 2026-09-01 | все висят при перекрытом окне |
| drop(paths) | NOT-TESTED | — | файл-дроп снаружи; вероятная замена upload |
| type / press_key / select_option | PASS | 2026-09-01 | работают и в перекрытом окне |
| handle_dialog (alert/prompt) | PASS | 2026-09-01 | modal state в ответе |
| wait_for text — БЕЗ снапшота | PASS | 2026-09-01 | ~250 байт ответ |
| console_messages(level) | PASS | 2026-09-01 | шум чужих расширений в счётчике |
| network_requests(filter) + request(part) | PASS | 2026-09-01 | part=response-body точечный |
| run_code_unsafe (батч, force-click) | PASS | 2026-09-01 | только доверенные страницы |
| resize (viewport-only) | PASS | 2026-09-01 | OS-окно не трогает |
| close → тихий auto-reconnect | PASS | 2026-09-01 | токен-путь, без ручного Allow |
| file_upload | FAIL | 2026-09-01 | CDP DOM.setFileInputFiles «Not allowed» в extension mode — ограничение chrome.debugger, не баг конфига |
| read-only на залогиненном сайте | PASS | 2026-09-01 | GitHub, user-login виден |
| reconnect после разрыва «сайтом-убийцей» | NOT-TESTED | — | не провоцировали; auto-reconnect наблюдали после close |
| recording (--caps=devtools) | NOT-TESTED | — | opt-in, требует ручной демонстрации потока |
| --timeout-settle поведение | NOT-TESTED | — | нужен рестарт сервера с флагом |

## Gate

Перед версионным бампом пина или правкой флагов сервера должны быть PASS: tabs, navigate, find, evaluate, scoped snapshot, take_screenshot(filename), fill_form, click, wait_for-без-снапшота, close→reconnect, read-only залогиненный сайт. file_upload остаётся вне гейта (известный FAIL платформы).
