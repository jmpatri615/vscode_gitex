use super::types::BlameEntry;

/// Parse `git blame --incremental` output into a Vec<BlameEntry>.
///
/// The incremental format looks like:
/// ```text
/// <40-char sha> <orig_line> <final_line> <num_lines>
/// author <name>
/// author-mail <<email>>
/// author-time <epoch>
/// author-tz <tz>
/// committer <name>
/// committer-mail <<email>>
/// committer-time <epoch>
/// committer-tz <tz>
/// summary <text>
/// previous <sha> <filename>
/// filename <path>
/// \t<line content>        (optional, only in porcelain, not incremental)
/// ```
///
/// A new blame chunk starts with a line matching the SHA pattern.
/// Subsequent lines are key-value pairs until the next SHA line or EOF.
pub fn parse_blame_output(raw: &[u8]) -> Vec<BlameEntry> {
    let input = match std::str::from_utf8(raw) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut entries: Vec<BlameEntry> = Vec::new();

    // Current entry being built
    let mut current_sha = String::new();
    let mut current_orig_line: u32 = 0;
    let mut current_final_line: u32 = 0;
    let mut current_num_lines: u32 = 0;
    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut author_date: u64 = 0;
    let mut committer_name = String::new();
    let mut committer_email = String::new();
    let mut committer_date: u64 = 0;
    let mut summary = String::new();
    let mut filename = String::new();
    let mut in_entry = false;

    for line in input.lines() {
        let line = line.trim_end();

        if line.is_empty() {
            continue;
        }

        // Skip content lines (lines starting with a tab in porcelain mode)
        if line.starts_with('\t') {
            continue;
        }

        // Check if this line is a SHA header line.
        // Format: <40-hex-chars> <orig_line> <final_line> <num_lines>
        // or:     <40-hex-chars> <orig_line> <final_line>  (boundary commits in some modes)
        if is_sha_header(line) {
            // If we were building an entry, finalize it
            if in_entry && !current_sha.is_empty() && !filename.is_empty() {
                entries.push(BlameEntry {
                    sha: current_sha.clone(),
                    short_sha: if current_sha.len() >= 7 {
                        current_sha[..7].to_string()
                    } else {
                        current_sha.clone()
                    },
                    orig_line: current_orig_line,
                    final_line: current_final_line,
                    num_lines: current_num_lines,
                    author_name: author_name.clone(),
                    author_email: author_email.clone(),
                    author_date,
                    committer_name: committer_name.clone(),
                    committer_email: committer_email.clone(),
                    committer_date,
                    summary: summary.clone(),
                    filename: filename.clone(),
                });
            }

            // Parse the header
            let parts: Vec<&str> = line.split_whitespace().collect();
            current_sha = parts[0].to_string();
            current_orig_line = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            current_final_line = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            current_num_lines = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(1);

            // Reset fields for new entry
            author_name.clear();
            author_email.clear();
            author_date = 0;
            committer_name.clear();
            committer_email.clear();
            committer_date = 0;
            summary.clear();
            filename.clear();
            in_entry = true;

            continue;
        }

        if !in_entry {
            continue;
        }

        // Parse key-value pairs
        if let Some(val) = line.strip_prefix("author-mail ") {
            // Strip angle brackets: <email> -> email
            author_email = val.trim_start_matches('<').trim_end_matches('>').to_string();
        } else if let Some(val) = line.strip_prefix("author-time ") {
            author_date = val.trim().parse().unwrap_or(0);
        } else if line.starts_with("author-tz ") {
            // Ignore timezone, we use epoch
        } else if let Some(val) = line.strip_prefix("author ") {
            author_name = val.to_string();
        } else if let Some(val) = line.strip_prefix("committer-mail ") {
            committer_email = val.trim_start_matches('<').trim_end_matches('>').to_string();
        } else if let Some(val) = line.strip_prefix("committer-time ") {
            committer_date = val.trim().parse().unwrap_or(0);
        } else if line.starts_with("committer-tz ") {
            // Ignore timezone
        } else if let Some(val) = line.strip_prefix("committer ") {
            committer_name = val.to_string();
        } else if let Some(val) = line.strip_prefix("summary ") {
            summary = val.to_string();
        } else if let Some(val) = line.strip_prefix("filename ") {
            filename = val.to_string();
        } else if line.starts_with("previous ") || line.starts_with("boundary") {
            // Ignore these metadata lines
        }
    }

    // Don't forget the last entry
    if in_entry && !current_sha.is_empty() && !filename.is_empty() {
        entries.push(BlameEntry {
            sha: current_sha.clone(),
            short_sha: if current_sha.len() >= 7 {
                current_sha[..7].to_string()
            } else {
                current_sha.clone()
            },
            orig_line: current_orig_line,
            final_line: current_final_line,
            num_lines: current_num_lines,
            author_name,
            author_email,
            author_date,
            committer_name,
            committer_email,
            committer_date,
            summary,
            filename,
        });
    }

    entries
}

/// Check if a line looks like a blame SHA header.
///
/// A SHA header line starts with 40 hex characters followed by at least two
/// space-separated numbers (orig_line and final_line).
fn is_sha_header(line: &str) -> bool {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return false;
    }

    let sha_candidate = parts[0];
    if sha_candidate.len() != 40 {
        return false;
    }
    if !sha_candidate.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }

    // Check that the second and third parts are numbers
    parts[1].parse::<u32>().is_ok() && parts[2].parse::<u32>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_sha_header() {
        assert!(is_sha_header(
            "abcdef0123456789abcdef0123456789abcdef01 1 1 3"
        ));
        assert!(is_sha_header(
            "abcdef0123456789abcdef0123456789abcdef01 10 20 5"
        ));
        assert!(!is_sha_header("author John Doe"));
        assert!(!is_sha_header("summary Fix bug"));
        assert!(!is_sha_header("short 1 1 1")); // too short SHA
    }

    #[test]
    fn test_parse_blame_single_entry() {
        let raw = b"abcdef0123456789abcdef0123456789abcdef01 1 1 3\nauthor Alice\nauthor-mail <alice@example.com>\nauthor-time 1700000000\nauthor-tz +0000\ncommitter Bob\ncommitter-mail <bob@example.com>\ncommitter-time 1700000100\ncommitter-tz +0000\nsummary Initial commit\nfilename src/main.rs\n";
        let entries = parse_blame_output(raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].sha, "abcdef0123456789abcdef0123456789abcdef01");
        assert_eq!(entries[0].short_sha, "abcdef0");
        assert_eq!(entries[0].orig_line, 1);
        assert_eq!(entries[0].final_line, 1);
        assert_eq!(entries[0].num_lines, 3);
        assert_eq!(entries[0].author_name, "Alice");
        assert_eq!(entries[0].author_email, "alice@example.com");
        assert_eq!(entries[0].committer_name, "Bob");
        assert_eq!(entries[0].summary, "Initial commit");
        assert_eq!(entries[0].filename, "src/main.rs");
    }

    #[test]
    fn test_parse_blame_empty() {
        let entries = parse_blame_output(b"");
        assert!(entries.is_empty());
    }
}
