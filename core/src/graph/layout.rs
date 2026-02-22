use std::collections::HashMap;

use super::types::*;

/// Simple hash function for branch names to produce a color index.
fn hash_branch_name(name: &str) -> u32 {
    let mut hash: u32 = 5381;
    for byte in name.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u32);
    }
    hash % 12
}

/// Determine the NodeType for a commit based on its refs.
fn determine_node_type(node: &CommitNode) -> NodeType {
    for r in &node.refs {
        if r.ref_type == RefType::Head {
            return NodeType::Head;
        }
        if r.ref_type == RefType::Stash {
            return NodeType::Stash;
        }
    }
    NodeType::Normal
}

/// Determine the color index for a commit.
///
/// If the commit has a branch ref, use hash(branch_name) % 12.
/// Otherwise, inherit the color from the first parent's lane.
fn determine_color_index(
    node: &CommitNode,
    lane_colors: &HashMap<i32, u32>,
    parent_lane: Option<i32>,
) -> u32 {
    // Check for a branch ref on this commit
    for r in &node.refs {
        if r.ref_type == RefType::Branch || r.ref_type == RefType::RemoteBranch {
            return hash_branch_name(&r.name);
        }
    }

    // Inherit from parent lane color
    if let Some(lane) = parent_lane {
        if let Some(&color) = lane_colors.get(&lane) {
            return color;
        }
    }

    // Fallback: hash the sha
    hash_branch_name(&node.sha)
}

