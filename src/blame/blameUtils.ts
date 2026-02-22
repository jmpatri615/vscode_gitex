/**
 * Format an epoch timestamp into a human-readable date string.
 */
export function formatDate(epoch: number, format: 'relative' | 'iso' | 'locale'): string {
    if (!epoch) { return ''; }
    const date = new Date(epoch * 1000);

    switch (format) {
        case 'relative':
            return formatRelativeDate(date);
        case 'iso':
            return date.toISOString().replace('T', ' ').substring(0, 19);
        case 'locale':
            return date.toLocaleDateString();
        default:
            return formatRelativeDate(date);
    }
}

function formatRelativeDate(date: Date): string {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    if (diffSec < 60) { return 'just now'; }
    if (diffMin < 60) { return `${diffMin} min ago`; }
    if (diffHour < 24) { return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`; }
    if (diffDay < 7) { return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`; }
    if (diffWeek < 5) { return `${diffWeek} week${diffWeek > 1 ? 's' : ''} ago`; }
    if (diffMonth < 12) { return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`; }
    return `${diffYear} year${diffYear > 1 ? 's' : ''} ago`;
}
