import * as vscode from 'vscode';
import { GitCommands } from '../git/gitCommands';
import { parseBlame } from '../wasm/wasmBridge';
import { BlameEntry } from '../common/types';
import { configuration } from '../common/configuration';
import { log, logTiming, logError } from '../common/outputChannel';

interface CacheEntry {
    entries: BlameEntry[];
    headSha: string;
    accessTime: number;
}

export class BlameService implements vscode.Disposable {
    private cache = new Map<string, CacheEntry>();
    private currentHead: string = '';

    constructor(private gitCommands: GitCommands) {}

    async getBlame(filePath: string): Promise<BlameEntry[]> {
        const headSha = await this.getCurrentHead();
        const cacheKey = filePath;

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.headSha === headSha) {
            cached.accessTime = Date.now();
            return cached.entries;
        }

        // Fetch blame
        const startMs = Date.now();
        try {
            const rawBlame = await this.gitCommands.getBlameRaw(filePath);
            const entries = parseBlame(rawBlame);
            logTiming(`Blame for ${filePath}`, startMs);

            // Cache
            this.addToCache(cacheKey, entries, headSha);
            return entries;
        } catch (error) {
            logError(`Failed to get blame for ${filePath}`, error);
            return [];
        }
    }

    async getBlameForLine(filePath: string, line: number): Promise<BlameEntry | null> {
        const entries = await this.getBlame(filePath);
        for (const entry of entries) {
            if (line >= entry.finalLine && line < entry.finalLine + entry.numLines) {
                return entry;
            }
        }
        return null;
    }

    streamBlame(
        filePath: string,
        onEntry: (entries: BlameEntry[]) => void,
        onComplete: () => void,
    ): void {
        const chunks: Buffer[] = [];
        this.gitCommands.streamBlame(
            filePath,
            (data: Buffer) => {
                chunks.push(data);
                // Try to parse what we have so far for progressive updates
                const current = Buffer.concat(chunks);
                try {
                    const entries = parseBlame(current);
                    if (entries.length > 0) {
                        onEntry(entries);
                    }
                } catch {
                    // Partial data, wait for more
                }
            },
            (code: number) => {
                if (code === 0) {
                    const final = Buffer.concat(chunks);
                    const entries = parseBlame(final);
                    const headSha = this.currentHead;
                    this.addToCache(filePath, entries, headSha);
                    onEntry(entries);
                }
                onComplete();
            },
        );
    }

    invalidateCache(filePath?: string): void {
        if (filePath) {
            this.cache.delete(filePath);
        } else {
            this.cache.clear();
        }
    }

    private async getCurrentHead(): Promise<string> {
        const sha = await this.gitCommands.revParse('HEAD');
        this.currentHead = sha || '';
        return this.currentHead;
    }

    private addToCache(key: string, entries: BlameEntry[], headSha: string): void {
        // Evict if at capacity
        const maxSize = configuration.blameCacheSize;
        if (this.cache.size >= maxSize) {
            let oldestKey = '';
            let oldestTime = Infinity;
            for (const [k, v] of this.cache) {
                if (v.accessTime < oldestTime) {
                    oldestTime = v.accessTime;
                    oldestKey = k;
                }
            }
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            entries,
            headSha,
            accessTime: Date.now(),
        });
    }

    dispose(): void {
        this.cache.clear();
    }
}
