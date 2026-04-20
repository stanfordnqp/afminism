const ALLOWED_ORIGINS = [
  "https://stanfordnqp.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/") {
      const contentLength = Number(request.headers.get("Content-Length") ?? 0);
      if (contentLength > 25_000_000) {
        return new Response("Payload too large (max 25 MB)", { status: 413, headers: cors });
      }
      const id = crypto.randomUUID().slice(0, 8);
      await env.R2.put(id, request.body, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { created: String(Date.now()) },
      });
      return Response.json({ id }, { headers: cors });
    }

    if (request.method === "GET") {
      const id = url.pathname.slice(1);
      if (!id) return new Response("Not found", { status: 404, headers: cors });
      const obj = await env.R2.get(id);
      if (!obj) return new Response("Not found", { status: 404, headers: cors });
      return new Response(obj.body, {
        headers: { ...cors, "Content-Type": "application/octet-stream" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};
