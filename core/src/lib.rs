pub mod graph;
pub mod blame;
pub mod filter;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;

use wasm_bindgen::prelude::*;

use graph::types::LayoutResult;

// ---------------------------------------------------------------------------
// Handle storage for persistent LayoutResult instances across WASM calls.
// ---------------------------------------------------------------------------

/// Global storage for layout results, keyed by opaque u32 handles.
/// Uses OnceLock for lazy one-time initialization and Mutex for interior mutability.
fn layout_store() -> &'static Mutex<LayoutStore> {
    static STORE: OnceLock<Mutex<LayoutStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(LayoutStore::new()))
}

struct LayoutStore {
    layouts: HashMap<u32, LayoutResult>,
    next_handle: u32,
}

impl LayoutStore {
    fn new() -> Self {
        LayoutStore {
            layouts: HashMap::new(),
            next_handle: 1,
        }
    }

    fn insert(&mut self, layout: LayoutResult) -> u32 {
        let handle = self.next_handle;
        self.next_handle = self.next_handle.wrapping_add(1);
        if self.next_handle == 0 {
            self.next_handle = 1; // skip 0 as a sentinel
        }
        self.layouts.insert(handle, layout);
        handle
    }

    fn get(&self, handle: u32) -> Option<&LayoutResult> {
        self.layouts.get(&handle)
    }

    fn get_mut(&mut self, handle: u32) -> Option<&mut LayoutResult> {
        self.layouts.get_mut(&handle)
    }

    fn remove(&mut self, handle: u32) -> bool {
        self.layouts.remove(&handle).is_some()
    }
}

// ---------------------------------------------------------------------------
// JSON result wrapper for returning handle + data together.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct HandleResult {
    handle: u32,
    #[serde(flatten)]
    layout: LayoutResult,
}

#[derive(serde::Serialize)]
struct ErrorResult {
    error: String,
}

fn json_error(msg: &str) -> String {
    serde_json::to_string(&ErrorResult {
        error: msg.to_string(),
    })
    .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", msg))
}

// ---------------------------------------------------------------------------
// WASM-exported functions
// ---------------------------------------------------------------------------

/// Compute the full graph layout from raw git log output.
///
/// Input: raw bytes of NUL-delimited, record-separator-separated git log.
/// Returns: JSON string with { handle, nodes, edges, total_count }.
///
/// The handle can be used with `append_to_layout`, `filter_commits`,
/// `filter_by_date`, and must be freed with `free_layout` when done.
#[wasm_bindgen]
pub fn compute_graph_layout(raw_log: &[u8]) -> String {
    let commits = graph::parse_log(raw_log);
    let layout = graph::compute_layout(&commits);

    let mut store = match layout_store().lock() {
        Ok(s) => s,
        Err(_) => return json_error("Failed to acquire layout store lock"),
    };

    let handle = store.insert(layout.clone());

    let result = HandleResult { handle, layout };

    serde_json::to_string(&result).unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)))
}

