import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
  private lastApiCallTime = 0;
  private minDelayBetweenCalls = 2000; // 2 seconds between API calls to avoid rate limits

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async callClaudeWithRetry(
    params: any,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Implement client-side rate limiting
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCallTime;
        if (timeSinceLastCall < this.minDelayBetweenCalls) {
          const waitTime = this.minDelayBetweenCalls - timeSinceLastCall;
          console.log(`Rate limiting: waiting ${Math.ceil(waitTime / 1000)}s before next API call...`);
          await this.sleep(waitTime);
        }

        this.lastApiCallTime = Date.now();
        return await this.anthropic.messages.create(params);
      } catch (error: any) {
        lastError = error;

        // Check if it's a rate limit error
        if (error.status === 429) {
          // Get retry-after from headers (could be in different formats)
          let retryAfterSeconds = 0;

          if (error.headers) {
            // Headers might be a Headers object or plain object
            const getHeader = (key: string) => {
              if (typeof error.headers.get === 'function') {
                return error.headers.get(key);
              }
              return error.headers[key];
            };

            const retryAfterHeader = getHeader('retry-after');
            if (retryAfterHeader) {
              retryAfterSeconds = parseInt(retryAfterHeader);
            }

            // Also check the reset time
            if (!retryAfterSeconds) {
              const resetTime = getHeader('anthropic-ratelimit-input-tokens-reset');
              if (resetTime) {
                const resetDate = new Date(resetTime);
                const now = new Date();
                retryAfterSeconds = Math.ceil((resetDate.getTime() - now.getTime()) / 1000);
              }
            }
          }

          // Use retry-after if available, otherwise exponential backoff
          const waitTime = retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : Math.min(1000 * Math.pow(2, attempt), 30000);

          console.log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s before retry ${attempt + 1}/${maxRetries}...`);
          await this.sleep(waitTime);
          continue;
        }

        // If it's not a rate limit error, throw immediately
        throw error;
      }
    }

    // All retries exhausted
    throw lastError;
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

    // Create a working copy of messages for the agentic loop
    const conversationMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // Use Sonnet by default for better tool use accuracy
    // Can switch to Haiku via CLAUDE_TOOL_MODEL env var to save tokens (less accurate)
    const toolUseModel = process.env.CLAUDE_TOOL_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
    const finalModel = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';

    let response = await this.callClaudeWithRetry({
      model: toolUseModel,
      max_tokens: 4096,
      tools: tools,
      messages: conversationMessages,
    });

    console.log('Initial response received');

    // Agentic loop: handle tool calls
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;

      // Collect ALL tool_use blocks in this response
      const toolUseBlocks = response.content.filter((block: any) => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) break;

      // Add assistant response to messages
      conversationMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Execute all tools and collect results
      const toolResults = [];
      for (let i = 0; i < toolUseBlocks.length; i++) {
        const toolUseBlock = toolUseBlocks[i];
        console.log(`Claude wants to use tool: ${toolUseBlock.name}`);

        // Add a small delay between tool executions to avoid rate limiting
        if (i > 0) {
          await this.sleep(500); // 500ms delay between tools
        }

        // Execute the tool via MCP
        const toolResult = await this.executeToolCall(toolUseBlock.name, toolUseBlock.input);

        // Track tool calls for response
        toolCalls.push({
          name: toolUseBlock.name,
          input: toolUseBlock.input,
          result: toolResult,
        });

        // Truncate large tool results to reduce token usage
        const resultContent = JSON.stringify(toolResult.content);
        const truncatedContent = resultContent.length > 2000
          ? resultContent.substring(0, 2000) + '... [truncated]'
          : resultContent;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: truncatedContent,
        });
      }

      // Add all tool results in a single user message
      conversationMessages.push({
        role: 'user',
        content: toolResults,
      });

      // Keep only recent messages to reduce token usage
      // Keep first user message + last 4 messages (2 exchanges)
      if (conversationMessages.length > 6) {
        const firstMessage = conversationMessages[0];
        const recentMessages = conversationMessages.slice(-4);
        conversationMessages.length = 0;
        conversationMessages.push(firstMessage, ...recentMessages);
      }

      // Get next response from Claude with retry logic
      response = await this.callClaudeWithRetry({
        model: toolUseModel,
        max_tokens: 4096,
        tools: tools,
        messages: conversationMessages as any,
      });
    }

    if (iterations >= maxIterations) {
      console.warn('Max tool use iterations reached');
    }

    // If we ended in tool use mode, get a final text response
    let finalTextResponse = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    // If the final response is empty or very short, get a better response with the final model
    if (!finalTextResponse || finalTextResponse.length < 50) {
      console.log('Getting final response with better model...');

      conversationMessages.push({
        role: 'assistant',
        content: response.content,
      });

      const finalResponse = await this.callClaudeWithRetry({
        model: finalModel,
        max_tokens: 4096,
        messages: conversationMessages as any,
      });

      finalTextResponse = finalResponse.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }

    return {
      response: finalTextResponse,
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
