import type { Chat, Message, Update, User } from "grammy/types";

type ReplyTarget = NonNullable<Message["reply_to_message"]>;
type MessageChat = Exclude<Chat, Chat.ChannelChat>;
type MessageOptions = { chat?: MessageChat; from?: User; replyTo?: ReplyTarget };

export function createTelegramUpdates(userId: number) {
  const chat: Chat.PrivateChat = { id: userId, type: "private", first_name: "Test user" };
  const user: User = { id: userId, is_bot: false, first_name: "Test user" };
  const messageBase = (updateId: number, { replyTo, ...overrides }: MessageOptions = {}) => ({
    message_id: updateId, date: 0, chat, from: user, ...overrides,
    ...(replyTo ? { reply_to_message: replyTo } : {})
  });
  const message = (updateId: number, text: string, options: MessageOptions = {}): Update => ({
    update_id: updateId, message: { ...messageBase(updateId, options), text }
  });
  const command = (updateId: number, text: string, options: MessageOptions = {}): Update => ({
    update_id: updateId, message: { ...messageBase(updateId, options), text,
      entities: [{ type: "bot_command", offset: 0, length: text.length }] }
  });
  const photo = (updateId: number): Update => ({
    update_id: updateId, message: { ...messageBase(updateId), photo: [{ file_id: "photo", file_unique_id: "photo", width: 1, height: 1 }] }
  });
  const callbackQuery = (updateId: number, payload: { data: string } | { game_short_name: string }, options: { chat?: Chat } = {}): Update => ({
    update_id: updateId, callback_query: {
      id: String(updateId), from: user, chat_instance: "fixture", ...payload, message: { message_id: 20, date: 0, chat: options.chat ?? chat }
    }
  });
  const callback = (updateId: number, data: string, options: { chat?: Chat } = {}) => callbackQuery(updateId, { data }, options);
  const gameCallback = (updateId: number, gameShortName: string) => callbackQuery(updateId, { game_short_name: gameShortName });
  const replyTarget = (text: string, from: User): ReplyTarget => ({ message_id: 20, date: 0, chat, from, text, reply_to_message: undefined });
  return { chat, user, message, command, photo, callback, gameCallback, replyTarget };
}
