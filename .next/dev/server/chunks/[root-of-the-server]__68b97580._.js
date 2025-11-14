module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/lib/mcp-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MCPAgent",
    ()=>MCPAgent,
    "getAgent",
    ()=>getAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__Anthropic__as__default$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/client.mjs [app-route] (ecmascript) <export Anthropic as default>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$modelcontextprotocol$2f$sdk$2f$dist$2f$esm$2f$client$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$modelcontextprotocol$2f$sdk$2f$dist$2f$esm$2f$client$2f$streamableHttp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js [app-route] (ecmascript)");
;
;
;
class MCPAgent {
    anthropic;
    mcpClient = null;
    availableTools = [];
    connected = false;
    constructor(){
        this.anthropic = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__Anthropic__as__default$3e$__["default"]({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
    }
    async initialize() {
        if (this.connected) return;
        console.log('Initializing MCP client connection...');
        this.mcpClient = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$modelcontextprotocol$2f$sdk$2f$dist$2f$esm$2f$client$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Client"]({
            name: 'watt-data-web',
            version: '1.0.0'
        }, {
            capabilities: {
                tools: {}
            }
        });
        const serverUrl = process.env.MCP_SERVER_URL;
        const apiKey = process.env.MCP_SERVER_API_KEY;
        const authType = process.env.MCP_AUTH_TYPE || 'basic';
        const headers = {};
        if (authType === 'basic') {
            headers['Authorization'] = `Basic ${apiKey}`;
        } else if (authType === 'bearer') {
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (authType === 'custom') {
            headers['X-API-Key'] = apiKey;
        }
        const transport = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$modelcontextprotocol$2f$sdk$2f$dist$2f$esm$2f$client$2f$streamableHttp$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StreamableHTTPClientTransport"](new URL(serverUrl), {
            requestInit: {
                headers: headers
            }
        });
        await this.mcpClient.connect(transport);
        console.log('MCP client connected successfully');
        const toolsList = await this.mcpClient.listTools();
        this.availableTools = toolsList.tools.map((tool)=>({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }));
        console.log(`Available tools: ${this.availableTools.length}`);
        this.connected = true;
    }
    getMCPToolsForClaude() {
        return this.availableTools.map((tool)=>({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema
            }));
    }
    async executeToolCall(toolName, toolInput) {
        if (!this.mcpClient) {
            throw new Error('MCP client not initialized');
        }
        console.log(`Executing tool: ${toolName}`);
        const result = await this.mcpClient.callTool({
            name: toolName,
            arguments: toolInput
        });
        return result;
    }
    async chat(messages) {
        if (!this.connected) {
            await this.initialize();
        }
        const tools = this.getMCPToolsForClaude();
        const toolCalls = [];
        let response = await this.anthropic.messages.create({
            model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
            max_tokens: 4096,
            tools: tools,
            messages: messages.map((msg)=>({
                    role: msg.role,
                    content: msg.content
                }))
        });
        console.log('Initial response received');
        // Agentic loop: handle tool calls
        while(response.stop_reason === 'tool_use'){
            const toolUseBlock = response.content.find((block)=>block.type === 'tool_use');
            if (!toolUseBlock) break;
            console.log(`Claude wants to use tool: ${toolUseBlock.name}`);
            // Execute the tool via MCP
            const toolResult = await this.executeToolCall(toolUseBlock.name, toolUseBlock.input);
            // Track tool calls for response
            toolCalls.push({
                name: toolUseBlock.name,
                input: toolUseBlock.input,
                result: toolResult
            });
            // Add assistant response and tool result to messages
            messages.push({
                role: 'assistant',
                content: response.content
            });
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUseBlock.id,
                        content: JSON.stringify(toolResult.content)
                    }
                ]
            });
            // Get next response from Claude
            response = await this.anthropic.messages.create({
                model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
                max_tokens: 4096,
                tools: tools,
                messages: messages
            });
        }
        // Extract final text response
        const finalResponse = response.content.filter((block)=>block.type === 'text').map((block)=>block.text).join('\n');
        return {
            response: finalResponse,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }
    async cleanup() {
        if (this.mcpClient) {
            await this.mcpClient.close();
            console.log('MCP client connection closed');
            this.connected = false;
        }
    }
    getAvailableTools() {
        return this.availableTools;
    }
}
// Singleton instance for server-side use
let agentInstance = null;
function getAgent() {
    if (!agentInstance) {
        agentInstance = new MCPAgent();
    }
    return agentInstance;
}
}),
"[project]/app/api/chat/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$mcp$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/mcp-agent.ts [app-route] (ecmascript)");
;
;
async function POST(request) {
    try {
        const body = await request.json();
        const { messages, uploadedData } = body;
        if (!messages || !Array.isArray(messages)) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'Messages array is required'
            }, {
                status: 400
            });
        }
        // Get the singleton agent instance
        const agent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$mcp$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getAgent"])();
        // If there's uploaded data, add context to the first user message
        let chatMessages = messages;
        if (uploadedData && uploadedData.rows && uploadedData.rows.length > 0) {
            // Add context about uploaded data
            const dataContext = `
I have uploaded a CSV file with the following information:
- Total rows: ${uploadedData.rows.length}
- Detected fields: ${JSON.stringify(uploadedData.detectedFields)}
- Column headers: ${uploadedData.headers.join(', ')}
- First 3 rows (sample):
${JSON.stringify(uploadedData.rows.slice(0, 3), null, 2)}

IMPORTANT: When using resolve_identities tool, you MUST use this exact format:
{
  "id_type": "email",
  "id_hash": "plaintext",
  "identifiers": ["email1@example.com", "email2@example.com"]
}

For phone numbers:
{
  "id_type": "phone",
  "id_hash": "plaintext",
  "identifiers": ["+15551234567"]
}

For addresses:
{
  "id_type": "address",
  "id_hash": "plaintext",
  "identifiers": ["123 Main St, City, State ZIP"]
}

Please help me enrich this data using the Watt Data tools.
`;
            // Only add context if this is the first message about the uploaded data
            const hasDataContext = messages.some((m)=>typeof m.content === 'string' && m.content.includes('uploaded a CSV file'));
            if (!hasDataContext && messages.length > 0) {
                chatMessages = [
                    ...messages.slice(0, -1),
                    {
                        role: 'user',
                        content: messages[messages.length - 1].content + '\n\n' + dataContext
                    }
                ];
            }
        }
        // Get response from agent
        const result = await agent.chat(chatMessages);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            response: result.response,
            toolCalls: result.toolCalls
        });
    } catch (error) {
        console.error('Error in chat API:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__68b97580._.js.map