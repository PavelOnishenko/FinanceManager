# Приёмка упаковки семейного релиза — Task 2

**Принято:** 21 октября 2026 года владелец подтвердил успешное выполнение всех пунктов А и Б на двух соответствующих машинах.

Проверяем текущий релиз **1**: Node **24.13.0**, Wrangler **4.133.0**, compatibility date **2026-09-16**.
Если значения в `tools/family-installer/release.ts` уже другие, сначала обновите версии, пути и контрольные суммы в этой инструкции.

Выполняйте шаги по порядку. Отмечайте пункт только после получения указанного результата.
При неожиданном результате остановитесь и пришлите номер шага и текст ошибки. Следующие шаги не выполняйте.
Команды рассчитаны на **PowerShell 5.1 или новее**, а не на `cmd.exe` или Git Bash.
Часть А выполняется в одном окне PowerShell: последующие команды используют созданные ранее переменные.
Часть Б — в отдельном окне на чистой Windows x64.

Это проверка упаковки. Установка в Cloudflare, Telegram, авторизация, обновление базы и работа будущего мастера сюда не входят.
Интернет нужен только в части А для скачивания публичных пакетов npm и Node.js. Готовый пакет проверяем без сети.

## А. На компьютере разработчика

### А1. Открыть проект и проверить инструменты

- [x] Откройте PowerShell в корне репозитория `FinanceManager`, где находятся `package.json` и `wrangler.jsonc`.

```powershell
$ErrorActionPreference = 'Stop'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
$repo = (Get-Location).Path
if (!(Test-Path 'package.json') -or !(Test-Path 'tools\family-installer\release.ts')) { throw 'Открыта не папка проекта' }
git branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'Не удалось определить ветку' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Не удалось определить commit' }
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node недоступен' }
npm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'npm недоступен' }
python --version
if ($LASTEXITCODE -ne 0) { throw 'Python недоступен' }
```

**Ожидается:** ветка `feat/installer-task2-release-artifacts` для проверки PR #9, SHA проверяемого commit,
Node 24.x (проверенная Windows-версия — 24.13.0), версия npm и Python 3.x.
Здесь используются инструменты разработчика. На компьютере из части Б они не понадобятся.
Если вы меняли исходники локально, проверяется именно их текущее содержимое, а не только указанный commit.

### А2. Создать свежую рабочую папку и установить зависимости проекта

- [x] Выполните:

```powershell
$run = Join-Path $repo ('work\acceptance-' + [guid]::NewGuid().ToString('N'))
$toolchain = Join-Path $run 'windows-toolchain'
$output = Join-Path $run 'releases'
New-Item -ItemType Directory -Path $toolchain -Force | Out-Null
npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Не установлены зависимости проекта' }
Write-Host "Рабочая папка: $run"
```

**Ожидается:** `npm ci` завершается успешно. Создан новый каталог под `work/`; прежние сборки не удаляются.
`npm ci` заменяет корневой `node_modules` зависимостями из текущего lock-файла.

### А3. Подготовить Windows toolchain из текущего lock-файла

- [x] Установите зависимости в отдельную папку:

```powershell
Copy-Item 'package.json', 'package-lock.json' $toolchain
npm.cmd ci --prefix $toolchain --os=win32 --cpu=x64 --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Не подготовлены Windows-зависимости' }
```

- [x] Скачайте и проверьте официальный Node, затем извлеките два нужных файла:

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

**Ожидается:** обе команды скачивания/распаковки и обе проверки хэша проходят. В `$toolchain` есть
`runtime\node.exe`, `runtime\LICENSE` и `node_modules\wrangler`.
Не копируйте зависимости из старой toolchain или из корневого `node_modules` проекта.

### А4. Проверить только установщик

- [x] Выполните три команды:

```powershell
npm.cmd run installer:check
if ($LASTEXITCODE -ne 0) { throw 'Ошибка типов установщика' }
npm.cmd run installer:test
if ($LASTEXITCODE -ne 0) { throw 'Тесты установщика не прошли' }
npm.cmd run installer:demo
if ($LASTEXITCODE -ne 0) { throw 'Demo установщика не прошло' }
```

