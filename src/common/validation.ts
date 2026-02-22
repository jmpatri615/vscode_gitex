/**
 * Validators for git inputs to prevent command injection and invalid arguments.
 */

/** Validate a git SHA (hex-only, 7-40 chars). */
export function isValidSha(sha: string): boolean {
    return /^[0-9a-f]{7,40}$/i.test(sha);
}

/** Validate a git ref name — rejects shell metacharacters and invalid git ref patterns. */
export function isValidRefName(ref: string): boolean {
    if (!ref || ref.length === 0) { return false; }
    // Reject shell metacharacters and control characters
    // eslint-disable-next-line no-control-regex, no-useless-escape
    if (/[`$|;&<>(){}\[\]!\\~^?*\x00-\x1f\x7f]/.test(ref)) { return false; }
    // Reject '..' (traversal), trailing dot or slash, leading '-', '@{', spaces, '~', ':'
    if (ref.includes('..')) { return false; }
    if (ref.endsWith('.') || ref.endsWith('/')) { return false; }
    if (ref.startsWith('-')) { return false; }
    if (ref.includes('@{')) { return false; }
    if (/\s/.test(ref)) { return false; }
    if (ref.includes(':')) { return false; }
    return true;
}

/** Escape regex metacharacters for safe use in git --grep/--author/--committer patterns. */
export function sanitizeGitPattern(pattern: string): string {
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
