use serde::{Deserialize, Serialize};

/// A single blame entry from `git blame --incremental` output.
/// Each entry attributes a range of lines to a specific commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlameEntry {
    pub sha: String,
    pub short_sha: String,
    pub orig_line: u32,
    pub final_line: u32,
    pub num_lines: u32,
    pub author_name: String,
    pub author_email: String,
    pub author_date: u64,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_date: u64,
    pub summary: String,
    pub filename: String,
}
