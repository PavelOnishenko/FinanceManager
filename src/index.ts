export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok", service: "family-finance-bot" });

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler;

