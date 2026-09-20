# Семейный финансовый бот

Telegram-бот для быстрого учёта общих семейных расходов в RSD.

Бот работает в Telegram, а Worker развёрнут в Cloudflare с удалённой D1. Можно добавлять, просматривать, редактировать и удалять расходы, а также смотреть статистику за месяц или выбранный период.

## Локальная проверка

```powershell
npm.cmd install
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run demo:webhook
```

- `npm.cmd test` запускает автоматические тесты.
- `npm.cmd run check` проверяет типы Worker и тестов.
- `npm.cmd run build` собирает Worker в `dist`, но ничего не публикует.
- `npm.cmd run dev` запускает локальный Worker: `/health` и защищённый `POST /telegram`. Для реального webhook нужны D1, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` в окружении Worker.
- `npm.cmd run demo:storage` создаёт временную локальную D1, дважды сохраняет один расход и печатает историю и статистику. В результате должны быть `firstCreated: true`, `duplicateCreated: false`, одна запись на 2490 RSD и итог статистики 2490 RSD.
- `npm.cmd run demo:application` воспроизводит оба способа добавления расхода через application-слой. Ожидаются `directCreated: true`, 15 предложенных категорий, `selectedCreated: true`, `duplicateCreated: false`, две записи в истории и 3190 RSD за предыдущий месяц.
- `npm.cmd run demo:telegram` воспроизводит локальные Telegram update fixtures с перехватом ответов Bot API. Ожидаются 32 пройденных теста, в том числе отчёт за месяц, кнопки навигации, нижняя граница января 2026 года и календарь с диапазоном через границу месяца. Telegram-сеть и удалённая Cloudflare D1 не используются.
- `npm.cmd run demo:webhook` запускает Worker в Miniflare с чистой временной D1, применяет миграцию, добавляет только тестового участника и отправляет HTTP-запросы на `/telegram`. Второй локальный Worker перехватывает все исходящие вызовы Telegram API. Ожидается 1 пройденный сквозной тест: `401` без правильного секрета, оба способа добавления, повторный тап без дубликата, история, редактирование всех полей, удаление и статистика. `npm.cmd run dev`, реальные Telegram и удалённая D1 в этой команде не участвуют.

Локальные интеграционные тесты используют временную D1 и имитацию Telegram Bot API; команды выше не обращаются к развёрнутому боту и удалённой базе. Автоматическая проверка production-окружения в них не входит.

Технические решения описаны в [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md).
