use crate::graph::types::LayoutResult;

/// Filter commits in a LayoutResult by date range.
///
/// `after` and `before` are unix epoch timestamps (seconds).
/// A value of 0 for either bound means "no constraint" on that side.
/// Filters on the `author_date` field of each LayoutNode.
pub fn filter_commits_by_date(
    layout: &LayoutResult,
    after: u64,
    before: u64,
) -> LayoutResult {
    let matching_shas: std::collections::HashSet<String> = layout
        .nodes
        .iter()
        .filter(|node| {
            let date = node.author_date;
            let after_ok = after == 0 || date >= after;
            let before_ok = before == 0 || date <= before;
            after_ok && before_ok
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

    LayoutResult {
        nodes: filtered_nodes,
        edges: filtered_edges,
        total_count,
    }
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
                    subject: "Recent commit".to_string(),
                    author_name: "Alice".to_string(),
                    author_date: 1700000000, // Nov 14, 2023
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
                    subject: "Middle commit".to_string(),
                    author_name: "Bob".to_string(),
                    author_date: 1690000000, // Jul 22, 2023
                    refs: vec![],
                    parents: vec!["ccc333".to_string()],
                    node_type: NodeType::Normal,
                },
                LayoutNode {
                    sha: "ccc333".to_string(),
                    short_sha: "ccc".to_string(),
                    lane: 0,
                    row: 2,
                    color_index: 0,
                    subject: "Old commit".to_string(),
                    author_name: "Charlie".to_string(),
                    author_date: 1680000000, // Mar 28, 2023
                    refs: vec![],
                    parents: vec![],
                    node_type: NodeType::Normal,
                },
            ],
            edges: vec![
                Edge {
                    from_sha: "aaa111".to_string(),
                    to_sha: "bbb222".to_string(),
                    from_lane: 0,
                    to_lane: 0,
                    from_row: 0,
                    to_row: 1,
                    edge_type: EdgeType::Normal,
                    color_index: 0,
                },
                Edge {
                    from_sha: "bbb222".to_string(),
                    to_sha: "ccc333".to_string(),
                    from_lane: 0,
                    to_lane: 0,
                    from_row: 1,
                    to_row: 2,
                    edge_type: EdgeType::Normal,
                    color_index: 0,
                },
            ],
            total_count: 3,
        }
    }

    #[test]
    fn test_filter_after_only() {
        let layout = make_test_layout();
        let result = filter_commits_by_date(&layout, 1695000000, 0);
        // Only the recent commit (1700000000) should pass
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].sha, "aaa111");
    }

    #[test]
    fn test_filter_before_only() {
        let layout = make_test_layout();
        let result = filter_commits_by_date(&layout, 0, 1685000000);
        // Only the old commit (1680000000) should pass
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].sha, "ccc333");
    }

    #[test]
    fn test_filter_date_range() {
        let layout = make_test_layout();
        let result = filter_commits_by_date(&layout, 1685000000, 1695000000);
        // Only the middle commit (1690000000) should pass
        assert_eq!(result.total_count, 1);
        assert_eq!(result.nodes[0].sha, "bbb222");
    }

    #[test]
    fn test_filter_no_constraint() {
        let layout = make_test_layout();
        let result = filter_commits_by_date(&layout, 0, 0);
        assert_eq!(result.total_count, 3);
    }

    #[test]
    fn test_filter_no_match() {
        let layout = make_test_layout();
        let result = filter_commits_by_date(&layout, 1800000000, 1900000000);
        assert_eq!(result.total_count, 0);
    }
}
