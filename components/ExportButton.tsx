'use client';

import { exportToCSV, EnrichedRow } from '@/lib/csv-processor';

interface ExportButtonProps {
  data: EnrichedRow[] | null;
  filename?: string;
}

export default function ExportButton({ data, filename = 'enriched-data.csv' }: ExportButtonProps) {
  console.log('ExportButton: data is', data ? `${data.length} rows` : 'null');

  const handleExport = () => {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    console.log('ExportButton: Exporting', data.length, 'rows');
    console.log('ExportButton: First row sample:', JSON.stringify(data[0]).substring(0, 300));
    exportToCSV(data, filename);
  };

  const hasData = data && data.length > 0;

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
      <span>Export CSV</span>
      {hasData && (
        <span className="text-xs opacity-80">({data.length} rows)</span>
      )}
    </button>
  );
}
