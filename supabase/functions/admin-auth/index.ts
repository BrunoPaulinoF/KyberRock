import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminSession } from "../_shared/admin-session.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const username = Deno.env.get("KYBERROCK_ADMIN_USERNAME") ?? "";
  const passwordHash = Deno.env.get("KYBERROCK_ADMIN_PASSWORD_HASH") ?? "";
  const passwordSalt = Deno.env.get("KYBERROCK_ADMIN_PASSWORD_SALT") ?? "";
  const sessionSecret = Deno.env.get("KYBERROCK_ADMIN_SESSION_SECRET") ?? "";

  if (!username || !passwordHash || !sessionSecret) {
    return jsonResponse({ error: "Admin auth is not configured" }, 500);
  }

  const body = await req.json().catch(() => ({})) as { username?: string; password?: string };
  const attemptedUsername = String(body.username ?? "").trim();
  const attemptedPassword = String(body.password ?? "");
  const attemptedHash = await sha256Hex(`${passwordSalt}${attemptedPassword}`);

  if (!safeEqual(attemptedUsername, username) || !safeEqual(attemptedHash, passwordHash)) {
    return jsonResponse({ error: "Usuario ou senha invalidos" }, 401);
  }

  const token = await createAdminSession(username, sessionSecret);
  return jsonResponse({ token, username, expiresInSeconds: 8 * 60 * 60 });
});
