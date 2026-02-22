import * as path from 'path';
import { log, logError } from '../common/outputChannel';

let wasmModule: WasmExports | null = null;
let loadAttempted = false;

export interface WasmExports {
    compute_graph_layout(rawLog: Uint8Array): string;
    append_to_layout(handle: number, rawLog: Uint8Array): string;
    free_layout(handle: number): void;
    parse_blame(rawBlame: Uint8Array): string;
    filter_commits(handle: number, field: string, pattern: string): string;
    filter_by_date(handle: number, after: number, before: number): string;
}

export async function loadWasm(extensionPath: string): Promise<WasmExports | null> {
    if (loadAttempted) {
        return wasmModule;
    }
    loadAttempted = true;

    try {
        const wasmPkgPath = path.join(extensionPath, 'wasm-pkg', 'gitex_core.js');
        log(`Loading WASM from ${wasmPkgPath}`);

        // wasm-pack --target nodejs generates a CommonJS module
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const wasmPkg = require(wasmPkgPath);
        wasmModule = wasmPkg as WasmExports;
        log('WASM module loaded successfully');
        return wasmModule;
    } catch (error) {
        logError('Failed to load WASM module — falling back to pure TypeScript', error);
        return null;
    }
}

export function getWasm(): WasmExports | null {
    return wasmModule;
}

export function isWasmAvailable(): boolean {
    return wasmModule !== null;
}
