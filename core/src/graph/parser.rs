use super::types::{CommitNode, RefInfo, RefType};

/// Parse the decorate string from git log `%d` into a Vec<RefInfo>.
///
/// The `%d` format produces strings like:
///   ` (HEAD -> main, origin/main, tag: v1.0)`
///   ` (origin/feature-branch)`
///   ` (tag: v0.1, tag: v0.1-rc1)`
///   `` (empty string for commits with no refs)
fn parse_refs(decorate: &str) -> Vec<RefInfo> {
    let trimmed = decorate.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    // Strip surrounding parentheses: " (HEAD -> main, origin/main)" -> "HEAD -> main, origin/main"
    let inner = if trimmed.starts_with('(') && trimmed.ends_with(')') {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };

    let mut refs = Vec::new();
    let mut head_branch: Option<String> = None;

    // Check for "HEAD -> branch_name" pattern first
    // This means the named branch is the current HEAD
    if inner.contains("HEAD -> ") {
        // Find the branch name that HEAD points to
        for part in inner.split(',') {
            let part = part.trim();
            if let Some(branch_name) = part.strip_prefix("HEAD -> ") {
                head_branch = Some(branch_name.trim().to_string());
                break;
            }
        }
    }

    for part in inner.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }

        if part == "HEAD" {
            // Detached HEAD
            refs.push(RefInfo {
                name: "HEAD".to_string(),
                ref_type: RefType::Head,
                is_head: true,
            });
            continue;
        }

        if part.starts_with("HEAD -> ") {
            // HEAD -> branch_name: emit a Head ref for HEAD
            let branch_name = part.strip_prefix("HEAD -> ").unwrap().trim();
            refs.push(RefInfo {
                name: "HEAD".to_string(),
                ref_type: RefType::Head,
                is_head: true,
            });
            // The branch itself will be handled below (it may appear separately
            // or we add it now if it won't appear again)
            refs.push(RefInfo {
                name: branch_name.to_string(),
                ref_type: RefType::Branch,
                is_head: true,
            });
            continue;
        }

        if let Some(tag_name) = part.strip_prefix("tag: ") {
            let tag_name = tag_name.trim();
            refs.push(RefInfo {
                name: tag_name.to_string(),
                ref_type: RefType::Tag,
                is_head: false,
            });
            continue;
        }

        // Check for stash ref
        if part.starts_with("refs/stash") || part == "stash" {
            refs.push(RefInfo {
                name: part.to_string(),
                ref_type: RefType::Stash,
                is_head: false,
            });
            continue;
        }

        // Check for remote branch: contains '/' indicating origin/branch_name
        // but not "refs/heads/" or "refs/tags/"
        if let Some(stripped) = part.strip_prefix("refs/remotes/") {
            refs.push(RefInfo {
                name: stripped.to_string(),
                ref_type: RefType::RemoteBranch,
                is_head: false,
            });
            continue;
        }

        if let Some(stripped) = part.strip_prefix("refs/heads/") {
            let is_head = head_branch.as_deref() == Some(stripped);
            refs.push(RefInfo {
                name: stripped.to_string(),
                ref_type: RefType::Branch,
                is_head,
            });
            continue;
        }

        // If it contains a '/', treat as remote branch (e.g. "origin/main")
        if part.contains('/') {
            refs.push(RefInfo {
                name: part.to_string(),
                ref_type: RefType::RemoteBranch,
                is_head: false,
            });
        } else {
            // Local branch name
            let is_head = head_branch.as_deref() == Some(part);
            refs.push(RefInfo {
                name: part.to_string(),
                ref_type: RefType::Branch,
                is_head,
            });
        }
    }

    refs
}

/// Parse the raw git log output into a Vec<CommitNode>.
///
/// Expected format uses NUL (\x00) delimited fields and record separator (\x1e)
/// between records:
///   `%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%d%x1e`
///
/// Fields in order:
///   0: %H  - full commit hash
///   1: %h  - abbreviated commit hash
///   2: %P  - parent hashes (space-separated)
///   3: %an - author name
///   4: %ae - author email
///   5: %at - author date (unix epoch)
///   6: %cn - committer name
///   7: %ce - committer email
///   8: %ct - committer date (unix epoch)
///   9: %s  - subject
///  10: %d  - ref decoration
pub fn parse_log(raw: &[u8]) -> Vec<CommitNode> {
    let input = match std::str::from_utf8(raw) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut commits = Vec::new();

    // Split by record separator \x1e
    for record in input.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        // Split by NUL \x00
        let fields: Vec<&str> = record.split('\x00').collect();
        if fields.len() < 10 {
            // Not enough fields, skip malformed record
            continue;
        }

        let sha = fields[0].trim().to_string();
        if sha.is_empty() {
            continue;
        }

        let short_sha = fields[1].trim().to_string();

        let parents: Vec<String> = fields[2]
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        let author_name = fields[3].to_string();
        let author_email = fields[4].to_string();
        let author_date: u64 = fields[5].trim().parse().unwrap_or(0);

        let committer_name = fields[6].to_string();
        let committer_email = fields[7].to_string();
        let commit_date: u64 = fields[8].trim().parse().unwrap_or(0);

        let subject = fields[9].to_string();

        let decorate = if fields.len() > 10 { fields[10] } else { "" };
        let refs = parse_refs(decorate);

        let node = CommitNode {
            sha,
            short_sha,
            parents,
            children: Vec::new(),
            author_name,
            author_email,
            author_date,
            committer_name,
            committer_email,
            commit_date,
            subject,
            refs,
            lane: -1,
            row: -1,
        };

        commits.push(node);
    }

    // Build children index: for each commit, add it as a child of its parents
    let sha_to_idx: std::collections::HashMap<String, usize> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.sha.clone(), i))
        .collect();

    // Collect parent-child relationships first to avoid borrow issues
    let mut child_additions: Vec<(usize, String)> = Vec::new();
    for commit in &commits {
        for parent_sha in &commit.parents {
            if let Some(&parent_idx) = sha_to_idx.get(parent_sha) {
                child_additions.push((parent_idx, commit.sha.clone()));
            }
        }
    }

    for (parent_idx, child_sha) in child_additions {
        commits[parent_idx].children.push(child_sha);
    }

    commits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_refs_empty() {
        let refs = parse_refs("");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_parse_refs_head_and_branch() {
        let refs = parse_refs(" (HEAD -> main, origin/main)");
        assert!(refs.len() >= 2);
        // Should have HEAD and main branch
        assert!(refs.iter().any(|r| r.ref_type == RefType::Head && r.is_head));
        assert!(refs.iter().any(|r| r.name == "main" && r.ref_type == RefType::Branch && r.is_head));
    }

    #[test]
    fn test_parse_refs_tag() {
        let refs = parse_refs(" (tag: v1.0)");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "v1.0");
        assert_eq!(refs[0].ref_type, RefType::Tag);
    }

    #[test]
    fn test_parse_log_single_record() {
        let raw = b"abc123\x00abc\x00def456 ghi789\x00Alice\x00alice@example.com\x001700000000\x00Alice\x00alice@example.com\x001700000000\x00Initial commit\x00 (HEAD -> main)\x1e";
        let commits = parse_log(raw);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].sha, "abc123");
        assert_eq!(commits[0].parents.len(), 2);
        assert_eq!(commits[0].parents[0], "def456");
        assert_eq!(commits[0].parents[1], "ghi789");
        assert_eq!(commits[0].author_name, "Alice");
    }

    #[test]
    fn test_parse_log_empty() {
        let raw = b"";
        let commits = parse_log(raw);
        assert!(commits.is_empty());
    }
}
