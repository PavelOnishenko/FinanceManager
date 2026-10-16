import assert from "node:assert/strict";

type InlineButton = { text: string; callback_data: string };
export type TelegramApiCall = { method: string; payload: Record<string, unknown> };

export function buttonNamed(keyboard: InlineButton[][], text: string): InlineButton {
  const button = keyboard.flat().find(button => button.text === text);
  assert(button, `Expected button ${JSON.stringify(text)}; got ${JSON.stringify(keyboard)}`);
  return button;
}

export function createTelegramOutput(calls: () => TelegramApiCall[]) {
  const lastCall = () => {
    const call = calls().at(-1);
    assert(call, "Expected a Telegram API response");
    return call;
  };
  const screen = () => {
    const call = calls().findLast(call => call.method === "sendMessage" || call.method === "editMessageText");
    assert(call, "Expected a sent or edited Telegram message");
    return call.payload;
  };
  const keyboard = () => {
    const markup = screen().reply_markup as { inline_keyboard?: InlineButton[][] } | undefined;
    assert(markup?.inline_keyboard, `Expected inline buttons; got ${JSON.stringify(screen())}`);
    return markup.inline_keyboard;
  };
  const expectMenu = () => {
    const markup = screen().reply_markup as { keyboard?: { text: string }[][] } | undefined;
    assert(markup?.keyboard, `Expected the main menu; got ${JSON.stringify(screen())}`);
    assert.deepEqual(markup.keyboard[0]?.map(button => button.text), ["История", "Статистика", "Категории", "Помощь"]);
  };
  const expectAcknowledgement = (text?: string | RegExp) => {
    assert.equal(lastCall().method, "answerCallbackQuery");
    if (typeof text === "string")
      assert.equal(lastCall().payload.text, text);
    else if (text)
      assert.match(String(lastCall().payload.text), text);
  };
  const expectAlert = (text: string | RegExp) => {
    expectAcknowledgement(text);
    assert.equal(lastCall().payload.show_alert, true);
  };
  const expectForceReply = () => {
    assert.equal((screen().reply_markup as { force_reply?: boolean } | undefined)?.force_reply, true);
  };
  return {
    screen,
    text: () => String(screen().text),
    lastCall,
    lastText: () => String(lastCall().payload.text),
    keyboard,
    button: (text: string) => buttonNamed(keyboard(), text),
    hasButton: (text: string) => keyboard().flat().some(button => button.text === text),
    // d:<expense ID> is the details button carried by each displayed expense row.
    expenseButtons: () => keyboard().flat().filter(button => /^d:/.test(button.callback_data)),
    expectMenu,
    expectAcknowledgement,
    expectAlert,
    expectForceReply,
    expectNoMessageEdits: () => assert(!calls().some(call => call.method === "editMessageText"), "Expected no edited messages")
  };
}
