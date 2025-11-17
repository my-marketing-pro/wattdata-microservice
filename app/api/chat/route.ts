import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/mcp-agent';
import { ChatMessage } from '@/lib/mcp-agent';
import { EnrichedRow, flattenProfileData } from '@/lib/csv-processor';

/**
 * Process tool call results to extract enriched person data
 */
function processEnrichedData(toolCalls: any[], uploadedData: any): EnrichedRow[] {
  const enrichedRows: EnrichedRow[] = [];

  // Find all get_person tool calls with results
  const personDataCalls = toolCalls.filter(tc => tc.name === 'get_person' && tc.result);

  if (personDataCalls.length === 0) {
    return enrichedRows;
  }

  // Map person_ids to their enriched data
  const personDataMap = new Map<string, any>();

  for (const call of personDataCalls) {
    try {
      // Parse the result content
      const resultContent = typeof call.result.content === 'string'
        ? JSON.parse(call.result.content)
        : call.result.content;

      // Extract person data from the result
      let personData = null;
      if (Array.isArray(resultContent)) {
        personData = resultContent[0]?.content?.data;
      } else if (resultContent.content?.data) {
        personData = resultContent.content.data;
      } else if (resultContent.data) {
        personData = resultContent.data;
      }

      if (personData && personData.person_id) {
        personDataMap.set(personData.person_id, personData);
      }
    } catch (error) {
      console.error('Error parsing person data:', error);
    }
  }

  // Merge enriched data with original rows
  for (const row of uploadedData.rows) {
    const enrichedRow: EnrichedRow = { ...row };

    // Try to find matching person data by person_id
    const personIdField = uploadedData.detectedFields?.personIds;
    const personId = personIdField ? row[personIdField] : null;

    if (personId && personDataMap.has(personId)) {
      const personData = personDataMap.get(personId);

      // Flatten and add all person data fields
      const flattenedData = flattenProfileData(personData);
      Object.assign(enrichedRow, flattenedData);
    }

    enrichedRows.push(enrichedRow);
  }

  return enrichedRows;
}

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

    // Process tool calls to extract enriched data
    let enrichedData = null;
    if (result.toolCalls && result.toolCalls.length > 0 && uploadedData) {
      enrichedData = processEnrichedData(result.toolCalls, uploadedData);
    }

    return NextResponse.json({
      response: result.response,
      toolCalls: result.toolCalls,
      enrichedData: enrichedData,
    });

  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
