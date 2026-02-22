use regex::Regex;

use crate::graph::types::LayoutResult;

/// Filter commits in a LayoutResult by a regex pattern on a specified field.
///
/// Supported fields: "message" (subject), "author", "committer", "sha".
/// Returns a new LayoutResult containing only matching nodes and their edges.
pub fn filter_commits_by_field(
    layout: &LayoutResult,
    field: &str,
    pattern: &str,
) -> Result<LayoutResult, String> {
    let re = Regex::new(pattern).map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let matching_shas: std::collections::HashSet<String> = layout
        .nodes
        .iter()
        .filter(|node| {
            let value = match field {
                "message" | "subject" => &node.subject,
                "author" => &node.author_name,
                "sha" | "hash" => &node.sha,
                _ => return false,
            };
            re.is_match(value)
        })
        .map(|node| node.sha.clone())
        .collect();

    let filtered_nodes: Vec<_> = layout
        .nodes
        .iter()
        .filter(|n| matching_shas.contains(&n.sha))
        .cloned()
        .collect();

    let filtered_edges: Vec<_> = layout
        .edges
        .iter()
        .filter(|e| matching_shas.contains(&e.from_sha) && matching_shas.contains(&e.to_sha))
        .cloned()
        .collect();

    let total_count = filtered_nodes.len();

    Ok(LayoutResult {
        nodes: filtered_nodes,
        edges: filtered_edges,
        total_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::types::*;

    fn make_test_layout() -> LayoutResult {
        LayoutResult {
            nodes: vec![
                LayoutNode {
                    sha: "aaa111".to_string(),
                    short_sha: "aaa".to_string(),
                    lane: 0,
                    row: 0,
                    color_index: 0,
                    subject: "Fix critical bug in parser".to_string(),
                    author_name: "Alice".to_string(),
                    author_date: 1700000000,
                    refs: vec![],
                    parents: vec!["bbb222".to_string()],
                    node_type: NodeType::Normal,
                },
                LayoutNode {
                    sha: "bbb222".to_string(),
                    short_sha: "bbb".to_string(),
                    lane: 0,
                    row: 1,
                    color_index: 0,
                    subject: "Add new feature for graph layout".to_string(),
                    author_name: "Bob".to_string(),
                    author_date: 1699999000,
                    refs: vec![],
                    parents: vec![],
                    node_type: NodeType::Normal,
                },
            ],
            edges: vec![Edge {
                from_sha: "aaa111".to_string(),
                to_sha: "bbb222".to_string(),
                from_lane: 0,
                to_lane: 0,
                from_row: 0,
                to_row: 1,
                edge_type: EdgeType::Normal,
                color_index: 0,
            }],
            total_count: 2,
        }
    }

    #[test]
    fn test_filter_by_author() {
        let layout = make_test_layout();
        let result = filter_commits_by_field(&layout, "author", "Alice").unwrap();
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].author_name, "Alice");
    }

    #[test]
    fn test_filter_by_message() {
        let layout = make_test_layout();
        let result = filter_commits_by_field(&layout, "message", "(?i)bug").unwrap();
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].sha, "aaa111");
    }

    #[test]
    fn test_filter_by_sha() {
        let layout = make_test_layout();
        let result = filter_commits_by_field(&layout, "sha", "bbb").unwrap();
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].sha, "bbb222");
    }

    #[test]
    fn test_filter_no_match() {
        let layout = make_test_layout();
        let result = filter_commits_by_field(&layout, "author", "Charlie").unwrap();
        assert_eq!(result.total_count, 0);
    }

    #[test]
    fn test_filter_invalid_regex() {
        let layout = make_test_layout();
        let result = filter_commits_by_field(&layout, "author", "[invalid");
        assert!(result.is_err());
    }
}
