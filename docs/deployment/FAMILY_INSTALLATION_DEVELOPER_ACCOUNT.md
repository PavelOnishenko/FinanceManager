# Установка семейного бота в Cloudflare-аккаунте разработчика

Разработчик выполняет установку на своём компьютере Windows x64 в PowerShell 5.1 или новее.
Для новой семьи создаются отдельные Worker, D1 и Telegram-бот. Друг пользуется только Telegram,
подтверждает валюту, IANA часовой пояс и двух участников. Он согласен, что разработчик имеет административный доступ к базе.
Разработчик может создать бота через свой официальный **@BotFather** и хранит средства администрирования у себя.

Используйте универсальный ZIP со встроенными Node **24.13.0** и Wrangler **4.133.0**, содержащий эту инструкцию.
Ни данные установки, ни секреты в репозиторий или исходный ZIP не добавляются.
Команды и их порядок взяты из проверенной FAMILY_INSTALLATION.md: предыдущие Task 4 и Task 5 завершены.
Это отдельный сценарий; его подготовка и локальные проверки ещё не доказывают успешную живую установку.
Отчёты предыдущих установок остаются историческими записями.

До сеанса согласуйте с другом настройки и время проверки в Telegram. Подготовьте проверенный существующий OAuth-профиль
своего Cloudflare-аккаунта. Не выполняйте новый login, logout или создание профиля поверх работающей авторизации.
Папка распаковки каждый раз новая и случайная; постоянные именованные папки семей не нужны.

Если команды выполняет помощник, перед сетевыми обращениями он объясняет, какие ресурсы читает или меняет,
и получает явное разрешение разработчика по AGENTS.md. При самостоятельном выполнении вы сами подтверждаете выбранную цель.
Разрешение на Git или локальную сборку не разрешает Cloudflare и Telegram.
Можно согласовать конкретную группу команд следующего шага; при смене цели согласование повторяют.
Существующие Worker, D1, участники и webhook других установок не меняются.

## 0. Подготовить инструменты и собрать ZIP

На компьютере разработчика нужны Windows x64, Git, Node.js 24.x с npm и Python 3.
Python используется существующим тестом для независимого чтения ZIP. Если инструмента нет,
установите его до продолжения; другу эти инструменты не нужны.
Используйте рабочую копию проекта с проверяемыми изменениями этой инструкции и сборщика.
Команды собирают текущее содержимое файлов, включая локальные изменения; не переключайте ветку и не удаляйте чужую работу.

Все дальнейшие блоки выполняйте сверху вниз в одном окне PowerShell без transcript, отладки и записи экрана.
При любой ошибке остановитесь и проверьте результат, прежде чем продолжать.
Путь к проекту вводится в консоли, остальные рабочие пути создаются автоматически.

```powershell
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_WRITE_LOGS = 'false'
$env:NO_UPDATE_NOTIFIER = '1'
$repo = (Read-Host 'Полный путь к рабочей копии FinanceManager').Trim()
Set-Location -LiteralPath $repo
$repo = (Get-Location).Path
if (!(Test-Path 'package-lock.json') -or !(Test-Path 'tools\family-installer\release.ts')) { throw 'Открыта не папка проекта' }
git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'Не удалось определить ветку' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Не удалось определить commit' }
node --version
if ($LASTEXITCODE -ne 0) { throw 'Нужен Node.js 24.x' }
npm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'Нужен npm' }
python --version
if ($LASTEXITCODE -ne 0) { throw 'Нужен Python 3 для проверки ZIP' }
```

**Ожидается:** показаны выбранные ветка и commit, Node 24.x, версии npm и Python 3.
Ниже закреплены Node **24.13.0**, Wrangler **4.133.0** и релиз **1** из `tools/family-installer/release.ts`.
Это версии универсального пакета, а не данные семьи. При изменении закреплённых версий сначала обновите этот порядок сборки.

Подготовка скачивает публичные зависимости из npm и официальный Node с `nodejs.org`.
Она создаёт новые файлы под `work/` и заменяет корневой `node_modules` зависимостями из текущего lock-файла.
Cloudflare, Telegram и их credentials не используются; существующие установки не меняются.
Если команды выполняет помощник, перед этими скачиваниями получите отдельное разрешение.

Создайте свежий каталог и установите зависимости проекта и Windows toolchain — набор файлов для включения в ZIP:

