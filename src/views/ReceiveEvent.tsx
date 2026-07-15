import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, ArrowRight, Check, Copy, ShieldCheck, ShieldAlert, CheckCheck, Inbox, Wifi, WifiOff } from "lucide-react";
import { useApp } from "../store";
import FormTree from "../components/FormTree";
import { toJSON, copyText } from "../lib/format";
import { decrypt, verify } from "../lib/crypto";
import type { Envelope } from "../lib/crypto";
import { inboxFor } from "../lib/bus";
import type { BusMessage } from "../types";
import { kafkaStartConsumer, kafkaStopConsumer, fetchMemberKeys, isTauri } from "../lib/ecohub";

// A received event — either from the local bus (self-test) or real Kafka.
type Incoming =
  | { kind: "bus"; msg: BusMessage }
  | { kind: "kafka"; id: string; topic: string; time: string; subject: string; fromIdp: string; processName: string; envelope: Envelope; rawEvent: any };

function incomingId(inc: Incoming) { return inc.kind === "bus" ? inc.msg.id : inc.id; }
function incomingLabel(inc: Incoming) {
  if (inc.kind === "bus") return `${inc.msg.fromName} — ${inc.msg.subject}`;
  return `${inc.fromIdp} — ${inc.subject}`;
}
function incomingEnvelope(inc: Incoming): Envelope {
  return inc.kind === "bus" ? inc.msg.envelope : inc.envelope;
}

