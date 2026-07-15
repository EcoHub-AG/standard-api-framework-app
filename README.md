# Standard API Framework — app (redesign)

Phase-1 UI of the SAF Testing Tool redesign, per `../EcoHub-AG/saf-testing-tool/REDESIGN_PLAN.md`.

**Stack:** Tauri + React + TypeScript + Tailwind v4 + Framer Motion + Lucide.

## Run

```bash
npm install
npm run dev          # UI in browser → http://localhost:1421
npm run tauri dev    # native window (needs Rust + C++ build tools)
```

## What's implemented (Phase 1, UI)

- macOS-style **title bar**: member name, role chip, identity dropdown (Insurer/Broker), rename, **connection pill** (U4/U8).
- **Sidebar** IA — Data Exchange (Send event, Receive event, Inbox, Outbox) + Setup (Configuration) (U1).
- **Send event** pipeline: Target + standard selectors, Payload with **Form/Raw + JSON/XML** + test-file loader, animated **Encrypt → Send** (U5/F4/F6).
- **Receive event** pipeline: incoming envelope → **Decrypt** → decoded (Form/Raw) + **Acknowledge** (F1), live "Listening" indicator (U6).
- **Inbox / Outbox** with Verified/Unverified + Delivered/Failed/Delivering chips, signature panel, empty states, search.
- **Configuration**: Connection, Tech user, **keys folded in** (generate/import/activate, U2/U3/F2); **Test connection** + **Reconnect** (U7); reconnecting **does not delete keys** (decoupled).
- Role theming (petrol/indigo), toasts, friendly error catalog scaffold (F3).

## Backend boundary

`src/lib/backend.ts` is the seam. Phase 1 = mock (delays + fake ciphertext). Phase 2 swaps each
function for a Tauri `invoke(...)` into a **.NET sidecar** reusing the verified SAF crypto
(AES-256 + RSA-OAEP-SHA256, GZip + AES-GCM, SHA-384 + ECDSA) and Kafka — UI unchanged.