```powershell
$run = Join-Path $repo ('work\family-build-' + [guid]::NewGuid().ToString('N'))
$toolchain = Join-Path $run 'windows-toolchain'
$output = Join-Path $run 'releases'
New-Item -ItemType Directory -Path $toolchain -Force | Out-Null
npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Не установлены зависимости проекта' }
Copy-Item 'package.json', 'package-lock.json' $toolchain
npm.cmd ci --prefix $toolchain --os=win32 --cpu=x64 --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Не подготовлены Windows-зависимости' }
```

Скачайте официальный Windows x64 Node, проверьте SHA-256 и добавьте runtime в toolchain:

```powershell
$nodeZip = Join-Path $run 'node-v24.13.0-win-x64.zip'
Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/v24.13.0/node-v24.13.0-win-x64.zip' -OutFile $nodeZip
$nodeZipHash = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($nodeZipHash -ne 'ca2742695be8de44027d71b3f53a4bdb36009b95575fe1ae6f7f0b5ce091cb88') { throw 'Не совпал SHA256 архива Node' }
$nodeExtracted = Join-Path $run 'node-extracted'
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtracted
$runtime = Join-Path $toolchain 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null
Copy-Item (Join-Path $nodeExtracted 'node-v24.13.0-win-x64\node.exe') $runtime
Copy-Item (Join-Path $nodeExtracted 'node-v24.13.0-win-x64\LICENSE') $runtime
$nodeExeHash = (Get-FileHash -LiteralPath (Join-Path $runtime 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($nodeExeHash -ne 'd14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11') { throw 'Не совпал SHA256 node.exe' }
```

**Ожидается:** обе проверки SHA-256 прошли. В `$toolchain` есть `runtime\node.exe`, `runtime\LICENSE`
и `node_modules\wrangler`. Прежние toolchain и результаты сборок не перезаписываются.

Проверьте упаковщик и выполните сборку из корня проекта:

```powershell
npm.cmd run installer:check
if ($LASTEXITCODE -ne 0) { throw 'Ошибка типов упаковщика' }
npm.cmd run installer:test
if ($LASTEXITCODE -ne 0) { throw 'Тесты упаковщика не прошли' }
npm.cmd run release:family -- $toolchain $output
if ($LASTEXITCODE -ne 0) { throw 'Сборка релиза не прошла' }
$release = Join-Path $output 'family-finance-1-windows-x64'
$zip = Join-Path $release 'family-finance-1-windows-x64.zip'
if (!(Test-Path -LiteralPath $zip -PathType Leaf)) { throw 'Не найден готовый ZIP' }
python -c "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('ZIP CRC OK')" $zip
if ($LASTEXITCODE -ne 0) { throw 'Повреждён ZIP' }
Write-Host ('ZIP для установки: ' + $zip)
```

**Ожидается:** проверки проходят, сборщик выводит `Release 1: … files; …zip`, затем появляется `ZIP CRC OK`.
В `$release` находятся ZIP и каталог `package/`. Сборщик сам ничего не скачивает: ему нужны подготовленный toolchain
и выходной каталог вне toolchain, поэтому выше они созданы соседними каталогами.
Он проверяет закреплённый Node, версии зависимостей и состав пакета; существующий каталог релиза не заменяет.

Сохраняйте исходный ZIP без данных установки. Для нового прохода сборки начните шаг 0 заново в новом окне:
случайный `$run` исключит конфликт с прежним результатом. Завершённые приёмки Task 2, Task 4 и Task 5 повторно не отмечайте.

## 1. Распаковать ZIP

Продолжайте в том же PowerShell: `$zip` уже содержит путь к только что собранному архиву.
Распакуйте именно ZIP в новый случайный каталог, не используйте каталог `package/` сборщика как рабочую установку:

```powershell
$instanceRoot = Join-Path $env:LOCALAPPDATA 'FamilyFinanceBot'
$packageRoot = Join-Path $instanceRoot ('release-1-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $packageRoot
Set-Location -LiteralPath $packageRoot
foreach ($document in @('FAMILY_INSTALLATION.md', 'FAMILY_INSTALLATION_DEVELOPER_ACCOUNT.md')) {
  $sourceHash = (Get-FileHash -LiteralPath (Join-Path $repo ('docs\deployment\' + $document)) -Algorithm SHA256).Hash
  $packagedHash = (Get-FileHash -LiteralPath (Join-Path $packageRoot $document) -Algorithm SHA256).Hash
  if ($sourceHash -ne $packagedHash) { throw ('В ZIP другая инструкция: ' + $document) }
}
```

**Ожидается:** распаковка прошла, обе инструкции из архива совпадают с текущими файлами проекта.

Настройте пути и окружение для команд ниже:

