/**
 * Malý pomocný server pre odrezy z animácie (kollar.html).
 *   deno run --allow-net --allow-write tools/kollar_dump_server.ts
 * POST /dump?name=xyz  (telo = data:image/png;base64,...)  ->  shots/xyz.png
 * GET  /               ->  zoznam uložených snímok
 */
const shotsDir = new URL("../shots/", import.meta.url);
await Deno.mkdir(shotsDir, { recursive: true });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
};

Deno.serve({ port: 8812, onListen: () => console.log("dump server: http://127.0.0.1:8812/dump") }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "POST" && url.pathname === "/dump") {
    const name = (url.searchParams.get("name") || "shot").replace(/[^a-zA-Z0-9_.-]/g, "");
    const body = (await req.text()).replace(/^data:image\/png;base64,/, "");
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    await Deno.writeFile(new URL(name + ".png", shotsDir), bytes);
    return new Response(`ok ${bytes.length}B ${name}.png`, { headers: cors });
  }
  if (req.method === "GET") {
    const list = [];
    for await (const e of Deno.readDir(shotsDir)) list.push(e.name);
    return new Response(list.join("\n"), { headers: { ...cors, "Content-Type": "text/plain" } });
  }
  return new Response("nope", { status: 404, headers: cors });
});
