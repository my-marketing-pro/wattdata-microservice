import Papa from 'papaparse';

export interface CSVRow {
  [key: string]: string | undefined;
}

export interface ParsedCSV {
  headers: string[];
  rows: CSVRow[];
  detectedFields: {
    emails?: string;
    phones?: string;
    addresses?: string;
    personIds?: string;
  };
}

export interface EnrichedRow extends CSVRow {
  person_id?: string;
  overall_quality_score?: string;
  // Demographics
  age?: string;
  gender?: string;
  income?: string;
  education?: string;
  // Interests/Clusters
  clusters?: string;
  interests?: string;
  // All profile data will be flattened into additional columns
  [key: string]: string | undefined;
}

/**
 * Parse CSV file and detect relevant columns
 */
export function parseCSV(file: File): Promise<ParsedCSV> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const rows = results.data as CSVRow[];

        // Detect which columns contain emails, phones, addresses, person_ids
        const detectedFields = detectFieldTypes(headers);

        resolve({
          headers,
          rows,
          detectedFields,
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

/**
 * Detect column types based on header names
 */
function detectFieldTypes(headers: string[]): ParsedCSV['detectedFields'] {
  const detected: ParsedCSV['detectedFields'] = {};

  const lowerHeaders = headers.map(h => h.toLowerCase());

  // Detect email column
  const emailIndex = lowerHeaders.findIndex(h =>
    h.includes('email') || h.includes('e-mail') || h === 'email_address'
  );
  if (emailIndex >= 0) {
    detected.emails = headers[emailIndex];
  }

  // Detect phone column
  const phoneIndex = lowerHeaders.findIndex(h =>
    h.includes('phone') || h.includes('mobile') || h.includes('cell') || h === 'telephone'
  );
  if (phoneIndex >= 0) {
    detected.phones = headers[phoneIndex];
  }

  // Detect address column
  const addressIndex = lowerHeaders.findIndex(h =>
    h.includes('address') || h.includes('street') || h.includes('location')
  );
  if (addressIndex >= 0) {
    detected.addresses = headers[addressIndex];
  }

  // Detect person_id column
  const personIdIndex = lowerHeaders.findIndex(h =>
    h.includes('person_id') || h.includes('personid') || h === 'id'
  );
  if (personIdIndex >= 0) {
    detected.personIds = headers[personIdIndex];
  }

  return detected;
}

/**
 * Export enriched data to CSV
 */
export function exportToCSV(data: EnrichedRow[], filename: string = 'enriched-data.csv') {
  // Collect all unique keys from all rows for proper CSV headers
  // Papa.unparse() by default only uses keys from the first row, so we need to specify all columns
  const allKeys = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      allKeys.add(key);
    }
  }
  const columns = Array.from(allKeys);

  // Use explicit columns to ensure all fields are included even if first row doesn't have them
  const csv = Papa.unparse(data, { columns });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Flatten nested profile data into a single row
 * Handles MCP's format where enrichment data is in JSON strings (t1.json, t2.json, etc.)
 */
export function flattenProfileData(profile: any): Record<string, string> {
  const flattened: Record<string, string> = {};

  // First, parse all JSON string fields (t1.json, t2.json, etc.)
  const parsedData: any = {};

  for (const key in profile) {
    const value = profile[key];

    // If it's a .json field, handle it specially - DO NOT add to flattened output
    if (key.endsWith('.json')) {
      if (typeof value === 'string') {
        const parsed = robustJsonParse(value);
        if (parsed !== null) {
          Object.assign(parsedData, parsed);
        } else {
          console.warn(`Failed to parse ${key} even after attempting fixes`);
        }
      } else if (typeof value === 'object' && value !== null) {
        // If it's already an object, merge it directly
        Object.assign(parsedData, value);
      }
      // Skip adding .json fields to the flattened output
    } else if (Array.isArray(value)) {
      // Arrays get joined with commas
      flattened[key] = value.join(', ');
    } else if (typeof value === 'object' && value !== null) {
      // Handle non-.json objects by flattening them with the key as prefix
      flattenObject(value, key, flattened);
    } else if (value !== null && value !== undefined) {
      // Direct values
      flattened[key] = String(value);
    }
  }

  // Helper function to flatten nested objects
  function flattenObject(obj: any, prefix: string, target: Record<string, string>) {
    for (const k in obj) {
      const v = obj[k];
      const newKey = `${prefix}_${k}`;

      if (v === null || v === undefined) {
        target[newKey] = '';
      } else if (Array.isArray(v)) {
        target[newKey] = v.join(', ');
      } else if (typeof v === 'object') {
        flattenObject(v, newKey, target);
      } else {
        target[newKey] = String(v);
      }
    }
  }

  // Now flatten the parsed JSON data
  function flatten(obj: any, prefix = '') {
    for (const key in obj) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}_${key}` : key;

      if (value === null || value === undefined) {
        flattened[newKey] = '';
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle nested objects like { cluster_id: "...", value: "..." }
        if ('value' in value) {
          flattened[newKey] = String(value.value);
          if ('cluster_id' in value) {
            flattened[`${newKey}_cluster_id`] = String(value.cluster_id);
          }
        } else {
          flatten(value, newKey);
        }
      } else if (Array.isArray(value)) {
        flattened[newKey] = value.join(', ');
      } else {
        flattened[newKey] = String(value);
      }
    }
  }

  flatten(parsedData);

  return flattened;
}

function robustJsonParse(value: string): any | null {
  const attempts = buildJsonVariants(value);
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      continue;
    }
  }
  return null;
}

function buildJsonVariants(rawValue: string): string[] {
  const variants = new Set<string>();
  const queue: string[] = [];

  const enqueue = (str?: string | null) => {
    if (!str) return;
    const trimmed = str.trim();
    if (!trimmed) return;
    if (!variants.has(trimmed)) {
      variants.add(trimmed);
      queue.push(trimmed);
    }
  };

  enqueue(rawValue);

  const transformers: Array<(input: string) => string> = [
    (input) => input.replace(/'/g, '"'),
    fixUnquotedKeys,
    stripTrailingCommas,
    removeControlCharacters,
  ];

  while (queue.length > 0) {
    const variant = queue.shift()!;
    for (const transform of transformers) {
      enqueue(transform(variant));
    }
  }

  return Array.from(variants);
}

const fixUnquotedKeys = (input: string): string => {
  return input.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
};

const stripTrailingCommas = (input: string): string => {
  return input.replace(/,(\s*[}\]])/g, '$1');
};

const removeControlCharacters = (input: string): string => {
  return input.replace(/[\u0000-\u001f]/g, '');
};

/**
 * Extract demographics from profile data
 */
export function extractDemographics(profile: any): Partial<EnrichedRow> {
  const demographics: Partial<EnrichedRow> = {};

  // Common demographic fields
  if (profile.age) demographics.age = String(profile.age);
  if (profile.gender) demographics.gender = String(profile.gender);
  if (profile.income) demographics.income = String(profile.income);
  if (profile.education) demographics.education = String(profile.education);

  // Handle nested demographics
  if (profile.demographics) {
    if (profile.demographics.age) demographics.age = String(profile.demographics.age);
    if (profile.demographics.gender) demographics.gender = String(profile.demographics.gender);
    if (profile.demographics.income) demographics.income = String(profile.demographics.income);
    if (profile.demographics.education) demographics.education = String(profile.demographics.education);
  }

  return demographics;
}

/**
 * Extract interests and clusters from profile data
 */
export function extractInterests(profile: any): Partial<EnrichedRow> {
  const interests: Partial<EnrichedRow> = {};

  // Extract clusters
  if (profile.clusters) {
    if (Array.isArray(profile.clusters)) {
      interests.clusters = profile.clusters.map((c: any) =>
        typeof c === 'string' ? c : c.cluster_name || c.name
      ).join(', ');
    } else if (typeof profile.clusters === 'string') {
      interests.clusters = profile.clusters;
    }
  }

  // Extract interests
  if (profile.interests) {
    if (Array.isArray(profile.interests)) {
      interests.interests = profile.interests.join(', ');
    } else if (typeof profile.interests === 'string') {
      interests.interests = profile.interests;
    }
  }

  return interests;
}

// ============================================
// ICP (Ideal Customer Profile) Analysis Types
// ============================================

export interface ICPAttribute {
  attribute: string;      // e.g., "gender=Female"
  attributeName: string;  // e.g., "gender" (original field name)
  attributeValue: string; // e.g., "Female"
  clusterName: string;    // Normalized name for WattData API (e.g., "gender" instead of "demographic_gender_value")
  count: number;
  percentage: number;
  selected: boolean;      // For UI state
  operator: 'AND' | 'OR'; // For UI state
}

export interface ICPAnalysisResult {
  topAttributes: ICPAttribute[];
  totalProfiles: number;
}

// Fields to exclude from ICP analysis (PII and identifiers)
const ICP_EXCLUDED_FIELDS = new Set([
  // Identifiers
  'person_id', 't0.person_id', 'personid',
  // Contact info
  'email', 'email1', 'email2', 'email3', 'email4',
  'phone', 'phone1', 'phone2', 'phone3', 'phone4',
  'address', 'address1', 'address2', 'street', 'city', 'state', 'zip', 'zipcode', 'postal_code',
  // Names
  'name', 'first_name', 'last_name', 'full_name', 'firstname', 'lastname',
  // Quality/metadata fields
  'overall_quality_score', 'quality_score', 'match_score',
  // Internal fields
  'enrichment_error', 'enrichment_status',
]);

// Field name patterns to exclude (regex patterns)
const ICP_EXCLUDED_PATTERNS = [
  /^email\d*$/i,
  /^phone\d*$/i,
  /^address\d*$/i,
  /^t\d+\./,  // t0., t1., etc. prefixes from raw MCP data
  /cluster_id$/i,  // cluster IDs are internal (but keep cluster values)
  /^_/,  // Fields starting with underscore
];

/**
 * Normalize field name for cluster lookup
 * Removes common suffixes added by flattening and converts to WattData cluster name format
 */
function normalizeClusterName(fieldName: string): string {
  let name = fieldName;

  // Remove common suffixes from flattened data
  const suffixesToRemove = ['_value', '_cluster_id', '_detail'];
  for (const suffix of suffixesToRemove) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
    }
  }

  // Remove domain prefixes (demographic_, interest_, etc.)
  const prefixesToRemove = ['demographic_', 'interest_', 'lifestyle_', 'financial_', 'employment_', 'household_', 'affinity_'];
  for (const prefix of prefixesToRemove) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
    }
  }

  return name;
}

/**
 * Check if a field should be excluded from ICP analysis
 */
function shouldExcludeField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();

  if (ICP_EXCLUDED_FIELDS.has(lowerField)) {
    return true;
  }

  for (const pattern of ICP_EXCLUDED_PATTERNS) {
    if (pattern.test(fieldName)) {
      return true;
    }
  }

  return false;
}

// Track logged fields to avoid spam
const loggedExcludedFields = new Set<string>();
const loggedIncludedFields = new Set<string>();

/**
 * Debug version - logs field exclusion reasons (first occurrence only)
 */
function shouldExcludeFieldDebug(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();

  if (ICP_EXCLUDED_FIELDS.has(lowerField)) {
    if (!loggedExcludedFields.has(fieldName)) {
      loggedExcludedFields.add(fieldName);
      console.log(`[ICP Debug] Excluding field "${fieldName}" - in excluded fields list`);
    }
    return true;
  }

  for (const pattern of ICP_EXCLUDED_PATTERNS) {
    if (pattern.test(fieldName)) {
      if (!loggedExcludedFields.has(fieldName)) {
        loggedExcludedFields.add(fieldName);
        console.log(`[ICP Debug] Excluding field "${fieldName}" - matches pattern ${pattern}`);
      }
      return true;
    }
  }

  if (!loggedIncludedFields.has(fieldName)) {
    loggedIncludedFields.add(fieldName);
    console.log(`[ICP Debug] Including field "${fieldName}"`);
  }

  return false;
}

/**
 * Check if a value is meaningful for ICP analysis
 */
function isMeaningfulValue(value: unknown): boolean {
  // Skip objects/arrays - they can't be used as categorical values
  if (value !== null && typeof value === 'object') return false;

  if (value === null || value === undefined) return false;

  // Convert to string for further checks
  const strValue = String(value);
  const trimmed = strValue.trim().toLowerCase();

  // Exclude empty, null-like, or generic values
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'n/a' || trimmed === 'na') {
    return false;
  }

  // Exclude [object Object] which indicates a failed string conversion
  if (trimmed === '[object object]') {
    return false;
  }

  // Exclude very long values (likely free text, not categorical)
  if (trimmed.length > 100) {
    return false;
  }

  return true;
}

/**
 * Analyze enriched profiles to extract ICP (Ideal Customer Profile) characteristics
 * Returns top attributes sorted by frequency with default selections
 */
export function analyzeICPFromProfiles(rows: EnrichedRow[]): ICPAnalysisResult {
  const totalProfiles = rows.length;

  console.log(`[ICP Analysis] Starting analysis of ${totalProfiles} profiles`);

  if (totalProfiles === 0) {
    return { topAttributes: [], totalProfiles: 0 };
  }

  // Log sample row to understand structure
  if (rows[0]) {
    const keys = Object.keys(rows[0]);
    console.log(`[ICP Analysis] Sample row has ${keys.length} fields`);
    console.log(`[ICP Analysis] Sample fields:`, keys.slice(0, 20).join(', '));
  }

  // Count attribute frequencies
  const attributeCounts = new Map<string, { name: string; value: string; count: number }>();
  let excludedFieldCount = 0;
  let excludedValueCount = 0;
  let includedCount = 0;

  for (const row of rows) {
    for (const [fieldName, fieldValue] of Object.entries(row)) {
      // Skip excluded fields (using debug version for logging)
      if (shouldExcludeFieldDebug(fieldName)) {
        excludedFieldCount++;
        continue;
      }

      // Skip non-meaningful values
      if (!isMeaningfulValue(fieldValue)) {
        excludedValueCount++;
        continue;
      }

      includedCount++;
      const value = String(fieldValue).trim();
      const attributeKey = `${fieldName}=${value}`;

      const existing = attributeCounts.get(attributeKey);
      if (existing) {
        existing.count++;
      } else {
        attributeCounts.set(attributeKey, {
          name: fieldName,
          value: value,
          count: 1,
        });
      }
    }
  }

  console.log(`[ICP Analysis] Excluded ${excludedFieldCount} field instances, ${excludedValueCount} value instances`);
  console.log(`[ICP Analysis] Included ${includedCount} attribute instances`);
  console.log(`[ICP Analysis] Found ${attributeCounts.size} unique attribute-value pairs`);

  // Convert to array and sort by frequency (descending)
  const allAttributes = Array.from(attributeCounts.entries())
    .map(([key, data]) => ({
      attribute: key,
      attributeName: data.name,
      attributeValue: data.value,
      clusterName: normalizeClusterName(data.name), // Normalized for WattData API
      count: data.count,
      percentage: (data.count / totalProfiles) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  console.log(`[ICP Analysis] Top 5 attributes before threshold filter:`);
  allAttributes.slice(0, 5).forEach(attr => {
    console.log(`  - ${attr.attribute}: ${attr.count} (${attr.percentage.toFixed(1)}%)`);
  });

  // Filter by minimum percentage (lowered to 5% for better results)
  const MIN_PERCENTAGE = 5;
  const sortedAttributes = allAttributes.filter(attr => attr.percentage >= MIN_PERCENTAGE);

  console.log(`[ICP Analysis] ${sortedAttributes.length} attributes above ${MIN_PERCENTAGE}% threshold`);

  // Separate positive and negative attributes
  // Positive = true values or non-boolean values
  // Negative = false values
  const positiveAttributes = sortedAttributes.filter(attr =>
    attr.attributeValue.toLowerCase() !== 'false'
  );
  const negativeAttributes = sortedAttributes.filter(attr =>
    attr.attributeValue.toLowerCase() === 'false'
  );

  console.log(`[ICP Analysis] ${positiveAttributes.length} positive attributes, ${negativeAttributes.length} negative attributes`);

  // Take a balanced mix: prioritize positive attributes but include negative too
  // Target: up to 20 positive + up to 15 negative = max 35 total
  const MAX_POSITIVE = 20;
  const MAX_NEGATIVE = 15;
  const MAX_TOTAL = 35;

  const selectedPositive = positiveAttributes.slice(0, MAX_POSITIVE);
  const selectedNegative = negativeAttributes.slice(0, MAX_NEGATIVE);

  // Combine and sort by percentage (so most common appear first regardless of positive/negative)
  const combinedAttributes = [...selectedPositive, ...selectedNegative]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, MAX_TOTAL);

  // Set default selections: select top 5 positive attributes by default
  const topPositiveNames = new Set(
    positiveAttributes.slice(0, 5).map(a => a.attribute)
  );

  const topAttributes: ICPAttribute[] = combinedAttributes.map((attr) => ({
    ...attr,
    selected: topPositiveNames.has(attr.attribute), // Select top 5 positive by default
    operator: 'AND' as const,
  }));

  console.log(`[ICP Analysis] Returning ${topAttributes.length} attributes (${selectedPositive.length} positive, ${selectedNegative.length} negative)`);

  return {
    topAttributes,
    totalProfiles,
  };
}

/**
 * Build a boolean expression from selected ICP attributes and cluster mappings
 * Respects user's AND/OR operator choices for each attribute
 *
 * clusterMap should be keyed by "clusterName=value" format (e.g., "gender=Female")
 */
export function buildClusterExpression(
  selectedAttributes: ICPAttribute[],
  clusterMap: Map<string, string> // "clusterName=value" -> cluster_id
): string {
  const validAttributes = selectedAttributes.filter(attr => {
    // Use normalized clusterName with value for lookup
    const lookupKey = `${attr.clusterName}=${attr.attributeValue}`;
    const clusterId = clusterMap.get(lookupKey);
    console.log(`[buildClusterExpression] Looking up: "${lookupKey}" -> ${clusterId || 'NOT FOUND'}`);
    return clusterId !== undefined;
  });

  if (validAttributes.length === 0) {
    console.log(`[buildClusterExpression] No valid attributes found in clusterMap`);
    return '';
  }

  const parts: string[] = [];

  for (let i = 0; i < validAttributes.length; i++) {
    const attr = validAttributes[i];
    const lookupKey = `${attr.clusterName}=${attr.attributeValue}`;
    const clusterId = clusterMap.get(lookupKey)!;

    if (i > 0) {
      // Use the operator from the previous attribute
      parts.push(validAttributes[i - 1].operator);
    }
    parts.push(clusterId);
  }

  console.log(`[buildClusterExpression] Built expression: ${parts.join(' ')}`);
  return parts.join(' ');
}
