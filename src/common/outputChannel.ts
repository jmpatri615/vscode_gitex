import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('GitEx');
    }
    return channel;
}

export function log(message: string): void {
    const timestamp = new Date().toISOString();
    getOutputChannel().appendLine(`[${timestamp}] ${message}`);
}

export function logCommand(command: string, args: string[]): void {
    log(`> ${command} ${args.join(' ')}`);
}

export function logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const ch = getOutputChannel();
    ch.appendLine(`[${timestamp}] ERROR: ${message}`);
    if (error instanceof Error) {
        ch.appendLine(`  ${error.message}`);
        if (error.stack) {
            ch.appendLine(`  ${error.stack}`);
        }
    } else if (error !== undefined) {
        ch.appendLine(`  ${String(error)}`);
    }
}

export function logTiming(label: string, startMs: number): void {
    const elapsed = Date.now() - startMs;
    log(`${label} completed in ${elapsed}ms`);
}

export function showOutputChannel(): void {
    getOutputChannel().show(true);
}

export function disposeOutputChannel(): void {
    if (channel) {
        channel.dispose();
        channel = undefined;
    }
}
