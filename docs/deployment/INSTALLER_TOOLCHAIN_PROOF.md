# Task 1: проверенные инструменты и операции

Task 1 завершена. Владелец подтвердил ручные проверки на Windows и в отдельном аккаунте Cloudflare.
Этот документ — справка для [подготовки ручной установки из ZIP](INSTALLER_TASK_3.md).

## Подтверждённые возможности и границы

Проверены OAuth с отдельным профилем, отказ доступа к рабочему аккаунту из тестового профиля, создание D1,
миграции `0001`–`0005`, чтение и параметризованная запись настроек, добавление участника, deploy/redeploy,
секреты, Telegram webhook и чтение ресурсов после нового запуска PowerShell.
В тестовом боте проверены создание, изменение и удаление расхода, история и статистика.
Redeploy сохранил секреты, настройки и историю миграций.

Локальная проба проверяет настоящую D1 через систему миграций Wrangler: новую базу, изменение настроек,
повторное применение миграций без сброса выбора, отдельную конфигурацию и dry-run сборки.
Она не проверяет переход между релизами с расходами, удалённые API или восстановление из экспорта.

Упаковка и запуск native-зависимостей на Windows проверены отдельно в [Task 2](FAMILY_RELEASE_ACCEPTANCE.md).
Полный сопровождаемый проход из ZIP, продолжение прерванного сеанса и redeploy с сохранением тестовых расходов
входят в репетицию пилота. Истечение OAuth, schema upgrade и восстановление проверяем перед использованием соответствующей операции.

## Версии

| Компонент | Проверенная Windows-конфигурация |
| --- | --- |
| Node.js | 24.13.0, входит в ZIP |
| PowerShell | 5.1.26100.9711 |
| Wrangler | 4.133.0, закреплён в package-lock.json и входит в ZIP |
| Compatibility date | 2026-09-16 |
| esbuild приложения | 0.28.2, используется при сборке разработчиком |
| esbuild Wrangler | 0.28.1, входит в ZIP как отдельная зависимость |
| workerd | 1.20260916.1, Windows native-файл входит в ZIP |

Не копировать Linux `node_modules` в Windows-пакет. Подготовка Windows toolchain описана в
[инструкции сборки](FAMILY_RELEASE_BUILD.md) и [чек-листе упаковки](FAMILY_RELEASE_ACCEPTANCE.md).
На компьютере друга не нужны npm, Git, TypeScript или исходники проекта.

## Локальная проба

Из checkout с уже установленными зависимостями:

```powershell
node scripts/probe-installer-toolchain.mjs 'K:\Programming\work\installer-task1'
```

В Linux:

```bash
node scripts/probe-installer-toolchain.mjs /workspace/work/installer-task1
```

Каждый запуск создаёт новый подкаталог `installer-task1-*` с отдельной конфигурацией, копией миграций,
локальной D1 и результатами команд. Успех: код 0 и строка `Offline probe passed...`.
Скрипт ничего не скачивает и не обращается к удалённым ресурсам; результаты не включаются в ZIP.
Это developer-проверка, не установка на компьютере друга.

## Авторизация и явный выбор ресурсов

Для Wrangler 4.133.0 проверен профиль `family-finance-installer`, созданный через `auth create`
и привязанный к рабочему каталогу через `auth activate`. `whoami --json` выполняется в этом каталоге без `--profile`.
Ресурсные команды используют `--profile family-finance-installer` и заполненный `account_id` в отдельной конфигурации.
`login` и `whoami` не принимают `--profile`. Профили помечены experimental; версия Wrangler закреплена.

Авторизация сохранилась после перезапуска PowerShell. Обращение к production account ID из тестового профиля
получило `Authentication error [code: 10000]`; перехода к production credentials не было.
OAuth хранится штатно у Wrangler. Перенос `XDG_CONFIG_HOME` не гарантирует изоляцию:
существующий `~/.wrangler` может иметь приоритет. Не подменять `HOME` и не копировать credential-файлы вручную.

Каждая ресурсная команда использует отдельный рабочий каталог, явные `--config` и пустой `--env-file`.
Для D1 явно выбираются база и `--remote` либо `--local`. Не использовать production checkout или `--env demo` для семьи.
Перед запуском исключить посторонние credential/account overrides (`CLOUDFLARE_*`, `CF_*` и аналогичные настройки),
не отключая штатный proxy/CA и проверку TLS. Пустой `account_id` Wrangler только предупреждает и игнорирует:
оператор обязан подтвердить непустой ID и привязку `DB` до записи.

## Команды и ожидаемые результаты

`W` ниже — обозначение запуска Node и Wrangler, а не готовая shell-команда.
Для ZIP это `runtime/node.exe` и `wrangler/node_modules/wrangler/bin/wrangler.js`.
Ресурсные команды дополняются явными путями конфигурации, пустого env-файла и профилем, как описано выше.
Имена и ID подставляются только после проверки выбранного аккаунта.

