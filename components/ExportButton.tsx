'use client';

import Papa from 'papaparse';

import { exportToCSV, EnrichedRow, flattenProfileData } from '@/lib/csv-processor';

interface ExportButtonProps {
  data: EnrichedRow[] | null;
  filename?: string;
  downloadUrl?: string;
}

export default function ExportButton({ data, filename = 'enriched-data.csv', downloadUrl }: ExportButtonProps) {
  console.log('ExportButton: data is', data ? `${data.length} rows` : 'null');

  const hasLocalData = Array.isArray(data) && data.length > 0;
  const hasDownloadUrl = Boolean(downloadUrl);
  const canDownloadRemote = hasDownloadUrl;
  const hasData = hasLocalData || hasDownloadUrl;
  const buttonLabel = canDownloadRemote ? 'Download Export' : 'Export CSV';

  const handleExport = async () => {
    try {
      if (downloadUrl) {
        const remoteRows = await fetchRemoteRows(downloadUrl);
        if (!remoteRows.length) {
          alert('The export file did not contain any profiles to convert.');
          return;
        }

        const orderedRows = hasLocalData ? reorderRows(remoteRows, data!) : remoteRows;
        exportToCSV(orderedRows, filename);
        return;
      }

      if (hasLocalData) {
        console.log('ExportButton: No remote export link, using in-memory rows');
        exportToCSV(data!, filename);
        return;
      }

      alert('No data to export');
    } catch (error) {
      console.error('ExportButton: Failed to download export link', error);
      alert('Failed to download export. Please try again.');
    }
  };

  const fetchRemoteRows = async (url: string): Promise<EnrichedRow[]> => {
    const response = await fetch(`/api/proxy-download?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') || url.toLowerCase().endsWith('.json')) {
      const exportJson = await response.json();
      return extractRowsFromExportJson(exportJson);
    }

    const csvText = await response.text();
    return extractRowsFromCsvText(csvText);
  };

  const extractRowsFromExportJson = (exportJson: unknown): EnrichedRow[] => {
    const profilesArray = Array.isArray(exportJson)
      ? exportJson
      : Array.isArray((exportJson as { profiles?: unknown[] })?.profiles)
        ? (exportJson as { profiles?: unknown[] }).profiles ?? []
        : [];

    const rows: EnrichedRow[] = [];
    for (const entry of profilesArray) {
      const record = (entry as { domains?: Record<string, unknown> }) ?? {};
      const domains = (record.domains ?? record) as Record<string, unknown>;
      const flattened = flattenProfileData(domains);
      const personIdValue = domains['t0.person_id'];
      if (!flattened.person_id && typeof personIdValue === 'string') {
        flattened.person_id = personIdValue.trim();
      }
      rows.push(flattened);
    }
    return rows;
  };

  const extractRowsFromCsvText = (csvText: string): EnrichedRow[] => {
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const csvRows = Array.isArray(parsed.data) ? parsed.data : [];
    return csvRows
      .filter(row => row && Object.values(row).some(value => typeof value === 'string' && value.trim().length > 0))
      .map(row => ensurePersonId({ ...row }));
  };

  const ensurePersonId = (row: EnrichedRow): EnrichedRow => {
    if (!row.person_id) {
      const fallbackId = getPersonId(row);
      if (fallbackId) {
        row.person_id = fallbackId;
      }
    }
    return row;
  };

  const getPersonId = (row: EnrichedRow): string | undefined => {
    const candidates = ['person_id', 't0.person_id', 't0.personid', 'personid', 'id'];
    for (const key of candidates) {
      const value = row[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  };

  const reorderRows = (remoteRows: EnrichedRow[], referenceRows: EnrichedRow[]): EnrichedRow[] => {
    if (!referenceRows.length) {
      return remoteRows;
    }

    const normalizedRemoteRows = remoteRows.map(row => ensurePersonId({ ...row }));
    const personIdMap = new Map<string, EnrichedRow>();
    const emailMap = new Map<string, EnrichedRow>();
    const phoneMap = new Map<string, EnrichedRow>();
    const usedRows = new Set<EnrichedRow>();

    for (const row of normalizedRemoteRows) {
      const personId = getPersonId(row);
      if (personId && !personIdMap.has(personId)) {
        personIdMap.set(personId, row);
      }
      for (const email of collectNormalizedValues(row, ['email', 'Email', 'email1', 'email2', 'email3'], 'email')) {
        if (!emailMap.has(email)) {
          emailMap.set(email, row);
        }
      }
      for (const phone of collectNormalizedValues(row, ['phone', 'Phone', 'phone1', 'phone2', 'phone3'], 'phone')) {
        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, row);
        }
      }
    }

    const orderedRows: EnrichedRow[] = [];

    const takeRow = (map: Map<string, EnrichedRow>, key: string | undefined) => {
      if (!key) return undefined;
      const row = map.get(key);
      if (!row) {
        return undefined;
      }
      map.delete(key);
      if (usedRows.has(row)) {
        return undefined;
      }
      usedRows.add(row);
      return row;
    };

    for (const referenceRow of referenceRows) {
      let match = takeRow(personIdMap, getPersonId(referenceRow));

      if (!match) {
        for (const email of collectNormalizedValues(referenceRow, ['email', 'Email', 'email1', 'email2', 'email3'], 'email')) {
          match = takeRow(emailMap, email);
          if (match) break;
        }
      }

      if (!match) {
        for (const phone of collectNormalizedValues(referenceRow, ['phone', 'Phone', 'phone1', 'phone2', 'phone3'], 'phone')) {
          match = takeRow(phoneMap, phone);
          if (match) break;
        }
      }

      if (match) {
        orderedRows.push(mergeRows(referenceRow, match));
      } else {
        orderedRows.push(referenceRow);
      }
    }

    for (const row of normalizedRemoteRows) {
      if (!usedRows.has(row)) {
        orderedRows.push(row);
      }
    }

    return orderedRows;
  };

  const collectNormalizedValues = (row: EnrichedRow, fields: string[], type: 'email' | 'phone'): string[] => {
    const values: string[] = [];
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== 'string') continue;
      const normalized = normalizeContactValue(value, type);
      if (normalized && !values.includes(normalized)) {
        values.push(normalized);
      }
    }
    return values;
  };

  const normalizeContactValue = (value: string, type: 'email' | 'phone'): string => {
    if (!value) return '';
    let normalized = value.trim().toLowerCase();
    if (type === 'phone') {
      let digits = normalized.replace(/[^0-9]/g, '');
      if (digits.length === 11 && digits.startsWith('1')) {
        digits = digits.slice(1);
      }
      normalized = digits;
    }
    return normalized;
  };

  const mergeRows = (referenceRow: EnrichedRow, enrichedRow: EnrichedRow): EnrichedRow => {
    const merged: EnrichedRow = { ...referenceRow };
    const alwaysOverwrite = new Set(['person_id', 'overall_quality_score']);

    for (const [key, value] of Object.entries(enrichedRow)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value;
        continue;
      }

      const current = merged[key];
      const isEmptyCurrent = current === undefined || current === null || current === '';

      if (alwaysOverwrite.has(key) || isEmptyCurrent) {
        merged[key] = value;
      }
    }

    return merged;
  };

  return (
    <button
      onClick={handleExport}
      disabled={!hasData}
      className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        hasData
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
      }`}
    >
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <span>{buttonLabel}</span>
      {canDownloadRemote && (
        <span className="text-xs opacity-80">({data!.length} rows)</span>
      )}
      {!canDownloadRemote && hasLocalData && (
        <span className="text-xs opacity-80">({data!.length} rows)</span>
      )}
    </button>
  );
}