```powershell
$nodeExe = Join-Path $packageRoot 'runtime\node.exe'
$wranglerJs = Join-Path $packageRoot 'wrangler\node_modules\wrangler\bin\wrangler.js'
$configPath = Join-Path $packageRoot 'wrangler.instance.json'
$emptyEnv = Join-Path $packageRoot 'empty.env'
[IO.File]::WriteAllText($emptyEnv, '')
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_HIDE_BANNER = 'true'
$env:WRANGLER_LOG = 'log'
$env:NO_UPDATE_NOTIFIER = '1'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
```

**Ожидается:** архив распакован в новый случайный каталог разработчика. В нём есть `worker/`, `migrations/`,
`runtime/`, `wrangler/` и `wrangler.template.json`. Дальнейшие команды используют инструменты из ZIP; повторно устанавливать зависимости или собирать Worker не нужно.
Если распаковка не удалась, удалять облачные ресурсы не нужно: получите и распакуйте проверенный архив заново.

Перед авторизацией исключите переменные, которые могут подставить чужой аккаунт, профиль или credentials.
Выведите только их имена. Если список не пуст, остановитесь и выясните их происхождение; значения не печатайте.
Не отключайте системный proxy, доверенные CA или проверку TLS.

```powershell
$overrides = @(Get-ChildItem Env: | Where-Object {
  $_.Name -match '^(CLOUDFLARE_|CF_|WRANGLER_API_|WRANGLER_ACCOUNT|WRANGLER_PROFILE|WRANGLER_ENV|WRANGLER_LOG_PATH)'
})
if ($overrides.Count -ne 0) {
  $overrides.Name
  throw 'Уберите посторонние настройки авторизации из этого сеанса и повторите проверку'
}
function Auth {
  & $nodeExe $wranglerJs @args --env-file $emptyEnv
  if ($LASTEXITCODE -ne 0) { throw 'Команда авторизации Wrangler не выполнена' }
}
function W {
  & $nodeExe $wranglerJs @args --config $configPath --env-file $emptyEnv --profile $authProfile
  if ($LASTEXITCODE -ne 0) { throw 'Команда Wrangler не выполнена; проверьте результат до повтора' }
}
```

`Auth` запускает команды авторизации, `W` — ресурсные команды с явной конфигурацией и профилем.
При сохранении блоков в `.ps1` используйте UTF-8 с BOM для PowerShell 5.1. Секретов в файле быть не должно.

## 2. Проверить существующий OAuth-профиль разработчика

Посмотрите существующие профили:

```powershell
Auth auth list
```

Из списка выберите ранее проверенный профиль своего аккаунта. `auth list` читает локальный список,
`auth activate` привязывает профиль только к новой папке распаковки. `whoami` обращается к Cloudflare,
читает доступные аккаунты и при необходимости обновляет OAuth; рабочие ресурсы не меняет.
Перед `whoami` получите разрешение на это чтение.

```powershell
$authProfile = (Read-Host 'Имя существующего проверенного OAuth-профиля').Trim()
if ([string]::IsNullOrWhiteSpace($authProfile)) { throw 'Нужно имя существующего профиля' }
Auth auth activate $authProfile $packageRoot
$identity = (Auth whoami --json) | ConvertFrom-Json
if (!$identity.loggedIn -or $identity.authType -ne 'OAuth Token') { throw 'Нужен OAuth разработчика' }
$identity.accounts | Format-Table name, id
$accountId = (Read-Host 'Account ID разработчика из списка и Cloudflare Dashboard').Trim()
if ($accountId -notmatch '^[a-f0-9]{32}$') { throw 'Некорректный account ID' }
if (@($identity.accounts | Where-Object { $_.id -eq $accountId }).Count -ne 1) {
  throw 'Выбранный аккаунт не найден среди доступных'
}
```

**Ожидается:** `whoami` показывает ваш аккаунт. Сверьте account ID с Dashboard, даже если аккаунт один.
При несовпадении или недействительном OAuth остановитесь и восстановите доступ отдельно; другой профиль автоматически не выбирайте.
`whoami` не принимает `--profile`; он использует профиль, привязанный к текущему каталогу через `auth activate`.
Привязки профилей к каталогам предыдущих установок не меняйте.

## 3. Выбрать имена и создать одну D1

Выберите отдельные свободные имена для этой семьи, например `family-finance-petrov`. В Dashboard выбранного аккаунта убедитесь,
что Worker с выбранным именем отсутствует. Если имя уже занято, выясните назначение ресурса и выберите свободное имя.

