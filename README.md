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
- `npm.cmd run dev` запускает локальный Worker: `/health` и защищённый `POST /telegram`. Для реального webhook нужны D1, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` в окружении Worker.
- `npm.cmd run demo:storage` создаёт временную локальную D1, дважды сохраняет один расход и печатает историю и статистику. В результате должны быть `firstCreated: true`, `duplicateCreated: false`, одна запись на 2490 RSD и итог статистики 2490 RSD.
- `npm.cmd run demo:application` воспроизводит оба способа добавления расхода через application-слой. Ожидаются `directCreated: true`, 15 предложенных категорий, `selectedCreated: true`, `duplicateCreated: false`, две записи в истории и 3190 RSD за предыдущий месяц.
- `npm.cmd run demo:telegram` воспроизводит локальные Telegram update fixtures с перехватом ответов Bot API. Ожидается 26 пройденных тестов: callback-форматы, отдельные сценарии бота, короткий сквозной smoke-тест, webhook-секрет и ответы при ошибках. Telegram-сеть и удалённая Cloudflare D1 не используются.

Реализованы D1 storage, application-сценарии и grammY-обработчики: доступ, оба способа создания без дубликатов, история, детали, редактирование, удаление с подтверждением и краткая статистика за предыдущий месяц. Интеграционные тесты используют временную локальную D1 и имитацию Bot API; реальная Cloudflare D1 и Telegram пока не проверялись. Навигация по месяцам и календарь — следующий шаг плана.

Технические решения описаны в [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md).
Порядок продолжения работы находится в [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).
