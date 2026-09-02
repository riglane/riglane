#!/usr/bin/env node
/**
 * demo-db-server — a REAL, minimal MCP server for the tools-demo example.
 *
 * Zero dependencies: a plain stdio
 * JSON-RPC 2.0 loop implementing initialize / tools/list / tools/call.
 *
 * Exposes ONE tool:
 *   query_table({ table }) → rows from the tiny in-memory "database" below.
 *
 * This is deliberately the smallest possible working MCP server — read it
 * top-to-bottom to see everything an external `type: mcp` tool dependency
 * needs: a server command in workflow.yaml (server_config), a tool name that
 * `expected_tools` can whitelist, and a JSON result on stdout.
 */

const DB = {
  projects: [
    { id: 1, name: 'render-engine', status: 'active' },
    { id: 2, name: 'billing-service', status: 'active' },
    { id: 3, name: 'legacy-importer', status: 'archived' },
  ],
};

const TOOLS = [
  {
    name: 'query_table',
    description: 'Return all rows of a demo database table (tables: projects).',
    inputSchema: {
      type: 'object',
      required: ['table'],
      properties: { table: { type: 'string', description: 'Table name, e.g. "projects"' } },
    },
  },
];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === '') continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not JSON — ignore (robust stdio loop)
    }
    if (msg.method === 'initialize') {
      reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo_db', version: '1.0.0' },
      });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const table = msg.params?.arguments?.table;
      const rows = DB[table];
      if (rows === undefined) {
        reply(msg.id, {
          content: [{ type: 'text', text: `Unknown table '${table}'. Tables: ${Object.keys(DB).join(', ')}` }],
          isError: true,
        });
      } else {
        reply(msg.id, {
          content: [{ type: 'text', text: JSON.stringify({ table, count: rows.length, rows }) }],
        });
      }
    } else if (msg.id !== undefined) {
      // Unknown request — empty result keeps strict clients happy.
      reply(msg.id, {});
    }
    // Notifications (no id) are ignored.
  }
});
