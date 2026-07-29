// ============================================================
// Real SAF crypto using the Web Crypto API (SubtleCrypto).
//
// Matches the scheme in the C# reference tool:
//   • content: GZip → AES-256-GCM  (output = nonce[12] ‖ ciphertext ‖ tag[16])
//   • AES key wrap: RSA-OAEP-SHA256
//   • signature: ECDSA P-384 over the SHA-384 of the ciphertext
//
// Note on interop: Web Crypto ECDSA signatures are raw r‖s; the C# tool uses
// DER (Rfc3279DerSequence). For local round-trip (sign+verify in this app) raw
// is consistent and correct. DER conversion is only needed when verifying
// against the live EcoHub counterparties — that lives in the network layer.
// ============================================================

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

// TS 5.x types Uint8Array as Uint8Array<ArrayBufferLike>; Web Crypto / Blob want
// BufferSource / BlobPart over ArrayBuffer. Runtime is identical — cast at the seam.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;
const bp = (u: Uint8Array): BlobPart => u as unknown as BlobPart;

// ---------- base64 ----------
export function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- PEM ----------
function toPem(der: ArrayBuffer, label: string): string {
  const b64 = b64encode(der).replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
}
function fromPem(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return b64decode(body);
}

// ---------- ECDSA signature format ----------
// Web Crypto produces/consumes raw r‖s (IEEE P1363). The C# reference tool uses
// DER (Rfc3279DerSequence). Convert at the boundary so signatures are byte-for-byte
// interoperable with EcoHub counterparties. P-384 → each integer is 48 bytes.
const P384 = 48;

function rawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const encodeInt = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++; // strip leading zeros
    let v = b.slice(i);
    if (v[0] & 0x80) { const t = new Uint8Array(v.length + 1); t.set(v, 1); v = t; } // pad if high bit set
    const out = new Uint8Array(2 + v.length);
    out[0] = 0x02; out[1] = v.length; out.set(v, 2);
    return out;
  };
  const r = encodeInt(raw.slice(0, half));
  const s = encodeInt(raw.slice(half));
  const len = r.length + s.length;
  const header = len < 128 ? new Uint8Array([0x30, len]) : new Uint8Array([0x30, 0x81, len]);
  const out = new Uint8Array(header.length + len);
  out.set(header, 0); out.set(r, header.length); out.set(s, header.length + r.length);
  return out;
}

function derToRaw(der: Uint8Array, size = P384): Uint8Array {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("invalid DER signature");
  let seqLen = der[i++];
  if (seqLen & 0x80) { const n = seqLen & 0x7f; seqLen = 0; for (let k = 0; k < n; k++) seqLen = (seqLen << 8) | der[i++]; }
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("invalid DER integer");
    const len = der[i++];
    let v = der.slice(i, i + len); i += len;
    let j = 0;
    while (j < v.length - 1 && v[j] === 0) j++; // strip leading zero pad
    v = v.slice(j);
    const out = new Uint8Array(size);
    out.set(v, size - v.length); // left-pad to fixed width
    return out;
  };
  const r = readInt(), s = readInt();
  const out = new Uint8Array(size * 2);
  out.set(r, 0); out.set(s, size);
  return out;
}

