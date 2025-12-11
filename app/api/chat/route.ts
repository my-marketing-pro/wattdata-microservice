import { NextRequest, NextResponse } from 'next/server';
import { getAgent, MCPAgent, ChatMessage } from '@/lib/mcp-agent';
import { EnrichedRow, flattenProfileData, analyzeICPFromProfiles, ICPAttribute, ICPAnalysisResult, buildClusterExpression } from '@/lib/csv-processor';
import { Readable } from 'stream';

type WorkflowMode = 'enrich' | 'find-similar';

interface EnrichmentResult {
  rows: EnrichedRow[];
  exportLinks: string[];
  resolvedCount: number;
  enrichedCount: number;
}

type IdentifierType = 'email' | 'phone' | 'address';

const PREVIEW_FIELDS = {
  name: ['Name', 'name', 'first_name'],
  email: ['Email', 'email', 'email1'],
  phone: ['Phone', 'phone', 'phone1'],
};

const findFirstValue = (row: EnrichedRow, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const formatPreviewRows = (rows: EnrichedRow[]): string => {
  if (!rows.length) return '';
  const previewCount = Math.min(rows.length, 3);
  const lines: string[] = [];

  for (let i = 0; i < previewCount; i++) {
    const row = rows[i];
    const name = findFirstValue(row, PREVIEW_FIELDS.name) || 'Unknown name';
    const email = findFirstValue(row, PREVIEW_FIELDS.email) || 'N/A';
    const phone = findFirstValue(row, PREVIEW_FIELDS.phone) || 'N/A';
    const personId = row.person_id || row['t0.person_id'] || 'N/A';

    lines.push(`${i + 1}. ${name} | Email: ${email} | Phone: ${phone} | person_id: ${personId}`);
  }

  return `Sample rows:\n${lines.join('\n')}`;
};

/**
 * Formats an attribute name and value into a human-friendly label for chat responses.
 */
const formatAttributeLabel = (name: string, value: string): string => {
  const isFalse = value.toLowerCase() === 'false';
  const isTrue = value.toLowerCase() === 'true';
  const isBoolean = isFalse || isTrue;

  const parts = name.toLowerCase().split('_');

  // Remove category prefix
  const categories = ['financial', 'lifestyle', 'interest', 'demographic', 'household', 'purchase', 'donation', 'political', 'technology', 'vehicle', 'property', 'health', 'travel', 'retail'];
  let remainingParts = categories.includes(parts[0]) ? parts.slice(1) : [...parts];

  // Remove common suffixes
  const suffixes = ['value', 'flag', 'indicator', 'code'];
  while (remainingParts.length > 0 && suffixes.includes(remainingParts[remainingParts.length - 1])) {
    remainingParts.pop();
  }

  const formatWords = (words: string[]) => words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .replace(/\bAnd\b/g, '&');

  // Pattern matching for natural language
  if (remainingParts[0] === 'is') {
    const thing = formatWords(remainingParts.slice(1));
    return isBoolean ? (isFalse ? `Not a ${thing.toLowerCase()}` : `Is a ${thing.toLowerCase()}`) : `${thing}: ${value}`;
  }
  if (remainingParts[0] === 'has') {
    const thing = formatWords(remainingParts.slice(1));
    return isBoolean ? (isFalse ? `No ${thing.toLowerCase()}` : `Has ${thing.toLowerCase()}`) : `${thing}: ${value}`;
  }
  if (remainingParts[0] === 'owns') {
    const thing = formatWords(remainingParts.slice(1));
    return isBoolean ? (isFalse ? `Doesn't own ${thing.toLowerCase()}` : `Owns ${thing.toLowerCase()}`) : `${thing}: ${value}`;
  }
  if (remainingParts[0] === 'donated') {
    const cause = formatWords(remainingParts.slice(1));
    return isBoolean ? (isFalse ? `Doesn't donate to ${cause.toLowerCase()}` : `Donates to ${cause.toLowerCase()}`) : `${cause}: ${value}`;
  }
  if (remainingParts[0] === 'interested') {
    const interest = formatWords(remainingParts.slice(1));
    return isBoolean ? (isFalse ? `Not interested in ${interest.toLowerCase()}` : `Interested in ${interest.toLowerCase()}`) : `${interest}: ${value}`;
  }

  // Default formatting
  const formatted = formatWords(remainingParts);
  return isBoolean ? (isFalse ? `No ${formatted.toLowerCase()}` : formatted) : `${formatted}: ${value}`;
};

const buildUserFacingSummary = (
  resolvedCount: number,
  enrichedCount: number,
  enrichedData: EnrichedRow[] | null,
  exportLinks: string[]
): string => {
  const lines: string[] = [];
  const headlineParts: string[] = [];

  if (resolvedCount > 0) {
    headlineParts.push(`resolved ${resolvedCount} person_id${resolvedCount === 1 ? '' : 's'}`);
  }
  if (enrichedCount > 0) {
    headlineParts.push(`enriched ${enrichedCount} row${enrichedCount === 1 ? '' : 's'}`);
  }

  if (headlineParts.length > 0) {
    lines.push(`Enrichment summary: ${headlineParts.join(' and ')}.`);
  }

  if (enrichedData && enrichedData.length > 0) {
    lines.push(formatPreviewRows(enrichedData));
  }

  if (exportLinks.length > 0) {
    lines.push('The enriched CSV is available from the Export button.');
  }

  return lines.join('\n\n');
};

const logError = (message: string, error: unknown) => {
  if (error instanceof Error) {
    console.error(message, error.message, error.stack);
  } else {
    console.error(message, error);
  }
};

const normalizeIdentifier = (value: string, type: IdentifierType): string => {
  if (!value) return '';
  let trimmed = value.trim();

  if (type === 'phone') {
    let digits = trimmed.replace(/[^0-9]/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = digits.slice(1);
    }
    // For 10-digit US numbers, add +1 prefix for WattData API
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    return digits;
  }

  trimmed = trimmed.toLowerCase();

  if (type === 'address') {
    trimmed = trimmed.replace(/\s+/g, ' ');
  }

  return trimmed;
};

const buildIdentifierKey = (value: unknown, type: IdentifierType): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const stringValue = typeof value === 'string' ? value : String(value);
  const normalized = normalizeIdentifier(stringValue, type);
  if (!normalized) return null;
  return `${type}:${normalized}`;
};

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
        const rawValue = String(row[emailField]).trim();
        const key = buildIdentifierKey(rawValue, 'email');
        if (key && rawValue) {
          emailCandidates.set(key, rawValue);
        }
      }
      if (phoneField && row[phoneField]) {
        const rawValue = String(row[phoneField]).trim();
        const key = buildIdentifierKey(rawValue, 'phone');
        // Normalize phone for API: use the normalized format (with +1 prefix)
        const normalizedPhone = normalizeIdentifier(rawValue, 'phone');
        if (key && normalizedPhone) {
          phoneCandidates.set(key, normalizedPhone);
        }
      }
      if (addressField && row[addressField]) {
        const rawValue = String(row[addressField]).trim();
        const key = buildIdentifierKey(rawValue, 'address');
        if (key && rawValue) {
          addressCandidates.set(key, rawValue);
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

  const addIdentifierMapping = (value: unknown, type: IdentifierType, personId: string) => {
    const key = buildIdentifierKey(value, type);
    if (key) {
      identifierToPersonIdMap.set(key, personId);
    }
  };

  const ensureIdentifierMapping = (value: unknown, type: IdentifierType, personId: string) => {
    const key = buildIdentifierKey(value, type);
    if (key && !identifierToPersonIdMap.has(key)) {
      identifierToPersonIdMap.set(key, personId);
    }
  };

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
                addIdentifierMapping(email, 'email', String(personId));
              }
            }

            if (identity.identifiers.phone && Array.isArray(identity.identifiers.phone)) {
              for (const phone of identity.identifiers.phone) {
                console.log(`Mapping phone: ${phone} -> ${personId}`);
                addIdentifierMapping(phone, 'phone', String(personId));
              }
            }

            if (identity.identifiers.address && Array.isArray(identity.identifiers.address)) {
              for (const address of identity.identifiers.address) {
                console.log(`Mapping address: ${address} -> ${personId}`);
                addIdentifierMapping(address, 'address', String(personId));
              }
            }
          }
        }
      }
    } catch (error) {
      logError('Error parsing resolve_identities data:', error);
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
          ensureIdentifierMapping(row[emailField], 'email', personId);
        }
        if (phoneField && row[phoneField]) {
          ensureIdentifierMapping(row[phoneField], 'phone', personId);
        }
        if (addressField && row[addressField]) {
          ensureIdentifierMapping(row[addressField], 'address', personId);
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
        logError(`Failed auto resolve for ${identifierType}`, error);
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
      // Try to get person_id from multiple locations
      let personId: string | null = null;

      // Check root level person_id first (new API format)
      if (profile.person_id) {
        personId = String(profile.person_id);
      }
      // Check domains['t0.person_id'] (old format)
      else if (profile.domains && profile.domains['t0.person_id']) {
        personId = String(profile.domains['t0.person_id']);
      }
      // Check domains.person_id
      else if (profile.domains && profile.domains.person_id) {
        personId = String(profile.domains.person_id);
      }

      if (personId) {
        console.log(`Storing person data for ID: ${personId}`);
        // Store either the domains object or the whole profile if domains doesn't exist
        const dataToStore = profile.domains || profile;
        personDataMap.set(personId, dataToStore);
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
        logError('Failed to fetch export data', error);
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
      logError('Error parsing person data:', error);
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
        logError('Failed to auto-fetch person data for chunk', error);
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
        const phoneKey = buildIdentifierKey(row[phoneField], 'phone');
        if (phoneKey) {
          personId = identifierToPersonIdMap.get(phoneKey);
          console.log(`Tried phone "${row[phoneField]}": ${personId ? 'FOUND ' + personId : 'not found'}`);
        }
      }

      if (!personId && emailField && row[emailField]) {
        const emailKey = buildIdentifierKey(row[emailField], 'email');
        if (emailKey) {
          personId = identifierToPersonIdMap.get(emailKey);
          console.log(`Tried email "${row[emailField]}": ${personId ? 'FOUND ' + personId : 'not found'}`);
        }
      }

      if (!personId && addressField && row[addressField]) {
        const addressKey = buildIdentifierKey(row[addressField], 'address');
        if (addressKey) {
          personId = identifierToPersonIdMap.get(addressKey);
          console.log(`Tried address "${row[addressField]}": ${personId ? 'FOUND ' + personId : 'not found'}`);
        }
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

  // Count how many rows actually got enrichment data
  const actualEnrichedCount = orderedRows.filter(row => Object.keys(row).length > 3).length;

  console.log(`Returning ${orderedRows.length} enriched rows`);
  console.log(`Resolved person_ids: ${allResolvedPersonIds.length}`);
  console.log(`Actually enriched rows (>3 keys): ${actualEnrichedCount}`);
  console.log(`PersonDataMap size: ${personDataMap.size}`);

  // Find a row that was enriched and log its keys
  const enrichedRow = orderedRows.find(row => Object.keys(row).length > 3);
  if (enrichedRow) {
    console.log(`Sample enriched row keys (first 10): ${Object.keys(enrichedRow).slice(0, 10).join(', ')}`);
  }

  return {
    rows: orderedRows,
    exportLinks: Array.from(exportLinks),
    resolvedCount: allResolvedPersonIds.length,
    enrichedCount: actualEnrichedCount, // Fixed: use actual count instead of empty array
  };
}

/**
 * Process ICP analysis for Find Similar workflow
 * Step 1: Enrich all profiles with all domains
 * Step 2: Analyze the enriched data to find common characteristics
 */
async function processICPAnalysis(
  agent: MCPAgent,
  toolCalls: any[],
  uploadedData: any
): Promise<{ enrichedRows: EnrichedRow[]; icpAnalysis: ICPAnalysisResult }> {
  console.log(`[processICPAnalysis] Starting with ${toolCalls.length} tool calls`);
  console.log(`[processICPAnalysis] Uploaded data has ${uploadedData?.rows?.length || 0} rows`);

  // Enrich all rows with all available domains
  const enrichmentResult = await processEnrichedData(agent, toolCalls, uploadedData);

  console.log(`[processICPAnalysis] Enrichment returned ${enrichmentResult.rows.length} rows`);
  if (enrichmentResult.rows[0]) {
    const keys = Object.keys(enrichmentResult.rows[0]);
    console.log(`[processICPAnalysis] First enriched row has ${keys.length} fields:`);
    console.log(`[processICPAnalysis] Sample keys: ${keys.slice(0, 15).join(', ')}`);
  }

  // Analyze ICP from enriched data
  const icpAnalysis = analyzeICPFromProfiles(enrichmentResult.rows);

  console.log(`[processICPAnalysis] ICP Analysis found ${icpAnalysis.topAttributes.length} attributes from ${icpAnalysis.totalProfiles} profiles`);

  return {
    enrichedRows: enrichmentResult.rows,
    icpAnalysis,
  };
}

interface FindSimilarResult {
  similarContacts: any[];
  exportLinks: string[];
  total: number;
  expression: string;
}

/**
 * Process Find Similar Contacts search
 * Uses selected ICP attributes to find lookalike audience via WattData
 */
async function processFindSimilarContacts(
  agent: MCPAgent,
  selectedAttributes: ICPAttribute[]
): Promise<FindSimilarResult> {
  console.log(`Finding similar contacts with ${selectedAttributes.length} selected attributes`);

  // Step 1: Get cluster IDs for selected attributes
  // Use clusterName (normalized) for WattData API lookup
  const uniqueClusterNames = [...new Set(selectedAttributes.map(a => a.clusterName))];
  console.log('Looking up clusters for cluster names:', uniqueClusterNames);
  console.log('Original attribute names:', selectedAttributes.map(a => a.attributeName));

  let clustersResult: any;
  try {
    clustersResult = await agent.callToolDirect('list_clusters', {
      cluster_names: uniqueClusterNames,
    });
    console.log('list_clusters result:', JSON.stringify(clustersResult).substring(0, 500));
  } catch (error) {
    logError('Error calling list_clusters', error);
    throw new Error('Failed to look up cluster IDs for the selected attributes');
  }

  // Parse the clusters response - handle MCP errors
  let clusters: any[] = [];
  if (clustersResult?.content) {
    let content = clustersResult.content;
    if (typeof content === 'string') {
      // Check for MCP error
      if (content.startsWith('MCP error')) {
        console.error('MCP Error from list_clusters:', content);
        throw new Error(`WattData API error: The selected attributes may not be supported for cluster lookup. Try selecting different characteristics.`);
      }
      try {
        content = JSON.parse(content);
      } catch {
        // Not JSON, might be error message
        console.error('Unexpected list_clusters response:', content);
        throw new Error('Unexpected response from cluster lookup');
      }
    }
    if (Array.isArray(content) && content[0]?.type === 'text') {
      const textContent = content[0].text;
      // Check for MCP error in text content
      if (textContent.startsWith('MCP error')) {
        console.error('MCP Error from list_clusters:', textContent);
        throw new Error(`WattData API error: The selected attributes may not be supported for cluster lookup. Try selecting different characteristics.`);
      }
      try {
        content = JSON.parse(textContent);
      } catch {
        console.error('Failed to parse list_clusters text:', textContent);
        throw new Error('Failed to parse cluster lookup response');
      }
    }
    clusters = content?.clusters || [];
  }

  console.log(`Found ${clusters.length} clusters`);

  // Step 2: Map attributes to cluster IDs
  // Note: API returns 'name' and 'value', not 'cluster_name' and 'cluster_value'
  const clusterMap = new Map<string, string>();
  for (const cluster of clusters) {
    // Handle both field naming conventions from API
    const clusterName = cluster.name || cluster.cluster_name;
    const clusterValue = cluster.value || cluster.cluster_value;
    const clusterId = String(cluster.cluster_id);
    const key = `${clusterName}=${clusterValue}`;
    clusterMap.set(key, clusterId);
    console.log(`Mapped ${key} -> ${clusterId}`);
  }

  // Step 3: Build boolean expression from selected attributes
  const expression = buildClusterExpression(selectedAttributes, clusterMap);

  if (!expression) {
    throw new Error('Could not build search expression - no matching clusters found for selected attributes');
  }

  console.log('Search expression:', expression);

  // Step 4: Call find_persons with a limit of 50 contacts
  // Note: The API returns max ~10 samples inline. For more records, we'd need format: "json" or "csv"
  // but that creates an S3 export which can fail with INTERNAL_ERROR for large result sets.
  // For now, we use inline format with limit to get the available samples.
  const MAX_SIMILAR_CONTACTS = 50;
  let findResult: any;
  try {
    findResult = await agent.callToolDirect('find_persons', {
      expression,
      identifier_type: 'email',
      limit: MAX_SIMILAR_CONTACTS,
      format: 'none', // Inline results (max ~10 samples)
    });
    console.log('find_persons result:', JSON.stringify(findResult).substring(0, 500));
  } catch (error) {
    logError('Error calling find_persons', error);
    throw new Error('Failed to find similar contacts');
  }

  // Parse the find_persons response
  let parsedResult: any = {};
  if (findResult?.content) {
    let content = findResult.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        if (Array.isArray(content) && content[0]?.type === 'text') {
          content = JSON.parse(content[0].text);
        }
      }
    }
    if (Array.isArray(content) && content[0]?.type === 'text') {
      try {
        parsedResult = JSON.parse(content[0].text);
      } catch {
        parsedResult = {};
      }
    } else {
      parsedResult = content;
    }
  }

  const total = parsedResult.total || 0;
  const sample = parsedResult.sample || [];
  const exportUrl = parsedResult.export?.url || parsedResult.export?.download_url || '';

  console.log(`Found ${total} similar contacts, ${sample.length} samples, export: ${exportUrl ? 'yes' : 'no'}`);

  // If we have sample contacts, enrich them with full profile data using get_person
  let enrichedContacts: EnrichedRow[] = [];

  if (sample.length > 0) {
    // Convert person_ids to strings - the API expects string IDs
    const personIds = sample
      .map((contact: any) => contact.person_id)
      .filter(Boolean)
      .map((id: any) => String(id));
    console.log(`Enriching ${personIds.length} similar contacts with full profile data`);

    if (personIds.length > 0) {
      try {
        // Call get_person to get full profile data for the sample contacts
        const getPersonResult = await agent.callToolDirect('get_person', {
          person_ids: personIds,
          domains: [
            'name', 'email', 'phone', 'address',
            'demographic', 'household', 'interest', 'lifestyle', 'financial'
          ],
          format: 'none',
        });

        console.log('get_person result (first 500 chars):', JSON.stringify(getPersonResult).substring(0, 500));

        // Parse the get_person response
        let profiles: any[] = [];
        if (getPersonResult?.content) {
          let content = getPersonResult.content;
          if (Array.isArray(content) && content[0]?.type === 'text') {
            try {
              const parsed = JSON.parse(content[0].text);
              profiles = parsed.profiles || [];
            } catch {
              console.log('Failed to parse get_person response');
            }
          }
        }

        console.log(`Got ${profiles.length} enriched profiles`);

        // Flatten the enriched profiles
        if (profiles.length > 0) {
          enrichedContacts = profiles.map((profile: any) => flattenProfileData(profile));
        }
      } catch (error) {
        console.error('Error enriching similar contacts:', error);
        // Fall back to basic flattening if enrichment fails
      }
    }
  }

  // If enrichment failed or returned no results, fall back to basic flattening
  if (enrichedContacts.length === 0 && sample.length > 0) {
    console.log('Falling back to basic contact flattening');
    enrichedContacts = sample.map((contact: any) => {
      const flat: Record<string, any> = {
        person_id: contact.person_id,
      };

      // Flatten identifiers
      if (contact.identifiers) {
        // Handle email array
        if (Array.isArray(contact.identifiers.email)) {
          contact.identifiers.email.forEach((email: string, idx: number) => {
            flat[`email${idx + 1}`] = email;
          });
        } else if (typeof contact.identifiers.email === 'object') {
          Object.entries(contact.identifiers.email).forEach(([key, value]) => {
            flat[key] = value;
          });
        }

        // Handle phone array
        if (Array.isArray(contact.identifiers.phone)) {
          contact.identifiers.phone.forEach((phone: string, idx: number) => {
            flat[`phone${idx + 1}`] = phone;
          });
        } else if (typeof contact.identifiers.phone === 'object') {
          Object.entries(contact.identifiers.phone).forEach(([key, value]) => {
            flat[key] = value;
          });
        }

        // Handle address
        if (contact.identifiers.address) {
          if (Array.isArray(contact.identifiers.address)) {
            contact.identifiers.address.forEach((addr: any, idx: number) => {
              if (typeof addr === 'object') {
                Object.entries(addr).forEach(([key, value]) => {
                  flat[`address${idx + 1}_${key}`] = value;
                });
              } else {
                flat[`address${idx + 1}`] = addr;
              }
            });
          } else if (typeof contact.identifiers.address === 'object') {
            Object.entries(contact.identifiers.address).forEach(([key, value]) => {
              flat[`address_${key}`] = value;
            });
          }
        }
      }

      return flat;
    });
  }

  return {
    similarContacts: enrichedContacts,
    exportLinks: exportUrl ? [exportUrl] : [],
    total,
    expression,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, uploadedData, workflowMode = 'enrich', icpSearchParams } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    // Get the singleton agent instance
    const agent = getAgent();

    // Handle Find Similar Contacts workflow - search step
    if (workflowMode === 'find-similar' && icpSearchParams?.selectedAttributes) {
      console.log('Processing Find Similar search with selected attributes');
      try {
        const result = await processFindSimilarContacts(
          agent,
          icpSearchParams.selectedAttributes
        );

        const sampleCount = result.similarContacts.length;
        const totalFormatted = Number(result.total).toLocaleString();

        let responseMessage = `Found ${totalFormatted} total contacts matching your criteria.`;
        if (sampleCount > 0) {
          responseMessage += ` Showing ${sampleCount} sample contacts.`;
        } else {
          responseMessage += ` No sample contacts available for preview.`;
        }

        return NextResponse.json({
          response: responseMessage,
          similarContacts: result.similarContacts,
          exportLinks: result.exportLinks,
          totalFound: result.total,
        });
      } catch (error) {
        logError('Error in find similar search:', error);
        return NextResponse.json({
          response: `Error finding similar contacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error: true,
        });
      }
    }

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
    let icpAnalysis: ICPAnalysisResult | null = null;

    if (uploadedData) {
      console.log(`Processing ${toolCalls.length} tool calls... (workflowMode: ${workflowMode})`);

      if (workflowMode === 'find-similar') {
        // Find Similar workflow - ICP analysis step
        // First enrich the data, then analyze ICP
        const result = await processICPAnalysis(agent, toolCalls, uploadedData);
        enrichedData = result.enrichedRows;
        icpAnalysis = result.icpAnalysis;
        resolvedCount = enrichedData.length;
        enrichedCount = enrichedData.filter(row => row.person_id).length;

        console.log(`ICP Analysis complete: ${icpAnalysis.topAttributes.length} attributes identified`);

        // Build response message for ICP analysis with human-friendly labels
        const topAttrsPreview = icpAnalysis.topAttributes.slice(0, 5)
          .map(attr => `  - ${formatAttributeLabel(attr.attributeName, attr.attributeValue)} (${attr.percentage.toFixed(0)}%)`)
          .join('\n');

        const userFacingResponse = `I've analyzed your ${icpAnalysis.totalProfiles} contacts and identified common characteristics.

**Top characteristics found:**
${topAttrsPreview}

Use the sidebar to select which characteristics to match and find similar contacts.`;

        return NextResponse.json({
          response: userFacingResponse,
          toolCalls,
          enrichedData,
          exportLinks: [],
          icpAnalysis,
          resolvedCount,
          enrichedCount,
        });
      }

      // Standard Enrich workflow
      const enrichmentResult = await processEnrichedData(agent, toolCalls, uploadedData);
      enrichedData = enrichmentResult.rows;
      exportLinks = enrichmentResult.exportLinks;
      resolvedCount = enrichmentResult.resolvedCount;
      enrichedCount = enrichmentResult.enrichedCount;
      console.log(`Enriched data rows: ${enrichedData?.length || 0}`);
      if (enrichedData && enrichedData.length > 0) {
        console.log('First enriched row keys:', Object.keys(enrichedData[0]).join(', '));
        // Find and log an actually enriched row
        const enrichedSample = enrichedData.find(row => Object.keys(row).length > 5);
        if (enrichedSample) {
          console.log(`Found enriched row with ${Object.keys(enrichedSample).length} keys`);
          console.log('Sample enriched keys:', Object.keys(enrichedSample).slice(0, 20).join(', '));
        } else {
          console.log('WARNING: No rows have more than 5 keys - enrichment may have failed');
        }
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

    let userFacingResponse = finalResponseText;
    if (resolvedCount > 0 || enrichedCount > 0) {
      const summaryText = buildUserFacingSummary(resolvedCount, enrichedCount, enrichedData, exportLinks);
      userFacingResponse = summaryText || finalResponseText;
    }

    // Debug: Log what we're about to send
    if (enrichedData && enrichedData.length > 0) {
      const sampleRow = enrichedData.find(r => Object.keys(r).length > 5) || enrichedData[0];
      console.log(`[RESPONSE] About to send ${enrichedData.length} rows`);
      console.log(`[RESPONSE] Sample row has ${Object.keys(sampleRow).length} keys`);
      console.log(`[RESPONSE] Sample keys: ${Object.keys(sampleRow).slice(0, 15).join(', ')}`);

      // Test JSON serialization
      try {
        const testJson = JSON.stringify(sampleRow);
        const parsed = JSON.parse(testJson);
        console.log(`[RESPONSE] After JSON round-trip: ${Object.keys(parsed).length} keys`);
      } catch (e) {
        console.error(`[RESPONSE] JSON serialization error:`, e);
      }
    }

    return NextResponse.json({
      response: userFacingResponse,
      toolCalls,
      enrichedData,
      exportLinks,
      resolvedCount,
      enrichedCount,
    });

  } catch (error) {
    logError('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
