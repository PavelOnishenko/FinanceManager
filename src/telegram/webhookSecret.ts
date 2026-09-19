export function hasValidWebhookSecret(request: Request, secret: string | undefined): boolean {
  return !!secret && request.headers.get("X-Telegram-Bot-Api-Secret-Token") === secret;
}
