# TESTS.md — browser (Playwright MCP: agent Chrome over CDP + the user's Chrome over the extension bridge)

Живая зависимость: `@playwright/mcp@0.0.83` + Chrome 154. Агентские профили: `scripts/agent-chrome.sh` (в прогоне два профиля на портах 9333/9334). Мост: расширение Playwright MCP Bridge ≥0.3.0 (protocol v2).
Скрипты тестов 07.10.2026 — разовые, в репозиторий не входят (stdio MCP-клиент `mcp.mjs`).

## Агентские профили (CDP, `--cdp-endpoint`) — прогон 2026-10-07

| Capability | State | Notes |
|---|---|---|
| connect + `browser_tabs list` | PASS | ~40 ms; фокус не уходит |
| navigate / fill_form / click / type в текущей вкладке, окно перекрыто | PASS | фокус остаётся у пользователя (`--disable-backgrounding-occluded-windows` и др.) |
| `browser_tabs new` / `browser_tabs select` / `context.newPage()` | PASS, крадут фокус | поднимают Chrome — в агентских профилях не использовать |
| фоновое окно CDP `Target.createTarget {newWindow, background}` (Bash и внутри run_code через `browser().newBrowserCDPSession()`) | PASS | фокус не уходит |
| своя страница по `targetId` в run_code (`newCDPSession` → `Target.getTargetInfo`) | PASS | метка URL `#wN` пропадает после перехода |
| file upload: `setInputFiles` в run_code (любой путь) | PASS | |
| file upload: click → `browser_file_upload` | PASS | |
| `page.screenshot({path})` в run_code вне output-dir | PASS | |
| `locator('body').ariaSnapshot()` в run_code | PASS | компактная структура |
| три клиента параллельно, каждый в своём окне через run_code | PASS | `parallel3.mjs`, 1,4 с на три формы |
| `secret-relay.py serve` ×2 параллельно → `page.request.get` + `fill` | PASS | каждое поле получило своё значение; повторный GET отклонён; буфер обмена не менялся |
| `secret-relay.py receive` → `security add-generic-password` | PASS | в ответ только `{rc, length}` |
| выгруженная вкладка (chrome://discards → Urgent Discard) | FAIL без лечения | connectOverCDP висит (таймаут 25 с, playwright-mcp#1757); `agent-chrome.sh ensure` перезагружает её — PASS |
| постоянная кука после `stop` (Browser.close) → `ensure` | PASS | |
| сессионная кука после перезапуска | FAIL по умолчанию | живёт только с «Продолжить с того же места» |
| ссылка из другого приложения при трёх Chrome | PASS | открылась в основном Chrome пользователя |
| `tell application "Google Chrome"` при трёх Chrome | FAIL | адресует новейший экземпляр — поднимать Chrome пользователя по pid |
| idle-stop второго профиля | PASS | при подключённом клиенте живёт, без клиентов — `Browser.close` |
| два оператора в одном профиле: один пошагово, второй run_code по targetId | PASS | 08.10.2026, `collide.mjs`: 3 раунда одновременных кликов — каждый попал в свою вкладку, фокус не ушёл |
| три оператора-агента в одном профиле, все через run_code в своих окнах (живые логины рабочих сервисов) | PASS | 08.10.2026: 14 входов из 21 сервиса, помех между окнами нет |
| ошибка `fill` с секретом | FAIL → исправлено | текст ошибки Playwright печатает значение (`fill("…")`); шаблон `waitFor` → GET → `try/catch` с вырезанием значения — PASS, канарейка не утекла |
| Dock/ссылка, когда открыт только Chrome агента | NOT-TESTED | |

## Мост в Chrome пользователя (extension mode)

Матрица ниже прогнана на 0.0.80 (2026-09-01, локальная тест-страница + read-only GitHub); 07.10.2026 на 0.0.83 подтверждено: клик только в активной вкладке окна, подключение крадёт фокус, два MCP-клиента моста прошли один контролируемый прогон без зависания (правило «один клиент» остаётся).

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

Перед версионным бампом пина или правкой флагов сервера должны быть PASS.
- Агентский профиль: connect, navigate, fill_form, click в перекрытом окне без смены фокуса, фоновое окно + run_code по targetId, `setInputFiles`, `secret-relay.py serve`, connect при выгруженной вкладке после `ensure` (после бампа на версию с microsoft/playwright#42936 — и без `ensure`).
- Мост: tabs, navigate, find, evaluate, scoped snapshot, take_screenshot(filename), fill_form, click, wait_for-без-снапшота, close→reconnect, read-only залогиненный сайт. file_upload через мост остаётся вне гейта (известный FAIL платформы).

## Приложение на профиль и переезд на Chrome Beta — прогон 2026-11-09

| Capability | State | Notes |
|---|---|---|
| `name=port app=Google Chrome Beta` → `ensure` / `status` | PASS | Chrome/158 beta, `"app"` в `status`; строка без `app=` → Google Chrome; нет файла → `agent=9333` |
| `app=` несуществующего приложения | PASS | `open -a` падает сразу, `ensure` → `ok:false`, rc 1 |
| копия профиля Chrome 156 в Beta 158 без переноса | FAIL | 1434 куки → 0 |
| перенос кук по CDP (`Storage.getCookies` → `Storage.setCookies`) | PASS | 1431 из 1431, значения совпали по хэшу; Facebook и Allegro залогинены |
| те же куки после перезапуска Beta | PASS после правки | без «Продолжить с того же места» пропали 78 из 79 сессионных; после `settingsPrivate.setPref` — 0 потерь |


## Запуск без фокуса и расширения при старте — прогон 2026-11-10

Chrome Beta 158, тестовые профили на портах 9337/9338 (+ новый профиль на 9339 для первого старта). Переднее приложение читалось `lsappinfo front` каждые 0,5 с до, во время и после команды; никто его не менял. Автотесты: `node --test tests/` (12 PASS, Chrome не нужен).

| Capability | State | Notes |
|---|---|---|
| прежний старт `open -g` с окном при старте | FAIL | Chrome Beta выходит вперёд и остаётся (замер родительской сессии; повторно не гонял) |
| `open -g -j` | FAIL | Chrome Beta впереди ~2 с, потом приложение прячется (замер родительской сессии) |
| старт `--no-startup-window` | PASS | переднее приложение не меняется; порт отвечает; страниц нет |
| `stop` → `ensure` (новый код), 5 прогонов подряд | PASS 5/5 | 24–25 замеров на прогон, все — терминал; `boot.restored` 4/4/4/4/4; ~8 с со `stop` |
| восстановление сессии после `stop` → `ensure` | PASS | первое фоновое окно `Target.createTarget {newWindow, background}` само запускает восстановление при «Продолжить с того же места»; пустая страница закрывается, не копится (6-й прогон: 3 вкладки из 3) |
| восстановленные окна | PASS | `windowState: normal`, активная вкладка каждого окна `visibilityState: visible`, `hasFocus() false` |
| сессионная кука после `stop` → `ensure` | PASS | тестовая сессионная кука на месте во всех 6 прогонах |
| профиль без «Продолжить с того же места», без `ext=` | PASS | `boot.restored: 0`, одна `about:blank`, ключа `ext` нет; фокус не ушёл (45 замеров) |
| первый старт нового профиля | PASS | 47 замеров — терминал; одна `about:blank`; расширение загружено |
| `ensure` на работающем профиле, `window <url>`, `status` | PASS | фокус не ушёл (41 замер); `boot` нет; `ext` — `loaded: true` без `new` |
| `stop` | PASS | фокус не меняет |
| `ext=` → uBlock Origin Lite после каждого перезапуска | PASS | `Extensions.loadUnpacked`, id один и тот же; в JSON `"new":true` |
| режим сайта uBOL после перезапусков | PASS | `example.com` = `basic` выставлен до 5 перезапусков и остался `basic`; соседний сайт — `optimal` |
| `ext=` с отсутствующей папкой и относительным путём | PASS | `loaded:false` + `warning`, `ok:true`, rc 0, остальные папки грузятся |
| `open`, `front` | NOT-TESTED | не менялись; поднимают окно намеренно |
| падение Chrome → `ensure` | NOT-TESTED | восстановление после аварии не проверялось |