export default function ReceiveEvent() {
  const { active, toast, busTick, configured } = useApp();
  const pfx = active.techUser?.techUserCert;
  const idp = active.credentials.idp || active.id;

  const busMessages = inboxFor(idp);
  const [kafkaEvents, setKafkaEvents] = useState<Extract<Incoming, { kind: "kafka" }>[]>([]);
  const [consumerState, setConsumerState] = useState<"off" | "starting" | "ready" | "error">("off");

  const allIncoming: Incoming[] = [
    ...kafkaEvents,
    ...busMessages.map((msg): Incoming => ({ kind: "bus", msg })),
  ];

  const [selId, setSelId] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decoded, setDecoded] = useState<any | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<"form" | "raw">("form");
  const [acked, setAcked] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const src = allIncoming.find((m) => incomingId(m) === selId) ?? allIncoming[0] ?? null;

  // Reset decrypt state when selected message changes.
  useEffect(() => { setDecoded(null); setVerified(null); setAcked(false); setErr(null); }, [selId, src && incomingId(src)]);

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
      listen<{ rawJson: string; topic: string }>("saf-message", (evt) => {
        try {
          const event = JSON.parse(evt.payload.rawJson);
          const envelope: Envelope = {
            payload: event.data?.payload ?? "",
            encryptionKey: event.data?.encryptionKey ?? "",
            payloadSignature: event.data?.payloadSignature ?? "",
            publicKeyVersion: event.data?.publicKeyVersion ?? "",
            signatureKeyVersion: event.data?.signatureKeyVersion ?? "",
          };
          const incoming: Extract<Incoming, { kind: "kafka" }> = {
            kind: "kafka",
            id: event.id ?? `kafka-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            topic: evt.payload.topic,
            time: event.time ?? new Date().toISOString(),
            subject: event.subject ?? event.processName ?? "Event",
            fromIdp: event.eventSender?.id ?? "unknown",
            processName: event.processName ?? "",
            envelope,
            rawEvent: event,
          };
          setKafkaEvents((prev) => [incoming, ...prev]);
        } catch { /* malformed message — skip */ }
      }).then((fn) => { unlisten = fn; });

      listen<void>("saf-consumer-ready", () => setConsumerState("ready"))
        .then((fn) => { unlistenReady = fn; });

      listen<string>("saf-consumer-error", (evt) => {
        setConsumerState("error");
        toast(`Consumer error [idp=${active.credentials.idp} group=CG-00001-${active.credentials.idp}]: ${evt.payload}`);
      }).then((fn) => { unlistenErr = fn; });
    });

    return () => { unlisten?.(); unlistenReady?.(); unlistenErr?.(); };
  }, []);

  async function doDecrypt() {
    if (!src) return;
    setDecrypting(true); setErr(null);
    const envelope = incomingEnvelope(src);
    try {
      // Find the private key matching the publicKeyVersion in the envelope.
      const privKey =
        active.encKeys.find((k) => k.version === envelope.publicKeyVersion) ??
        active.encKeys.find((k) => k.active);
      if (!privKey) throw new Error(`No private key for version "${envelope.publicKeyVersion}". Generate & activate one in Configuration.`);

      const clear = await decrypt(envelope, privKey.privatePem);
      setDecoded(JSON.parse(clear));

      // Signature verification.
      if (src.kind === "bus") {
        // For local bus events the sender's sig public key is bundled in the message.
        setVerified(await verify(envelope, src.msg.signerSigPublicPem));
      } else {
        // For real Kafka events: fetch the sender's signature public key from the PKS.
        try {
          const km = await fetchMemberKeys({
            environment: active.credentials.environment,
            pfxBase64: pfx!,
            password: active.credentials.password,
            idp: src.fromIdp,
          });
          const sigKey = km.data?.find(
            (k) => k.keyType === "signature" && k.version === envelope.signatureKeyVersion
          ) ?? km.data?.find((k) => k.keyType === "signature" && k.ecoHubStatus === "Activated");
          if (sigKey) {
            setVerified(await verify(envelope, sigKey.key));
          } else {
            setVerified(false);
          }
        } catch {
          setVerified(false);
        }
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

  if (allIncoming.length === 0) {
    return (
      <div className="view">
        <div className="chead">
          <div><h1>Receive event</h1><div className="sub">Decrypt and verify an incoming SAF event</div></div>
          <div className="chead-spacer" />
          {configured && (
            <div className="live-ind">
              {consumerIcon}&nbsp;
              {consumerState === "ready" ? "Listening" : consumerState === "starting" ? "Connecting…" : consumerState === "error" ? "Consumer error" : "Offline"} · {active.name}
            </div>
          )}
        </div>
        <div className="empty-mailbox" style={{ flex: 1 }}>
          <Inbox strokeWidth={1.4} />
          <div className="em-title">No incoming events</div>
          <div className="em-sub">
            {consumerState === "ready"
              ? `Listening on ${active.credentials.environment}. Events sent to ${active.credentials.idp} will appear here.`
              : "Connect this profile to start receiving events from EcoHub."}
          </div>
        </div>
      </div>
    );
  }

  const rawText = decoded ? toJSON(decoded) : "";
  const envelope = src ? incomingEnvelope(src) : null;

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Receive event</h1><div className="sub">Decrypt and verify an incoming SAF event</div></div>
        <div className="chead-spacer" />
        {configured && (
          <div className="live-ind">
            {consumerIcon}&nbsp;
            {consumerState === "ready" ? "Listening" : consumerState === "starting" ? "Connecting…" : "Offline"} · {allIncoming.length} event{allIncoming.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div className="exch-head">
          <div className="sel" style={{ maxWidth: 560 }}>
            <span className="fl">Incoming event</span>
            <div className="selectw">
              <select value={src ? incomingId(src) : ""} onChange={(e) => { setSelId(e.target.value); }}>
                {allIncoming.map((m) => (
                  <option key={incomingId(m)} value={incomingId(m)}>
                    {m.kind === "kafka" ? "⬇ " : ""}{incomingLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            {src && <span className="std-tag">{src.kind === "kafka" ? src.topic : src.msg.topic}</span>}
          </div>
        </div>

        <div className="pipeline">
          <div className="pane">
            <div className="pane-head">
              <span className="pane-step">1</span>
              <div className="pane-titles"><div className="pane-title">Encrypted envelope</div><div className="pane-sub">Received ciphertext</div></div>
              <button className="btn-copy" onClick={() => { if (envelope) { copyText(toJSON(envelope)); toast("Copied"); } }}><Copy size={12} /> Copy</button>
            </div>
            <div className="pane-body">
              {src && (
                <div className="enc-meta">
                  <span className="k">From</span>
                  <span className="v">{src.kind === "bus" ? src.msg.fromName : src.fromIdp}</span>
                  <span className="k">Process</span>
                  <span className="v">{src.kind === "bus" ? src.msg.standardNs : src.processName}</span>
                  <span className="k">Enc key</span>
                  <span className="v">v{envelope?.publicKeyVersion}</span>
                  <span className="k">Sig key</span>
                  <span className="v">v{envelope?.signatureKeyVersion}</span>
                </div>
              )}
              <div className="ciph-head"><span className="lbl">payload (AES-GCM)</span></div>
              <pre className="code-block">{envelope?.payload}</pre>
            </div>
          </div>

          <div className="connector">
            <motion.div className={"op-node" + (decoded ? " done" : "")} animate={decrypting ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={decrypting ? { repeat: Infinity, duration: 1 } : {}}>
              {decoded ? <Check size={21} /> : <KeyRound size={21} strokeWidth={1.8} />}
            </motion.div>
            <button className="op-btn" disabled={decrypting || !src} onClick={doDecrypt}>
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
    </div>
  );
}
