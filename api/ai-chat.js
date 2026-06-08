export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key neconfigurat pe server." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body invalid." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, systemPrompt, tools } = body;
  if (!messages || !systemPrompt) {
    return new Response(JSON.stringify({ error: "Lipsesc campuri obligatorii." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await anthropicRes.json();

  if (!anthropicRes.ok) {
    return new Response(JSON.stringify({ error: data.error?.message || "Eroare API." }), {
      status: anthropicRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Returnam raspunsul complet: blocurile de continut (text + tool_use) si motivul opririi
  return new Response(JSON.stringify({ content: data.content, stop_reason: data.stop_reason }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
