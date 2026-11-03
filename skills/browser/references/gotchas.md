# browser — ловушки

## Мост и доступ

**«Extension not found» часто означает отсутствие Full Disk Access, а не отсутствие расширения**
Playwright MCP (Extension Mode) на preflight сканирует `~/Library/Application Support/Google/Chrome/Default/Extensions/`.
Без FDA у процесса-хоста readdir даёт `Operation not permitted`, и сервер ложно репортит
«Playwright Extension not found … install it», хотя расширение `mmlmfjhmonkocbjadbfplnigmagldckm` установлено.
`ls -d` на каталог проходит, а перечисление содержимого — нет, поэтому диагноз неочевиден.
Проверка: `ls ~/Library/Safari` (или readdir Extensions) из Bash без сандбокса. Панель открыть:
`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`; программного запроса FDA
в macOS нет (уведомление не приходит). Не советовать переустановку расширения, пока FDA не подтверждён.

**TCC-контекст держит tmux-сервер**
Перезапуск `claude` внутри старого tmux (-CC) FDA не даёт. Но включение тумблера FDA в System Settings
подхватилось живым деревом процессов без рестарта (2026-08-25: `ls ~/Library/Safari` → OK, мост заработал
сразу) — `tmux kill-server` не понадобился.


## Агентские профили (CDP, с 3.0.0)

**Подключение висит без ошибки — выгруженная или упавшая вкладка в профиле**
`@playwright/mcp` 0.0.83 зависает в `connectOverCDP`, если в профиле есть вкладка, выгруженная Chrome (Memory Saver, chrome://discards) или с упавшим рендерером (playwright-mcp#1757; исправления microsoft/playwright#42936, #43075 ещё не в пине). Воспроизведено 07.10.2026: одна выгруженная вкладка → таймаут 25 с. `agent-chrome.sh ensure|status <profile>` находит такие вкладки (attach + `Runtime.evaluate` с таймаутом), перезагружает их в фоне, а не ожившие закрывает. В профилях выключать «Экономию памяти».

**`ensure` отвечает «runs but port does not answer»**
Процесс Chrome профиля жив, а порт молчит (завис или запущен без флага). Второй запуск того же профиля только откроет окно в первом процессе — сначала `agent-chrome.sh stop <profile>` (Browser.close, затем kill).

**AppleScript попадает не в тот Chrome**
У трёх экземпляров один bundle id `com.google.Chrome`; `tell application "Google Chrome"` адресует новейший экземпляр — обычно профиль агента. Chrome пользователя поднимать по pid процесса без `--user-data-dir`: `pgrep -f 'Google Chrome.app/Contents/MacOS/Google Chrome$'`. Ссылки из других приложений (07.10.2026, три экземпляра) уходят в Chrome пользователя.

## Перенос входа из своего Chrome в профиль агента

**Не каждый сайт принимает скопированную сессию.** 08.10.2026: куки входа скопировали из Chrome пользователя в профиль агента для 13 доменов; вход заработал на 9. Два сайта получили все куки, включая `__Secure-next-auth.session-token`, но в профиле агента остались гостями. Сразу после этого один из них оказался разлогинен и в Chrome пользователя; было ли это последствием переноса, не установлено. Перед переносом проверять вход в Chrome пользователя (сессионный эндпоинт через `page.request.get`), после — в обоих браузерах. Сайтам, которые не приняли сессию, — ручной вход через `agent-chrome.sh open <профиль>`.
