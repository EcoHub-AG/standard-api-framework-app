import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lock, ArrowRight, Send, Copy, Check, FileText, AlertTriangle, RefreshCw, Loader2, Upload } from "lucide-react";
import { PROCESSES, ALL_PROCESS_NAMES, isProcessName, LEGACY_XSD_NAMESPACE, legacyStandardsBase, type ProcessName } from "../data/standards";
import { EVENT_TYPES, ALL_EVENT_KINDS, GENERIC_PROCESS_SUGGESTIONS, GENERIC_SUBPROCESS_STAGES, KEY_PROCESS_NAME_OVERRIDES, DEFAULT_PROCESS_NAME_NO_SELECTOR, DEFAULT_SUBPROCESS_NAME_NO_SELECTOR, type EventKind } from "../data/eventTypes";
import { useApp } from "../store";
import FormTree from "../components/FormTree";
import DetailModal, { type Detail } from "../components/DetailModal";
import { deepClone, setPath, toJSON, toXML, copyText, fileToBase64, fileToBytes } from "../lib/format";
import * as crypto from "../lib/crypto";
import { fetchReceivers, fetchMemberKeys, pickEncryptionKey, produceEvent, produceViaKafka, schemaRegistryGetIds, toCategoryEnum, type Receiver } from "../lib/ecohub";
import { publish } from "../lib/bus";
import type { FieldSchema } from "../lib/formSchema";
import { loadLegacyForm } from "../lib/schema/xsdParser";
import { buildEnvelopeSkeleton, envelopeSchemaUrl } from "../lib/schema/envelope";
import { validateAgainstSchema } from "../lib/schema/ajv";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export default function SendEvent() {
  const { active, configured, setView, toast, bumpBus } = useApp();
  const pfx = active.techUser?.techUserCert;
  const senderSig = active.sigKeys.find((k) => k.active);

  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [recvLoading, setRecvLoading] = useState(false);
  const [recvIdx, setRecvIdx] = useState(0);
  const [eventKind, setEventKind] = useState<EventKind>("data");
  const [proc, setProc] = useState<ProcessName>("offer.nlpi");
  const [genericProcessName, setGenericProcessName] = useState(GENERIC_PROCESS_SUGGESTIONS[0]);
  const [genericSubProcess, setGenericSubProcess] = useState(GENERIC_SUBPROCESS_STAGES[0]);

  // --- Legacy XSD form state (invoice/commission/contract/mandate/claimsExperience) ---
  const legacyDef = eventKind === "data" ? PROCESSES[proc].legacyXsd : undefined;
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [values, setValues] = useState<any>(deepClone(PROCESSES["offer.nlpi"].sample));
  const [legacySchema, setLegacySchema] = useState<FieldSchema | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [rawXml, setRawXml] = useState("");

  // --- Free-text "data" (offer.nlpi / generic / ids / inquiry / error — no XML schema) ---
  const [dataText, setDataText] = useState("");
  // Raw bytes of the last uploaded file — encrypted as-is instead of re-encoding the
  // base64 shown in the textarea. Cleared whenever the user hand-edits that text.
  const [uploadedFileBytes, setUploadedFileBytes] = useState<Uint8Array | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [event, setEvent] = useState<any | null>(null);
  const [envelopeText, setEnvelopeText] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [sending, setSending] = useState<null | "kafka" | "rest">(null);
  const [status, setStatus] = useState("Encrypt, then send.");
  const [detail, setDetail] = useState<Detail>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const receiver = receivers[recvIdx];
  const procOptions: ProcessName[] = useMemo(() => {
    const sp = receiver?.supportedProcesses?.map((p) => p.processName).filter(isProcessName) as ProcessName[] | undefined;
    return sp && sp.length ? Array.from(new Set(sp)) : ALL_PROCESS_NAMES;
  }, [receiver]);
  const processVersion = useMemo(() => {
    const m = receiver?.supportedProcesses?.find((p) => p.processName === proc);
    return m?.processVersion || PROCESSES[proc].defaultVersion;
  }, [receiver, proc]);

  useEffect(() => { if (eventKind === "data" && !procOptions.includes(proc)) changeProc(procOptions[0]); }, [procOptions, eventKind]);

  // Load the XSD-derived form for legacy processes; everything else uses the free-text data pane.
  useEffect(() => {
    setEvent(null);
    setValidationErrors([]);
    if (!legacyDef) { setLegacySchema(null); setLegacyError(null); return; }
    let cancelled = false;
    setLegacyLoading(true);
    setLegacyError(null);
    loadLegacyForm(legacyDef)
      .then(({ schema, sample }) => {
        if (cancelled) return;
        setLegacySchema(schema);
        setValues(sample);
        setMode("form");
      })
      .catch((e) => {
        if (cancelled) return;
        setLegacySchema(null);
        setLegacyError(`Couldn't load the live XSD schema (${String((e as Error).message)}) — falling back to the built-in sample.`);
        setValues(deepClone(PROCESSES[proc].sample));
      })
      .finally(() => { if (!cancelled) setLegacyLoading(false); });
    return () => { cancelled = true; };
  }, [legacyDef?.tag, eventKind]);

  // Keep the raw-XML view in sync with form edits (but not vice versa while the user is typing in raw mode).
  useEffect(() => {
    if (legacyDef) setRawXml(toXML(legacyDef.rootElementName, LEGACY_XSD_NAMESPACE, values));
  }, [values, legacyDef?.tag]);

  // Seed the free-text data pane from whatever sample exists for the selected process/kind.
  useEffect(() => {
    if (legacyDef) return;
    if (eventKind === "data") setDataText(toJSON(PROCESSES[proc].sample));
    else setDataText("");
    setUploadedFileBytes(null);
    setEvent(null);
    setValidationErrors([]);
  }, [eventKind, proc, legacyDef]);

  async function loadReceivers() {
    if (!configured || !pfx) { toast("Connect this profile first"); return; }
    setRecvLoading(true);
    try {
      const { result, data, url, method, requestBody } = await fetchReceivers({ environment: active.credentials.environment, pfxBase64: pfx, password: active.credentials.password, license: active.credentials.license });
      if (result.ok && data) {
        setReceivers(data); setRecvIdx(0);
        toast(`${data.length} receiver${data.length === 1 ? "" : "s"} loaded`);
      } else {
        setDetail({ title: "Load receivers", status: result.status, ok: false, body: result.body, url, method, requestBody });
      }
    } catch (e) {
      setDetail({ title: "Load receivers", status: 0, ok: false, body: String((e as Error).message) });
    }
    setRecvLoading(false);
  }
  useEffect(() => { if (configured && pfx && receivers.length === 0) loadReceivers(); }, []);

  function changeProc(p: ProcessName) {
    setProc(p);
    setValues(deepClone(PROCESSES[p].sample));
  }

  function onField(path: string, val: any) {
    setValues((prev: any) => { const n = deepClone(prev); setPath(n, path, val); return n; });
    setEvent(null);
  }

  async function onUploadFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      toast(`${f.name} is ${(f.size / (1024 * 1024)).toFixed(1)}MB — max upload size is 8MB`);
      return;
    }
    try {
      const [bytes, b64] = await Promise.all([fileToBytes(f), fileToBase64(f)]);
      setUploadedFileBytes(bytes);
      setDataText(b64);
      setEvent(null);
      toast(`${f.name} → base64, filled into "data"`);
    } catch (e) {
      toast(`Could not read ${f.name}: ${String((e as Error).message)}`);
    }
  }

  const cleartext = legacyDef ? rawXml : dataText;
  const eventTypeDef = EVENT_TYPES[eventKind];

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
      if (!km.result.ok || !km.data) {
        setDetail({ title: "Fetch receiver public key", status: km.result.status, ok: false, body: km.result.body, url: km.url, method: km.method });
        setStatus("✗ Could not fetch receiver key.");
        setEncrypting(false);
        return;
      }
      const processNameForKey =
        eventKind === "data" ? proc
        : eventKind === "generic" ? genericProcessName
        : KEY_PROCESS_NAME_OVERRIDES[eventKind] ?? eventTypeDef.label; // unconfirmed kinds fall back to the label — likely won't match a real key
      const encKey = pickEncryptionKey(km.data, processNameForKey);
      if (!encKey) {
        setDetail({ title: "Fetch receiver public key", status: km.result.status, ok: true, body: km.result.body, url: km.url, method: km.method });
        setStatus(`✗ ${receiver.companyName} has no activated encryption key for ${processNameForKey}.`);
        setEncrypting(false);
        return;
      }

      const data = await crypto.encryptAndSign({
        cleartext: uploadedFileBytes ?? cleartext,
        recipientEncPublicPem: encKey.key,
        publicKeyVersion: encKey.version,
        signerSigPrivatePem: senderSig!.privatePem,
        signatureKeyVersion: senderSig!.version,
      });

      const dataschema =
        eventKind === "data"
          ? legacyDef
            ? `${legacyStandardsBase(legacyDef)}/${legacyDef.xsdFile}`
            : PROCESSES[proc].dataschema?.(processVersion)
          : undefined;

      const processName = eventKind === "data" ? proc : eventKind === "generic" ? genericProcessName : DEFAULT_PROCESS_NAME_NO_SELECTOR;
      const subProcessName = eventKind === "data" ? PROCESSES[proc].subProcessName : eventKind === "generic" ? genericSubProcess : DEFAULT_SUBPROCESS_NAME_NO_SELECTOR;
      const processStatus = eventKind === "data" ? PROCESSES[proc].processStatus : "active";
      const label = eventKind === "data" ? PROCESSES[proc].label : eventTypeDef.label;

      const evt = buildEnvelopeSkeleton({
        eventType: eventTypeDef,
        data,
        dataschema,
        subject: `${label} ${subProcessName}`,
        licenceKey: active.credentials.license,
        userAgent: { name: "SAF Testing Tool", version: "2.1" },
        eventReceiver: { category: toCategoryEnum(receiver.memberType), id: idp },
        eventSender: { category: active.membershipType, id: active.credentials.idp },
        processName,
        processVersion: eventKind === "data" ? processVersion : PROCESSES["offer.nlpi"].defaultVersion,
        processStatus,
        subProcessName,
        subProcessStatus: "Created",
      });
      setEvent(evt);
      setEnvelopeText(toJSON(evt));
      setStatus("Encrypted & signed — validating envelope…");

      try {
        const { valid, errors } = await validateAgainstSchema(envelopeSchemaUrl(eventKind, eventTypeDef), evt);
        setValidationErrors(valid ? [] : errors);
        setStatus(valid ? "Encrypted & signed — ready to send." : `⚠ Encrypted, but envelope has ${errors.length} schema issue(s) — see below.`);
      } catch (e) {
        setValidationErrors([]);
        setStatus(`Encrypted & signed — ready to send (envelope validation unavailable: ${String((e as Error).message)}).`);
      }
    } catch (e) {
      setStatus("✗ " + String((e as Error).message));
    }
    setEncrypting(false);
  }

  function onEnvelopeTextChange(text: string) {
    setEnvelopeText(text);
    try { setEvent(JSON.parse(text)); } catch { /* keep last-valid `event` until it parses again */ }
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
            <span className="fl">Event type</span>
            <div className="selectw">
              <select value={eventKind} onChange={(e) => setEventKind(e.target.value as EventKind)}>
                {ALL_EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_TYPES[k].label}</option>)}
              </select>
            </div>
            <span className="std-tag">{eventTypeDef.ceType}</span>
          </div>
          {eventKind === "data" && (
            <div className="sel">
              <span className="fl">Process (standard)</span>
              <div className="selectw">
                <select value={proc} onChange={(e) => changeProc(e.target.value as ProcessName)}>
                  {procOptions.map((p) => <option key={p} value={p}>{PROCESSES[p].label} ({p})</option>)}
                </select>
              </div>
              <span className="std-tag">processVersion {processVersion}</span>
            </div>
          )}
          {eventKind === "generic" && (
            <>
              <div className="sel">
                <span className="fl">Process (free text)</span>
                <input className="ctl" list="generic-process-suggestions" value={genericProcessName}
                  onChange={(e) => { setGenericProcessName(e.target.value); setEvent(null); }} />
                <datalist id="generic-process-suggestions">
                  {GENERIC_PROCESS_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="sel">
                <span className="fl">Sub-process (workflow stage)</span>
                <div className="selectw">
                  <select value={genericSubProcess} onChange={(e) => { setGenericSubProcess(e.target.value); setEvent(null); }}>
                    {GENERIC_SUBPROCESS_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        {blocker && (
          <div style={{ margin: "0 16px 4px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--warn)" }}>
            <AlertTriangle size={14} /> {blocker}
          </div>
        )}
        {legacyError && (
          <div style={{ margin: "0 16px 4px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--warn)" }}>
            <AlertTriangle size={14} /> {legacyError}
          </div>
        )}

        <div className="pipeline">
          <div className="pane">
            <div className="pane-head">
              <span className="pane-step">1</span>
              <div className="pane-titles">
                <div className="pane-title">Data</div>
                <div className="pane-sub">Cleartext · {eventKind === "data" ? PROCESSES[proc].label : eventTypeDef.label}{legacyLoading ? " · loading XSD…" : ""}</div>
              </div>
              {legacyDef ? (
                <>
                  <button className="btn-copy" style={{ marginRight: 8 }} onClick={() => { loadLegacyForm(legacyDef).then(({ sample }) => setValues(sample)); toast("Sample reloaded"); }}>
                    <FileText size={12} /> Sample
                  </button>
                  <div className="seg">
                    <button className={mode === "form" ? "on" : ""} onClick={() => setMode("form")}>Form</button>
                    <button className={mode === "raw" ? "on" : ""} onClick={() => setMode("raw")}>Raw</button>
                  </div>
                </>
              ) : (
                <>
                  <button className="btn-copy" style={{ marginRight: 8 }} onClick={() => fileInputRef.current?.click()}>
                    <Upload size={12} /> Upload file
                  </button>
                  <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(e) => onUploadFile(e.target.files?.[0])} />
                </>
              )}
            </div>
            <div className="pane-body">
              {legacyDef ? (
                mode === "form" ? (
                  <FormTree values={values} schema={legacySchema ?? undefined} onChange={onField} />
                ) : (
                  <div>
                    <div className="raw-bar">
                      <button className="btn-copy" onClick={() => { copyText(rawXml); toast("Copied"); }}><Copy size={12} /> Copy</button>
                    </div>
                    <textarea className="code-edit" spellCheck={false} value={rawXml} onChange={(e) => { setRawXml(e.target.value); setEvent(null); }} />
                  </div>
                )
              ) : (
                <div>
                  <div className="raw-bar">
                    <button className="btn-copy" onClick={() => { copyText(dataText); toast("Copied"); }}><Copy size={12} /> Copy</button>
                  </div>
                  <textarea
                    className="code-edit" spellCheck={false} value={dataText}
                    placeholder="Free-form data — type it in, or upload a file (it will be base64-encoded into this box)."
                    onChange={(e) => { setDataText(e.target.value); setUploadedFileBytes(null); setEvent(null); }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="connector">
            <motion.div className={"op-node" + (event ? " done" : "")} animate={encrypting ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={encrypting ? { repeat: Infinity, duration: 1 } : {}}>
              {event ? <Check size={21} /> : <Lock size={21} strokeWidth={1.8} />}
            </motion.div>
            <button className="op-btn" disabled={encrypting || !!blocker || !cleartext} onClick={doEncrypt}>{encrypting ? "Encrypting…" : "Encrypt"} <ArrowRight size={13} /></button>
            <div className="op-label">RSA-OAEP-256<br />+ A256GCM</div>
          </div>

          <div className="pane">
            <div className="pane-head">
              <span className={"pane-step" + (event ? " done" : "")}>2</span>
              <div className="pane-titles"><div className="pane-title">SAF event</div><div className="pane-sub">CloudEvents envelope to produce — editable</div></div>
              <button className="btn-copy" disabled={!event} onClick={() => { if (event) { copyText(envelopeText); toast("Copied"); } }}><Copy size={12} /> Copy</button>
            </div>
            <div className="pane-body">
              {!event ? (
                <div className="pane-empty">
                  <Lock strokeWidth={1.5} /><div className="t">Not built yet</div>
                  <div className="s">Encrypt to assemble the signed {eventTypeDef.label} envelope that will be produced to the in-topic.</div>
                </div>
              ) : (
                <textarea className="code-edit" spellCheck={false} value={envelopeText} onChange={(e) => onEnvelopeTextChange(e.target.value)} />
              )}
              {validationErrors.length > 0 && (
                <div className="unsupported-note" style={{ marginTop: 8 }}>
                  Envelope schema issues:
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
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
