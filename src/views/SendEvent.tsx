import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Lock, ArrowRight, Send, Copy, Check, FileText, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { PROCESSES, ALL_PROCESS_NAMES, isProcessName, type ProcessName } from "../data/standards";
import { useApp } from "../store";
import FormTree from "../components/FormTree";
import DetailModal, { type Detail } from "../components/DetailModal";
import { deepClone, setPath, toJSON, toXML, copyText } from "../lib/format";
import * as crypto from "../lib/crypto";
import { fetchReceivers, fetchMemberKeys, pickEncryptionKey, produceEvent, produceViaKafka, schemaRegistryGetIds, type Receiver } from "../lib/ecohub";
import { publish } from "../lib/bus";

export default function SendEvent() {
  const { active, configured, setView, toast, bumpBus } = useApp();
  const pfx = active.techUser?.techUserCert;
  const senderSig = active.sigKeys.find((k) => k.active);

  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [recvLoading, setRecvLoading] = useState(false);
  const [recvIdx, setRecvIdx] = useState(0);
  const [proc, setProc] = useState<ProcessName>("offer.nlpi");
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [rawFmt, setRawFmt] = useState<"json" | "xml">("json");
  const [values, setValues] = useState<any>(deepClone(PROCESSES["offer.nlpi"].sample));
  const [event, setEvent] = useState<any | null>(null);
  const [encrypting, setEncrypting] = useState(false);
  const [sending, setSending] = useState<null | "kafka" | "rest">(null);
  const [status, setStatus] = useState("Encrypt, then send.");
  const [detail, setDetail] = useState<Detail>(null);

  const receiver = receivers[recvIdx];
  // process options: what the selected receiver supports, else the full enum
  const procOptions: ProcessName[] = useMemo(() => {
    const sp = receiver?.supportedProcesses?.map((p) => p.processName).filter(isProcessName) as ProcessName[] | undefined;
    return sp && sp.length ? Array.from(new Set(sp)) : ALL_PROCESS_NAMES;
  }, [receiver]);
  const processVersion = useMemo(() => {
    const m = receiver?.supportedProcesses?.find((p) => p.processName === proc);
    return m?.processVersion || PROCESSES[proc].defaultVersion;
  }, [receiver, proc]);

  useEffect(() => { if (!procOptions.includes(proc)) changeProc(procOptions[0]); }, [procOptions]);

  async function loadReceivers() {
    if (!configured || !pfx) { toast("Connect this profile first"); return; }
    setRecvLoading(true);
    try {
      const { result, data } = await fetchReceivers({ environment: active.credentials.environment, pfxBase64: pfx, password: active.credentials.password, license: active.credentials.license });
      if (result.ok && data) {
        setReceivers(data); setRecvIdx(0);
        toast(`${data.length} receiver${data.length === 1 ? "" : "s"} loaded`);
      } else {
        setDetail({ title: "Load receivers", status: result.status, ok: false, body: result.body });
      }
    } catch (e) {
      setDetail({ title: "Load receivers", status: 0, ok: false, body: String((e as Error).message) });
    }
    setRecvLoading(false);
  }
  // auto-load once when entering the view connected
  useEffect(() => { if (configured && pfx && receivers.length === 0) loadReceivers(); }, []);

  function changeProc(p: ProcessName) {
    setProc(p);
    setValues(deepClone(PROCESSES[p].sample));
    setEvent(null);
    setStatus("Encrypt, then send.");
  }
  function onField(path: string, val: any) {
    setValues((prev: any) => { const n = deepClone(prev); setPath(n, path, val); return n; });
    setEvent(null);
  }
  const rawText = rawFmt === "json" ? toJSON(values) : toXML(proc, PROCESSES[proc].dataschema?.(processVersion) ?? "", values);

  const blocker = !configured ? "Connect this profile first (Configuration)."
    : !senderSig ? "No active signature key — generate & activate one in Configuration → Keys."
    : !receiver ? "Load receivers and pick one."
    : null;

  async function doEncrypt() {
    if (blocker) { setStatus(blocker); return; }
    setEncrypting(true); setStatus("Fetching receiver key & encrypting…");
    try {
      const idp = receiver.idp[0];
      const km = await fetchMemberKeys({ environment: active.credentials.environment, pfxBase64: pfx!, password: active.credentials.password, idp });
      if (!km.result.ok || !km.data) { setDetail({ title: "Fetch receiver public key", status: km.result.status, ok: false, body: km.result.body }); setStatus("✗ Could not fetch receiver key."); setEncrypting(false); return; }
      const encKey = pickEncryptionKey(km.data, proc);
      if (!encKey) { setStatus(`✗ ${receiver.companyName} has no activated encryption key for ${proc}.`); setEncrypting(false); return; }

      const data = await crypto.encryptAndSign({
        cleartext: toJSON(values),
        recipientEncPublicPem: encKey.key,
        publicKeyVersion: encKey.version,
        signerSigPrivatePem: senderSig!.privatePem,
        signatureKeyVersion: senderSig!.version,
      });

      const def = PROCESSES[proc];
      const evt = {
        id: globalThis.crypto.randomUUID(),
        source: "http://www.myecohub.ch/saf-testing-tool",
        specversion: "1.0",
        type: "ch.ecohub.saf.data",
        datacontenttype: "application/json",
        dataschema: def.dataschema?.(processVersion),
        subject: `${def.label} ${def.subProcessName}`,
        time: new Date().toISOString(),
        licenceKey: active.credentials.license,
        userAgent: { name: "SAF Testing Tool", version: "2.1" },
        eventReceiver: { category: receiver.memberType.toLowerCase(), id: idp },
        eventSender: { category: active.role, id: active.credentials.idp },
        data,
        processId: globalThis.crypto.randomUUID(),
        processGroupId: globalThis.crypto.randomUUID(),
        processName: proc,
        processVersion,
        processStatus: def.processStatus,
        subProcessName: def.subProcessName,
        subProcessStatus: "Created",
      };
      setEvent(evt);
      setStatus("Encrypted & signed — ready to send.");
    } catch (e) {
      setStatus("✗ " + String((e as Error).message));
    }
    setEncrypting(false);
  }

  function recordOutbox() {
    publish({
      id: "m-" + Date.now(), fromProfileId: active.id, fromName: active.name,
      toName: receiver.companyName, toIdp: receiver.idp[0], topic: "eh.saf.in.v1", standardNs: event.dataschema ?? "",
      subject: event.subject, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      envelope: event.data, recipientEncPublicPem: "", signerSigPublicPem: senderSig!.publicPem, signerName: active.name, status: "sent",
    });
    bumpBus();
  }

  async function send(via: "kafka" | "rest") {
    if (!event) return;
    setSending(via);
    setStatus(via === "kafka" ? "Producing via Kafka (eh.saf.in.v1)…" : "Producing via REST proxy (/saf/v1/in)…");
    try {
      // Resolve live schema IDs from the registry for both transports.
      // Falls back to hardcoded ids if registry is unreachable.
      setStatus("Resolving schema IDs from registry…");
      let valueSchemaId: number | undefined;
      let keySchemaId: number | undefined;
      try {
        const ids = await schemaRegistryGetIds({
          environment: active.credentials.environment,
          pfxBase64: pfx!,
          password: active.credentials.password,
          topic: "eh.saf.in.v1",
        });
        valueSchemaId = ids.valueSchemaId;
        keySchemaId = ids.keySchemaId;
      } catch {
        // registry unreachable — both transports fall back to hardcoded ids
      }

      if (via === "kafka") {
        const r = await produceViaKafka({
          environment: active.credentials.environment,
          pfxBase64: pfx!,
          password: active.credentials.password,
          eventJson: JSON.stringify(event),
          processId: event.processId,
          valueSchemaId,
        });
        setDetail({ title: "Produce via Kafka — eh.saf.in.v1", status: r.ok ? 200 : 0, ok: r.ok, body: r.detail });
        if (r.ok) { recordOutbox(); setStatus(`✓ ${r.detail}`); toast(`Event produced to ${receiver.companyName}`); }
        else setStatus(`✗ Kafka produce failed. See details.`);
      }
      if (via === "rest") {
        const r = await produceEvent({ environment: active.credentials.environment, pfxBase64: pfx!, password: active.credentials.password, eventJson: JSON.stringify(event), valueSchemaId, keySchemaId });
        setDetail({ title: "Produce via REST proxy — POST /saf/v1/in", status: r.status, ok: r.ok, body: r.body || "(empty body)" });
        if (r.ok) { recordOutbox(); setStatus(`✓ HTTP ${r.status} — produced via REST proxy.`); toast(`Event produced to ${receiver.companyName}`); }
        else setStatus(`✗ HTTP ${r.status} — REST produce failed. See details.`);
      }
    } catch (e) {
      setDetail({ title: "Produce event", status: 0, ok: false, body: String((e as Error).message) });
    }
    setSending(null);
  }

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Send event</h1><div className="sub">Compose, encrypt, and produce a standardised SAF event</div></div>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div className="exch-head">
          <div className="sel">
            <span className="fl">Target (receiver)</span>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="selectw" style={{ flex: 1 }}>
                <select value={recvIdx} disabled={!receivers.length} onChange={(e) => { setRecvIdx(+e.target.value); setEvent(null); }}>
                  {receivers.length === 0 ? <option>{configured ? "No receivers loaded" : "Connect first"}</option>
                    : receivers.map((r, i) => <option key={i} value={i}>{r.companyName} ({r.memberType})</option>)}
                </select>
              </div>
              <button className="btn-ghost" disabled={recvLoading || !configured} onClick={loadReceivers} title="Fetch from /saf-receivers">
                {recvLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              </button>
            </div>
            {receiver && <span className="std-tag">{receiver.idp.join(", ")}</span>}
          </div>
          <div className="sel">
            <span className="fl">Process (standard)</span>
            <div className="selectw">
              <select value={proc} onChange={(e) => changeProc(e.target.value as ProcessName)}>
                {procOptions.map((p) => <option key={p} value={p}>{PROCESSES[p].label} ({p})</option>)}
              </select>
            </div>
            <span className="std-tag">processVersion {processVersion}</span>
          </div>
        </div>

        {blocker && (
          <div style={{ margin: "0 16px 4px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--warn)" }}>
            <AlertTriangle size={14} /> {blocker}
          </div>
        )}

        <div className="pipeline">
          <div className="pane">
            <div className="pane-head">
              <span className="pane-step">1</span>
              <div className="pane-titles"><div className="pane-title">Payload</div><div className="pane-sub">Cleartext · {PROCESSES[proc].label}</div></div>
              <button className="btn-copy" style={{ marginRight: 8 }} onClick={() => { setValues(deepClone(PROCESSES[proc].sample)); toast("Sample loaded"); }}><FileText size={12} /> Sample</button>
              <div className="seg">
                <button className={mode === "form" ? "on" : ""} onClick={() => setMode("form")}>Form</button>
                <button className={mode === "raw" ? "on" : ""} onClick={() => setMode("raw")}>Raw</button>
              </div>
            </div>
            <div className="pane-body">
              {mode === "form" ? <FormTree values={values} onChange={onField} /> : (
                <div>
                  <div className="raw-bar">
                    <div className="seg sm">
                      <button className={rawFmt === "json" ? "on" : ""} onClick={() => setRawFmt("json")}>JSON</button>
                      <button className={rawFmt === "xml" ? "on" : ""} onClick={() => setRawFmt("xml")}>XML</button>
                    </div>
                    <button className="btn-copy" onClick={() => { copyText(rawText); toast("Copied"); }}><Copy size={12} /> Copy</button>
                  </div>
                  <textarea className="code-edit" spellCheck={false} value={rawText} readOnly={rawFmt === "xml"}
                    onChange={(e) => { try { setValues(JSON.parse(e.target.value)); setEvent(null); } catch {} }} />
                </div>
              )}
            </div>
          </div>

          <div className="connector">
            <motion.div className={"op-node" + (event ? " done" : "")} animate={encrypting ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={encrypting ? { repeat: Infinity, duration: 1 } : {}}>
              {event ? <Check size={21} /> : <Lock size={21} strokeWidth={1.8} />}
            </motion.div>
            <button className="op-btn" disabled={encrypting || !!blocker} onClick={doEncrypt}>{encrypting ? "Encrypting…" : "Encrypt"} <ArrowRight size={13} /></button>
            <div className="op-label">RSA-OAEP-256<br />+ A256GCM</div>
          </div>

          <div className="pane">
            <div className="pane-head">
              <span className={"pane-step" + (event ? " done" : "")}>2</span>
              <div className="pane-titles"><div className="pane-title">SAF event</div><div className="pane-sub">CloudEvents envelope to produce</div></div>
              <button className="btn-copy" disabled={!event} onClick={() => { if (event) { copyText(toJSON(event)); toast("Copied"); } }}><Copy size={12} /> Copy</button>
            </div>
            <div className="pane-body">
              {!event ? (
                <div className="pane-empty">
                  <Lock strokeWidth={1.5} /><div className="t">Not built yet</div>
                  <div className="s">Encrypt to assemble the signed SAFEventType that will be produced to the in-topic.</div>
                </div>
              ) : <pre className="code-block">{toJSON(event)}</pre>}
            </div>
            <div className="pane-foot">
              <span className={"st" + (status.startsWith("✓") ? " ok" : status.startsWith("✗") ? " err" : "")}>{status}</span>
              <button className="btn-ghost" disabled={!event || sending !== null} onClick={() => send("kafka")} title="Native Kafka protocol (mTLS to CSM broker)">
                {sending === "kafka" ? <Loader2 size={13} className="spin" style={{ verticalAlign: "-2px" }} /> : null} Send via Kafka
              </button>
              <button className="btn-primary" disabled={!event || sending !== null} onClick={() => send("rest")} title="REST proxy POST /saf/v1/in">
                <Send size={14} /> {sending === "rest" ? "Producing…" : "Send via REST proxy"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <DetailModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
