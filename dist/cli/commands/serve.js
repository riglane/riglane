import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRODUCT_DIR, CLI_NAME } from '../../config/product.js';
import { ensureLocalServer, refTraceServer, stopTraceServer } from '../../engine/trace-server.js';
import { getServeToken, withServeToken } from '../../engine/local-api.js';
export async function runServe(argv) {
    const positional = [];
    for (const a of argv) {
        if (a.startsWith('-')) {
            process.stderr.write(`[${CLI_NAME}] serve: unknown option '${a}'\n`);
            return 2;
        }
        positional.push(a);
    }
    if (positional.length > 1) {
        process.stderr.write(`[${CLI_NAME}] serve: expected at most one path argument\n`);
        return 2;
    }
    const target = resolve(positional[0] ?? '.');
    const agentDir = join(target, PRODUCT_DIR);
    let isDir = false;
    try {
        isDir = statSync(agentDir).isDirectory();
    }
    catch {
        isDir = false;
    }
    if (!isDir) {
        process.stderr.write(`[${CLI_NAME}] serve: ${target} has no ${PRODUCT_DIR}/ — not a Riglane project (run '${CLI_NAME} init' first)\n`);
        return 1;
    }
    const base = await ensureLocalServer(agentDir);
    if (!base) {
        process.stderr.write(`[${CLI_NAME}] serve: server could not start\n`);
        return 1;
    }
    refTraceServer();
    process.stdout.write(`${CLI_NAME} local server\n`);
    process.stdout.write(`  project: ${target}\n`);
    process.stdout.write(`  base:    ${base}\n`);
    process.stdout.write(`  token:   ${getServeToken()}  (X-Riglane-Token header or ?rl_token= query)\n`);
    process.stdout.write(`  studio:  ${withServeToken(`${base}/tools/workflow-studio.html`)}\n`);
    process.stdout.write(`Press Ctrl+C to stop.\n`);
    return await new Promise((resolveExit) => {
        const shutdown = () => {
            stopTraceServer();
            resolveExit(0);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        process.stdin.resume();
    });
}