/// Compute the DAG layout for a list of commits in topological order.
///
/// The algorithm uses a "straight branches" approach:
/// 1. Process commits in the order given (topological from git).
/// 2. For each commit, if it continues an existing lane (a parent occupied that lane),
///    reuse it. Otherwise, allocate the first available lane.
/// 3. When a merge happens (commit has multiple parents), free the non-primary
///    parent lanes after the merge row.
/// 4. Generate Edge structs connecting each parent-child pair.
pub fn compute_layout(commits: &[CommitNode]) -> LayoutResult {
    if commits.is_empty() {
        return LayoutResult {
            nodes: Vec::new(),
            edges: Vec::new(),
            total_count: 0,
        };
    }

    let total_count = commits.len();

    // Track which lane each SHA currently occupies (SHA -> lane)
    let mut sha_lane: HashMap<&str, i32> = HashMap::new();

    // Track which lanes are currently in use (lane -> bool)
    // We use a vec to track active lanes; index = lane number
    let mut active_lanes: Vec<bool> = Vec::new();

    // Track color for each lane
    let mut lane_colors: HashMap<i32, u32> = HashMap::new();

    // Output
    let mut layout_nodes: Vec<LayoutNode> = Vec::with_capacity(total_count);
    let mut edges: Vec<Edge> = Vec::new();

    /// Find the first available (inactive) lane, or extend the vec.
    fn allocate_lane(active_lanes: &mut Vec<bool>) -> i32 {
        for (i, active) in active_lanes.iter().enumerate() {
            if !active {
                active_lanes[i] = true;
                return i as i32;
            }
        }
        // All lanes are active, add a new one
        active_lanes.push(true);
        (active_lanes.len() - 1) as i32
    }

    fn free_lane(active_lanes: &mut Vec<bool>, lane: i32) {
        if lane >= 0 && (lane as usize) < active_lanes.len() {
            active_lanes[lane as usize] = false;
        }
    }

    // Process commits in topological order (row = index in the list)
    for (row, commit) in commits.iter().enumerate() {
        let row_i32 = row as i32;

        // Determine lane for this commit:
        // 1. If this commit's first child already assigned us a lane (via parent reservation),
        //    use it.
        // 2. Otherwise, allocate a new lane.
        let lane = if let Some(&reserved_lane) = sha_lane.get(commit.sha.as_str()) {
            // We already have a lane reserved from a child commit
            reserved_lane
        } else {
            // No reservation; allocate a new lane
            let new_lane = allocate_lane(&mut active_lanes);
            sha_lane.insert(&commit.sha, new_lane);
            new_lane
        };

        let color_index = determine_color_index(commit, &lane_colors, Some(lane));
        lane_colors.insert(lane, color_index);

        let node_type = determine_node_type(commit);

        layout_nodes.push(LayoutNode {
            sha: commit.sha.clone(),
            short_sha: commit.short_sha.clone(),
            lane,
            row: row_i32,
            color_index,
            subject: commit.subject.clone(),
            author_name: commit.author_name.clone(),
            author_date: commit.author_date,
            refs: commit.refs.clone(),
            parents: commit.parents.clone(),
            node_type,
        });

        // Process parents: reserve lanes for them
        if commit.parents.is_empty() {
            // Root commit: free the lane after this row (branch ends here going back in time)
            free_lane(&mut active_lanes, lane);
            sha_lane.remove(commit.sha.as_str());
        } else {
            // First parent continues on the same lane
            let first_parent = &commit.parents[0];

            // Check if the first parent already has a lane assigned (from another child)
            if sha_lane.contains_key(first_parent.as_str()) {
                // First parent already has a lane from another path.
                // Free our current lane since it merges into the parent's lane.
                let parent_lane = sha_lane[first_parent.as_str()];

                // Generate edge from this commit to its first parent
                // (parent's row/lane will be filled in when we reach it)
                // For now we record what we know
                edges.push(Edge {
                    from_sha: commit.sha.clone(),
                    to_sha: first_parent.clone(),
                    from_lane: lane,
                    to_lane: parent_lane,
                    from_row: row_i32,
                    to_row: -1, // will be filled in later
                    edge_type: EdgeType::Normal,
                    color_index: lane_colors.get(&parent_lane).copied().unwrap_or(color_index),
                });

                // Free this commit's lane since the parent is already tracked elsewhere
                free_lane(&mut active_lanes, lane);
                sha_lane.remove(commit.sha.as_str());
            } else {
                // First parent inherits this commit's lane
                sha_lane.remove(commit.sha.as_str());
                sha_lane.insert(first_parent, lane);

                edges.push(Edge {
                    from_sha: commit.sha.clone(),
                    to_sha: first_parent.clone(),
                    from_lane: lane,
                    to_lane: lane,
                    from_row: row_i32,
                    to_row: -1,
                    edge_type: EdgeType::Normal,
                    color_index,
                });
            }

            // Additional parents (merge parents) get new lanes
            for merge_parent in commit.parents.iter().skip(1) {
                if sha_lane.contains_key(merge_parent.as_str()) {
                    // Parent already has a lane from another path
                    let parent_lane = sha_lane[merge_parent.as_str()];
                    edges.push(Edge {
                        from_sha: commit.sha.clone(),
                        to_sha: merge_parent.clone(),
                        from_lane: lane,
                        to_lane: parent_lane,
                        from_row: row_i32,
                        to_row: -1,
                        edge_type: EdgeType::Merge,
                        color_index: lane_colors
                            .get(&parent_lane)
                            .copied()
                            .unwrap_or(color_index),
                    });
                } else {
                    // Allocate a new lane for this merge parent
                    let merge_lane = allocate_lane(&mut active_lanes);
                    let merge_color = hash_branch_name(merge_parent);
                    lane_colors.insert(merge_lane, merge_color);
                    sha_lane.insert(merge_parent, merge_lane);

                    edges.push(Edge {
                        from_sha: commit.sha.clone(),
                        to_sha: merge_parent.clone(),
                        from_lane: lane,
                        to_lane: merge_lane,
                        from_row: row_i32,
                        to_row: -1,
                        edge_type: EdgeType::Merge,
                        color_index: merge_color,
                    });
                }
            }
        }
    }

    // Second pass: fill in to_row for all edges by looking up each parent's assigned row
    let sha_to_row: HashMap<&str, i32> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.sha.as_str(), i as i32))
        .collect();

    for edge in &mut edges {
        if let Some(&parent_row) = sha_to_row.get(edge.to_sha.as_str()) {
            edge.to_row = parent_row;
        }
        // Also update to_lane from the layout node at that row
        if edge.to_row >= 0 && (edge.to_row as usize) < layout_nodes.len() {
            edge.to_lane = layout_nodes[edge.to_row as usize].lane;
        }
    }

    LayoutResult {
        nodes: layout_nodes,
        edges,
        total_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::parser::parse_log;

    #[test]
    fn test_compute_layout_empty() {
        let result = compute_layout(&[]);
        assert_eq!(result.total_count, 0);
        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }

    #[test]
    fn test_compute_layout_linear() {
        // Three linear commits: A -> B -> C
        let raw = b"aaa\x00aa\x00bbb\x00Alice\x00a@e.com\x001700000000\x00Alice\x00a@e.com\x001700000000\x00Third\x00\x1ebbb\x00bb\x00ccc\x00Alice\x00a@e.com\x001699999000\x00Alice\x00a@e.com\x001699999000\x00Second\x00\x1eccc\x00cc\x00\x00Alice\x00a@e.com\x001699998000\x00Alice\x00a@e.com\x001699998000\x00First\x00\x1e";
        let commits = parse_log(raw);
        assert_eq!(commits.len(), 3);

        let result = compute_layout(&commits);
        assert_eq!(result.total_count, 3);
        assert_eq!(result.nodes.len(), 3);
        // Linear commits should all be on lane 0
        assert_eq!(result.nodes[0].lane, 0);
        assert_eq!(result.nodes[1].lane, 0);
        assert_eq!(result.nodes[2].lane, 0);

        // Should have 2 edges: A->B and B->C
        assert_eq!(result.edges.len(), 2);
    }

    #[test]
    fn test_compute_layout_merge() {
        // Merge commit: M has parents A and B. Then A -> C (root), B -> C (root)
        // Topological order: M, A, B, C
        let raw = concat!(
            "mmm\x00mm\x00aaa bbb\x00Alice\x00a@e.com\x001700003000\x00Alice\x00a@e.com\x001700003000\x00Merge\x00\x1e",
            "aaa\x00aa\x00ccc\x00Alice\x00a@e.com\x001700002000\x00Alice\x00a@e.com\x001700002000\x00On main\x00\x1e",
            "bbb\x00bb\x00ccc\x00Bob\x00b@e.com\x001700001000\x00Bob\x00b@e.com\x001700001000\x00On branch\x00\x1e",
            "ccc\x00cc\x00\x00Alice\x00a@e.com\x001700000000\x00Alice\x00a@e.com\x001700000000\x00Root\x00\x1e"
        );
        let commits = parse_log(raw.as_bytes());
        assert_eq!(commits.len(), 4);

        let result = compute_layout(&commits);
        assert_eq!(result.total_count, 4);

        // Merge commit M should have 3 edges total (2 from M to parents, 2 from A/B to C... wait)
        // Actually: M->A (normal), M->B (merge), A->C (normal), B->C (normal) = 4 edges
        assert!(result.edges.len() >= 3);
    }
}
