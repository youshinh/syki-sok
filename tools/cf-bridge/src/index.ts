import { PWA_HTML } from "./pwa_html";
import { APP_ICON_B64 } from "./app_icon";

export interface Env {
  DB: D1Database;
  BUCKET?: R2Bucket;
  AUTH_TOKEN: string;
}

interface MemoAttachment {
  type: "image" | "audio" | "file";
  mime: string;
  filename: string;
  dataBase64: string; // Base64 encoded binary
}

interface MemoPayload {
  client_time?: string;
  device?: string;
  type?: "text" | "image" | "audio" | "file";
  text?: string;
  attachment?: MemoAttachment | null;
}

// Constant-time token verification against timing attacks
async function verifyAuth(req: Request, expectedToken: string): Promise<boolean> {
  if (!expectedToken) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1];

  const enc = new TextEncoder();
  const a = enc.encode(token);
  const b = enc.encode(expectedToken);
  if (a.byteLength !== b.byteLength) {
    crypto.subtle.timingSafeEqual(a, a);
    return false;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}

// Base64 helper
function base64ToArrayBuffer(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // 0. Enforce HTTPS in production for Secure Context (Microphone & Camera API)
    const proto = req.headers.get("x-forwarded-proto");
    if (proto === "http") {
      const httpsUrl = new URL(req.url);
      httpsUrl.protocol = "https:";
      return Response.redirect(httpsUrl.toString(), 301);
    }

    // 1. CORS Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 2. Serve Web PWA Frontend
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(req.method === "HEAD" ? null : PWA_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, must-revalidate",
          "Permissions-Policy": "camera=(self), microphone=(self)",
        },
      });
    }

    // 2.5 Serve App Icon & Favicon
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/app.png" || url.pathname === "/favicon.ico" || url.pathname === "/favicon.png")) {
      const buffer = base64ToArrayBuffer(APP_ICON_B64);
      return new Response(req.method === "HEAD" ? null : buffer, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // 3. PWA Web App Manifest
    if (req.method === "GET" && url.pathname === "/manifest.json") {
      const manifest = {
        name: "syki::sok Quick Capture",
        short_name: "syki::sok",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#101113",
        theme_color: "#101113",
        icons: [
          {
            src: "/app.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/app.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      };
      return new Response(JSON.stringify(manifest), {
        headers: {
          "Content-Type": "application/manifest+json",
          "Cache-Control": "no-cache, must-revalidate",
        },
      });
    }

    // 4. API Endpoints (Auth Required)
    if (url.pathname.startsWith("/api/")) {
      const isAuthorized = await verifyAuth(req, env.AUTH_TOKEN);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      // POST /api/memo : Ingest a new memo from Mobile
      if (req.method === "POST" && url.pathname === "/api/memo") {
        try {
          const body: MemoPayload = await req.json();
          const now = Date.now();
          const id = `${now}-${crypto.randomUUID().slice(0, 8)}`;
          const serverTime = new Date().toISOString();
          const clientTime = body.client_time || serverTime;
          const device = body.device || "Mobile";
          const contentType = body.type || (body.attachment ? body.attachment.type : "text");
          const textContent = body.text || "";

          // Geo from Cloudflare Edge
          const cf = req.cf as any;
          const geo = cf?.city ? `${cf.city}, ${cf.country || "JP"}` : (cf?.country || "Online");

          let filename: string | null = null;
          let fileMime: string | null = null;
          let fileData: Uint8Array | null = null;
          let r2Key: string | null = null;

          if (body.attachment && body.attachment.dataBase64) {
            filename = body.attachment.filename || `file_${now}`;
            fileMime = body.attachment.mime || "application/octet-stream";
            const bytes = base64ToArrayBuffer(body.attachment.dataBase64);

            if (env.BUCKET) {
              r2Key = `media/${id}/${filename}`;
              await env.BUCKET.put(r2Key, bytes, {
                httpMetadata: { contentType: fileMime },
              });
            } else {
              fileData = bytes;
            }
          }

          // Insert into D1
          await env.DB.prepare(
            `INSERT INTO memos (id, device, client_time, server_time, geo, content_type, text_content, filename, file_mime, file_data, r2_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              id,
              device,
              clientTime,
              serverTime,
              geo,
              contentType,
              textContent,
              filename,
              fileMime,
              fileData,
              r2Key,
              now
            )
            .run();

          return new Response(JSON.stringify({ ok: true, id }), {
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message || "Failed to save memo" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
      }

      // GET /api/memos : Fetch all unread memos (Called by PC syki::sok)
      if (req.method === "GET" && url.pathname === "/api/memos") {
        try {
          const { results } = await env.DB.prepare(
            `SELECT id, device, client_time, server_time, geo, content_type, text_content, filename, file_mime, file_data, r2_key, created_at
             FROM memos ORDER BY created_at ASC`
          ).all();

          const memos = await Promise.all(
            results.map(async (row: any) => {
              let attachmentBase64: string | null = null;

              if (row.r2_key && env.BUCKET) {
                const obj = await env.BUCKET.get(row.r2_key);
                if (obj) {
                  const buf = await obj.arrayBuffer();
                  attachmentBase64 = arrayBufferToBase64(buf);
                }
              } else if (row.file_data) {
                attachmentBase64 = arrayBufferToBase64(row.file_data);
              }

              return {
                id: row.id,
                device: row.device,
                client_time: row.client_time,
                server_time: row.server_time,
                geo: row.geo,
                content_type: row.content_type,
                text_content: row.text_content,
                filename: row.filename,
                file_mime: row.file_mime,
                attachment_base64: attachmentBase64,
                created_at: row.created_at,
              };
            })
          );

          return new Response(JSON.stringify({ ok: true, memos }), {
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
      }

      // DELETE /api/memos : Bulk delete collected memos (Called by PC syki::sok after saving)
      if (req.method === "DELETE" && url.pathname === "/api/memos") {
        try {
          const body: { ids: string[] } = await req.json();
          if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
            return new Response(JSON.stringify({ ok: true, deleted: 0 }), {
              headers: { "Content-Type": "application/json", ...corsHeaders() },
            });
          }

          // Clean up R2 objects if any
          if (env.BUCKET) {
            for (const id of body.ids) {
              const row: any = await env.DB.prepare("SELECT r2_key FROM memos WHERE id = ?").bind(id).first();
              if (row && row.r2_key) {
                await env.BUCKET.delete(row.r2_key);
              }
            }
          }

          // Delete from D1
          const placeholders = body.ids.map(() => "?").join(",");
          const stmt = env.DB.prepare(`DELETE FROM memos WHERE id IN (${placeholders})`);
          await stmt.bind(...body.ids).run();

          return new Response(JSON.stringify({ ok: true, deleted: body.ids.length }), {
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
