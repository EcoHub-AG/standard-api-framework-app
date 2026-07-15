// ============================================================
// Backend boundary.
//
// Phase 1 (now): mock implementation so the UI is fully usable.
// Phase 2: swap the body of each function for a Tauri `invoke(...)`
//   call into the .NET sidecar that reuses the verified SAF crypto
//   (AES-256 + RSA-OAEP-SHA256, GZip + AES-GCM, SHA-384 + ECDSA) and
//   Kafka transport. The UI does not change — only this file.
// ============================================================
import { chunk, randB64, toJSON } from "./format";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type EncryptResult = {
  recipient: string;
  kid: string;
  contentType: string;
  cipher: string; // JWE-compact-style preview
  signed: boolean;
};

export async function encrypt(opts: { recipient: string; standardNs: string; cleartext: string }): Promise<EncryptResult> {
  await delay(650); // emulate crypto + key fetch
  const header = randB64(38);
  const encKey = randB64(64);
  const iv = randB64(16);
  const body = randB64(220);
  const tag = randB64(22);
  return {
    recipient: opts.recipient,
    kid: "enc-" + randB64(8).toLowerCase(),
    contentType: "application/json+gzip",
    signed: true,
    cipher: chunk([header, encKey, iv, body, tag].join("."), 64),
  };
}

export async function send(_envelope: EncryptResult & { topic: string }): Promise<{ partition: number; offset: number }> {
  await delay(900);
  return { partition: 0, offset: Math.floor(Math.random() * 90000) + 1000 };
}

export async function decrypt(_cipher: string): Promise<{ payload: Record<string, any>; verified: boolean; signer: string }> {
  await delay(700);
  return { payload: {}, verified: true, signer: "sha256:9f2c4ad1…a14e · ECDSA-P384" };
}

export async function connect(_cfg: Record<string, string>): Promise<{ ok: boolean; member: string }> {
  await delay(750);
  return { ok: true, member: "SAF Insurer" };
}

export async function generateKeyPair(): Promise<{ fingerprint: string; publicKeyPem: string }> {
  await delay(300);
  return {
    fingerprint: "sha256:" + randB64(8).toLowerCase() + "…" + randB64(4).toLowerCase() + " · RSA-2048",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\n" + chunk(randB64(380), 64) + "\n-----END PUBLIC KEY-----",
  };
}

// Friendly error catalog (PRD F3) — map raw failures to actionable guidance.
export const ERROR_GUIDANCE: Record<string, string> = {
  kafka_subscribe: "Cannot subscribe to the Kafka topic. Check your connection and that the tech user is enrolled.",
  no_receivers: "No receivers found. Load receivers again, or verify your license key for this environment.",
  no_private_key: "No private key found for this version. Import or activate a matching key in Configuration.",
  decrypt_failed: "Failed to decrypt the AES key. The envelope may target a different key version than the one active here.",
};

export { toJSON };