**Ожидается:** проверка типов без ошибок; все тесты установщика проходят без пропусков;
последняя строка demo — `Симуляция провайдеров, установки и обновления появится в задачах 3–5.`
Python используется тестом для независимого чтения ZIP. Полный набор тестов приложения для этой приёмки не запускается.

### А5. Собрать релиз и проверить контрольную сумму ZIP

- [x] Выполните:

```powershell
npm.cmd run release:family -- $toolchain $output
if ($LASTEXITCODE -ne 0) { throw 'Сборка релиза не прошла' }
$release = Join-Path $output 'family-finance-1-windows-x64'
$zip = Join-Path $release 'family-finance-1-windows-x64.zip'
$checksums = Join-Path $release 'SHA256SUMS.txt'
foreach ($item in @($zip, $checksums, (Join-Path $release 'package'))) {
  if (!(Test-Path -LiteralPath $item)) { throw "Отсутствует результат сборки: $item" }
}
$expectedZipHash = ((Get-Content -LiteralPath $checksums -Raw).Trim() -split '\s+')[0]
$actualZipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualZipHash -ne $expectedZipHash) { throw 'Не совпал SHA256 релизного ZIP' }
Write-Host "ZIP: $zip"
Write-Host "SHA256: $actualZipHash"
```

**Ожидается:** строка `Release 1: … files; …zip`, каталог `$release` с ZIP, `SHA256SUMS.txt` и `package/`, совпавшая контрольная сумма.
Точное количество файлов и размер ZIP не являются критерием: они могут изменяться вместе с зависимостями.
Повторную приёмку начинайте с А1 в новом окне: А2 создаст новую рабочую папку, без конфликта с прежним результатом.

### А6. Проверить именно архив, а не только папку до упаковки

- [x] Проверьте распаковку и CRC всех файлов, затем распакуйте ZIP:

```powershell
python -c "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('ZIP CRC OK')" $zip
if ($LASTEXITCODE -ne 0) { throw 'Повреждён ZIP' }
$unpacked = Join-Path $run 'Проверка пакета с пробелами'
Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
```

**Ожидается:** `ZIP CRC OK` и успешная распаковка.

- [x] Проверьте верхний уровень архива и состав миграций:

```powershell
$expectedRoot = @('installer', 'worker', 'migrations', 'runtime', 'wrangler', 'Start setup.cmd',
  'wrangler.template.json', 'THIRD_PARTY_NOTICES.txt', 'RELEASE_NOTES.ru.md')
$actualRoot = @(Get-ChildItem -LiteralPath $unpacked -Force | Select-Object -ExpandProperty Name)
if (Compare-Object $expectedRoot $actualRoot) { throw 'Неожиданный состав верхнего уровня ZIP' }
$sourceMigrations = @(Get-ChildItem -LiteralPath (Join-Path $repo 'migrations') -File | Select-Object -ExpandProperty Name)
$zipMigrations = @(Get-ChildItem -LiteralPath (Join-Path $unpacked 'migrations') -File | Select-Object -ExpandProperty Name)
if (Compare-Object $sourceMigrations $zipMigrations) { throw 'Не совпал список миграций' }
foreach ($name in $sourceMigrations) {
  $sourceHash = (Get-FileHash -LiteralPath (Join-Path $repo "migrations\$name") -Algorithm SHA256).Hash
  $packagedHash = (Get-FileHash -LiteralPath (Join-Path $unpacked "migrations\$name") -Algorithm SHA256).Hash
  if ($sourceHash -ne $packagedHash) { throw "Изменилось содержимое миграции: $name" }
}
```

**Ожидается:** ровно перечисленные папки/файлы верхнего уровня и все миграции с неизменным содержимым.
В корне пакета нет `.git`, `.env`, `.wrangler`, исходного `wrangler.jsonc`, исходников проекта или файлов состояния семьи.
Содержимое опубликованных npm-пакетов внутри `wrangler/` не фильтруется по именам файлов.