// ---------- gzip via CompressionStream ----------
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([bp(data)]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bp(data)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- key generation ----------
export type KeyPair = { publicPem: string; privatePem: string };

export async function generateEncryptionKeyPair(): Promise<KeyPair> {
  const kp = await subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  return {
    publicPem: toPem(await subtle.exportKey("spki", kp.publicKey), "PUBLIC KEY"),
    privatePem: toPem(await subtle.exportKey("pkcs8", kp.privateKey), "PRIVATE KEY"),
  };
}

export async function generateSignatureKeyPair(): Promise<KeyPair> {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
  return {
    publicPem: toPem(await subtle.exportKey("spki", kp.publicKey), "PUBLIC KEY"),
    privatePem: toPem(await subtle.exportKey("pkcs8", kp.privateKey), "PRIVATE KEY"),
  };
}

// ---------- imported key validation ----------
// Confirms a pasted/uploaded PEM pair is actually usable for the given
// algorithm before it's saved as a KeyRecord — throws on any mismatch.
export async function validateEncryptionKeyPair(publicPem: string, privatePem: string): Promise<void> {
  await subtle.importKey("spki", bs(fromPem(publicPem)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  await subtle.importKey("pkcs8", bs(fromPem(privatePem)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}
export async function validateSignatureKeyPair(publicPem: string, privatePem: string): Promise<void> {
  await subtle.importKey("spki", bs(fromPem(publicPem)), { name: "ECDSA", namedCurve: "P-384" }, false, ["verify"]);
  await subtle.importKey("pkcs8", bs(fromPem(privatePem)), { name: "ECDSA", namedCurve: "P-384" }, false, ["sign"]);
}

export async function fingerprint(publicPem: string): Promise<string> {
  const hash = await subtle.digest("SHA-256", bs(fromPem(publicPem)));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

// ---------- encrypt / sign ----------
export type Envelope = {
  payload: string;          // base64( nonce ‖ ciphertext ‖ tag )
  encryptionKey: string;    // base64( RSA-OAEP wrapped AES key )
  payloadSignature: string; // base64( ECDSA signature )
  publicKeyVersion: string;
  signatureKeyVersion: string;
};

export async function encryptAndSign(opts: {
  cleartext: string | Uint8Array;
  recipientEncPublicPem: string;
  publicKeyVersion: string;
  signerSigPrivatePem: string;
  signatureKeyVersion: string;
}): Promise<Envelope> {
  // 1. AES-256 key + GCM encrypt over gzipped content
  // For binary uploads (e.g. PDFs) opts.cleartext is the raw file bytes — encrypt
  // those directly. Only string input (typed/pasted text) goes through TextEncoder.
  const rawAes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await subtle.importKey("raw", bs(rawAes), "AES-GCM", false, ["encrypt"]);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const rawInput = typeof opts.cleartext === "string" ? te.encode(opts.cleartext) : opts.cleartext;
  const zipped = await gzip(rawInput);
  const ctAndTag = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: bs(nonce), tagLength: 128 }, aesKey, bs(zipped)));
  const combined = new Uint8Array(nonce.length + ctAndTag.length);
  combined.set(nonce, 0);
  combined.set(ctAndTag, nonce.length);
  const payloadB64 = b64encode(combined);

  // 2. wrap AES key with recipient RSA-OAEP public key
  const rsaPub = await subtle.importKey("spki", bs(fromPem(opts.recipientEncPublicPem)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const wrapped = await subtle.encrypt({ name: "RSA-OAEP" }, rsaPub, bs(rawAes));

  // 3. sign the ciphertext (base64 string bytes, SHA-384 inside ECDSA)
  const sigPriv = await subtle.importKey("pkcs8", bs(fromPem(opts.signerSigPrivatePem)), { name: "ECDSA", namedCurve: "P-384" }, false, ["sign"]);
  const rawSig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-384" }, sigPriv, bs(te.encode(payloadB64))));

  return {
    payload: payloadB64,
    encryptionKey: b64encode(wrapped),
    payloadSignature: b64encode(rawToDer(rawSig)), // DER (Rfc3279DerSequence), matching the C# tool
    publicKeyVersion: opts.publicKeyVersion,
    signatureKeyVersion: opts.signatureKeyVersion,
  };
}

// ---------- decrypt / verify ----------
export async function decrypt(env: Envelope, recipientEncPrivatePem: string): Promise<string> {
  const rsaPriv = await subtle.importKey("pkcs8", bs(fromPem(recipientEncPrivatePem)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const rawAes = new Uint8Array(await subtle.decrypt({ name: "RSA-OAEP" }, rsaPriv, bs(b64decode(env.encryptionKey))));
  const aesKey = await subtle.importKey("raw", bs(rawAes), "AES-GCM", false, ["decrypt"]);

  const combined = b64decode(env.payload);
  const nonce = combined.slice(0, 12);
  const ctAndTag = combined.slice(12);
  const zipped = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: bs(nonce), tagLength: 128 }, aesKey, bs(ctAndTag)));
  return td.decode(await gunzip(zipped));
}

// ---------- Public Key Store challenge helpers ----------
// Encryption key proof: server sends RSA-OAEP-SHA256 ciphertext; decrypt it.
export async function rsaDecryptToString(cipherB64: string, privatePem: string): Promise<string> {
  const rsaPriv = await subtle.importKey("pkcs8", bs(fromPem(privatePem)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "RSA-OAEP" }, rsaPriv, bs(b64decode(cipherB64))));
  return td.decode(plain);
}
// Signature key proof: server sends a string; sign it (ECDSA SHA-384, DER) → base64.
export async function signTextToDerB64(text: string, privatePem: string): Promise<string> {
  const sigPriv = await subtle.importKey("pkcs8", bs(fromPem(privatePem)), { name: "ECDSA", namedCurve: "P-384" }, false, ["sign"]);
  const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-384" }, sigPriv, bs(te.encode(text))));
  return b64encode(rawToDer(raw));
}

export async function verify(env: Envelope, signerSigPublicPem: string): Promise<boolean> {
  try {
    const sigPub = await subtle.importKey("spki", bs(fromPem(signerSigPublicPem)), { name: "ECDSA", namedCurve: "P-384" }, false, ["verify"]);
    const rawSig = derToRaw(b64decode(env.payloadSignature)); // DER → raw r‖s for Web Crypto
    return await subtle.verify({ name: "ECDSA", hash: "SHA-384" }, sigPub, bs(rawSig), bs(te.encode(env.payload)));
  } catch {
    return false;
  }
}
