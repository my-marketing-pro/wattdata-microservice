import { NextRequest, NextResponse } from 'next/server';
import { getAgent, MCPAgent, ChatMessage } from '@/lib/mcp-agent';
import { EnrichedRow, flattenProfileData } from '@/lib/csv-processor';
import { Readable } from 'stream';

interface EnrichmentResult {
  rows: EnrichedRow[];
  exportLinks: string[];
  resolvedCount: number;
  enrichedCount: number;
}

/**
 * Process tool call results to extract enriched person data
 */
async function processEnrichedData(
  agent: MCPAgent,
  toolCalls: any[] = [],
  uploadedData: any
): Promise<EnrichmentResult> {
  const enrichedRows: EnrichedRow[] = [];
  const exportLinks = new Set<string>();
  const resolvedPersonIds = new Set<string>();
  const emailField = uploadedData?.detectedFields?.emails;
  const phoneField = uploadedData?.detectedFields?.phones;
  const addressField = uploadedData?.detectedFields?.addresses;

  const emailCandidates = new Map<string, string>();
  const phoneCandidates = new Map<string, string>();
  const addressCandidates = new Map<string, string>();

  if (uploadedData?.rows) {
    for (const row of uploadedData.rows) {
      if (emailField && row[emailField]) {
        const value = String(row[emailField]).trim();
        if (value) {
          emailCandidates.set(value.toLowerCase(), value);
        }
      }
      if (phoneField && row[phoneField]) {
        const value = String(row[phoneField]).trim();
        if (value) {
          phoneCandidates.set(value.toLowerCase(), value);
        }
      }
      if (addressField && row[addressField]) {
        const value = String(row[addressField]).trim();
        if (value) {
          addressCandidates.set(value.toLowerCase(), value);
        }
      }
    }
  }

  // Step 1: Extract person_id mappings from resolve_identities calls
  // Note: When multiple person_ids are associated with the same identifier (phone/email),
  // we keep the last one encountered. This happens when the MCP server returns multiple
  // profiles for the same contact information.
  const identifierToPersonIdMap = new Map<string, string>();
  const resolveIdentitiesCalls = toolCalls.filter(tc => tc.name === 'resolve_identities' && tc.result);
  const existingPersonIds = new Set<string>();
  const headerLookup = new Map<string, string>();
  if (Array.isArray(uploadedData?.headers)) {
    for (const header of uploadedData.headers) {
      headerLookup.set(String(header).toLowerCase(), header);
    }
  }

  const getHeaderMatch = (...candidates: string[]): string | undefined => {
    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (headerLookup.has(key)) {
        return headerLookup.get(key);
      }
    }
    return undefined;
  };

  const detectedPersonIdField = uploadedData?.detectedFields?.personIds;
  const fallbackPersonIdField = getHeaderMatch('person_id', 'personid', 't0.person_id', 't0.personid');
  const personIdFieldCandidates = [detectedPersonIdField, fallbackPersonIdField].filter(Boolean) as string[];

  const processResolveCall = (call: any) => {
    try {
      console.log('=== RESOLVE_IDENTITIES CALL ===');

      let resultContent = call.result.content;

      if (typeof resultContent === 'string') {
        resultContent = JSON.parse(resultContent);
      }

      if (Array.isArray(resultContent) && resultContent[0]?.type === 'text') {
        resultContent = JSON.parse(resultContent[0].text);
      }

      console.log('Parsed identities count:', resultContent.identities?.length || 0);

      if (resultContent.identities && Array.isArray(resultContent.identities)) {
        for (const identity of resultContent.identities) {
          const personId = identity.person_id;

          if (identity.identifiers) {
            resolvedPersonIds.add(String(personId));
            if (identity.identifiers.email && Array.isArray(identity.identifiers.email)) {
              for (const email of identity.identifiers.email) {
                console.log(`Mapping email: ${email} -> ${personId}`);
                identifierToPersonIdMap.set(email.toLowerCase(), String(personId));
              }
            }

            if (identity.identifiers.phone && Array.isArray(identity.identifiers.phone)) {
              for (const phone of identity.identifiers.phone) {
                console.log(`Mapping phone: ${phone} -> ${personId}`);
                identifierToPersonIdMap.set(phone.toLowerCase(), String(personId));
              }
            }

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
  };

  for (const call of resolveIdentitiesCalls) {
    processResolveCall(call);
  }

  // If dataset already has person_id columns, treat them as resolved ids too
  if (uploadedData?.rows && personIdFieldCandidates.length > 0) {
    for (const row of uploadedData.rows) {
      for (const field of personIdFieldCandidates) {
        const rawValue = row[field];
        if (!rawValue) continue;
        const personId = String(rawValue).trim();
        if (!personId) continue;
        existingPersonIds.add(personId);

        if (emailField && row[emailField]) {
          const key = String(row[emailField]).toLowerCase();
          if (key && !identifierToPersonIdMap.has(key)) {
            identifierToPersonIdMap.set(key, personId);
          }
        }
        if (phoneField && row[phoneField]) {
          const key = String(row[phoneField]).toLowerCase();
          if (key && !identifierToPersonIdMap.has(key)) {
            identifierToPersonIdMap.set(key, personId);
          }
        }
        if (addressField && row[addressField]) {
          const key = String(row[addressField]).toLowerCase();
          if (key && !identifierToPersonIdMap.has(key)) {
            identifierToPersonIdMap.set(key, personId);
          }
        }
      }
    }
  }

  const recomputeResolvedIds = () => Array.from(new Set([
    ...Array.from(identifierToPersonIdMap.values()),
    ...Array.from(existingPersonIds.values()),
    ...Array.from(resolvedPersonIds.values()),
  ]));

  const logResolvedSummary = (resolvedIds: string[]) => {
    console.log(`Total identifier mappings: ${identifierToPersonIdMap.size}`);
    console.log(`Unique person_ids from resolve_identities: ${resolvedIds.length}`);
    console.log('Sample resolved person_ids:', resolvedIds.slice(0, 10));
  };

  let allResolvedPersonIds = recomputeResolvedIds();

  const autoResolveIdentifiers = async (
    identifierType: 'email' | 'phone' | 'address',
    candidateMap: Map<string, string>
  ) => {
    const unresolvedValues = Array.from(candidateMap.entries())
      .filter(([normalized]) => !identifierToPersonIdMap.has(normalized))
      .map(([, raw]) => raw)
      .filter(Boolean);

    if (unresolvedValues.length === 0) {
      return;
    }

    const chunkSize = 45;
    for (let i = 0; i < unresolvedValues.length; i += chunkSize) {
      const chunk = unresolvedValues.slice(i, i + chunkSize);
      const resolveInput: any = {
        id_type: identifierType,
        id_hash: 'plaintext',
        identifiers: chunk,
      };

      try {
        console.log(`Auto-calling resolve_identities for ${identifierType} identifiers: ${chunk.length}`);
        const toolResult = await agent.callToolDirect('resolve_identities', resolveInput);
        const autoCall = {
          name: 'resolve_identities',
          input: resolveInput,
          result: toolResult,
        };
        toolCalls.push(autoCall);
        processResolveCall(autoCall);
      } catch (error) {
        console.error(`Failed auto resolve for ${identifierType}`, error);
      }
    }
  };

  await autoResolveIdentifiers('phone', phoneCandidates);
  await autoResolveIdentifiers('email', emailCandidates);
  await autoResolveIdentifiers('address', addressCandidates);

  allResolvedPersonIds = recomputeResolvedIds();
  logResolvedSummary(allResolvedPersonIds);

  // Step 2: Extract enriched person data from get_person calls
  const personDataMap = new Map<string, any>();
  const personDataCalls = toolCalls.filter(tc => tc.name === 'get_person' && tc.result);

  const addExportLink = (value: any) => {
    if (!value) return;
    if (typeof value === 'string') {
      exportLinks.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(addExportLink);
      return;
    }
    if (typeof value === 'object') {
      const maybeStrings = ['download_url', 'url', 'link', 'href'];
      for (const key of maybeStrings) {
        if (typeof value[key] === 'string') {
          exportLinks.add(value[key]);
        }
      }
      if (Array.isArray(value.urls)) {
        value.urls.forEach(addExportLink);
      }
    }
  };

  const processProfiles = async (profiles?: any[]) => {
    if (!profiles || !Array.isArray(profiles)) return;
    console.log(`Found ${profiles.length} profiles in response`);
    for (const profile of profiles) {
      if (profile.domains && profile.domains['t0.person_id']) {
        const personId = String(profile.domains['t0.person_id']);
        console.log(`Storing person data for ID: ${personId}`);
        personDataMap.set(personId, profile.domains);
      } else {
        console.log('Profile missing person_id:', JSON.stringify(profile).substring(0, 200));
      }
    }
  };

  const fetchExportProfiles = async (exportData: any) => {
    const urls: string[] = [];
    const collectUrls = (value: any) => {
      if (!value) return;
      if (typeof value === 'string') {
        urls.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collectUrls);
        return;
      }
      if (typeof value === 'object') {
        for (const key of ['download_url', 'url', 'link', 'href']) {
          if (typeof value[key] === 'string') {
            urls.push(value[key]);
          }
        }
        if (Array.isArray(value.urls)) {
          value.urls.forEach(collectUrls);
        }
      }
    };

    collectUrls(exportData);
    for (const url of urls) {
      try {
        console.log('Fetching export data from', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.error('Export fetch failed with status', response.status);
          continue;
        }
        const exportJson = await response.json();
        const profiles = Array.isArray(exportJson)
          ? exportJson
          : Array.isArray(exportJson.profiles)
            ? exportJson.profiles
            : [];
        await processProfiles(profiles);
      } catch (error) {
        console.error('Failed to fetch export data', error);
      }
    }
  };

  const processPersonCall = async (call: any) => {
    try {
      console.log('=== GET_PERSON CALL ===');
      console.log('Input:', JSON.stringify(call.input, null, 2));

      const requestedPersonIds = call.input?.person_ids || [];
      console.log(`Requested ${requestedPersonIds.length} person_ids`);

      let resultContent = call.result.content;

      if (typeof resultContent === 'string') {
        resultContent = JSON.parse(resultContent);
      }

      if (Array.isArray(resultContent) && resultContent[0]?.type === 'text') {
        console.log('Raw text content:', resultContent[0].text.substring(0, 500) + '...');

        if (resultContent[0].text.startsWith('MCP error')) {
          console.error('MCP Error returned from get_person:', resultContent[0].text);
          return;
        }

        resultContent = JSON.parse(resultContent[0].text);
      }

      console.log('Parsed result structure:', Object.keys(resultContent).join(', '));

      if (resultContent.export) {
        addExportLink(resultContent.export);
        await fetchExportProfiles(resultContent.export);
      }

      await processProfiles(resultContent.profiles);
    } catch (error) {
      console.error('Error parsing person data:', error, error.stack);
    }
  };

  for (const call of personDataCalls) {
    await processPersonCall(call);
  }

  console.log(`Total person data entries: ${personDataMap.size}`);

  // Check for mismatch between resolved and retrieved person_ids
  const missingPersonIds = allResolvedPersonIds.filter(id => !personDataMap.has(id));
  if (missingPersonIds.length > 0) {
    console.warn(`⚠️  WARNING: ${missingPersonIds.length} person_ids were resolved but NOT retrieved from get_person!`);
    console.warn(`Missing person_ids:`, missingPersonIds.slice(0, 10));
    console.warn('Automatically fetching missing person_ids via MCP get_person...');

    const chunkSize = 45;
    const defaultDomains = [
      'name',
      'demographic',
      'email',
      'phone',
      'address',
      'employment',
      'interest',
      'lifestyle',
      'household',
      'financial',
    ];

    for (let i = 0; i < missingPersonIds.length; i += chunkSize) {
      const chunk = missingPersonIds.slice(i, i + chunkSize);
      const getPersonInput = {
        person_ids: chunk,
        domains: defaultDomains,
        format: 'json',
      };

      try {
        console.log(`Auto-calling get_person for ${chunk.length} ids...`);
        const toolResult = await agent.callToolDirect('get_person', getPersonInput);
        const autoCall = {
          name: 'get_person',
          input: getPersonInput,
          result: toolResult,
        };
        toolCalls.push(autoCall);
        await processPersonCall(autoCall);
      } catch (error) {
        console.error('Failed to auto-fetch person data for chunk', chunk, error);
      }
    }
  }
  console.log('Sample identifier mappings:', Array.from(identifierToPersonIdMap.entries()).slice(0, 5));

  // Step 3: Merge enriched data with original rows
  console.log('=== MERGING DATA ===');
  console.log('Detected fields:', uploadedData.detectedFields);
  console.log('First row sample:', uploadedData.rows[0]);

  const enrichedRowsWithIndex: { row: EnrichedRow; index: number }[] = [];

  uploadedData.rows.forEach((row: any, index: number) => {
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

    enrichedRowsWithIndex.push({ row: enrichedRow, index });
  });

  enrichedRowsWithIndex.sort((a, b) => a.index - b.index);
  const orderedRows = enrichedRowsWithIndex.map(entry => entry.row);

  console.log(`Returning ${orderedRows.length} enriched rows`);
  return {
    rows: orderedRows,
    exportLinks: Array.from(exportLinks),
    resolvedCount: allResolvedPersonIds.length,
    enrichedCount: enrichedRows.length,
  };
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
      // Check if data is already enriched by looking for enrichment fields
      const firstRow = uploadedData.rows[0];
      const isAlreadyEnriched = firstRow && ('person_id' in firstRow || 'first_name' in firstRow || 't0.person_id' in firstRow);

      // Add context about uploaded data
      const dataContext = `
I have ${isAlreadyEnriched ? 'previously enriched' : 'uploaded a'} CSV file with the following information:
- Total rows: ${uploadedData.rows.length}
${isAlreadyEnriched ? `- Data status: Previously enriched with demographic and interest data` : `- Detected fields: ${JSON.stringify(uploadedData.detectedFields)}`}
- Column headers: ${uploadedData.headers.slice(0, 10).join(', ')}${uploadedData.headers.length > 10 ? ` ... (${uploadedData.headers.length} total columns)` : ''}
- First 3 rows (sample):
${JSON.stringify(uploadedData.rows.slice(0, 3), null, 2).substring(0, 2000)}...

${isAlreadyEnriched ?
`The data has already been enriched with person information. You can:
- Add additional enrichment by calling get_person with additional domains (e.g., household, financial) for person_ids that are already in the data
- Update existing records with more data
- Analyze the enriched data to provide insights

**CRITICAL**: When calling get_person, the person_ids parameter MUST be an array of STRINGS, not numbers!
✓ Correct: {"person_ids": ["123456", "789012"], ...}
✗ Wrong: {"person_ids": [123456, 789012], ...}`
:
`IMPORTANT: To enrich this data, you MUST follow these steps:

Step 1: Use resolve_identities to get person_ids from the identifiers (emails, phones, or addresses)
Format for email:
{
  "id_type": "email",
  "id_hash": "plaintext",
  "identifiers": ["email1@example.com", "email2@example.com"]
}

Step 2: Use get_person with the EXACT person_ids you received from resolve_identities

**CRITICAL REQUIREMENTS**:
1. The person_ids parameter MUST be an array of STRINGS, not numbers!
   ✓ Correct: {"person_ids": ["123456", "789012"], ...}
   ✗ Wrong: {"person_ids": [123456, 789012], ...}

2. You MUST use the EXACT person_ids that were returned from resolve_identities in Step 1
   - Do NOT use different person_ids
   - Do NOT make up person_ids
   - Use ALL person_ids from the resolve_identities response

3. Call get_person with these domains to get comprehensive data:
   - name
   - demographic (age, gender, etc.)
   - email
   - phone
   - address
   - employment
   - interest
   - lifestyle

Example workflow:
1. Call resolve_identities → Get back person_ids: ["123456", "789012", "111222"]
2. Call get_person with person_ids=["123456", "789012", "111222"] (use EXACT IDs from step 1!)

Please help me enrich this data by completing BOTH steps with the EXACT person_ids.`}

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
    const initialResult = await agent.chat(chatMessages);
    let finalResponseText = initialResult.response;
    let toolCalls = initialResult.toolCalls ? [...initialResult.toolCalls] : [];

    // Process tool calls to extract enriched data
    let enrichedData: EnrichedRow[] | null = null;
    let exportLinks: string[] = [];
    let resolvedCount = 0;
    let enrichedCount = 0;
    if (uploadedData) {
      console.log(`Processing ${toolCalls.length} tool calls...`);
      const enrichmentResult = await processEnrichedData(agent, toolCalls, uploadedData);
      enrichedData = enrichmentResult.rows;
      exportLinks = enrichmentResult.exportLinks;
      resolvedCount = enrichmentResult.resolvedCount;
      enrichedCount = enrichmentResult.enrichedCount;
      console.log(`Enriched data rows: ${enrichedData?.length || 0}`);
      if (enrichedData && enrichedData.length > 0) {
        console.log('First enriched row keys:', Object.keys(enrichedData[0]).join(', '));
      }

      if (resolvedCount > 0 || enrichedCount > 0) {
        console.log('Export links collected this run:', exportLinks);

        const sampleRows = enrichedData.slice(0, 5)
          .map((row, idx) => {
            const keys = Object.keys(row).slice(0, 10);
            const pairs = keys.map(key => `${key}: ${row[key]}`);
            return `Row ${idx + 1}: ${pairs.join(', ')}`;
          })
          .join('\n');

        const summaryContent = `System note: ${resolvedCount} person_ids were resolved and ${enrichedCount} rows were enriched via MCP. Here is a preview of the enriched rows:\n${sampleRows}`;

        chatMessages.push({
          role: 'user',
          content: summaryContent,
        });

        const finalResult = await agent.chat(chatMessages);
        finalResponseText = finalResult.response;
        if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
          toolCalls = [...toolCalls, ...finalResult.toolCalls];
        }
      }
    }

    const summaryParts = [];
    if (resolvedCount > 0) {
      summaryParts.push(`Resolved ${resolvedCount} unique person_ids.`);
    }
    if (enrichedCount > 0) {
      summaryParts.push(`Enriched ${enrichedCount} rows in the uploaded CSV.`);
    }

    const appendedSummary = summaryParts.length > 0
      ? `${summaryParts.join(' ')}${finalResponseText ? '\n\n' + finalResponseText : ''}`
      : finalResponseText;

    return NextResponse.json({
      response: appendedSummary,
      toolCalls,
      enrichedData,
      exportLinks,
      resolvedCount,
      enrichedCount,
    });

  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
