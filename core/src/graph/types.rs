use serde::{Deserialize, Serialize};

/// The type of a git reference.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RefType {
    Branch,
    RemoteBranch,
    Tag,
    Head,
    Stash,
}

/// A single git reference (branch, tag, HEAD, etc.) decorating a commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub name: String,
    pub ref_type: RefType,
    pub is_head: bool,
}

/// A parsed commit node from git log output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitNode {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub children: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_date: u64,
    pub committer_name: String,
    pub committer_email: String,
    pub commit_date: u64,
    pub subject: String,
    pub refs: Vec<RefInfo>,
    pub lane: i32,
    pub row: i32,
}

/// The type of a visual node in the graph layout.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NodeType {
    Normal,
    Head,
    Stash,
    WorkingTree,
}

/// A node in the rendered graph layout, ready for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutNode {
    pub sha: String,
    pub short_sha: String,
    pub lane: i32,
    pub row: i32,
    pub color_index: u32,
    pub subject: String,
    pub author_name: String,
    pub author_date: u64,
    pub refs: Vec<RefInfo>,
    pub parents: Vec<String>,
    pub node_type: NodeType,
}

/// The type of an edge connecting two commits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EdgeType {
    Normal,
    Merge,
}

/// An edge connecting two commits in the graph layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from_sha: String,
    pub to_sha: String,
    pub from_lane: i32,
    pub to_lane: i32,
    pub from_row: i32,
    pub to_row: i32,
    pub edge_type: EdgeType,
    pub color_index: u32,
}

/// The complete result of computing graph layout, returned as JSON to JS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutResult {
    pub nodes: Vec<LayoutNode>,
    pub edges: Vec<Edge>,
    pub total_count: usize,
}
