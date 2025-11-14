import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/mcp-agent';
import { ChatMessage } from '@/lib/mcp-agent';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, uploadedData } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    // Get the singleton agent instance
    const agent = getAgent();

    // If there's uploaded data, add context to the first user message
    let chatMessages: ChatMessage[] = messages;

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
      const hasDataContext = messages.some((m: ChatMessage) =>
        typeof m.content === 'string' && m.content.includes('uploaded a CSV file')
      );

      if (!hasDataContext && messages.length > 0) {
        chatMessages = [
          ...messages.slice(0, -1),
          {
            role: 'user',
            content: messages[messages.length - 1].content + '\n\n' + dataContext,
          }
        ];
      }
    }

    // Get response from agent
    const result = await agent.chat(chatMessages);

    return NextResponse.json({
      response: result.response,
      toolCalls: result.toolCalls,
    });

  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
