/**
 * mcp.js — Read-only Model Context Protocol server for the kit inventory.
 *
 * Exposes the inventory to MCP-capable agents (Claude Desktop, Claude Code,
 * custom agents) over a single Streamable HTTP endpoint at POST /mcp.
 *
 * Deliberately dependency-free: MCP is JSON-RPC 2.0, and for a stateless
 * read-only server that's a small amount of hand-rolled code — no SDK, no
 * build step, consistent with the rest of this project.
 *
 * Stateless: no sessions, no server-initiated SSE. Each POST is answered with
 * a single application/json JSON-RPC response. GET returns 405 (no SSE stream).
 *
 * Tools:
 *   search_inventory(query?, grade?, status?) — filter/find kits
 *   get_kit(id)                               — full record for one kit
 *   get_stock_summary()                       — totals by grade and status
 */

const SERVER_INFO = { name: 'kitkeeper-inventory', version: '1.0.0' };

// Versions we can speak. We echo the client's if we support it, else our latest.
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_VERSION = '2025-06-18';

const GRADES = ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'];
const STATUSES = ['backlog', 'in-progress', 'complete'];

// ── Tool definitions (advertised via tools/list) ──

const TOOLS = [
  {
    name: 'search_inventory',
    description: 'Search the kit inventory. Optionally match a free-text query against kit name, series, or model number, and/or filter by grade and build status. Returns a summary list of matching kits.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text match against name, series, or model number (case-insensitive)' },
        grade: { type: 'string', enum: GRADES, description: 'Filter by grade' },
        status: { type: 'string', enum: STATUSES, description: 'Filter by build status' }
      }
    }
  },
  {
    name: 'get_kit',
    description: 'Get the full record for a single kit by its id (e.g. "mg-001").',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The kit id' } },
      required: ['id']
    }
  },
  {
    name: 'get_stock_summary',
    description: 'Get inventory totals: overall kit count plus breakdowns by grade and by build status.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// ── Tool implementations ──

function summarize(k) {
  return {
    id: k.id,
    name: k.name,
    grade: k.grade,
    series: k.series,
    modelNumber: k.modelNumber || null,
    status: k.status,
    addedAt: k.addedAt || null
  };
}

const TOOL_HANDLERS = {
  search_inventory({ query, grade, status }, readInventory) {
    let items = readInventory();
    if (grade) items = items.filter(k => k.grade === grade);
    if (status) items = items.filter(k => k.status === status);
    if (query) {
      const q = String(query).toLowerCase();
      items = items.filter(k =>
        (k.name && k.name.toLowerCase().includes(q)) ||
        (k.series && k.series.toLowerCase().includes(q)) ||
        (k.modelNumber && String(k.modelNumber).toLowerCase().includes(q))
      );
    }
    return { count: items.length, results: items.map(summarize) };
  },

  get_kit({ id }, readInventory) {
    if (!id) throw new Error('id is required');
    const kit = readInventory().find(k => k.id === id);
    return kit ? { found: true, kit } : { found: false, id };
  },

  get_stock_summary(_args, readInventory) {
    const items = readInventory();
    const byGrade = {};
    const byStatus = {};
    for (const k of items) {
      byGrade[k.grade] = (byGrade[k.grade] || 0) + 1;
      byStatus[k.status] = (byStatus[k.status] || 0) + 1;
    }
    return { total: items.length, byGrade, byStatus };
  }
};

// ── JSON-RPC / MCP plumbing ──

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function callTool(params, readInventory) {
  const name = params && params.name;
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const data = handler((params && params.arguments) || {}, readInventory);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
}

// Returns a JSON-RPC response object, or null for notifications (no reply).
function handleMessage(msg, readInventory) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  // Notifications require no response.
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;

  try {
    let result;
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        result = {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        };
        break;
      }
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        result = callTool(params, readInventory);
        break;
      default:
        if (isNotification) return null;
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    if (isNotification) return null;
    return rpcError(id, -32603, err.message);
  }
}

// ── Express wiring ──

function registerMcp(app, readInventory) {
  // Permissive CORS so browser-based agents can reach it too.
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.post('/mcp', (req, res) => {
    const body = req.body;

    // JSON-RPC batch (arrays): answer each, drop notification nulls.
    if (Array.isArray(body)) {
      const responses = body.map(m => handleMessage(m, readInventory)).filter(Boolean);
      return responses.length ? res.json(responses) : res.status(202).end();
    }

    const response = handleMessage(body, readInventory);
    if (!response) return res.status(202).end(); // notification
    res.json(response);
  });

  // No server-initiated SSE stream on this endpoint.
  app.get('/mcp', (_req, res) => {
    res.status(405).json(rpcError(null, -32000, 'Method Not Allowed: use POST'));
  });
}

module.exports = { registerMcp, handleMessage, TOOLS };
