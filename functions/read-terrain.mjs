// Reads an onX topo screenshot with the Claude API and streams back a relative elevation grid as JSON text.
// Environment variables (Netlify > Site configuration > Environment variables):
//   ANTHROPIC_API_KEY        required, your key from console.anthropic.com
//   APP_PASSCODE             optional, visitors must enter this before scanning
//   DAILY_SCANS_PER_VISITOR  optional, default 10 (0 turns the daily cap off)
//   ANTHROPIC_MODEL          optional, default claude-sonnet-5-5
import { getStore } from "@netlify/blobs";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function buildPrompt(R, C, hints) {
  return `You are reading a screenshot of an onX Hunt map that shows topographic contour lines (with elevation labels on index lines) and possibly slope-angle shading (colored overlay where steeper ground is warmer colors), creeks (blue lines), and roads.
Build a relative ground elevation model of the WHOLE image as a grid with ${R} rows and ${C} columns. Row 0 is the TOP edge of the image, column 0 is the LEFT edge. Values are whole numbers of relative elevation from 0 (lowest ground in the image) to 100 (highest).
Method: use contour elevation labels where readable; contour lines bend upstream (pointing uphill) where they cross drainages and creeks; creeks and blue lines are low ground; closed contour rings are hilltops unless hachured; tightly spaced lines or hot slope shading mean steep ground. Keep ridgelines, saddles, benches, and drainages in their correct positions.
${hints ? "Hints from the hunter: " + hints + "\n" : ""}Reply with only compact JSON (no spaces, no line breaks inside the grid) in this shape: {"grid":[[...${C} numbers...], ... ${R} rows],"summary":"one sentence naming the main features you found and where","confidence":"low|medium|high"}`;
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "not_configured" }, 500);

  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers.get("x-passcode") !== pass) return json({ error: "passcode" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const image = body && body.image;
  if (typeof image !== "string" || image.length < 100 || image.length > 5_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image))
    return json({ error: "bad_image" }, 400);
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body.mediaType) ? body.mediaType : "image/jpeg";
  const R = Math.max(12, Math.min(48, parseInt(body.rows, 10) || 24));
  const C = Math.max(12, Math.min(48, parseInt(body.cols, 10) || 24));
  const hints = typeof body.hints === "string" ? body.hints.slice(0, 300) : "";

  // Daily cap per visitor IP, stored in Netlify Blobs.
  const limit = parseInt(process.env.DAILY_SCANS_PER_VISITOR ?? "10", 10);
  if (limit > 0) {
    try {
      const store = getStore("scan-counts");
      const k = `${new Date().toISOString().slice(0, 10)}/${context.ip || "unknown"}`;
      const n = parseInt((await store.get(k)) || "0", 10);
      if (n >= limit) return json({ error: "daily_limit" }, 429);
      await store.set(k, String(n + 1));
    } catch (e) {
      console.error("scan counter unavailable", e);
    }
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      stream: true,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: buildPrompt(R, C, hints) },
        ],
      }],
    }),
  });

  if (!upstream.ok) {
    console.error("Claude API error", upstream.status, await upstream.text());
    const busy = upstream.status === 429 || upstream.status === 529;
    return json({ error: busy ? "rate_limited" : "upstream_error" }, 502);
  }

  // Turn the API's event stream into plain text so the page can show progress.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const rd = upstream.body.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
              ctrl.enqueue(enc.encode(ev.delta.text));
            } else if (ev.type === "error") {
              ctrl.enqueue(enc.encode("[[ERROR:upstream_error]]"));
            } else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason === "max_tokens") {
              ctrl.enqueue(enc.encode("[[ERROR:invalid_json]]"));
            }
          }
        }
      } catch (e) {
        console.error("stream failed", e);
        ctrl.enqueue(enc.encode("[[ERROR:upstream_error]]"));
      }
      ctrl.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = {
  path: "/api/read-terrain",
  method: "POST",
  // Burst protection: at most 3 scans per minute from one visitor.
  rateLimit: { windowLimit: 3, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