В Dashboard проверьте текущий тариф, число D1 и использование общих квот аккаунта, а также доступность нового Worker.
Ранее проверенный Free допускает до 10 D1 на аккаунт; квоты общие для всех экземпляров.
Само число баз не доказывает наличие запаса по запросам и хранению. Если лимит исчерпан или запаса нет,
остановитесь и согласуйте решение; существующие базы не удаляйте и тариф автоматически не меняйте.
Перед `d1 list` получите разрешение на чтение списка D1 выбранного аккаунта,
а перед `d1 create` — на создание одной новой D1 с выбранным именем в регионе `eeur`.

Создайте рабочую конфигурацию из шаблона. До создания D1 временно уберите её привязку, чтобы не передавать заглушки в сеть.

```powershell
$workerName = (Read-Host 'Свободное имя Worker').Trim()
$databaseName = (Read-Host 'Свободное имя новой D1').Trim()
if ($workerName -notmatch '^[a-z0-9][a-z0-9-]{0,62}$') { throw 'Некорректное имя Worker' }
if ($databaseName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$') { throw 'Некорректное имя D1' }
$template = Get-Content -LiteralPath 'wrangler.template.json' -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath 'wrangler.template.json' -Raw | ConvertFrom-Json
$config.name = $workerName
$config.account_id = $accountId
$config.PSObject.Properties.Remove('d1_databases')
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
W d1 list --json
```

**Ожидается:** список D1 относится к выбранному аккаунту, имя новой базы свободно. Если такое имя уже есть после
прерванного создания, не выполняйте следующую команду: сверьте существующую базу по разделу продолжения сеанса.

```powershell
W d1 create $databaseName --location eeur --no-update-config
```

Сразу сохраните выданный UUID вместе с account ID, именами Worker и D1, именем профиля и путём `$packageRoot`
в новой временной заметке вне репозитория и каталога релиза. Не используйте общий `INSTANCE.txt` предыдущей семьи.
Эта заметка нужна при прерывании до завершения установки; секретов в ней быть не должно. При timeout сначала выполните `W d1 list --json`;
не повторяйте создание вслепую. После успешного создания:

```powershell
$databaseId = (Read-Host 'UUID только что созданной D1').Trim()
if ($databaseId -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { throw 'Некорректный UUID D1' }
$databases = (W d1 list --json) | ConvertFrom-Json
if (@($databases | Where-Object { $_.uuid -eq $databaseId -and $_.name -eq $databaseName }).Count -ne 1) {
  throw 'UUID и имя D1 не совпали со списком выбранного аккаунта'
}
$config | Add-Member -MemberType NoteProperty -Name d1_databases -Value @($template.d1_databases[0])
$config.d1_databases[0].database_name = $databaseName
$config.d1_databases[0].database_id = $databaseId
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
Get-Content -LiteralPath $configPath
```

**Ожидается:** правильные `account_id`, `name`, `DB`, database name/ID, `main: worker/worker.js`,
`no_bundle: true`, `APP_RELEASE_VERSION: "1"` и `migrations_dir: migrations`.
Оригинальный шаблон не меняется. Конфигурация лежит рядом с `worker/` и `migrations/`.

## 4. Применить миграции и проверить историю

Получите разрешение на чтение и применение миграций только к новой D1 с подтверждённым UUID:
`migrations list` и SELECT читают её, `migrations apply` создаёт таблицы и начальные данные этой базы.

```powershell
W d1 migrations list $databaseName --remote
W d1 migrations apply $databaseName --remote
W d1 migrations list $databaseName --remote
$history = (W d1 execute DB --remote --json --command 'SELECT name FROM d1_migrations ORDER BY id') | ConvertFrom-Json
if (@($history).Count -ne 1 -or !$history[0].success) { throw 'История миграций не прочитана' }
$applied = @($history[0].results | ForEach-Object { $_.name })
$packaged = @(Get-ChildItem -LiteralPath 'migrations' -File | Sort-Object Name | ForEach-Object { $_.Name })
if (($applied -join '|') -ne ($packaged -join '|')) { throw 'История D1 не совпала с миграциями пакета' }
W d1 execute DB --remote --json --command 'SELECT id, display_currency, finance_time_zone FROM instance_settings'
```

На вопрос `apply` ответьте только после сверки аккаунта и новой базы. **Ожидается:** миграции `0001`–`0005` применены,
ожидающих нет; одна строка настроек с `id = 1`, `RSD` и `Europe/Belgrade`.
Если история неизвестна или настройки отсутствуют, остановитесь. Не повторяйте seed и не пересоздавайте базу.

## 5. Подтвердить валюту и часовой пояс

Получите разрешение на SELECT настроек новой D1 и UPDATE одной строки `instance_settings` по согласованию с другом.
`auth token` в функции ниже использует активный OAuth-профиль и может обновить его токен; credentials остаются в памяти.

