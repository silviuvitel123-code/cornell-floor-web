import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
const dataFile = join(dataDir, "state.json");
const port = Number(process.env.PORT || 8787);
const token = process.env.APP_SYNC_TOKEN || "schimba-tokenul-asta";

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(payload);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  return header === `Bearer ${token}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  if (!authorized(req)) return send(res, 401, { error: "Token invalid sau lipsa." });

  try {
    if (req.method === "GET" && req.url === "/api/state") {
      try {
        const content = await readFile(dataFile, "utf8");
        return send(res, 200, JSON.parse(content));
      } catch {
        return send(res, 200, { state: null, updatedAt: null });
      }
    }

    if (req.method === "POST" && req.url === "/api/state") {
      const body = await readJson(req);
      await mkdir(dataDir, { recursive: true });
      const saved = { state: body.state, updatedAt: new Date().toISOString() };
      await writeFile(dataFile, JSON.stringify(saved, null, 2), "utf8");
      return send(res, 200, saved);
    }

    return send(res, 404, { error: "Ruta inexistenta." });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`CF Cornell's Floor sync server ruleaza pe portul ${port}`);
});
