import type { Update, User } from "grammy/types";
import { createTelegramUpdates } from "./telegramUpdates";

type Updates = ReturnType<typeof createTelegramUpdates>;
type MessageOptions = Parameters<Updates["message"]>[2] & { updateId?: number };
type CallbackOptions = Parameters<Updates["callback"]>[2] & { updateId?: number };

// Share user actions between direct bot tests and tests through the real Worker webhook.
export function createTelegramDriver<Result>(userId: number, botUser: User, dispatch: (update: Update) => Promise<Result>) {
  const updates = createTelegramUpdates(userId);
  let nextUpdateId = 1;
  const takeUpdateId = (explicit?: number) => {
    const id = explicit ?? nextUpdateId;
    nextUpdateId = Math.max(nextUpdateId, id + 1);
    return id;
  };
  const sendMessage = (text: string, { updateId, ...options }: MessageOptions = {}) =>
    dispatch(updates.message(takeUpdateId(updateId), text, options));
  const sendCommand = (text: string, { updateId, ...options }: MessageOptions = {}) =>
    dispatch(updates.command(takeUpdateId(updateId), text, options));
  const pressButton = (data: string, { updateId, ...options }: CallbackOptions = {}) =>
    dispatch(updates.callback(takeUpdateId(updateId), data, options));
  const replyToPrompt = (text: string, prompt: string, sender: User = botUser) =>
    sendMessage(text, { replyTo: updates.replyTarget(prompt, sender) });
  return {
    user: updates.user,
    sendMessage,
    sendCommand,
    pressButton,
    replyToPrompt,
    sendPhoto: () => dispatch(updates.photo(takeUpdateId()))
  };
}
