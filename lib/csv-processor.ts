import Papa from 'papaparse';

export interface CSVRow {
  [key: string]: string;
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
  const csv = Papa.unparse(data);
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

    // If it's a .json field, try to parse it
    if (key.endsWith('.json') && typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        // Merge parsed data into parsedData
        Object.assign(parsedData, parsed);
      } catch (e) {
        // If parsing fails, just store as string
        flattened[key] = value;
      }
    } else if (Array.isArray(value)) {
      // Arrays get joined with commas
      flattened[key] = value.join(', ');
    } else if (value !== null && value !== undefined) {
      // Direct values
      flattened[key] = String(value);
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