- [x] Откройте `$unpacked\wrangler.template.json` в редакторе и сверьте все значения:

```powershell
notepad.exe (Join-Path $unpacked 'wrangler.template.json')
```

| Поле | Ожидаемое значение |
| --- | --- |
| `name` | `__WORKER_NAME__` |
| `account_id` | `__ACCOUNT_ID__` |
| `main` | `worker/worker.js` |
| `no_bundle` | `true` |
| `compatibility_date` | `2026-09-16` |
| `workers_dev` | `true` |
| `vars.APP_RELEASE_VERSION` | строка `1` |
| `d1_databases` | массив из одного объекта |
| `d1_databases[0].binding` | `DB` |
| `d1_databases[0].database_name` | `__DATABASE_NAME__` |
| `d1_databases[0].database_id` | `__DATABASE_ID__` |
| `d1_databases[0].migrations_dir` | `migrations` |

**Ожидается:** шаблон с заглушками, без настоящих account/database IDs и без Telegram-токена или webhook secret.
Не заменяйте заглушки и не выполняйте команды deploy/login: для Task 2 они не нужны.

- [x] Откройте `runtime\LICENSE`, `THIRD_PARTY_NOTICES.txt` и `RELEASE_NOTES.ru.md` внутри распакованного пакета.

```powershell
notepad.exe (Join-Path $unpacked 'runtime\LICENSE')
notepad.exe (Join-Path $unpacked 'THIRD_PARTY_NOTICES.txt')
notepad.exe (Join-Path $unpacked 'RELEASE_NOTES.ru.md')
```

**Ожидается:** непустая лицензия Node, notices с Node/Wrangler и `Worker: grammy`, русские release notes с предупреждением,
что это предварительная сборка и установка/обновление пока недоступны.

## Б. На чистой Windows x64

### Б1. Подготовить отдельную среду и перенести архив

- [x] Используйте чистую Windows x64 VM или компьютер без установленных Node/npm/Git и без Cloudflare/Telegram-учётных данных разработчика.
  Новый пользователь на компьютере с глобально установленным Node сам по себе не доказывает автономность пакета.
- [x] Откройте PowerShell и выполните:

```powershell
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture
Get-CimInstance Win32_Processor | Select-Object Name, Architecture
Get-Command node, npm, git -ErrorAction SilentlyContinue
$checkRoot = Join-Path $env:USERPROFILE ('FamilyReleaseCheck-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $checkRoot | Out-Null
Write-Host "Папка приёмки: $checkRoot"
explorer.exe $checkRoot
```

**Ожидается:** Windows 64-bit и `Architecture` процессора **9** (x64); `Get-Command` не находит Node/npm/Git.
Если команды найдены или архитектура другая, выберите подходящую чистую среду.

- [x] Скопируйте в открывшуюся папку **только** `family-finance-1-windows-x64.zip` и `SHA256SUMS.txt` из А5.
  Не переносите checkout, toolchain, корневой `node_modules`, конфигурацию или креденшелы разработчика.
- [x] Отключите сеть в этой среде. Все дальнейшие шаги Б выполняются офлайн, в том же окне PowerShell.

### Б2. Проверить перенесённый ZIP и запустить launcher

- [x] Выполните:

```powershell
$zip = Join-Path $checkRoot 'family-finance-1-windows-x64.zip'
$expectedHash = ((Get-Content -LiteralPath (Join-Path $checkRoot 'SHA256SUMS.txt') -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Не совпал SHA256 перенесённого ZIP' }
$packageRoot = Join-Path $checkRoot 'Семейный бот с пробелами'
Expand-Archive -LiteralPath $zip -DestinationPath $packageRoot
explorer.exe $packageRoot
```

- [x] В открывшейся папке дважды нажмите `Start setup.cmd`.

**Ожидаются три строки:**

