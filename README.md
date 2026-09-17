# Семейный финансовый бот

Telegram-бот для быстрого учёта общих семейных расходов в RSD.

Сейчас проект находится на локальном этапе: определены техническая архитектура, схема данных, категории и разбор быстрого ввода. Облачные аккаунты и секреты пока не нужны.

## Локальная проверка

```powershell
npm.cmd install
npm.cmd test
npm.cmd run check
npm.cmd run build
```

- `npm.cmd test` запускает автоматические тесты.
- `npm.cmd run check` проверяет типы Worker и тестов.
- `npm.cmd run build` собирает Worker в `dist`, но ничего не публикует.
- `npm.cmd run dev` запускает локальный Worker. Сейчас реализован только технический адрес `http://localhost:8787/health`; Telegram-обработчики ещё не подключены.

Технические решения описаны в [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md).
Порядок продолжения работы находится в [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).