/// Append additional commits to an existing layout.
///
/// Parses the new raw log, computes layout for the combined set, and updates
/// the stored layout in place.
///
/// Returns: JSON string with the updated { handle, nodes, edges, total_count }.
#[wasm_bindgen]
pub fn append_to_layout(handle: u32, raw_log: &[u8]) -> String {
    let new_commits = graph::parse_log(raw_log);
    if new_commits.is_empty() {
        // No new commits to add; return the existing layout
        let store = match layout_store().lock() {
            Ok(s) => s,
            Err(_) => return json_error("Failed to acquire layout store lock"),
        };
        return match store.get(handle) {
            Some(layout) => {
                let result = HandleResult {
                    handle,
                    layout: layout.clone(),
                };
                serde_json::to_string(&result)
                    .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)))
            }
            None => json_error(&format!("Invalid handle: {}", handle)),
        };
    }

    let mut store = match layout_store().lock() {
        Ok(s) => s,
        Err(_) => return json_error("Failed to acquire layout store lock"),
    };

    let existing_layout = match store.get(handle) {
        Some(l) => l.clone(),
        None => return json_error(&format!("Invalid handle: {}", handle)),
    };

    // Collect existing SHAs to avoid duplicates
    let existing_shas: std::collections::HashSet<&str> = existing_layout
        .nodes
        .iter()
        .map(|n| n.sha.as_str())
        .collect();

    // Filter out duplicates from new commits
    let unique_new: Vec<_> = new_commits
        .into_iter()
        .filter(|c| !existing_shas.contains(c.sha.as_str()))
        .collect();

    if unique_new.is_empty() {
        let result = HandleResult {
            handle,
            layout: existing_layout,
        };
        return serde_json::to_string(&result)
            .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)));
    }

    // Re-parse ALL commits: we need the original raw commit data to rebuild.
    // Since we only store LayoutResult (not raw CommitNodes), we rebuild
    // CommitNode entries from the existing layout nodes + new parsed commits.
    // This is a simplification; for a production system you'd store the raw nodes too.
    let mut all_commits: Vec<graph::types::CommitNode> = existing_layout
        .nodes
        .iter()
        .map(|ln| graph::types::CommitNode {
            sha: ln.sha.clone(),
            short_sha: ln.short_sha.clone(),
            parents: ln.parents.clone(),
            children: Vec::new(),
            author_name: ln.author_name.clone(),
            author_email: String::new(),
            author_date: ln.author_date,
            committer_name: String::new(),
            committer_email: String::new(),
            commit_date: 0,
            subject: ln.subject.clone(),
            refs: ln.refs.clone(),
            lane: -1,
            row: -1,
        })
        .collect();

    all_commits.extend(unique_new);

    // Recompute layout on the combined set
    let new_layout = graph::compute_layout(&all_commits);

    // Update the store
    if let Some(stored) = store.get_mut(handle) {
        *stored = new_layout.clone();
    }

    let result = HandleResult {
        handle,
        layout: new_layout,
    };

    serde_json::to_string(&result)
        .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)))
}

/// Free a previously allocated layout handle and its associated data.
///
/// After calling this, the handle is invalid and must not be used.
#[wasm_bindgen]
pub fn free_layout(handle: u32) {
    if let Ok(mut store) = layout_store().lock() {
        store.remove(handle);
    }
}

/// Parse raw `git blame --incremental` output into JSON.
///
/// Returns: JSON array of BlameEntry objects.
#[wasm_bindgen]
pub fn parse_blame(raw_blame: &[u8]) -> String {
    let entries = blame::parse_blame_output(raw_blame);
    serde_json::to_string(&entries)
        .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)))
}

/// Filter commits in a stored layout by a regex pattern on a field.
///
/// Supported fields: "message", "author", "committer", "sha".
/// Returns: JSON LayoutResult with only matching commits and edges.
#[wasm_bindgen]
pub fn filter_commits(handle: u32, field: &str, pattern: &str) -> String {
    let store = match layout_store().lock() {
        Ok(s) => s,
        Err(_) => return json_error("Failed to acquire layout store lock"),
    };

    let layout = match store.get(handle) {
        Some(l) => l,
        None => return json_error(&format!("Invalid handle: {}", handle)),
    };

    match filter::filter_commits_by_field(layout, field, pattern) {
        Ok(filtered) => serde_json::to_string(&filtered)
            .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e))),
        Err(e) => json_error(&e),
    }
}