```text
Комплект релиза 1 проверен. Миграций: 5.
Это предварительная сборка. Мастер установки и обновления пока недоступен (задачи 3–6).
Подключение к Cloudflare и Telegram не выполнялось. См. RELEASE_NOTES.ru.md.
```

Окно ждёт нажатия клавиши и после него закрывается. Браузер и авторизация не открываются.

### Б3. Проверить bundled runtime и native-зависимости

- [x] Выполните из прежнего окна PowerShell:

```powershell
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_HIDE_BANNER = 'true'
& "$packageRoot\runtime\node.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Не запускается bundled Node' }
& "$packageRoot\runtime\node.exe" "$packageRoot\wrangler\node_modules\wrangler\bin\wrangler.js" --version
if ($LASTEXITCODE -ne 0) { throw 'Не запускается bundled Wrangler' }
& "$packageRoot\runtime\node.exe" "$packageRoot\wrangler\node_modules\wrangler\bin\wrangler.js" d1 migrations apply --help
if ($LASTEXITCODE -ne 0) { throw 'Не открывается справка D1' }
& "$packageRoot\wrangler\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Не запускается workerd' }
& "$packageRoot\wrangler\node_modules\wrangler\node_modules\@esbuild\win32-x64\esbuild.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Не запускается esbuild Wrangler' }
```

**Ожидается:** Node `v24.13.0`, Wrangler `4.133.0`, справка `d1 migrations apply`, workerd с датой `2026-09-16`,
esbuild `0.28.1`. Не должно быть предложений установить зависимости, ошибок DLL или сообщений об отсутствии модулей.
Если Windows сообщает о недостающей системной библиотеке, зафиксируйте ошибку: этот пункт не пройден.
Не устанавливайте дополнительные компоненты перед фиксацией результата — иначе проверяется уже другая среда.

### Б4. Перенести папку и проверить независимость от рабочего каталога

- [x] Выполните; при паузе launcher нажмите любую клавишу:

```powershell
$moved = Join-Path $checkRoot 'Перенесённый пакет'
Move-Item -LiteralPath $packageRoot -Destination $moved
$packageRoot = $moved
Set-Location $checkRoot
& "$packageRoot\Start setup.cmd"
if ($LASTEXITCODE -ne 0) { throw 'Launcher не работает после переноса' }
```

**Ожидается:** те же три строки успешной проверки и код завершения `0`.

### Б5. Проверить отсутствие обязательных файлов и восстановление

- [x] Выполните блок. Он временно переименует сначала миграцию, затем native-файл Wrangler.
  При каждой из двух пауз нажмите клавишу. Файлы восстанавливаются в `finally`.

```powershell
foreach ($relative in @('migrations\0005_instance_settings.sql', 'wrangler\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe')) {
  $original = Join-Path $packageRoot $relative
  $held = "$original.disabled"
  Move-Item -LiteralPath $original -Destination $held
  try {
    & "$packageRoot\Start setup.cmd"
    if ($LASTEXITCODE -ne 1) { throw "Не отклонено отсутствие файла: $relative" }
  } finally {
    Move-Item -LiteralPath $held -Destination $original
  }
}
& "$packageRoot\Start setup.cmd"
if ($LASTEXITCODE -ne 0) { throw 'Пакет не восстановился после возврата файлов' }
```

**Ожидается:** два отказа с кодом `1` и текстом `Комплект релиза повреждён или неполон. Распакуйте доверенный архив заново.`
После восстановления — три строки успеха и код `0`; в последней паузе также нажмите клавишу.

## Критерий завершения

- [x] Все пункты А и Б выполнены с указанными результатами; подтверждено владельцем.
Сохраняйте проверенные ZIP и SHA256SUMS.txt. При повторной проверке сообщите commit, SHA256 ZIP,
версию Windows и «А1–Б5 пройдены» либо номер первого неуспешного шага с ошибкой. Секреты и данные семьи не присылайте.

Приёмка **Task 2** завершена. Передача семье рабочего установщика требует выполнения задач 3–6;
этот ZIP пока проверяет комплектность и не устанавливает бот.