| Операция | Команда или API | Что подтвердить |
| --- | --- | --- |
| OAuth | `W auth create family-finance-installer`, `W auth activate family-finance-installer <instance-dir>` | Вход выполнен владельцем в браузере |
| Аккаунт | `W whoami --json` | `loggedIn`, `authType`, нужный `accounts[].id` |
| Новая D1 | `W d1 create <unique-name> --location eeur --no-update-config` | Сразу сохранить UUID, затем сверить через list |
| Список D1 | `W d1 list --json` | `uuid` и `name` выбранной базы |
| Миграции | `W d1 migrations apply <database-name> --remote`, затем `list` вместо `apply` | Ожидающие миграции применены; повтор не меняет настройки |
| История | `W d1 execute DB --remote --json --command "SELECT name FROM d1_migrations ORDER BY id"` | Имена совпадают с началом последовательности файлов пакета |
| Настройки | `W d1 execute DB --remote --json --command "SELECT id, display_currency, finance_time_zone FROM instance_settings"` | Одна валидная строка `id = 1` |
| Настройки и участники | D1 REST `POST /accounts/{account_id}/d1/database/{database_id}/query` с `{sql, params}` | Запись и отдельное чтение результата |
| Готовый Worker | `W deploy --no-bundle` | Правильный `main`, account, Worker и `DB`; HTTPS URL из вывода |
| Секреты | `W secret put TELEGRAM_BOT_TOKEN`, аналогично `TELEGRAM_WEBHOOK_SECRET` | Ввод через stdin; рабочий ответ бота после redeploy |
| Имена секретов | `W secret list --format json --name <worker-name>` | Оба ожидаемых имени без раскрытия значений |
| Deployment | `W deployments list --json` | Активный `version_id`, 100% трафика на нужную версию |
| Версия | `W versions view <version-id> --json` | Привязка D1, `APP_RELEASE_VERSION`, имена secrets |
| Telegram | `getMe`, `getWebhookInfo`, `setWebhook` | Нужный бот, `/telegram`, общий секрет и `drop_pending_updates=false` |

Task 1 размещала предварительно собранный Worker из отдельной папки. В ZIP уже есть `worker/worker.js`;
его полное развёртывание без checkout нужно подтвердить в репетиции. Не запускать сборку заново на компьютере друга.
Список имён секретов не доказывает работоспособность значений: после redeploy нужен новый запрос Telegram.
`--keep-vars` относится к обычным variables, а не к сохранению secrets.

После ошибки или timeout сначала читать состояние. Код выхода 0 не заменяет проверку результата;
при невозможности чтения исход остаётся неизвестным. Не создавать вторую базу для обхода ошибки первой.
`d1 migrations apply` не объявляет `--yes`; оператор отвечает на штатный запрос подтверждения.

## Параметризованные запросы и секреты

`d1 execute` не принимает SQL params. Для имён участников и настроек используем D1 REST с параметрами,
не конкатенацию пользовательских строк в SQL или shell. Примеры формы запросов:

```json
{
  "sql": "UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1",
  "params": ["EUR", "Europe/Belgrade"]
}
```

```json
{
  "sql": "INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, 1) ON CONFLICT(telegram_user_id) DO NOTHING",
  "params": ["<TELEGRAM_USER_ID>", "<DISPLAY_NAME>"]
}
```

Отдельный SELECT подтверждает результат. `DO NOTHING` не переименует и не включит существующего отключённого участника.
REST возвращает envelope с `success` и `result[].success`; CLI JSON содержит массив результатов.
Проверять оба уровня успеха REST, не смешивать эти форматы и не выдавать неудачную запись за успешную.

В Task 1 OAuth получали через `auth token --json` в привязанном каталоге: stdout захватывался в память без печати.
До вызова задавались `WRANGLER_WRITE_LOGS=false` и `WRANGLER_SEND_METRICS=false`.
Токены и Authorization headers не записывались в скрипт или отчёт; временные переменные очищались в `finally`.
Короткая команда для пилота должна сохранить эти свойства, скрывать ввод и не печатать token-bearing URL при ошибке Telegram.
Не просить владельца прислать сырой вывод `auth token` или ошибку с URL бота.

## Чтение установленной версии и восстановление

По account ID, database ID и Worker name можно найти базу, deployment, `DB`, настройки и миграции после нового запуска.
Для удобства ручного сопровождения разрешено сохранить также имя базы, URL и проверенный номер релиза в памятке владельца.
Перед изменениями всё сверяется с облаком. Потеря локальных файлов обрабатывается
[ручным восстановлением конфигурации](INSTALLER_TASK_3.md#если-файл-потерян).

Cloudflare version UUID и его `number` не равны релизу приложения.
`APP_RELEASE_VERSION` читается из bindings активной версии; `/health` сейчас возвращает только `status` и `service`
после проверки настроек D1. Поле версии в health не требуется для сопровождаемого пилота.
URL в проверке брали из вывода deploy; автоматическое получение URL отдельно не доказано и не нужно для ручной установки.

## Особенности Windows и провайдеров

- Новый `workers.dev` hostname временно выдавал TLS handshake error. Позже он заработал без отключения TLS.
  Оператор повторяет проверку после ожидания; ресурсы не пересоздаёт.
- PowerShell 5.1 требует UTF-8 с BOM для `.ps1` с русским текстом в проверенном окружении.
  Длинные команды удобнее запускать из такого файла без встроенных секретов.
- `d1 list` показывал `num_tables=0` и малый `file_size` при существующих таблицах.
  Эти поля не доказывают пустую базу: состояние проверяется SELECT-запросом.
- Время запуска из deploy не доказывает соответствие CPU-лимиту Free; потребление смотреть на реальной нагрузке.

## Справка провайдеров

Синтаксис проверять по справке поставляемого Wrangler, поскольку онлайн-документация может относиться к новой версии.

- [Wrangler: авторизация](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Профили](https://developers.cloudflare.com/workers/wrangler/profiles/)
- [Workers: deploy и secrets](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [D1: команды](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [D1 REST query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
