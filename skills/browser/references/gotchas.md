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