/// Filter commits in a stored layout by date range.
///
/// `after` and `before` are unix epoch timestamps. Use 0 for no constraint.
/// Returns: JSON LayoutResult with only matching commits and edges.
#[wasm_bindgen]
pub fn filter_by_date(handle: u32, after: u64, before: u64) -> String {
    let store = match layout_store().lock() {
        Ok(s) => s,
        Err(_) => return json_error("Failed to acquire layout store lock"),
    };

    let layout = match store.get(handle) {
        Some(l) => l,
        None => return json_error(&format!("Invalid handle: {}", handle)),
    };

    let filtered = filter::filter_commits_by_date(layout, after, before);
    serde_json::to_string(&filtered)
        .unwrap_or_else(|e| json_error(&format!("Serialization error: {}", e)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_graph_layout_and_free() {
        let raw = b"aaa111aaa111aaa111aaa111aaa111aaa111aaa1\x00aaa111a\x00bbb222bbb222bbb222bbb222bbb222bbb222bbb2\x00Alice\x00alice@example.com\x001700000000\x00Alice\x00alice@example.com\x001700000000\x00Second commit\x00 (HEAD -> main)\x1ebbb222bbb222bbb222bbb222bbb222bbb222bbb2\x00bbb222b\x00\x00Bob\x00bob@example.com\x001699999000\x00Bob\x00bob@example.com\x001699999000\x00Initial commit\x00\x1e";
        let result_json = compute_graph_layout(raw);
        let parsed: serde_json::Value = serde_json::from_str(&result_json).unwrap();

        assert!(parsed.get("handle").is_some());
        assert!(parsed.get("nodes").is_some());
        assert!(parsed.get("edges").is_some());
        assert_eq!(parsed["totalCount"], 2);

        let handle = parsed["handle"].as_u64().unwrap() as u32;

        // Free the layout
        free_layout(handle);

        // Filtering on a freed handle should return an error
        let err_json = filter_commits(handle, "author", "Alice");
        let err_parsed: serde_json::Value = serde_json::from_str(&err_json).unwrap();
        assert!(err_parsed.get("error").is_some());
    }

    #[test]
    fn test_parse_blame_wasm() {
        let raw = b"abcdef0123456789abcdef0123456789abcdef01 1 1 3\nauthor Alice\nauthor-mail <alice@example.com>\nauthor-time 1700000000\nauthor-tz +0000\ncommitter Bob\ncommitter-mail <bob@example.com>\ncommitter-time 1700000100\ncommitter-tz +0000\nsummary Initial commit\nfilename src/main.rs\n";
        let result_json = parse_blame(raw);
        let parsed: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        assert!(parsed.is_array());
        assert_eq!(parsed.as_array().unwrap().len(), 1);
        assert_eq!(parsed[0]["author_name"], "Alice");
    }

    #[test]
    fn test_filter_commits_wasm() {
        let raw = b"aaa\x00aa\x00\x00Alice\x00a@e.com\x001700000000\x00Alice\x00a@e.com\x001700000000\x00Fix bug\x00\x1ebbb\x00bb\x00\x00Bob\x00b@e.com\x001699999000\x00Bob\x00b@e.com\x001699999000\x00Add feature\x00\x1e";
        let result_json = compute_graph_layout(raw);
        let parsed: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let handle = parsed["handle"].as_u64().unwrap() as u32;

        let filtered_json = filter_commits(handle, "author", "Alice");
        let filtered: serde_json::Value = serde_json::from_str(&filtered_json).unwrap();
        assert_eq!(filtered["totalCount"], 1);

        free_layout(handle);
    }

    #[test]
    fn test_filter_by_date_wasm() {
        let raw = b"aaa\x00aa\x00\x00Alice\x00a@e.com\x001700000000\x00Alice\x00a@e.com\x001700000000\x00Recent\x00\x1ebbb\x00bb\x00\x00Bob\x00b@e.com\x001600000000\x00Bob\x00b@e.com\x001600000000\x00Old\x00\x1e";
        let result_json = compute_graph_layout(raw);
        let parsed: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let handle = parsed["handle"].as_u64().unwrap() as u32;

        let filtered_json = filter_by_date(handle, 1650000000, 0);
        let filtered: serde_json::Value = serde_json::from_str(&filtered_json).unwrap();
        assert_eq!(filtered["totalCount"], 1);
        assert_eq!(filtered["nodes"][0]["subject"], "Recent");

        free_layout(handle);
    }
}
