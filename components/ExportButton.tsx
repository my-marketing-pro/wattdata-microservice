'use client';

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
  const canDownloadRemote = hasDownloadUrl && !hasLocalData;
  const hasData = hasLocalData || hasDownloadUrl;
  const buttonLabel = canDownloadRemote ? 'Download Export' : 'Export CSV';

  const handleExport = async () => {
    try {
      // When we already have enriched rows in memory, exporting them preserves
      // the original CSV ordering (unlike the remote export).
      if (hasLocalData) {
        console.log('ExportButton: Using in-memory enriched rows for export');
        console.log('ExportButton: Exporting', data!.length, 'rows');
        console.log('ExportButton: First row sample:', JSON.stringify(data![0]).substring(0, 300));
        exportToCSV(data!, filename);
        return;
      }

      if (downloadUrl) {
        const response = await fetch(`/api/proxy-download?url=${encodeURIComponent(downloadUrl)}`);
        if (!response.ok) {
          throw new Error(`Download failed with status ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json') || downloadUrl.toLowerCase().endsWith('.json')) {
          const exportJson = await response.json();
          const rows = extractRowsFromExportJson(exportJson);
          if (!rows.length) {
            alert('The export file did not contain any profiles to convert.');
            return;
          }
          exportToCSV(rows, filename);
        } else {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.click();
          URL.revokeObjectURL(url);
        }
        return;
      }

      alert('No data to export');
    } catch (error) {
      console.error('ExportButton: Failed to download export link', error);
      alert('Failed to download export. Please try again.');
    }
  };

  const extractRowsFromExportJson = (exportJson: any): EnrichedRow[] => {
    const profilesArray = Array.isArray(exportJson)
      ? exportJson
      : Array.isArray(exportJson?.profiles)
        ? exportJson.profiles
        : [];

    const rows: EnrichedRow[] = [];
    for (const entry of profilesArray) {
      const domains = entry?.domains || entry;
      if (!domains) continue;
      const flattened = flattenProfileData(domains);
      if (!flattened.person_id && domains['t0.person_id']) {
        flattened.person_id = String(domains['t0.person_id']);
      }
      rows.push(flattened);
    }
    return rows;
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
        <span className="text-xs opacity-80">(download)</span>
      )}
      {!canDownloadRemote && hasLocalData && (
        <span className="text-xs opacity-80">({data!.length} rows)</span>
      )}
    </button>
  );
}