Для настроек и имён участников нужны SQL-параметры: `d1 execute` их не поддерживает.
Определите функцию D1 REST. Она получает OAuth из активного профиля в память, проверяет оба уровня ответа
и не печатает токен. При ошибке она сообщает только об операции; сырой объект ошибки в чат не пересылайте.

```powershell
function D1 {
  param([string]$Sql, [object[]]$Params = @())
  $authJson = $null
  $credentials = $null
  $headers = $null
  try {
    $authJson = Auth auth token --json
    $credentials = ($authJson -join "`n") | ConvertFrom-Json
    if ($credentials.type -ne 'oauth' -or !$credentials.token) { throw 'OAuth недоступен' }
    $headers = @{ Authorization = 'Bearer ' + $credentials.token }
    $payload = @{ sql = $Sql; params = @($Params) } | ConvertTo-Json -Depth 10 -Compress
    $uri = "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database/$databaseId/query"
    $reply = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' `
      -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if (!$reply.success -or @($reply.result).Count -ne 1 -or !$reply.result[0].success) { throw 'D1 отказала' }
    $reply.result[0]
  } catch {
    throw 'Запрос D1 не подтверждён. Проверьте аккаунт, авторизацию и результат отдельным SELECT перед повтором записи.'
  } finally {
    $authJson = $null
    $credentials = $null
    $headers = $null
  }
}
$settings = @( (D1 -Sql 'SELECT id, display_currency, finance_time_zone FROM instance_settings').results )
if ($settings.Count -ne 1 -or $settings[0].id -ne 1) { throw 'Ожидалась одна строка настроек с id=1' }
$settings | Format-Table id, display_currency, finance_time_zone
```

Покажите другу текущие значения. Валюта — подпись для старых и новых расходов, без конвертации чисел.
Часовой пояс влияет на новые даты и относительные периоды; сохранённые даты и суммы не переписывает.
Если друг оставляет значения, пропустите следующий блок. Если меняет — введите согласованные значения:

```powershell
$currency = Read-Host 'Валюта, например EUR'
$timeZone = Read-Host 'IANA timezone, например Europe/Belgrade или UTC'
$validateSettings = @'
const [currency, zone] = process.argv.slice(1);
if (!Intl.supportedValuesOf('currency').includes(currency)) process.exit(1);
if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(zone)) process.exit(1);
try { new Intl.DateTimeFormat('en', {timeZone: zone}).format(); } catch { process.exit(1); }
'@
& $nodeExe -e $validateSettings $currency $timeZone
if ($LASTEXITCODE -ne 0) { throw 'Недопустимая валюта или timezone; база не изменена' }
D1 -Sql 'UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1' -Params @($currency, $timeZone) | Out-Null
$settings = @((D1 -Sql 'SELECT id, display_currency, finance_time_zone FROM instance_settings').results)
if ($settings.Count -ne 1 -or $settings[0].display_currency -cne $currency -or $settings[0].finance_time_zone -cne $timeZone) {
  throw 'Прочитанные настройки не совпали с согласованными'
}
$settings | Format-Table id, display_currency, finance_time_zone
```

**Ожидается:** друг подтвердил прочитанные из D1 значения. При timeout UPDATE сначала прочитайте строку заново;
не возвращайте старые значения автоматически. Окончательно допустимость настроек подтверждает ответ Worker на `/health`.

## 6. Проверить Telegram-бота и разместить Worker

Создайте отдельного бота через `/newbot` у официального **@BotFather** в своём Telegram.
Не используйте токен бота другой установки. Получите разрешение на `getMe` и `getWebhookInfo`:
они читают сведения только нового бота. На `deploy` получите разрешение отдельно:
команда создаст новый Worker выбранного имени в вашем аккаунте и привяжет его к новой D1.
Запрос `/health` читает настройки этой D1 через Worker.
Токен вводите в скрытый prompt на компьютере разработчика. Не вставляйте его в команду, URL браузера, чат или файл.

```powershell
function Read-HiddenText {
  param([string]$Prompt)
  $hidden = Read-Host $Prompt -AsSecureString
  try { ([Net.NetworkCredential]::new('', $hidden)).Password }
  finally { $hidden.Dispose() }
}
function Telegram {
  param(
    [ValidateSet('getMe', 'getWebhookInfo', 'setWebhook')][string]$MethodName,
    [hashtable]$Body = @{}
  )
  try {
    $payload = $Body | ConvertTo-Json -Depth 10 -Compress
    $reply = Invoke-RestMethod -Method Post -Uri ("https://api.telegram.org/bot" + $botToken + '/' + $MethodName) `
      -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if (!$reply.ok) { throw 'Telegram отказал' }
    $reply.result
  } catch {
    throw 'Вызов Telegram не подтверждён. Проверьте сеть и токен локально; не публикуйте исходную ошибку или URL.'
  }
}
$botToken = Read-HiddenText 'Токен нового бота от BotFather'
$bot = Telegram -MethodName getMe
$bot | Select-Object id, username, first_name
$webhook = Telegram -MethodName getWebhookInfo
$webhook | Select-Object url, pending_update_count, last_error_date
if ($webhook.url) { throw 'Webhook уже настроен; выясните назначение бота до замены' }
```

**Ожидается:** username и ID принадлежат новому боту этой семьи; URL webhook пуст.
Если токен неверный, проверьте его у BotFather локально. Существующий чужой webhook не заменяйте.

```powershell
W deploy --no-bundle
```

При первом deploy в аккаунте разработчик регистрирует свободный `workers.dev` subdomain, если Wrangler запросит его.
**Ожидается:** успешный deploy нужного Worker, привязка `DB` к выбранной D1 и HTTPS URL.
Возьмите URL из вывода deploy или страницы этого Worker в Dashboard, без `/telegram` в конце:

```powershell
$workerUrl = (Read-Host 'HTTPS URL развёрнутого Worker').TrimEnd('/')
if ($workerUrl -notmatch '^https://[a-z0-9.-]+\.workers\.dev$') { throw 'Нужен URL этого Worker на workers.dev' }
if (!$workerUrl.StartsWith('https://' + $workerName + '.')) { throw 'URL не соответствует имени нового Worker' }
$health = Invoke-RestMethod -Uri ($workerUrl + '/health') -Method Get
$health
```

**Ожидается:** HTTP 200 и `status: ok`, `service: family-finance-bot`.
При 503 проверьте D1, привязку `DB` и настройки. При TLS-ошибке нового hostname подождите и повторите запрос;
не отключайте TLS и не создавайте ресурсы заново.

## 7. Записать секреты и подключить webhook

Получите разрешение записать два secrets только в новый Worker и направить webhook только нового Telegram-бота
на его `/telegram`. `secret put` меняет активную версию этого Worker; `secret list`, `deployments list`, `versions view`
и `getWebhookInfo` читают состояние. Проверочный POST без секрета обращается только к новому Worker.

Создайте случайный секрет webhook. Значения передаются Wrangler через stdin, а не аргументы командной строки.

```powershell
$randomBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
$webhookSecret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
$botToken | & $nodeExe $wranglerJs secret put TELEGRAM_BOT_TOKEN `
  --config $configPath --env-file $emptyEnv --profile $authProfile
if ($LASTEXITCODE -ne 0) { throw 'Запись TELEGRAM_BOT_TOKEN не подтверждена' }
$webhookSecret | & $nodeExe $wranglerJs secret put TELEGRAM_WEBHOOK_SECRET `
  --config $configPath --env-file $emptyEnv --profile $authProfile
if ($LASTEXITCODE -ne 0) { throw 'Запись TELEGRAM_WEBHOOK_SECRET не подтверждена' }
W secret list --format json --name $workerName
W deployments list --json
```

**Ожидается:** оба имени secrets присутствуют. Из списка deployments возьмите активный `version_id`
после записи обоих секретов; убедитесь, что он получает 100% трафика.

```powershell
$versionId = Read-Host 'Активный version_id из deployments'
W versions view $versionId --json
```

Сверьте привязку `DB`, database ID и `APP_RELEASE_VERSION` со своим конфигом; для этого ZIP релиз равен `1`.
Cloudflare version UUID и `number` не являются номером релиза приложения. Если данные не совпали, webhook не подключайте.

```powershell
$registered = Telegram -MethodName setWebhook -Body @{
  url = $workerUrl + '/telegram'
  secret_token = $webhookSecret
  drop_pending_updates = $false
}
if ($registered -ne $true) { throw 'Регистрация webhook не подтверждена' }
$webhook = Telegram -MethodName getWebhookInfo
if ($webhook.url -cne ($workerUrl + '/telegram')) { throw 'Адрес webhook не совпал' }
$webhook | Select-Object url, pending_update_count, last_error_date
```

Проверьте отказ для POST без секрета:

```powershell
$status = $null
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri ($workerUrl + '/telegram') -Method Post `
    -ContentType 'application/json' -Body '{}'
  $status = [int]$response.StatusCode
} catch {
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
}
if ($status -ne 401) { throw 'Ожидался HTTP 401 без webhook secret' }
```

**Ожидается:** HTTP 401. Теперь оба участника присылают `/start` своему боту.
До добавления в D1 каждый получает `Нет доступа. Ваш Telegram ID: …`.
Это проверяет настоящую доставку Telegram; успешный `setWebhook` сам по себе её не доказывает.
Если сообщение не пришло, локально проверьте `getWebhookInfo`, health и имена secrets; не печатайте токен.

## 8. Добавить участников и проверить совместную работу

Получите разрешение на INSERT и проверочный SELECT участников только новой D1.
Друг подтверждает каждого участника. Проверки в Telegram создают и меняют только тестовые данные новой семьи.

Для каждого из двух участников сверяйте Telegram ID с самим человеком, затем выполните блок.
Разработчика в рабочую семью не добавляйте.

```powershell
$memberId = (Read-Host 'Telegram ID участника из ответа этого бота').Trim()
$memberName = Read-Host 'Имя участника'
if ($memberId -notmatch '^[1-9][0-9]*$' -or [string]::IsNullOrWhiteSpace($memberName)) { throw 'Нужны ID и имя участника' }
D1 -Sql 'INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, 1) ON CONFLICT(telegram_user_id) DO NOTHING' `
  -Params @($memberId, $memberName) | Out-Null
$member = @((D1 -Sql 'SELECT telegram_user_id, display_name, enabled FROM members WHERE telegram_user_id = ?' -Params @($memberId)).results)
if ($member.Count -ne 1 -or $member[0].enabled -ne 1 -or $member[0].display_name -cne $memberName) {
  throw 'Участник не подтверждён; выясните состояние существующей записи'
}
$member | Format-Table telegram_user_id, display_name, enabled
```

`DO NOTHING` позволяет повторить INSERT после чтения результата, но не включает отключённого участника
и не меняет существующее имя. Такое несовпадение разбирайте отдельно.

Проверьте совместную работу:

- Оба подтверждённых участника могут открыть бота и добавить тестовый расход обоими способами; повторный тап не создаёт дубль.
- Второй участник видит, редактирует и удаляет общий тестовый расход.
- История, пагинация и статистика показывают ожидаемые данные; изменение и архивирование категории сохраняют старые расходы.
- Пользователь, которого нет в `members`, получает отказ.
- Проверку после закрытия терминала и выключения компьютера выполните в конце шага 9, после сохранения сведений.

Удалите тестовые расходы через бот, сохраняя настоящие данные семьи.
Если проверка не пройдена, исправьте причину до начала живого использования.
Повторять завершённые Task 4 и Task 5 или делать дополнительный redeploy для этого не требуется.

## 9. Сохранить сведения для обновления и передать бота другу

Единственная небольшая автоматизация этого прохода — сохранение памятки и конфигурации.
Вместо ручного переписывания реквизитов блок берёт их из текущего сеанса и создаёт новый случайный каталог
в `$env:LOCALAPPDATA\FamilyFinanceBot\records`, вне распаковки и Git. Предыдущие записи не перезаписываются.
Это локальная операция без Cloudflare и Telegram; отдельный скрипт не нужен, блок целиком включён в инструкцию внутри ZIP.

Выполните блок после проверок шага 8, перед очисткой переменных и закрытием терминала.
Проверку при выключенном компьютере завершите после него; окончательный результат пока не отмечайте.

```powershell
$recordsRoot = Join-Path (Split-Path -Parent $packageRoot) 'records'
New-Item -ItemType Directory -Path $recordsRoot -Force | Out-Null
$recordPath = Join-Path $recordsRoot ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $recordPath | Out-Null
Copy-Item -LiteralPath $configPath -Destination (Join-Path $recordPath 'wrangler.instance.json') -ErrorAction Stop
$instanceNote = [ordered]@{
  account_id = $accountId
  worker_name = $workerName
  worker_url = $workerUrl
  database_name = $databaseName
  database_id = $databaseId
  auth_profile = $authProfile
  app_release_version = $config.vars.APP_RELEASE_VERSION
  cloudflare_version_id = $versionId
  package_root = $packageRoot
  zip_path = $zip
  bot_username = $bot.username
}
[IO.File]::WriteAllText((Join-Path $recordPath 'INSTANCE.json'),
  ($instanceNote | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
Get-Content -LiteralPath (Join-Path $recordPath 'INSTANCE.json')
Write-Host ('Сведения сохранены: ' + $recordPath)
```

Сверьте сохранённые реквизиты с проверенными ресурсами. Сохраните оригинальный ZIP, эту инструкцию и копию
каталога записи в своём личном хранилище. Памятка и конфиг не являются резервной копией расходов.
OAuth остаётся в штатном хранилище Wrangler разработчика. Токены, webhook secret, участников и расходы в памятку не включайте.
При ошибке локального сохранения ресурсы заново не создавайте: исправьте путь и повторите блок в новом случайном каталоге.
Если сеанс возобновлён, перед блоком восстановите `$zip` и `$workerUrl` из своих записей, а `$versionId` и `$bot`
проверьте командами чтения из шагов 6–7 с соответствующим разрешением.

Перед закрытием PowerShell очистите временные переменные и буфер обмена, если туда копировали токен:

```powershell
$botToken = $null
$webhookSecret = $null
$randomBytes = $null
$Error.Clear()
Set-Clipboard -Value ''
```

Закройте терминал, выключите компьютер и попросите друга добавить расход через Telegram.
Только после успешной проверки зафиксируйте в отдельной локальной заметке в `$recordPath` дату,
фактическое время установки и результаты шагов 4–8 и проверки при выключенном компьютере.
Не включайте частные расходы, идентификаторы участников или секреты в Git и публичный PR.
Если проверка ещё не состоялась, запишите «живая проверка не завершена», не объявляйте бота переданным.
Документы и локальные проверки фиксируйте отдельно от результата живого сеанса.

Передайте другу ссылку `https://t.me/<bot_username>` и короткую памятку: начать с `/start`,
расходы общие для подтверждённых участников, по ошибкам и вопросам обращаться к вам.
Объясните, что бот работает при выключенном компьютере, вы администрируете Cloudflare и имеете доступ к базе.
Другу не нужны Cloudflare, ZIP, OAuth или инструменты разработчика. Обновление выполняете вы по отдельной инструкции
для перехода с сохранённого релиза; при смене схемы заранее проверяете переход и делаете экспорт D1.
При обновлении используйте прежние Worker, D1 и бота, не повторяйте первоначальную установку.

## Если сеанс прервался

Не начинайте создание ресурсов заново. В новом PowerShell выберите прежний каталог и включите остановку при ошибке:

```powershell
$ErrorActionPreference = 'Stop'
$packageRoot = Read-Host 'Полный путь к прежнему каталогу релиза'
Set-Location -LiteralPath $packageRoot
```

Повторите из шага 1 блок «Настройте пути и окружение» и блок с проверкой переменных окружения и определениями `Auth` и `W`.
ZIP заново не распаковывайте. Прочитайте сохранённый `wrangler.instance.json` и свою временную заметку или запись из `records`.
Перед `whoami` и `d1 list` получите разрешение на чтение вашего аккаунта и списка D1:


```powershell
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$accountId = $config.account_id
$workerName = $config.name
if ($config.d1_databases) {
  $databaseName = $config.d1_databases[0].database_name
  $databaseId = $config.d1_databases[0].database_id
}
$authProfile = (Read-Host 'Имя проверенного профиля из своей заметки').Trim()
Auth auth activate $authProfile $packageRoot
Auth whoami --json
W d1 list --json
```

Снова сверьте аккаунт и D1. Если база создана, но привязки в конфиге ещё нет, введите `$databaseName` из памятки,
загрузите `$template` из шага 3 и выполните только блок, начинающийся с ввода `$databaseId`, пропустив `d1 create`.
Если прерывание случилось до создания конфигурации, продолжайте с последнего подтверждённого шага авторизации.
При неоднозначности сначала выясните назначение ресурса.
После начала миграций прочитайте их историю и текущие настройки; продолжайте с первого незавершённого действия.
Для D1 REST заново определите `D1` из шага 5; для Telegram — `Read-HiddenText` и `Telegram` из шага 6.
Токен при необходимости введите через скрытый prompt повторно, не восстанавливайте его из журналов.
После timeout любой записи сначала прочитайте её результат. Если чтение тоже недоступно, исход остаётся неизвестным.

Если прерывание произошло между записью webhook secret и `setWebhook`, повторно введите токен нового бота,
создайте новый секрет и выполните шаг 7 целиком. Затем проверьте новое сообщение боту.
Если webhook уже работает, обычное продолжение или redeploy не требует замены секретов.

Потеря локального файла не останавливает облачного бота. Восстановите конфиг из своей сохранённой копии.
Если копии нет, найдите Worker в Dashboard, account ID и database ID из привязки `DB`,
восстановите конфиг из шаблона соответствующего релиза и сверьте миграции и активную версию.
Не создавайте другую базу взамен неизвестной и не очищайте историю миграций. Доступ к своему аккаунту восстанавливает разработчик.
