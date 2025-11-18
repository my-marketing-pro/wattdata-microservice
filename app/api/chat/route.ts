import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/mcp-agent';
import { ChatMessage } from '@/lib/mcp-agent';
import { EnrichedRow, flattenProfileData } from '@/lib/csv-processor';

/**
 * Process tool call results to extract enriched person data
 */
function processEnrichedData(toolCalls: any[], uploadedData: any): EnrichedRow[] {
  const enrichedRows: EnrichedRow[] = [];

  // Step 1: Extract person_id mappings from resolve_identities calls
  // Note: When multiple person_ids are associated with the same identifier (phone/email),
  // we keep the last one encountered. This happens when the MCP server returns multiple
  // profiles for the same contact information.
  const identifierToPersonIdMap = new Map<string, string>();
  const resolveIdentitiesCalls = toolCalls.filter(tc => tc.name === 'resolve_identities' && tc.result);

  for (const call of resolveIdentitiesCalls) {
    try {
      console.log('=== RESOLVE_IDENTITIES CALL ===');

      let resultContent = call.result.content;

      // Parse if it's a string
      if (typeof resultContent === 'string') {
        resultContent = JSON.parse(resultContent);
      }

      // If it's an array with text field, parse that
      if (Array.isArray(resultContent) && resultContent[0]?.type === 'text') {
        resultContent = JSON.parse(resultContent[0].text);
      }

      console.log('Parsed identities count:', resultContent.identities?.length || 0);

      // Extract identifier -> person_id mappings from the identities array
      if (resultContent.identities && Array.isArray(resultContent.identities)) {
        for (const identity of resultContent.identities) {
          const personId = identity.person_id;

          // Get identifiers from the identifiers object
          if (identity.identifiers) {
            // Handle email identifiers
            if (identity.identifiers.email && Array.isArray(identity.identifiers.email)) {
              for (const email of identity.identifiers.email) {
                console.log(`Mapping email: ${email} -> ${personId}`);
                identifierToPersonIdMap.set(email.toLowerCase(), String(personId));
              }
            }

            // Handle phone identifiers
            if (identity.identifiers.phone && Array.isArray(identity.identifiers.phone)) {
              for (const phone of identity.identifiers.phone) {
                console.log(`Mapping phone: ${phone} -> ${personId}`);
                identifierToPersonIdMap.set(phone.toLowerCase(), String(personId));
              }
            }

            // Handle address identifiers
            if (identity.identifiers.address && Array.isArray(identity.identifiers.address)) {
              for (const address of identity.identifiers.address) {
                console.log(`Mapping address: ${address} -> ${personId}`);
                identifierToPersonIdMap.set(address.toLowerCase(), String(personId));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error parsing resolve_identities data:', error, error.stack);
    }
  }

  console.log(`Total identifier mappings: ${identifierToPersonIdMap.size}`);

  // Step 2: Extract enriched person data from get_person calls
  const personDataMap = new Map<string, any>();
  const personDataCalls = toolCalls.filter(tc => tc.name === 'get_person' && tc.result);

  for (const call of personDataCalls) {
    try {
      console.log('=== GET_PERSON CALL ===');
      console.log('Input:', JSON.stringify(call.input, null, 2));

      let resultContent = call.result.content;

      // Parse if it's a string
      if (typeof resultContent === 'string') {
        resultContent = JSON.parse(resultContent);
      }

      // If it's an array with text field, parse that
      if (Array.isArray(resultContent) && resultContent[0]?.type === 'text') {
        console.log('Raw text content:', resultContent[0].text.substring(0, 500) + '...');
        resultContent = JSON.parse(resultContent[0].text);
      }

      console.log('Parsed result structure:', Object.keys(resultContent).join(', '));

      // MCP get_person returns: { profiles: [ { domains: { ... } } ] }
      if (resultContent.profiles && Array.isArray(resultContent.profiles)) {
        console.log(`Found ${resultContent.profiles.length} profiles in response`);

        for (const profile of resultContent.profiles) {
          if (profile.domains && profile.domains['t0.person_id']) {
            const personId = String(profile.domains['t0.person_id']);
            console.log(`Storing person data for ID: ${personId}`);

            // Store the entire domains object which contains all enrichment data
            personDataMap.set(personId, profile.domains);
          } else {
            console.log('Profile missing person_id:', JSON.stringify(profile).substring(0, 200));
          }
        }
      } else {
        console.log('No profiles array found. Full result:', JSON.stringify(resultContent, null, 2).substring(0, 1000));
      }
    } catch (error) {
      console.error('Error parsing person data:', error, error.stack);
    }
  }

  console.log(`Total person data entries: ${personDataMap.size}`);
  console.log('Sample identifier mappings:', Array.from(identifierToPersonIdMap.entries()).slice(0, 5));

  // Step 3: Merge enriched data with original rows
  console.log('=== MERGING DATA ===');
  console.log('Detected fields:', uploadedData.detectedFields);
  console.log('First row sample:', uploadedData.rows[0]);

  for (const row of uploadedData.rows) {
    const enrichedRow: EnrichedRow = { ...row };

    // Try to find person_id for this row
    let personId = null;

    // First, check if row already has person_id
    const personIdField = uploadedData.detectedFields?.personIds;
    if (personIdField && row[personIdField]) {
      personId = row[personIdField];
    }

    // If no person_id, try to resolve from email/phone/address
    if (!personId) {
      const emailField = uploadedData.detectedFields?.emails;
      const phoneField = uploadedData.detectedFields?.phones;
      const addressField = uploadedData.detectedFields?.addresses;

      console.log(`Looking up row: email field="${emailField}", phone field="${phoneField}", address field="${addressField}"`);
      console.log(`Row values: email="${row[emailField]}", phone="${row[phoneField]}", address="${row[addressField]}"`);

      // Try all fields, not just one
      if (phoneField && row[phoneField]) {
        const phoneValue = String(row[phoneField]).toLowerCase();
        personId = identifierToPersonIdMap.get(phoneValue);
        console.log(`Tried phone "${phoneValue}": ${personId ? 'FOUND ' + personId : 'not found'}`);
      }

      if (!personId && emailField && row[emailField]) {
        const emailValue = String(row[emailField]).toLowerCase();
        personId = identifierToPersonIdMap.get(emailValue);
        console.log(`Tried email "${emailValue}": ${personId ? 'FOUND ' + personId : 'not found'}`);
      }

      if (!personId && addressField && row[addressField]) {
        const addressValue = String(row[addressField]).toLowerCase();
        personId = identifierToPersonIdMap.get(addressValue);
        console.log(`Tried address "${addressValue}": ${personId ? 'FOUND ' + personId : 'not found'}`);
      }
    }

    // If we found a person_id, merge in the enriched data
    if (personId && personDataMap.has(personId)) {
      const personData = personDataMap.get(personId);
      console.log(`Enriching row with person_id: ${personId}`);

      // Add person_id to the row
      enrichedRow.person_id = personId;

      // Flatten and add all person data fields
      const flattenedData = flattenProfileData(personData);
      console.log(`Flattened data keys: ${Object.keys(flattenedData).join(', ')}`);
      Object.assign(enrichedRow, flattenedData);
    } else {
      console.log(`No enrichment for row (personId: ${personId})`);
    }

    enrichedRows.push(enrichedRow);
  }

  console.log(`Returning ${enrichedRows.length} enriched rows`);
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

IMPORTANT: To enrich this data, you MUST follow these steps:

Step 1: Use resolve_identities to get person_ids from the identifiers (emails, phones, or addresses)
Format for email:
{
  "id_type": "email",
  "id_hash": "plaintext",
  "identifiers": ["email1@example.com", "email2@example.com"]
}

Step 2: Use get_person with the person_ids you received to fetch demographic and enrichment data
You should call get_person with these domains to get comprehensive data:
- name
- demographic (age, gender, etc.)
- email
- phone
- address
- employment
- interest
- lifestyle

Example: After getting person_id 123456 from resolve_identities, call:
get_person with person_id=123456 and domains=["name","demographic","email","phone","address","employment","interest","lifestyle"]

Please help me enrich this data by completing BOTH steps.
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
      console.log(`Processing ${result.toolCalls.length} tool calls...`);
      enrichedData = processEnrichedData(result.toolCalls, uploadedData);
      console.log(`Enriched data rows: ${enrichedData?.length || 0}`);
      if (enrichedData && enrichedData.length > 0) {
        console.log('First enriched row keys:', Object.keys(enrichedData[0]).join(', '));
      }
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
