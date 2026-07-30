import { useEffect, useRef, useState } from "react";
import { Wifi, KeyRound, ShieldCheck, Plus, Trash2, Lock, UploadCloud, Loader2, FileUp, Import } from "lucide-react";
import { useApp } from "../store";
import type { Credentials, KeyRecord, MembershipType } from "../types";
import * as crypto from "../lib/crypto";
import { enrolTechUser, uploadAndActivateKey } from "../lib/ecohub";
import DetailModal, { type Detail } from "../components/DetailModal";

const ENVIRONMENTS = ["Production", "IAT", "Staging", "Test", "Development"];
const nextVersion = (rows: KeyRecord[]) =>
  rows.length ? `${Math.max(...rows.map((r) => parseInt(r.version) || 0)) + 1}.0.0` : "1.0.0";

export default function Configuration() {
  const { active, updateActive, configured, setConfigured, toast, deleteProfile, profiles } = useApp();
  const [section, setSection] = useState<"connection" | "keys">("connection");
  const [cred, setCred] = useState<Credentials>(active.credentials);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null); // `${kind}:${version}`
  const [detail, setDetail] = useState<Detail>(null);
  const [keyVersion, setKeyVersion] = useState("1.0.0");
  const [importOpen, setImportOpen] = useState(false);
  const [importVersion, setImportVersion] = useState("1.0.0");
  const [importBusy, setImportBusy] = useState(false);
  const [encPubIn, setEncPubIn] = useState("");
  const [encPrivIn, setEncPrivIn] = useState("");
  const [sigPubIn, setSigPubIn] = useState("");
  const [sigPrivIn, setSigPrivIn] = useState("");
  const encPubFile = useRef<HTMLInputElement>(null);
  const encPrivFile = useRef<HTMLInputElement>(null);
  const sigPubFile = useRef<HTMLInputElement>(null);
  const sigPrivFile = useRef<HTMLInputElement>(null);

  const keysUnlocked = true; // TEMP-TEST-BYPASS !!active.techUser; // enrolled at least once → has the mTLS cert
  const suggestVersion = () => nextVersion([...active.encKeys, ...active.sigKeys]);
  useEffect(() => setCred(active.credentials), [active.id]);
  useEffect(() => { setKeyVersion(suggestVersion()); }, [active.id]);
  useEffect(() => { if (!keysUnlocked) setSection("connection"); }, [keysUnlocked]);

  const valid = cred.license.trim() && cred.idp.trim() && cred.password.trim() && cred.iak.trim();
  const set = (k: keyof Credentials, v: string) => setCred((c) => ({ ...c, [k]: v }));

  async function enrol(persist: boolean) {
    if (!valid) { setStatus("Add license key, IDP number, password, and IAK first."); return; }
    setBusy(true);
    setStatus(`Enrolling tech user at ${cred.environment}…`);
    try {
      const { result, data, url } = await enrolTechUser({ environment: cred.environment, iak: cred.iak, idp: cred.idp, license: cred.license, password: cred.password });
      setDetail({ title: "Tech user enrolment", status: result.status, ok: result.ok, body: result.body, url });
      if (result.ok && data?.oAuth2) {
        if (persist) {
          updateActive({
            credentials: cred,
            connected: true,
            techUser: { clientId: data.oAuth2.clientId, clientSecret: data.oAuth2.clientSecret, openIdConfigurationEndpoint: data.oAuth2.openIdConfigurationEndpoint, techUserCert: data.techUserCert, enrolledAt: new Date().toISOString() },
          });
          setConfigured(true);
        }
        setStatus(`✓ HTTP ${result.status} — enrolled${persist ? " & connected" : ""} (client ${data.oAuth2.clientId}).`);
        toast(persist ? (configured ? "Reconnected" : "Connected") : "Credentials accepted");
      } else {
        // Only "Save & connect" affects the stored connection — "Test" never does.
        if (persist) { updateActive({ connected: false, techUser: null }); setConfigured(false); }
        setStatus(`✗ HTTP ${result.status} — enrolment failed. See details.`);
        toast("Enrolment failed");
      }
    } catch (e) {
      if (persist) { updateActive({ connected: false }); setConfigured(false); }
      setStatus("✗ " + String((e as Error).message));
    }
    setBusy(false);
  }
  const test = () => enrol(false);
  const save = () => enrol(true);

  async function generateKeys() {
    const v = keyVersion.trim();
    if (!/^\d+\.\d+\.\d+$/.test(v)) { toast("Enter a version like 1.0.0"); return; }
    if (active.encKeys.some((k) => k.version === v) || active.sigKeys.some((k) => k.version === v)) {
      toast(`Version ${v} already exists in this profile`);
      return;
    }
    setGenBusy(true);
    const [enc, sig] = await Promise.all([crypto.generateEncryptionKeyPair(), crypto.generateSignatureKeyPair()]);
    const [encFp, sigFp] = await Promise.all([crypto.fingerprint(enc.publicPem), crypto.fingerprint(sig.publicPem)]);
    const now = new Date().toISOString().slice(0, 10);
    updateActive({
      encKeys: [...active.encKeys, { version: v, createdAt: now, active: false, ...enc, fingerprint: encFp }],
      sigKeys: [...active.sigKeys, { version: v, createdAt: now, active: false, ...sig, fingerprint: sigFp }],
    });
    setGenBusy(false);
    setKeyVersion(nextVersion([...active.encKeys, ...active.sigKeys, { version: v } as KeyRecord]));
    toast(`Generated key pairs v${v}`);
  }

  function readFileInto(e: React.ChangeEvent<HTMLInputElement>, setter: (s: string) => void) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result ?? "").trim());
    reader.readAsText(f);
    e.target.value = "";
  }

  function resetImportForm() {
    setEncPubIn(""); setEncPrivIn(""); setSigPubIn(""); setSigPrivIn("");
  }

  async function importKeys() {
    const v = importVersion.trim();
    if (!/^\d+\.\d+\.\d+$/.test(v)) { toast("Enter a version like 1.0.0"); return; }
    const hasEnc = !!(encPubIn.trim() && encPrivIn.trim());
    const hasSig = !!(sigPubIn.trim() && sigPrivIn.trim());
    if (!hasEnc && !hasSig) { toast("Paste or upload at least one key pair"); return; }
    if (hasEnc && active.encKeys.some((k) => k.version === v)) { toast(`Version ${v} already exists for encryption keys`); return; }
    if (hasSig && active.sigKeys.some((k) => k.version === v)) { toast(`Version ${v} already exists for signature keys`); return; }

    setImportBusy(true);
    const errors: string[] = [];
    const updates: Partial<{ encKeys: KeyRecord[]; sigKeys: KeyRecord[] }> = {};
    const now = new Date().toISOString().slice(0, 10);

    if (hasEnc) {
      try {
        await crypto.validateEncryptionKeyPair(encPubIn, encPrivIn);
        const fp = await crypto.fingerprint(encPubIn);
        updates.encKeys = [...active.encKeys, { version: v, createdAt: now, active: false, publicPem: encPubIn.trim(), privatePem: encPrivIn.trim(), fingerprint: fp }];
      } catch (e) {
        errors.push(`Encryption key pair (RSA-OAEP) — ${(e as Error).message || "not a valid PEM for this algorithm"}`);
      }
    }
    if (hasSig) {
      try {
        await crypto.validateSignatureKeyPair(sigPubIn, sigPrivIn);
        const fp = await crypto.fingerprint(sigPubIn);
        updates.sigKeys = [...active.sigKeys, { version: v, createdAt: now, active: false, publicPem: sigPubIn.trim(), privatePem: sigPrivIn.trim(), fingerprint: fp }];
      } catch (e) {
        errors.push(`Signature key pair (ECDSA P-384) — ${(e as Error).message || "not a valid PEM for this algorithm"}`);
      }
    }

    if (errors.length) {
      setDetail({ title: "Key import failed", status: 0, ok: false, body: errors.join("\n\n") + "\n\nCheck each pasted/uploaded value is the matching public or private PEM for that key type, and that public/private come from the same generated pair." });
      toast("Invalid key — see details");
      setImportBusy(false);
      return;
    }

    updateActive(updates);
    resetImportForm();
    setImportOpen(false);
    setKeyVersion(nextVersion([...active.encKeys, ...(updates.encKeys ?? []), ...active.sigKeys, ...(updates.sigKeys ?? [])]));
    toast(`Imported key pair${hasEnc && hasSig ? "s" : ""} v${v}`);
    setImportBusy(false);
  }

  function activateLocal(kind: "enc" | "sig", version: string) {
    const key = kind === "enc" ? "encKeys" : "sigKeys";
    updateActive({ [key]: (active[key] as KeyRecord[]).map((k) => ({ ...k, active: k.version === version })) } as any);
  }

  async function uploadActivate(kind: "enc" | "sig", rec: KeyRecord) {
    const pfx = active.techUser?.techUserCert;
    if (!pfx) { toast("Enrol this profile first (Save & connect)"); return; }
    const tag = `${kind}:${rec.version}`;
    setUploading(tag);

    try {
      const res = await uploadAndActivateKey({
        environment: active.credentials.environment,
        pfxBase64: pfx,
        password: active.credentials.password,
        version: rec.version,
        publicPem: rec.publicPem,
        privatePem: rec.privatePem,
        kind: kind === "enc" ? "encryption" : "signature",
      });
      const log = res.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.name} — HTTP ${s.status}`).join("\n") + "\n\n" + res.detailBody;
      setDetail({ title: `Upload & activate ${kind === "enc" ? "encryption" : "signature"} key`, status: res.steps[res.steps.length - 1]?.status ?? 0, ok: res.ok, body: log, curl: res.curl });
      if (res.ok) {
        const key = kind === "enc" ? "encKeys" : "sigKeys";
        updateActive({
          [key]: (active[key] as KeyRecord[]).map((k) =>
            k.version === rec.version ? { ...k, version: res.version, keyId: res.keyId, remote: "activated", active: true } : { ...k, active: false }
          ),
        } as any);
        toast(`Key activated on ${active.credentials.environment}`);
      } else {
        toast("Upload/activate failed — see details");
      }
    } catch (e) {
      setDetail({ title: "Upload & activate", status: 0, ok: false, body: String((e as Error).message) });
    }
    setUploading(null);
  }

  const activeEnc = active.encKeys.find((k) => k.active);
  const activeSig = active.sigKeys.find((k) => k.active);

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Configuration</h1><div className="sub">Settings for profile <b>{active.name}</b></div></div>
        <div className="chead-spacer" />
        <div className="seg">
          <button className={section === "connection" ? "on" : ""} onClick={() => setSection("connection")}>Connection</button>
          <button className={section === "keys" ? "on" : ""} disabled={!keysUnlocked} onClick={() => keysUnlocked && setSection("keys")} title={keysUnlocked ? "" : "Enrol (Save & connect) first to manage keys"}>
            {!keysUnlocked && <Lock size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />}Keys
          </button>
        </div>
      </div>

      <div className="config">
        <div className="config-inner">
          {section === "connection" ? (
            <>
              <div className="card">
                <div className="card-head"><span className="card-icon"><Wifi size={16} /></span>
                  <div><div className="card-title">Connection</div><div className="card-desc">Where this profile reaches the SAF event bus</div></div></div>
                <div className="card-body">
                  <div className="frow two">
                    <div><label className="fl">Environment <span className="req">*</span></label>
                      <div className="selectw"><select value={cred.environment} onChange={(e) => set("environment", e.target.value)}>{ENVIRONMENTS.map((e) => <option key={e}>{e}</option>)}</select></div>
                    </div>
                    <div><label className="fl">License key <span className="req">*</span></label><input className="input mono" placeholder="SAF-XXXX-XXXX-XXXX" value={cred.license} onChange={(e) => set("license", e.target.value)} /></div>
                  </div>
                  <div className="frow">
                    <label className="fl">Membership type</label>
                    <div className="selectw" style={{ maxWidth: 220 }}>
                      <select
                        value={active.membershipType}
                        onChange={(e) => { updateActive({ membershipType: e.target.value as MembershipType }); toast("Membership type updated"); }}
                      >
                        <option value="insurer">Insurer</option>
                        <option value="broker">Broker</option>
                        <option value="serviceprovider">Service Provider</option>
                      </select>
                    </div>
                    <div className="hint">Used as this profile's sender category on outgoing events. Rarely needs changing.</div>
                  </div>
                  <div className="hint">CSM &amp; Services API URLs are derived from the environment.</div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><span className="card-icon"><KeyRound size={16} /></span>
                  <div><div className="card-title">Tech user credentials</div><div className="card-desc">The technical user this profile authenticates as</div></div></div>
                <div className="card-body">
                  <div className="frow two">
                    <div><label className="fl">IDP number <span className="req">*</span></label><input className="input mono" placeholder="10012345" value={cred.idp} onChange={(e) => set("idp", e.target.value)} /></div>
                    <div><label className="fl">Password <span className="req">*</span></label><input className="input" type="password" placeholder="••••••••••••" value={cred.password} onChange={(e) => set("password", e.target.value)} /></div>
                  </div>
                  <div className="frow two">
                    <div><label className="fl">IAK <span className="req">*</span></label><input className="input mono" placeholder="Identity access key" value={cred.iak} onChange={(e) => set("iak", e.target.value)} /></div>
                    <div><label className="fl">Org ID <span className="opt">optional</span></label><input className="input mono" placeholder="ORG-0042" value={cred.orgId} onChange={(e) => set("orgId", e.target.value)} /></div>
                  </div>
                </div>
              </div>

              <div className="config-foot">
                <span className={"foot-status" + (status?.startsWith("✓") ? " saved" : "")}>{status ?? <>Fields marked <span className="req">*</span> are required to connect.</>}</span>
                {profiles.length > 1 && (
                  <button className="btn-ghost" style={{ color: "var(--err)", borderColor: "var(--err-tint)" }}
                    onClick={() => { if (confirm(`Delete profile "${active.name}"? This removes its keys.`)) { deleteProfile(active.id); toast("Profile deleted"); } }}>
                    <Trash2 size={12} style={{ verticalAlign: "-2px" }} /> Delete
                  </button>
                )}
                <button className="btn-ghost" disabled={busy} onClick={test}>Test connection</button>
                <button className="btn-primary" disabled={!valid || busy} onClick={save}>{configured ? "Reconnect" : "Save & connect"}</button>
              </div>
            </>
          ) : (
            <div className="card">
              <div className="card-head"><span className="card-icon"><ShieldCheck size={16} /></span>
                <div><div className="card-title">Signing &amp; encryption keys</div><div className="card-desc">Generate locally, then upload &amp; activate in the live {active.credentials.environment} Public Key Store</div></div></div>
              <div className="card-body">
                <div className="keypair">
                  <div className="kp-fp">
                    <div className="kp-lbl">Active fingerprints</div>
                    <div className={"kp-val" + (activeEnc ? "" : " none")}>{activeEnc ? `enc ${activeEnc.fingerprint} · sig ${activeSig?.fingerprint ?? "—"}` : "No keys yet — generate a pair"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                    <div>
                      <label className="kp-lbl" style={{ display: "block", marginBottom: 4 }}>Version</label>
                      <input className="input mono" style={{ width: 110 }} value={keyVersion} placeholder="1.0.0"
                        onChange={(e) => setKeyVersion(e.target.value)} />
                    </div>
                    <button className="btn-ghost accent" disabled={genBusy} onClick={generateKeys}>
                      <Plus size={13} style={{ verticalAlign: "-2px" }} /> {genBusy ? "Generating…" : "Generate keys"}
                    </button>
                    <button className="btn-ghost" onClick={() => setImportOpen((o) => !o)}>
                      <Import size={13} style={{ verticalAlign: "-2px" }} /> {importOpen ? "Cancel import" : "Import keys"}
                    </button>
                  </div>
                </div>

                {importOpen && (
                  <div className="card" style={{ marginTop: 10, background: "var(--field)" }}>
                    <div className="card-body">
                      <div className="hint" style={{ marginBottom: 8 }}>Paste or upload an already-generated key pair (PEM). Fill in encryption, signature, or both — whichever you provide gets saved under the version below.</div>
                      <div className="frow">
                        <label className="fl">Version <span className="req">*</span></label>
                        <input className="input mono" style={{ width: 110 }} value={importVersion} placeholder="1.0.0" onChange={(e) => setImportVersion(e.target.value)} />
                      </div>

                      <div className="frow two">
                        <div>
                          <label className="fl">Encryption public key (RSA-OAEP)</label>
                          <textarea className="input mono" rows={4} placeholder="-----BEGIN PUBLIC KEY-----" value={encPubIn} onChange={(e) => setEncPubIn(e.target.value)} />
                          <input ref={encPubFile} type="file" accept=".pem,.crt,.pub,.key,.txt" style={{ display: "none" }} onChange={(e) => readFileInto(e, setEncPubIn)} />
                          <button className="btn-ghost" style={{ marginTop: 4 }} onClick={() => encPubFile.current?.click()}><FileUp size={12} style={{ verticalAlign: "-2px" }} /> Upload file</button>
                        </div>
                        <div>
                          <label className="fl">Encryption private key (RSA-OAEP)</label>
                          <textarea className="input mono" rows={4} placeholder="-----BEGIN PRIVATE KEY-----" value={encPrivIn} onChange={(e) => setEncPrivIn(e.target.value)} />
                          <input ref={encPrivFile} type="file" accept=".pem,.key,.txt" style={{ display: "none" }} onChange={(e) => readFileInto(e, setEncPrivIn)} />
                          <button className="btn-ghost" style={{ marginTop: 4 }} onClick={() => encPrivFile.current?.click()}><FileUp size={12} style={{ verticalAlign: "-2px" }} /> Upload file</button>
                        </div>
                      </div>

                      <div className="frow two">
                        <div>
                          <label className="fl">Signature public key (ECDSA P-384)</label>
                          <textarea className="input mono" rows={4} placeholder="-----BEGIN PUBLIC KEY-----" value={sigPubIn} onChange={(e) => setSigPubIn(e.target.value)} />
                          <input ref={sigPubFile} type="file" accept=".pem,.crt,.pub,.key,.txt" style={{ display: "none" }} onChange={(e) => readFileInto(e, setSigPubIn)} />
                          <button className="btn-ghost" style={{ marginTop: 4 }} onClick={() => sigPubFile.current?.click()}><FileUp size={12} style={{ verticalAlign: "-2px" }} /> Upload file</button>
                        </div>
                        <div>
                          <label className="fl">Signature private key (ECDSA P-384)</label>
                          <textarea className="input mono" rows={4} placeholder="-----BEGIN PRIVATE KEY-----" value={sigPrivIn} onChange={(e) => setSigPrivIn(e.target.value)} />
                          <input ref={sigPrivFile} type="file" accept=".pem,.key,.txt" style={{ display: "none" }} onChange={(e) => readFileInto(e, setSigPrivIn)} />
                          <button className="btn-ghost" style={{ marginTop: 4 }} onClick={() => sigPrivFile.current?.click()}><FileUp size={12} style={{ verticalAlign: "-2px" }} /> Upload file</button>
                        </div>
                      </div>

                      <div className="config-foot" style={{ padding: "10px 0 0" }}>
                        <span className="foot-status">Keys are validated locally before being saved — nothing is uploaded here.</span>
                        <button className="btn-ghost" disabled={importBusy} onClick={() => { resetImportForm(); setImportOpen(false); }}>Cancel</button>
                        <button className="btn-primary" disabled={importBusy} onClick={importKeys}>{importBusy ? "Importing…" : "Import"}</button>
                      </div>
                    </div>
                  </div>
                )}

                <KeyTable title="Encryption keys (RSA-OAEP)" rows={active.encKeys} uploading={uploading} kind="enc" env={active.credentials.environment}
                  onLocal={(v) => activateLocal("enc", v)} onUpload={(r) => uploadActivate("enc", r)} />
                <KeyTable title="Signature keys (ECDSA-P384)" rows={active.sigKeys} uploading={uploading} kind="sig" env={active.credentials.environment}
                  onLocal={(v) => activateLocal("sig", v)} onUpload={(r) => uploadActivate("sig", r)} />
                <div className="hint" style={{ marginTop: 10 }}>Upload &amp; activate signs a challenge with the private key over mutual-TLS — the private key never leaves this device. Reconnecting never deletes keys.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <DetailModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function KeyTable({ title, rows, kind, env, uploading, onLocal, onUpload }: {
  title: string; rows: KeyRecord[]; kind: "enc" | "sig"; env: string; uploading: string | null;
  onLocal: (v: string) => void; onUpload: (r: KeyRecord) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="kp-lbl" style={{ marginBottom: 4 }}>{title}</div>
      {rows.length === 0 ? <div className="hint">None yet.</div> : (
        <table className="keytable">
          <thead><tr><th>Version</th><th>Fingerprint</th><th>EcoHub</th><th>Local</th><th style={{ width: 150 }}></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const isUploading = uploading === `${kind}:${r.version}`;
              return (
                <tr key={r.version}>
                  <td className="mono">{r.version}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{r.fingerprint}</td>
                  <td>
                    {r.remote === "activated" ? <span className="chip chip-ok">Activated</span>
                      : r.remote === "uploaded" ? <span className="chip chip-warn">Uploaded</span>
                      : <span className="chip chip-pending">Local only</span>}
                  </td>
                  <td><span className={"dot " + (r.active ? "on" : "off")} style={{ marginRight: 6, verticalAlign: "middle" }} />{r.active ? "Active" : "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {!r.active && <button className="btn-ghost" onClick={() => onLocal(r.version)}>Use</button>}
                    {r.remote !== "activated" && (
                      <button className="btn-ghost accent" disabled={isUploading} onClick={() => onUpload(r)} title={`Upload & activate in ${env}`}>
                        {isUploading ? <Loader2 size={12} className="spin" style={{ verticalAlign: "-2px" }} /> : <UploadCloud size={12} style={{ verticalAlign: "-2px" }} />} {isUploading ? "Working…" : "Upload & activate"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
