# TESTS.md — browser (Patchright MCP: agent Chrome over CDP + Playwright MCP: the user's Chrome over the extension bridge)

Живая зависимость с 4.0.0: агентские профили — Patchright MCP из `patchright-core` (точная версия — константа в `scripts/setup.mjs`), мост — `@playwright/mcp` (там же); Chrome Beta 158. Матрица 07.10.2026 ниже прогнана на `@playwright/mcp@0.0.83` + Chrome 154. Агентские профили: `scripts/agent-chrome.sh` (в прогоне два профиля на портах 9333/9334). Мост: расширение Playwright MCP Bridge ≥0.3.0 (protocol v2).
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
- Агентский профиль: connect, navigate, fill_form, click в перекрытом окне без смены фокуса, фоновое окно + run_code по targetId, `setInputFiles`, `secret-relay.py serve` и `receive`, connect при выгруженной вкладке (Patchright — без `ensure`; `@playwright/mcp` — после `ensure`), главный мир через `page.evaluate(fn, arg, undefined, false)`, сборщик консоли через `addInitScript`, детектор утечек CDP без init-скрипта.
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

## Patchright MCP, реклама и отказ от cookies — прогон 2026-11-10

Таблицы здесь не повторяются: они лежат в отчётах потоков, сырые данные — в `~/.claude/jadlis/browser-bench/20261110-patchright/` и `…/20261110-adblock/` (машина автора). Patchright MCP 1.64.3 против `@playwright/mcp@0.0.83`, Chrome Beta 158, тестовые профили 9337/9338, затем живой профиль. Автотесты: `node --test tests/` (21 PASS: `setup.mjs`, `agent-ext.mjs`, Chrome и сеть не нужны).

| Capability | State | Где смотреть |
|---|---|---|
| набор инструментов и флаги | PASS | те же 25 имён, `--help` совпал; отчёт потока P, строки 1, 1a |
| выгруженная вкладка | PASS (лучше) | 3/3 за ~50 мс, у 0.0.83 — 0/3 (таймаут 30 с); P, строка 2b |
| консоль страницы | FAIL → обход | `console.*` и исключения не приходят, только сетевые ошибки; сборщик через `addInitScript` вернул все события; P, строка 3; живой прогон, шаг 4 |
| `browser_evaluate` в главном мире | FAIL → обход | изолированный мир; `page.evaluate(fn, arg, undefined, false)` вернул глобал и callback; P, строка 5; живой прогон, шаги 3, 3a |
| init-скрипты на `about:blank` и `data:` | PASS | работают по CDP; P, строка 4 |
| загрузка файла, скриншот, сеть, диалоги, фокус, два клиента, `route`, чистый контекст | PASS | как у 0.0.83; P, строки 6a–11 |
| `secret-relay.py serve` и `receive` | PASS | оба сервера, оба режима; P, «Проверки»; живой прогон, шаг 8 |
| Turnstile non-interactive и invisible | PASS | все пять режимов 3/3; отчёт потока M |
| Turnstile managed | PASS после одного доверенного клика | клик по координатам, токен 752 символа, при любом драйвере; M, раунд 5 |
| полностраничная проверка Cloudflare | как у 0.0.83 | scrapingcourse проходит сама, заставка nopecha просит клик при любом драйвере; M |
| sannysoft, reCAPTCHA v3 | как у 0.0.83 | 31/31, 0.9; M |
| детекторы утечек CDP (rebrowser, deviceandbrowserinfo, Brotector) | PASS (лучше) | Patchright чист, 0.0.83 пойман на всех трёх; M |
| детектор при `--init-script` | FAIL | `documentInterception` красный, без init-скрипта зелёный 21/21; живой прогон, «Что не так» — поэтому отказ от cookies стал расширением |
| баннер cookies: отказ | PASS | onet, t-online, sinoptik — отказ за 0.7–2.1 с на обоих драйверах; отчёт adblock-A; живой прогон, шаг 6 |
| uBOL в профиле: режим Optimal, режим сайта | PASS | живой прогон, шаг 7 |
| `setup.mjs`: настоящая установка в пустой HOME | PASS | рантайм 1.64.3 с lock-файлом, uBOL — sha256 совпал с digest релиза, расширение собрано, `ext=` в обеих строках; повтор — `changed: []`; отчёт R4 |
| фокус при работе Patchright | PASS | живой прогон, шаг 2: впереди терминал до, во время и после |

Отчёты: `~/.claude/jadlis/cld/reports/20261110-patchright-P.md` (матрица), `…-patchright-M.md` (детекторы и капчи), `…-patchright-live-jadlis.md` (живой профиль), `…-launcher-L.md` (запуск без фокуса), `…-adblock-A.md` (сборка autoconsent), `…-patchright-R4.md` (плагин).
