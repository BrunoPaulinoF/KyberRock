import { base64UrlDecode, base64UrlEncode, hmacSha256Hex, safeEqual } from "./crypto.ts";

export interface AdminSessionPayload {
  sub: string;
  role: "platform_admin";
  exp: number;
}

export async function createAdminSession(username: string, secret: string): Promise<string> {
  const payload: AdminSessionPayload = {
    sub: username,
    role: "platform_admin",
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256Hex(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyAdminSession(token: string | null, secret: string): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = await hmacSha256Hex(secret, encodedPayload);
  if (!safeEqual(signature, expected)) return null;
  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminSessionPayload;
  if (payload.role !== "platform_admin") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
