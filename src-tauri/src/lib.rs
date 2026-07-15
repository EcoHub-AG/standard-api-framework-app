use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct HttpResult {
    status: u16,
    ok: bool,
    body: String,
}

// ============================================================
// Encrypted vault: SQLite at rest, AES-256-GCM, master key in the OS keychain.
// The entire app state (profiles + private keys) is sealed before it touches
// disk; the only way to read it is with the per-machine key held by the OS
// credential store. Nothing is ever written in plaintext, and never to
// localStorage.
// ============================================================
const KEYCHAIN_SERVICE: &str = "ch.ecohub.saf.app";
const KEYCHAIN_USER: &str = "vault-master";

fn master_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(b64) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| e.to_string())?;
            let mut key = [0u8; 32];
            if bytes.len() != 32 {
                return Err("stored master key has wrong length".into());
            }
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            // first run on this machine → generate and persist a fresh master key
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let b64 = base64::engine::general_purpose::STANDARD.encode(key);
            entry.set_password(&b64).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

fn seal(plain: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key = master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|e| e.to_string())?;
    Ok((nonce.to_vec(), ct))
}

fn open(nonce: &[u8], ct: &[u8]) -> Result<Vec<u8>, String> {
    let key = master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| e.to_string())
}

fn db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("saf.db")).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK (id = 1), nonce BLOB NOT NULL, data BLOB NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn vault_load(app: tauri::AppHandle) -> Result<String, String> {
    let conn = db(&app)?;
    let row: Option<(Vec<u8>, Vec<u8>)> = conn
        .query_row("SELECT nonce, data FROM vault WHERE id = 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match row {
        Some((nonce, data)) => {
            let plain = open(&nonce, &data)?;
            Ok(String::from_utf8_lossy(&plain).to_string())
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn vault_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let (nonce, data) = seal(json.as_bytes())?;
    let conn = db(&app)?;
    conn.execute(
        "INSERT INTO vault (id, nonce, data) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET nonce = ?1, data = ?2",
        params![nonce, data],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// POST JSON over HTTP/1.1 from Rust (no browser CORS, forced HTTP/1.1 to match
/// the C# HttpClient). Returns the real status + response body so the UI can
/// show exactly what EcoHub returned.
#[tauri::command]
async fn http_post_json(url: String, body: String) -> Result<HttpResult, String> {
    let client = reqwest::Client::builder()
        .http1_only()
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let text = resp.text().await.unwrap_or_default();
    Ok(HttpResult { status, ok, body: text })
}

/// Mutual-TLS request presenting the tech-user certificate (base64 PKCS#12 / PFX,
/// opened with the profile password). Used for the Public Key Store API
/// (upload / verify / activate) which requires the SAF client certificate.
/// HTTP/1.1, TLS 1.2+ — matching the C# HttpClientHandler.
#[tauri::command]
async fn mtls_request(
    url: String,
    method: String,
    body: Option<String>,
    pfx_base64: String,
    password: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<HttpResult, String> {
    use base64::Engine;
    let der = base64::engine::general_purpose::STANDARD
        .decode(pfx_base64.trim())
        .map_err(|e| format!("cert decode: {e}"))?;
    let identity = reqwest::Identity::from_pkcs12_der(&der, &password)
        .map_err(|e| format!("load client cert: {e}"))?;

    let client = reqwest::Client::builder()
        .http1_only()
        .use_native_tls()
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .identity(identity)
        .build()
        .map_err(|e| e.to_string())?;

    let mut rb = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };
    rb = rb.header("Accept", "application/json");
    if let Some(hs) = headers {
        for (k, v) in hs {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = body {
        rb = rb.header("Content-Type", "application/json").body(b);
    }

    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let text = resp.text().await.unwrap_or_default();
    Ok(HttpResult { status, ok, body: text })
}

// ============================================================
// Schema Registry helpers — mTLS to {servicesApiUrl}/schemaregistry
// Mirrors Confluent.SchemaRegistry.CachedSchemaRegistryClient with
// UseLatestVersion = true, AutoRegisterSchemas = false,
// SubjectNameStrategy = Topic.
// Only used to resolve the live schema ID for the Confluent wire frame;
// payload validation is left to the broker (same as the C# JsonSerializer).
// ============================================================

/// Fetch the latest registered schema for a subject from the schema registry.
/// subject is typically "{topic}-value" or "{topic}-key".
async fn fetch_schema(
    registry_url: &str,
    subject: &str,
    pfx_base64: &str,
    password: &str,
) -> Result<u32, String> {
    use base64::Engine;
    let der = base64::engine::general_purpose::STANDARD
        .decode(pfx_base64.trim())
        .map_err(|e| format!("cert decode: {e}"))?;
    let identity = reqwest::Identity::from_pkcs12_der(&der, password)
        .map_err(|e| format!("load client cert: {e}"))?;

    let client = reqwest::Client::builder()
        .use_native_tls()
        .identity(identity)
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{registry_url}/subjects/{subject}/versions/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.schemaregistry.v1+json")
        .send()
        .await
        .map_err(|e| format!("schema registry request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("schema registry returned HTTP {status}: {body}"));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("parse schema registry response: {e}"))?;

    parsed["id"]
        .as_u64()
        .ok_or_else(|| "missing 'id' in schema registry response".to_string())
        .map(|id| id as u32)
}

/// Fetch both key and value schema IDs for a topic from the schema registry.
#[tauri::command]
async fn schema_registry_get_ids(
    services_api_url: String,
    topic: String,
    pfx_base64: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let registry_url = format!("{services_api_url}/schemaregistry");

    let value_schema_id = fetch_schema(&registry_url, &format!("{topic}-value"), &pfx_base64, &password).await?;
    let key_schema_id = fetch_schema(&registry_url, &format!("{topic}-key"), &pfx_base64, &password).await?;

    Ok(serde_json::json!({
        "valueSchemaId": value_schema_id,
        "keySchemaId": key_schema_id,
    }))
}

#[derive(Serialize)]
struct ProduceResult {
    ok: bool,
    partition: i32,
    offset: i64,
    detail: String,
}

/// Produce a SAF event over the native Kafka protocol (mTLS to the CSM broker,
/// same engine as the C# Confluent.Kafka client). Key and value are framed in
/// the Confluent wire format (0x00 magic + 4-byte big-endian schema id + JSON).
#[tauri::command]
async fn kafka_produce(
    bootstrap: String,
    topic: String,
    key_json: String,
    value_json: String,
    value_schema_id: u32,
    key_schema_id: u32,
    pfx_base64: String,
    password: String,
) -> Result<ProduceResult, String> {
    use base64::Engine;
    use rdkafka::config::ClientConfig;
    use rdkafka::producer::{FutureProducer, FutureRecord};
    use std::time::Duration;

    let der = base64::engine::general_purpose::STANDARD
        .decode(pfx_base64.trim())
        .map_err(|e| format!("cert decode: {e}"))?;
    let pfx_path = std::env::temp_dir().join(format!("saf-{}.p12", std::process::id()));
    std::fs::write(&pfx_path, &der).map_err(|e| e.to_string())?;

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &bootstrap)
        .set("security.protocol", "ssl")
        .set("ssl.keystore.location", pfx_path.to_string_lossy().to_string())
        .set("ssl.keystore.password", &password)
        .set("message.timeout.ms", "20000")
        .create()
        .map_err(|e| e.to_string())?;

    let wire = |id: u32, json: &str| -> Vec<u8> {
        let mut v = Vec::with_capacity(5 + json.len());
        v.push(0x00);
        v.extend_from_slice(&id.to_be_bytes());
        v.extend_from_slice(json.as_bytes());
        v
    };
    let key_bytes = wire(key_schema_id, &key_json);
    let value_bytes = wire(value_schema_id, &value_json);

    let record = FutureRecord::to(&topic).key(&key_bytes).payload(&value_bytes);
    let result = producer.send(record, Duration::from_secs(25)).await;
    let _ = std::fs::remove_file(&pfx_path);

    match result {
        Ok((partition, offset)) => Ok(ProduceResult {
            ok: true,
            partition,
            offset,
            detail: format!("Delivered to {topic} [partition {partition} @ offset {offset}]"),
        }),
        Err((e, _)) => Err(e.to_string()),
    }
}

// ============================================================
// Kafka consumer — subscribes to ^eh\.saf\..*\.out\.v1$ (mTLS),
// strips the Confluent wire frame, emits "saf-message" Tauri events.
// Mirrors C# ReceiveDataViewModel.StartKafkaConsumer().
// ============================================================

pub struct ConsumerState(Mutex<Arc<AtomicBool>>);

/// Start (or restart) the Kafka consumer. Safe to call multiple times —
/// stops any running consumer before starting a new one.
#[tauri::command]
fn kafka_start_consumer(
    app: tauri::AppHandle,
    state: tauri::State<ConsumerState>,
    bootstrap: String,
    group_id: String,
    pfx_base64: String,
    password: String,
) -> Result<(), String> {
    use base64::Engine;
    use rdkafka::config::ClientConfig;
    use rdkafka::consumer::{BaseConsumer, Consumer};
    use rdkafka::Message;
    use std::time::Duration;

    // stop any previous consumer
    state.0.lock().unwrap().store(false, Ordering::Relaxed);

    let running = Arc::new(AtomicBool::new(true));
    *state.0.lock().unwrap() = Arc::clone(&running);

    let der = base64::engine::general_purpose::STANDARD
        .decode(pfx_base64.trim())
        .map_err(|e| format!("cert decode: {e}"))?;
    let pfx_path = std::env::temp_dir().join(format!("saf-recv-{}.p12", std::process::id()));
    std::fs::write(&pfx_path, &der).map_err(|e| e.to_string())?;
    let pfx_path_str = pfx_path.to_string_lossy().to_string();

    std::thread::spawn(move || {
        let consumer: BaseConsumer = match ClientConfig::new()
            .set("bootstrap.servers", &bootstrap)
            .set("group.id", &group_id)
            .set("security.protocol", "ssl")
            .set("ssl.keystore.location", &pfx_path_str)
            .set("ssl.keystore.password", &password)
            .set("auto.offset.reset", "earliest")
            .set("enable.auto.commit", "true")
            .create()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("saf-consumer-error", e.to_string());
                return;
            }
        };

        if let Err(e) = consumer.subscribe(&["^eh\\.saf\\..*\\.out\\.v1$"]) {
            let _ = app.emit("saf-consumer-error", e.to_string());
            return;
        }

        let _ = app.emit("saf-consumer-ready", ());

        while running.load(Ordering::Relaxed) {
            match consumer.poll(Duration::from_millis(300)) {
                Some(Ok(msg)) => {
                    let Some(bytes) = msg.payload() else { continue };
                    // strip Confluent wire frame: 0x00 magic + 4-byte schema id
                    let json_bytes = if bytes.len() >= 5 && bytes[0] == 0x00 {
                        &bytes[5..]
                    } else {
                        bytes
                    };
                    let Ok(raw_json) = std::str::from_utf8(json_bytes) else { continue };
                    let _ = app.emit("saf-message", serde_json::json!({
                        "rawJson": raw_json,
                        "topic": msg.topic(),
                    }));
                }
                Some(Err(e)) => {
                    let _ = app.emit("saf-consumer-error", e.to_string());
                }
                None => {}
            }
        }

        let _ = std::fs::remove_file(&pfx_path);
    });

    Ok(())
}

#[tauri::command]
fn kafka_stop_consumer(state: tauri::State<ConsumerState>) {
    state.0.lock().unwrap().store(false, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConsumerState(Mutex::new(Arc::new(AtomicBool::new(false)))))
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            http_post_json, mtls_request, vault_load, vault_save,
            kafka_produce, schema_registry_get_ids,
            kafka_start_consumer, kafka_stop_consumer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
