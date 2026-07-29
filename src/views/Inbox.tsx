import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search, Inbox as InboxIcon, KeyRound, ArrowRight, Check, Copy,
  ShieldCheck, ShieldAlert, CheckCheck, Wifi, WifiOff,
} from "lucide-react";
import { useApp } from "../store";
import FormTree from "../components/FormTree";
import { toJSON, copyText } from "../lib/format";
import { decrypt, verify } from "../lib/crypto";
import type { Envelope } from "../lib/crypto";
import { inboxFor, addMessage, type InboxMessage } from "../lib/inboxStore";
import { kafkaStartConsumer, kafkaStopConsumer, fetchMemberKeys, isTauri } from "../lib/ecohub";

// Single source of truth: real Kafka-consumed events, persisted in the vault
// (src/lib/inboxStore.ts). No local/mock feed — this is the live inbox.
export default function Inbox() {
  const { active, toast, configured, sessionInboxIds, markReceivedThisSession } = useApp();
  const pfx = active.techUser?.techUserCert;
  const idp = active.credentials.idp || active.id;

  const [items, setItems] = useState<InboxMessage[]>(() => inboxFor(idp));
  const [consumerState, setConsumerState] = useState<"off" | "starting" | "ready" | "error">("off");
  const [q, setQ] = useState("");

  const [selId, setSelId] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decoded, setDecoded] = useState<any | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<"form" | "raw">("form");
  const [acked, setAcked] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reload history whenever the active profile's idp changes.
  useEffect(() => { setItems(inboxFor(idp)); }, [idp]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((m) => (m.fromIdp + m.subject + m.topic).toLowerCase().includes(s)) : items;
  }, [items, q]);
  const sel = items.find((m) => m.id === selId) ?? items[0] ?? null;

  useEffect(() => { setDecoded(null); setVerified(null); setAcked(false); setErr(null); }, [selId, sel?.id]);

  // Start/stop the Kafka consumer when profile connectivity changes.
  useEffect(() => {
    if (!configured || !pfx || !isTauri) return;

    setConsumerState("starting");
    kafkaStartConsumer({
      environment: active.credentials.environment,
      pfxBase64: pfx,
      password: active.credentials.password,
      idp: active.credentials.idp,
    }).catch((e) => { setConsumerState("error"); toast(`Consumer [idp=${active.credentials.idp} group=CG-00001-${active.credentials.idp}]: ${e}`); });

    return () => { kafkaStopConsumer(); setConsumerState("off"); };
  }, [configured, active.credentials.environment, active.credentials.idp]);

  // Listen for Tauri events from the consumer thread.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let unlistenReady: (() => void) | null = null;
    let unlistenErr: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ rawJson: string; topic: string; partition: number; offset: number; timestampMs: number | null }>("saf-message", (evt) => {
        try {
          const event = JSON.parse(evt.payload.rawJson);
          const envelope: Envelope = {
            payload: event.data?.payload ?? "",
            encryptionKey: event.data?.encryptionKey ?? "",
            payloadSignature: event.data?.payloadSignature ?? "",
            publicKeyVersion: event.data?.publicKeyVersion ?? "",
            signatureKeyVersion: event.data?.signatureKeyVersion ?? "",
          };
          const msg: InboxMessage = {
            id: event.id ?? `kafka-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            topic: evt.payload.topic,
            partition: evt.payload.partition,
            offset: evt.payload.offset,
            kafkaTimestampMs: evt.payload.timestampMs,
            receivedAt: new Date().toISOString(),
            toIdp: event.eventReceiver?.id ?? idp,
            fromIdp: event.eventSender?.id ?? "unknown",
            processName: event.processName ?? "",
            subject: event.subject ?? event.processName ?? "Event",
            envelope,
            rawEvent: event,
          };
          addMessage(msg);
          markReceivedThisSession(msg.id);
          setItems(inboxFor(idp));
        } catch { /* malformed message — skip */ }
      }).then((fn) => { unlisten = fn; });

      listen<void>("saf-consumer-ready", () => setConsumerState("ready")).then((fn) => { unlistenReady = fn; });

      listen<string>("saf-consumer-error", (evt) => {
        setConsumerState("error");
        toast(`Consumer error [idp=${active.credentials.idp} group=CG-00001-${active.credentials.idp}]: ${evt.payload}`);
      }).then((fn) => { unlistenErr = fn; });
    });

    return () => { unlisten?.(); unlistenReady?.(); unlistenErr?.(); };
  }, [idp]);

  async function doDecrypt() {
    if (!sel) return;
    setDecrypting(true); setErr(null);
    try {
      const privKey =
        active.encKeys.find((k) => k.version === sel.envelope.publicKeyVersion) ??
        active.encKeys.find((k) => k.active);
      if (!privKey) throw new Error(`No private key for version "${sel.envelope.publicKeyVersion}". Generate & activate one in Configuration.`);

      const clear = await decrypt(sel.envelope, privKey.privatePem);
      setDecoded(JSON.parse(clear));

      try {
        const km = await fetchMemberKeys({
          environment: active.credentials.environment,
          pfxBase64: pfx!,
          password: active.credentials.password,
          idp: sel.fromIdp,
        });
        const sigKey = km.data?.find(
          (k) => k.keyType === "signature" && k.version === sel.envelope.signatureKeyVersion
        ) ?? km.data?.find((k) => k.keyType === "signature" && k.ecoHubStatus === "Activated");
        setVerified(sigKey ? await verify(sel.envelope, sigKey.key) : false);
      } catch {
        setVerified(false);
      }
    } catch (e) {
      setErr(String(e));
    }
    setDecrypting(false);
  }

  const consumerIcon = consumerState === "ready" ? <Wifi size={12} style={{ color: "var(--ok)" }} />
    : consumerState === "error" ? <WifiOff size={12} style={{ color: "var(--err)" }} />
    : consumerState === "starting" ? <Wifi size={12} style={{ opacity: 0.4 }} />
    : null;

  const liveStatusLabel = consumerState === "ready" ? "Listening" : consumerState === "starting" ? "Connecting…" : consumerState === "error" ? "Consumer error" : "Offline";

  function fmtTime(m: InboxMessage) {
    const ms = m.kafkaTimestampMs ?? Date.parse(m.receivedAt);
    return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const rawText = decoded ? toJSON(decoded) : "";

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Inbox</h1><div className="sub">Live events consumed from Kafka, decrypt and verify</div></div>
        <div className="chead-spacer" />
        {configured && (
          <div className="live-ind">
            {consumerIcon}&nbsp;{liveStatusLabel} · {items.length} event{items.length !== 1 ? "s" : ""}
          </div>
        )}
        <div className="search"><Search size={14} /><input placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-mailbox" style={{ flex: 1 }}>
          <InboxIcon strokeWidth={1.4} />
          <div className="em-title">No incoming events</div>
          <div className="em-sub">
            {consumerState === "ready"
              ? `Listening on ${active.credentials.environment}. Events sent to ${active.credentials.idp} will appear here.`
              : "Connect this profile to start receiving events from EcoHub."}
          </div>
        </div>
      ) : (
        <div className="splitter">
          <div className="list">
            {filtered.map((m) => (
              <div key={m.id} className={"row" + (sel?.id === m.id ? " sel" : "")} onClick={() => setSelId(m.id)}>
                <span className="r-unreaddot" />
                <div className="r-body">
                  <div className="r-top">
                    <span className="r-from">{m.fromIdp}</span>
                    <span className="r-time">{fmtTime(m)}</span>
                  </div>
                  <div className="r-subject">
                    {m.subject}
                    {sessionInboxIds.has(m.id) && <span className="chip chip-ok" style={{ marginLeft: 6 }}>live</span>}
                  </div>
                  <div className="r-meta">
                    <span className="topic-tag">{m.topic}</span>
                    <span className="topic-tag">p{m.partition} · o{m.offset}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!sel ? (
            <div className="detail-empty">
              <InboxIcon strokeWidth={1.4} />
              <div className="de-title">No message selected</div>
              <div className="de-sub">Pick an event to inspect and decrypt its envelope.</div>
            </div>
          ) : (
            <div className="detail">
              <div className="pipeline">
                <div className="pane">
                  <div className="pane-head">
                    <span className="pane-step">1</span>
                    <div className="pane-titles"><div className="pane-title">Encrypted envelope</div><div className="pane-sub">Received ciphertext</div></div>
                    <button className="btn-copy" onClick={() => { copyText(toJSON(sel.envelope)); toast("Copied"); }}><Copy size={12} /> Copy</button>
                  </div>
                  <div className="pane-body">
                    <div className="enc-meta">
                      <span className="k">From</span><span className="v">{sel.fromIdp}</span>
                      <span className="k">Process</span><span className="v">{sel.processName || "—"}</span>
                      <span className="k">Topic</span><span className="v">{sel.topic}</span>
                      <span className="k">Partition · offset</span><span className="v">{sel.partition} · {sel.offset}</span>
                      <span className="k">Arrived</span><span className="v">{fmtTime(sel)}</span>
                      <span className="k">Enc key</span><span className="v">v{sel.envelope.publicKeyVersion}</span>
                      <span className="k">Sig key</span><span className="v">v{sel.envelope.signatureKeyVersion}</span>
                    </div>
                    <div className="ciph-head"><span className="lbl">payload (AES-GCM)</span></div>
                    <pre className="code-block">{sel.envelope.payload}</pre>
                  </div>
                </div>

                <div className="connector">
                  <motion.div className={"op-node" + (decoded ? " done" : "")} animate={decrypting ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={decrypting ? { repeat: Infinity, duration: 1 } : {}}>
                    {decoded ? <Check size={21} /> : <KeyRound size={21} strokeWidth={1.8} />}
                  </motion.div>
                  <button className="op-btn" disabled={decrypting} onClick={doDecrypt}>
                    {decrypting ? "Decrypting…" : "Decrypt"} <ArrowRight size={13} />
                  </button>
                  <div className="op-label">with your<br />private key</div>
                </div>

                <div className="pane">
                  <div className="pane-head">
                    <span className={"pane-step" + (decoded ? " done" : "")}>2</span>
                    <div className="pane-titles"><div className="pane-title">Decoded payload</div><div className="pane-sub">Cleartext after decryption</div></div>
                    <div className="seg" style={{ opacity: decoded ? 1 : 0.4, pointerEvents: decoded ? "auto" : "none" }}>
                      <button className={viewMode === "form" ? "on" : ""} onClick={() => setViewMode("form")}>Form</button>
                      <button className={viewMode === "raw" ? "on" : ""} onClick={() => setViewMode("raw")}>Raw</button>
                    </div>
                  </div>
                  <div className="pane-body">
                    {err ? (
                      <div className="pane-empty"><ShieldAlert style={{ color: "var(--err)" }} strokeWidth={1.5} /><div className="t">Decrypt failed</div><div className="s">{err}</div></div>
                    ) : !decoded ? (
                      <div className="pane-empty"><KeyRound strokeWidth={1.5} /><div className="t">Encrypted</div><div className="s">Decrypt with your private key to reveal the payload and verify the sender's signature.</div></div>
                    ) : viewMode === "form" ? <FormTree values={decoded} readOnly /> : <pre className="code-block">{rawText}</pre>}
                  </div>
                  {decoded && (
                    <div className="pane-foot">
                      <span className="st">
                        {verified === true
                          ? <span className="chip chip-ok"><ShieldCheck size={10} /> Signature verified</span>
                          : verified === false
                          ? <span className="chip chip-warn"><ShieldAlert size={10} /> Signature NOT verified</span>
                          : null}
                      </span>
                      <button className="btn-primary" disabled={acked} onClick={() => { setAcked(true); toast("Acknowledged"); }}>
                        <CheckCheck size={14} /> {acked ? "Acknowledged" : "Acknowledge"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
