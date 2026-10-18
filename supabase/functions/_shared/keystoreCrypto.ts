// AES-GCM encryption for keystore passwords. The key is derived from
// SUPABASE_SERVICE_ROLE_KEY via HKDF-SHA-256, so we don't ask the user
// to manage yet another secret. Rotating the service role key means
// re-encrypting (or asking users to re-enter passwords) — acceptable
// trade-off given how rarely role keys rotate.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(): Promise<CryptoKey> {
  const seed = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!seed) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  const ikm = await crypto.subtle.importKey("raw", enc.encode(seed), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("lovable.keystores.v1"),
      info: enc.encode("aes-gcm-256"),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptString(plain: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptString(payload: string): Promise<string> {
  const key = await deriveKey();
  const buf = b64decode(payload);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}
