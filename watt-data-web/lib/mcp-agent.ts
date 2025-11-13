import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHTTP.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

export interface AgentResponse {
  response: string;
  toolCalls?: Array<{
    name: string;
    input: any;
    result: any;
  }>;
}

export class MCPAgent {
  private anthropic: Anthropic;
  private mcpClient: Client | null = null;
  private availableTools: MCPTool[] = [];
  private connected = false;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }

  async initialize() {
    if (this.connected) return;

    console.log('Initializing MCP client connection...');

    this.mcpClient = new Client({
      name: 'watt-data-web',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
      },
    });

    const serverUrl = process.env.MCP_SERVER_URL!;
    const apiKey = process.env.MCP_SERVER_API_KEY!;
    const authType = process.env.MCP_AUTH_TYPE || 'basic';

    const headers: Record<string, string> = {};

    if (authType === 'basic') {
      headers['Authorization'] = `Basic ${apiKey}`;
    } else if (authType === 'bearer') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (authType === 'custom') {
      headers['X-API-Key'] = apiKey;
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(serverUrl),
      {
        requestInit: {
          headers: headers
        }
      }
    );

    await this.mcpClient.connect(transport);
    console.log('MCP client connected successfully');

    const toolsList = await this.mcpClient.listTools();
    this.availableTools = toolsList.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    console.log(`Available tools: ${this.availableTools.length}`);
    this.connected = true;
  }

  private getMCPToolsForClaude() {
    return this.availableTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  private async executeToolCall(toolName: string, toolInput: any) {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    console.log(`Executing tool: ${toolName}`);
    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: toolInput,
    });

    return result;
  }

  async chat(messages: ChatMessage[]): Promise<AgentResponse> {
    if (!this.connected) {
      await this.initialize();
    }

    const tools = this.getMCPToolsForClaude();
    const toolCalls: Array<{ name: string; input: any; result: any }> = [];

    let response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 4096,
      tools: tools,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    console.log('Initial response received');

    // Agentic loop: handle tool calls
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find((block: any) => block.type === 'tool_use');

      if (!toolUseBlock) break;

      console.log(`Claude wants to use tool: ${toolUseBlock.name}`);

      // Execute the tool via MCP
      const toolResult = await this.executeToolCall(toolUseBlock.name, toolUseBlock.input);

      // Track tool calls for response
      toolCalls.push({
        name: toolUseBlock.name,
        input: toolUseBlock.input,
        result: toolResult,
      });

      // Add assistant response and tool result to messages
      messages.push({
        role: 'assistant',
        content: response.content,
      });

      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(toolResult.content),
          },
        ],
      });

      // Get next response from Claude
      response = await this.anthropic.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
        max_tokens: 4096,
        tools: tools,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      });
    }

    // Extract final text response
    const finalResponse = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return {
      response: finalResponse,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async cleanup() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      console.log('MCP client connection closed');
      this.connected = false;
    }
  }

  getAvailableTools(): MCPTool[] {
    return this.availableTools;
  }
}

// Singleton instance for server-side use
let agentInstance: MCPAgent | null = null;

export function getAgent(): MCPAgent {
  if (!agentInstance) {
    agentInstance = new MCPAgent();
  }
  return agentInstance;
}
