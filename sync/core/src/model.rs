//! How Bits data is laid out inside the replicated Loro document.
//!
//! - `notes`: map of note id → map of fields. Fields are independent last-writer-wins
//!   registers, so edits to different fields of one note combine. (Stage 2 replaces the
//!   text-field rule with explicit conflict preservation.)
//! - `devices`: map of endpoint id → JSON device record. Membership lives in the document,
//!   so a device added on one peer becomes trusted by every peer it syncs with.

use anyhow::{Context, Result, bail};
use loro::{LoroDoc, LoroMap, LoroValue, ValueOrContainer};
use serde::{Deserialize, Serialize};

pub const NOTES: &str = "notes";
pub const DEVICES: &str = "devices";
/// Map of endpoint id → JSON list of socket addresses, written only by that device.
pub const ADDRESSES: &str = "addresses";

pub const MAX_BODY: usize = 100_000;
pub const MAX_TOPICS: usize = 30;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub source: String,
    pub topics: Vec<String>,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted: bool,
}

/// Fields a caller may change. `None` leaves the field as it is.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub source: Option<String>,
    pub topics: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub deleted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub name: String,
    pub platform: String,
    pub added_at: String,
    pub added_by: String,
    #[serde(default)]
    pub removed: bool,
}

pub fn now_iso() -> String {
    humantime::format_rfc3339_millis(std::time::SystemTime::now()).to_string()
}

fn str_field(map: &LoroMap, key: &str) -> String {
    match map.get(key) {
        Some(ValueOrContainer::Value(LoroValue::String(s))) => s.to_string(),
        _ => String::new(),
    }
}

fn bool_field(map: &LoroMap, key: &str) -> bool {
    matches!(map.get(key), Some(ValueOrContainer::Value(LoroValue::Bool(true))))
}

fn topics_field(map: &LoroMap) -> Vec<String> {
    match map.get("topics") {
        Some(ValueOrContainer::Value(LoroValue::String(s))) => serde_json::from_str(&s).unwrap_or_default(),
        _ => vec![],
    }
}

fn note_map(doc: &LoroDoc, id: &str) -> Option<LoroMap> {
    match doc.get_map(NOTES).get(id) {
        Some(ValueOrContainer::Container(c)) => c.into_map().ok(),
        _ => None,
    }
}

pub fn read_note(doc: &LoroDoc, id: &str) -> Option<Note> {
    let m = note_map(doc, id)?;
    Some(Note {
        id: id.to_owned(),
        title: str_field(&m, "title"),
        body: str_field(&m, "body"),
        source: str_field(&m, "source"),
        topics: topics_field(&m),
        favorite: bool_field(&m, "favorite"),
        created_at: str_field(&m, "createdAt"),
        updated_at: str_field(&m, "updatedAt"),
        deleted: bool_field(&m, "deleted"),
    })
}

pub fn list_notes(doc: &LoroDoc) -> Vec<Note> {
    let notes = doc.get_map(NOTES);
    let mut out: Vec<Note> = notes.keys().filter_map(|k| read_note(doc, &k)).collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// Comma-free, trimmed, case-insensitively unique topics (mirrors `parseTopics` in Bits).
pub fn normalize_topics(topics: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    topics
        .iter()
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .collect()
}

fn validate(patch: &NotePatch) -> Result<()> {
    if let Some(body) = &patch.body {
        if body.chars().count() > MAX_BODY {
            bail!("A bit can hold up to {MAX_BODY} characters.");
        }
    }
    if patch.title.as_ref().is_some_and(|t| t.chars().count() > 200) {
        bail!("Titles are limited to 200 characters.");
    }
    if patch.source.as_ref().is_some_and(|s| s.chars().count() > 2000) {
        bail!("Sources are limited to 2000 characters.");
    }
    if patch.topics.as_ref().is_some_and(|t| t.len() > MAX_TOPICS || t.iter().any(|t| t.chars().count() > 80)) {
        bail!("A bit can have up to {MAX_TOPICS} topics of 80 characters each.");
    }
    Ok(())
}

/// Writes only the fields that differ from the stored note, so untouched fields
/// generate no operations and concurrent edits to other fields survive.
/// Returns whether anything changed. The caller commits.
pub fn apply_patch(doc: &LoroDoc, id: &str, patch: &NotePatch) -> Result<bool> {
    validate(patch)?;
    let m = note_map(doc, id).context("That bit no longer exists.")?;
    let mut changed = false;
    for (key, value) in [("title", &patch.title), ("body", &patch.body), ("source", &patch.source)] {
        if let Some(v) = value {
            if str_field(&m, key) != *v {
                m.insert(key, v.as_str())?;
                changed = true;
            }
        }
    }
    if let Some(topics) = &patch.topics {
        let topics = normalize_topics(topics);
        if topics_field(&m) != topics {
            m.insert("topics", serde_json::to_string(&topics)?)?;
            changed = true;
        }
    }
    for (key, value) in [("favorite", patch.favorite), ("deleted", patch.deleted)] {
        if let Some(v) = value {
            if bool_field(&m, key) != v {
                m.insert(key, v)?;
                changed = true;
            }
        }
    }
    if changed {
        m.insert("updatedAt", now_iso())?;
    }
    Ok(changed)
}

pub fn create_note(doc: &LoroDoc, patch: &NotePatch) -> Result<String> {
    validate(patch)?;
    if patch.body.as_deref().unwrap_or("").trim().is_empty() {
        bail!("A bit needs some information.");
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    let m = doc.get_map(NOTES).insert_container(&id, LoroMap::new())?;
    m.insert("createdAt", now.as_str())?;
    m.insert("updatedAt", now.as_str())?;
    for key in ["title", "body", "source"] {
        m.insert(key, "")?;
    }
    m.insert("topics", "[]")?;
    m.insert("favorite", false)?;
    m.insert("deleted", false)?;
    apply_patch(doc, &id, patch)?;
    // apply_patch bumps updatedAt; a new note's timestamps should match.
    m.insert("updatedAt", now.as_str())?;
    Ok(id)
}

pub fn read_devices(doc: &LoroDoc) -> Vec<(String, DeviceRecord)> {
    let devices = doc.get_map(DEVICES);
    devices
        .keys()
        .filter_map(|k| match devices.get(&k) {
            Some(ValueOrContainer::Value(LoroValue::String(s))) => {
                serde_json::from_str(&s).ok().map(|r| (k.to_string(), r))
            }
            _ => None,
        })
        .collect()
}

pub fn write_device(doc: &LoroDoc, id: &str, record: &DeviceRecord) -> Result<()> {
    doc.get_map(DEVICES).insert(id, serde_json::to_string(record)?)?;
    Ok(())
}

pub fn read_addresses(doc: &LoroDoc, id: &str) -> Vec<std::net::SocketAddr> {
    match doc.get_map(ADDRESSES).get(id) {
        Some(ValueOrContainer::Value(LoroValue::String(s))) => serde_json::from_str(&s).unwrap_or_default(),
        _ => vec![],
    }
}

/// Publishes this device's addresses; returns whether they changed. The caller commits.
pub fn write_addresses(doc: &LoroDoc, id: &str, addrs: &[std::net::SocketAddr]) -> Result<bool> {
    let mut addrs = addrs.to_vec();
    addrs.sort();
    if read_addresses(doc, id) == addrs {
        return Ok(false);
    }
    doc.get_map(ADDRESSES).insert(id, serde_json::to_string(&addrs)?)?;
    Ok(true)
}
