import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, Content, Tool, SchemaType } from '@google/generative-ai';
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
  private provider: 'claude' | 'gemini';
  private anthropic: Anthropic | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;
  private geminiModelName: string = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  private mcpClient: Client | null = null;
  private availableTools: MCPTool[] = [];
  private connected = false;
  private lastApiCallTime = 0;
  private minDelayBetweenCalls = 2000; // 2 seconds between API calls to avoid rate limits

  // System prompt that defines Claude's role and behavior
  private readonly systemPrompt = `You are an AI assistant specialized in data enrichment using the Watt Data API. Your role is to help users enrich their CSV data with demographic, contact, employment, interest, and lifestyle information.

Your capabilities:
- Analyze uploaded CSV files to identify email, phone, address, or person_id columns
- Use the resolve_identities tool to convert identifiers (emails, phones, addresses) into person_ids
- Use the get_person tool to retrieve comprehensive person data from Watt Data
- Merge enriched data back into the original CSV structure
- Provide insights and analysis on the enriched data

Key guidelines:
1. Always be clear and precise when explaining what you're doing
2. When enriching data, follow the two-step process: resolve_identities first, then get_person
3. Use the EXACT person_ids returned from resolve_identities - never make up or modify IDs
4. Always format person_ids as strings in arrays, not numbers
5. Be helpful in suggesting additional enrichment domains (household, financial, etc.)
6. Provide clear summaries of enrichment results

Your responses should be professional, concise, and focused on helping users get the most value from their data enrichment.`;

  constructor() {
    const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase();
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required when AI_PROVIDER is set to "gemini"');
      }
      this.provider = 'gemini';
      this.geminiClient = new GoogleGenerativeAI(apiKey);
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER is set to "claude" (default)');
      }
      this.provider = 'claude';
      this.anthropic = new Anthropic({
        apiKey,
      });
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async scheduleApiCall() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.minDelayBetweenCalls) {
      const waitTime = this.minDelayBetweenCalls - timeSinceLastCall;
      console.log(`Rate limiting: waiting ${Math.ceil(waitTime / 1000)}s before next API call...`);
      await this.sleep(waitTime);
    }
    this.lastApiCallTime = Date.now();
  }

  private async callClaudeWithRetry(
    params: any,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (!this.anthropic) {
          throw new Error('Anthropic client not initialized');
        }

        await this.scheduleApiCall();
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
      description: tool.description || '',
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

  async callToolDirect(toolName: string, toolInput: any) {
    if (!this.connected) {
      await this.initialize();
    }

    return this.executeToolCall(toolName, toolInput);
  }

  private formatToolResultForConversation(toolResult: any): string {
    const rawContent = toolResult && toolResult.content !== undefined
      ? toolResult.content
      : toolResult;
    let contentString = typeof rawContent === 'string'
      ? rawContent
      : JSON.stringify(rawContent);
    if (!contentString) {
      contentString = '';
    }
    if (contentString.length > 2000) {
      return contentString.substring(0, 2000) + '... [truncated]';
    }
    return contentString;
  }

  private convertMessagesToGeminiContents(messages: ChatMessage[]): Content[] {
    return messages.map(message => {
      const textContent = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content ?? '') || '';

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{
          text: textContent,
        }],
      };
    });
  }

  private getGeminiTools(): Tool[] {
    if (this.availableTools.length === 0) {
      return [];
    }

    return [{
      functionDeclarations: this.availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: this.buildGeminiFunctionParameters(tool.inputSchema),
      })),
    }];
  }

  private buildGeminiFunctionParameters(schema: any) {
    const converted = this.convertSchemaForGemini(schema);
    if (converted.type === SchemaType.OBJECT) {
      return converted;
    }

    return {
      type: SchemaType.OBJECT,
      properties: {
        value: converted,
      },
      required: ['value'],
    };
  }

  private convertSchemaForGemini(schema: any, depth: number = 0): any {
    if (!schema || typeof schema !== 'object') {
      return {
        type: SchemaType.OBJECT,
        properties: {},
      };
    }

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
      return this.convertSchemaForGemini(schema.anyOf[0], depth + 1);
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
      return this.convertSchemaForGemini(schema.oneOf[0], depth + 1);
    }
    if (schema.items && Array.isArray(schema.items)) {
      // If items is an array, just take the first definition
      return this.convertSchemaForGemini({
        ...schema,
        items: schema.items[0],
      }, depth + 1);
    }

    const type = schema.type || 'object';

    if (type === 'object') {
      const objectSchema: any = {
        type: SchemaType.OBJECT,
        description: schema.description,
        properties: {},
      };

      if (schema.properties && typeof schema.properties === 'object') {
        for (const [key, value] of Object.entries(schema.properties)) {
          objectSchema.properties[key] = this.convertSchemaForGemini(value, depth + 1);
        }
      }

      if (Array.isArray(schema.required) && schema.required.length > 0) {
        objectSchema.required = schema.required;
      }

      if (Object.keys(objectSchema.properties).length === 0) {
        return {
          type: SchemaType.STRING,
          description: schema.description,
        };
      }

      return objectSchema;
    }

    if (type === 'array') {
      const arraySchema: any = {
        type: SchemaType.ARRAY,
        description: schema.description,
        items: this.convertSchemaForGemini(schema.items || { type: 'string' }, depth + 1),
      };

      if (typeof schema.minItems === 'number') {
        arraySchema.minItems = schema.minItems;
      }
      if (typeof schema.maxItems === 'number') {
        arraySchema.maxItems = schema.maxItems;
      }

      return arraySchema;
    }

    if (type === 'string') {
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return {
          type: SchemaType.STRING,
          description: schema.description,
          format: 'enum',
          enum: schema.enum.map((value: any) => String(value)),
        };
      }

      const stringSchema: any = {
        type: SchemaType.STRING,
        description: schema.description,
      };

      if (schema.format && typeof schema.format === 'string') {
        stringSchema.format = schema.format;
      }

      return stringSchema;
    }

    if (type === 'boolean') {
      return {
        type: SchemaType.BOOLEAN,
        description: schema.description,
      };
    }

    if (type === 'number' || type === 'integer') {
      const numberSchema: any = {
        type: type === 'integer' ? SchemaType.INTEGER : SchemaType.NUMBER,
        description: schema.description,
      };

      if (typeof schema.minimum === 'number') {
        numberSchema.minimum = schema.minimum;
      }
      if (typeof schema.maximum === 'number') {
        numberSchema.maximum = schema.maximum;
      }

      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        numberSchema.enum = schema.enum;
      }

      return numberSchema;
    }

    // Fallback to string schema for unsupported types
    return {
      type: SchemaType.STRING,
      description: schema.description,
    };
  }

  private extractTextFromGeminiParts(parts: any[]): string {
    if (!Array.isArray(parts)) {
      return '';
    }

    return parts
      .filter(part => typeof part.text === 'string')
      .map(part => part.text)
      .join('\n')
      .trim();
  }

  private async chatWithClaude(messages: ChatMessage[]): Promise<AgentResponse> {
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
      system: this.systemPrompt,
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
        const truncatedContent = this.formatToolResultForConversation(toolResult);

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
        system: this.systemPrompt,
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
        system: this.systemPrompt,
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

  private async chatWithGemini(messages: ChatMessage[]): Promise<AgentResponse> {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }

    const toolCalls: Array<{ name: string; input: any; result: any }> = [];
    const geminiTools = this.getGeminiTools();
    const model = this.geminiClient.getGenerativeModel({
      model: this.geminiModelName,
      tools: geminiTools.length > 0 ? geminiTools : undefined,
    });

    const conversationContents: Content[] = this.convertMessagesToGeminiContents(messages);
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      await this.scheduleApiCall();

      const result = await model.generateContent({
        contents: conversationContents,
      });

      const candidate = result.response.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error('Gemini did not return a candidate response');
      }

      const parts = candidate.content.parts || [];
      const functionCallParts = parts.filter((part: any) => part.functionCall);

      conversationContents.push({
        role: 'model',
        parts,
      });

      if (functionCallParts.length === 0) {
        const finalText = this.extractTextFromGeminiParts(parts);
        return {
          response: finalText || 'Gemini response was empty',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      }

      const functionResponseParts: Content['parts'] = [];

      for (let i = 0; i < functionCallParts.length; i++) {
        const callPart = functionCallParts[i];
        const call = callPart.functionCall;
        console.log(`Gemini wants to use tool: ${call?.name}`);

        if (!call?.name) {
          continue;
        }

        if (i > 0) {
          await this.sleep(500);
        }

        const args = call.args || {};
        const toolResult = await this.executeToolCall(call.name, args);
        toolCalls.push({
          name: call.name,
          input: args,
          result: toolResult,
        });

        const truncatedContent = this.formatToolResultForConversation(toolResult);
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              content: truncatedContent,
            },
          },
        });
      }

      if (functionResponseParts.length > 0) {
        conversationContents.push({
          role: 'function',
          parts: functionResponseParts,
        });
      }
    }

    console.warn('Max Gemini tool use iterations reached');
    return {
      response: 'Gemini could not complete the request before reaching the iteration limit.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async chat(messages: ChatMessage[]): Promise<AgentResponse> {
    if (!this.connected) {
      await this.initialize();
    }

    if (this.provider === 'gemini') {
      return this.chatWithGemini(messages);
    }

    return this.chatWithClaude(messages);
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
