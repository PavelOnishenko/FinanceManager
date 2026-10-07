# Demo environment

Use a separate Telegram bot, Cloudflare Worker, and D1 database for a video demo or disposable test expenses. The current application has one shared expense history per database; adding several families as members of one database would let them see and change each other's expenses. Give each family its own bot, Worker, and database if they continue testing independently.

Run these commands from the repository root in PowerShell. Every remote D1 command below names `family-finance-bot-demo` explicitly. Do not substitute the production database name, `family-finance-bot`.

## 1. Create the demo database and Worker configuration

Create the database and note the `database_id` printed by Wrangler:

```powershell
npx.cmd wrangler d1 create family-finance-bot-demo --location eeur
```

If Wrangler offers to add the binding automatically, answer `n`. Its suggested binding is top-level and may use a name other than the application's required `DB`.

Add a comma after the existing production `d1_databases` array in `wrangler.jsonc`, then add this `env` property at the top level. Replace the placeholder ID with the ID of the **new** database. Keep the existing top-level binding intact.

```jsonc
"env": {
  "demo": {
    "d1_databases": [{
      "binding": "DB",
      "database_name": "family-finance-bot-demo",
      "database_id": "<DEMO_DATABASE_ID>",
      "migrations_dir": "migrations"
    }]
  }
}
```

The `DB` binding is repeated because Wrangler environment bindings are not inherited. `--env demo` deploys a separate Worker named `family-finance-bot-demo`; an unqualified `wrangler deploy` still targets the existing production Worker.

## 2. Apply the same schema and categories

The existing migration files are the source of truth for both databases. They create the schema and insert the same 19 categories. Do not copy production expense or member rows.

```powershell
npx.cmd wrangler d1 migrations apply family-finance-bot-demo --env demo --remote
npx.cmd wrangler d1 migrations list family-finance-bot-demo --env demo --remote
npx.cmd wrangler d1 execute family-finance-bot-demo --env demo --remote --command "SELECT (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM expenses) AS expenses;"
```

Confirm that no migrations remain pending and the counts are `19`, `0`, `0`. Apply future migrations to **both** databases, always naming the intended database explicitly.

## 3. Deploy the demo Worker and set its secrets

Create a separate bot with `@BotFather`. Keep its token out of Git and chat messages. Check the code, then deploy only the demo environment:

```powershell
npm.cmd run check
npm.cmd run build
npx.cmd wrangler deploy --env demo
npx.cmd wrangler secret put TELEGRAM_BOT_TOKEN --env demo
npx.cmd wrangler secret put TELEGRAM_WEBHOOK_SECRET --env demo
```

Paste the **demo bot's** token at the first secret prompt. Use a newly generated, random webhook secret at the second prompt; keep a temporary copy for the next step. These secrets belong to the demo Worker and do not inherit production values. Record the demo Worker's HTTPS URL from the deploy output.

## 4. Set the demo bot's webhook

In the same PowerShell session, enter the demo credentials when prompted. `Read-Host` keeps the token and secret out of the command history. Use the exact URL printed by the demo deployment, without a trailing slash.

```powershell
$demoBotToken = Read-Host "Demo bot token"
$demoWebhookSecret = Read-Host "Demo webhook secret"
$demoWorkerUrl = Read-Host "Demo Worker HTTPS URL"
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$demoBotToken/setWebhook" -Body @{ url = "$demoWorkerUrl/telegram"; secret_token = $demoWebhookSecret }
Invoke-RestMethod -Uri "https://api.telegram.org/bot$demoBotToken/getWebhookInfo"
```

Confirm `ok: true` from `setWebhook`, then confirm that `getWebhookInfo` shows the demo URL with `/telegram` and no recent error. Never call `setWebhook` with the production bot token during this setup.

## 5. Allow your account and test the demo

Send `/start` to the **demo bot**. Its access-denied reply shows your Telegram ID. Insert that ID into the **demo** D1 database only, replacing `<YOUR_TELEGRAM_ID>` with the digits from the reply:

```powershell
npx.cmd wrangler d1 execute family-finance-bot-demo --env demo --remote --command "INSERT INTO members (telegram_user_id, display_name) VALUES ('<YOUR_TELEGRAM_ID>', 'Demo');"
```

Send `/start` again; the bot should now allow access. Add a sample expense, view history and statistics, and verify the demo database directly:

```powershell
npx.cmd wrangler d1 execute family-finance-bot-demo --env demo --remote --command "SELECT id, amount_rsd, category_id, spent_on FROM expenses ORDER BY id DESC LIMIT 10;"
```

The sample expense should appear in this database. Then edit and delete it through the demo bot and confirm that the query returns no expense rows. This guide creates no resources by itself; run the commands when you are ready to set up the demo.
