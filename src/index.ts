import { D1FinanceRepository } from "./storage/D1FinanceRepository";
import { CloudflareD1Database, type CloudflareD1Binding } from "./storage/CloudflareD1Database";
import { createFinanceBot } from "./telegram/bot";
import { hasValidWebhookSecret } from "./telegram/webhookSecret";
import type { Update } from "grammy/types";

type Environment = { DB: CloudflareD1Binding; TELEGRAM_BOT_TOKEN: string; TELEGRAM_WEBHOOK_SECRET: string };

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok", service: "family-finance-bot" });

    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!hasValidWebhookSecret(request, environment.TELEGRAM_WEBHOOK_SECRET))
        return new Response("Unauthorized", { status: 401 });
      if (!environment.TELEGRAM_BOT_TOKEN) return new Response("Bot token is missing", { status: 503 });
      const bot = createFinanceBot(environment.TELEGRAM_BOT_TOKEN, new D1FinanceRepository(new CloudflareD1Database(environment.DB)));
      await bot.init();
      await bot.handleUpdate(await request.json() as Update);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Environment>;
