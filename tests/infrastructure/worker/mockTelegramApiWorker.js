const calls = [];
export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (url.hostname === "mock.local" && url.pathname === "/calls") 
      return Response.json(calls);
    const botPath = `/bot${environment.BOT_TOKEN}/`;
    if (url.hostname !== "api.telegram.org" || !url.pathname.startsWith(botPath))
      return new Response("Unexpected outbound request", { status: 502 });

    const method = url.pathname.slice(botPath.length);
    const payload = await request.json();
    calls.push({ method, payload });
    const bot = {
      id: Number(environment.BOT_ID), is_bot: true, first_name: "Test", username: "test_bot", can_join_groups: false,
      can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false
    };
    if (method === "getMe") return Response.json({ ok: true, result: bot });
    if (method === "sendMessage") return Response.json({ ok: true, result: {
      message_id: 20, date: 0, chat: { id: payload.chat_id, type: "private", first_name: "Test user" }, from: bot, text: payload.text
    } });
    if (method === "editMessageText" || method === "answerCallbackQuery") return Response.json({ ok: true, result: true });
    return new Response(`Unexpected Telegram method: ${method}`, { status: 502 });
  }
};
