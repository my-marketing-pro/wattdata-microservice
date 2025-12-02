'use client';

import { useState } from 'react';
import ChatInterface from '@/components/ChatInterface';
import FileUpload from '@/components/FileUpload';
import ExportButton from '@/components/ExportButton';
import { ParsedCSV, EnrichedRow } from '@/lib/csv-processor';

export default function Home() {
  const [uploadedData, setUploadedData] = useState<ParsedCSV | null>(null);
  const [enrichedData, setEnrichedData] = useState<EnrichedRow[] | null>(null);
  const [exportLinks, setExportLinks] = useState<string[]>([]);
  const [showDataPreview, setShowDataPreview] = useState(false);

  const handleFileUploaded = (data: ParsedCSV) => {
    setUploadedData(data);
    setEnrichedData(null);
    setExportLinks([]);
    setShowDataPreview(true);
  };

  const handleDataEnriched = ({ rows, exportLinks = [] }: { rows: EnrichedRow[]; exportLinks?: string[]; resolvedCount?: number; enrichedCount?: number }) => {
    console.log('Page: Setting enriched data with', rows.length, 'rows');
    if (rows[0]) {
      console.log('Page: First row sample:', JSON.stringify(rows[0]).substring(0, 200));
    }
    console.log('Page: Previous export links:', exportLinks);
    setEnrichedData(rows.length > 0 ? rows : null);
    setExportLinks(exportLinks);
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Watt Data MCP Assistant</h1>
              <p className="text-sm text-gray-600">AI-powered data enrichment with Watt Data</p>
            </div>
            <ExportButton data={enrichedData} downloadUrl={exportLinks[0]} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          {/* Left Sidebar - File Upload & Data Preview */}
          <div className="lg:col-span-1 flex flex-col gap-4 overflow-y-auto">
            {/* File Upload */}
            <div className="bg-white rounded-lg shadow-lg p-6 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Upload CSV</h2>
              <FileUpload onFileUploaded={handleFileUploaded} />
            </div>

            {/* Data Preview */}
            {uploadedData && (
              <div className="bg-white rounded-lg shadow-lg p-6 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">Data Preview</h2>
                  <button
                    onClick={() => setShowDataPreview(!showDataPreview)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {showDataPreview ? 'Hide' : 'Show'}
                  </button>
                </div>

                {showDataPreview && (
                  <div className="space-y-3">
                      <div className="bg-blue-50 p-3 rounded">
                        <p className="text-sm font-medium text-blue-800">Total Rows:</p>
                        <p className="text-lg font-bold text-blue-900">{uploadedData.rows.length}</p>
                      </div>

                      <div className="bg-green-50 p-3 rounded">
                        <p className="text-sm font-medium text-green-800 mb-2">Detected Fields:</p>
                        <div className="space-y-1">
                          {uploadedData.detectedFields.emails && (
                            <p className="text-xs text-green-700">✓ Emails: {uploadedData.detectedFields.emails}</p>
                          )}
                          {uploadedData.detectedFields.phones && (
                            <p className="text-xs text-green-700">✓ Phones: {uploadedData.detectedFields.phones}</p>
                          )}
                          {uploadedData.detectedFields.addresses && (
                            <p className="text-xs text-green-700">✓ Addresses: {uploadedData.detectedFields.addresses}</p>
                          )}
                          {uploadedData.detectedFields.personIds && (
                            <p className="text-xs text-green-700">✓ Person IDs: {uploadedData.detectedFields.personIds}</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Uploaded Data Preview:</p>
                        <div className="bg-gray-50 p-2 rounded text-xs overflow-auto max-h-64">
                          <table className="min-w-full">
                            <thead>
                              <tr>
                                {uploadedData.headers.map((header, idx) => (
                                  <th key={idx} className="text-left px-2 py-1 text-gray-600 font-medium">
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {uploadedData.rows.map((row, idx) => (
                                <tr key={idx} className="border-t border-gray-200">
                                  {uploadedData.headers.map((header, hidx) => (
                                    <td key={hidx} className="px-2 py-1 text-gray-800">
                                      {row[header]}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {enrichedData && (
                        <div className="bg-purple-50 p-3 rounded">
                          <p className="text-sm font-medium text-purple-800">Enrichment Status:</p>
                          <p className="text-lg font-bold text-purple-900">✓ Complete</p>
                          <p className="text-xs text-purple-700">{enrichedData.length} rows enriched</p>
                        </div>
                      )}
                    </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side - Chat Interface */}
          <div className="lg:col-span-2 min-h-0">
            <ChatInterface
              uploadedData={uploadedData}
              enrichedData={enrichedData}
              onDataEnriched={handleDataEnriched}
            />
          </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <p className="text-center text-xs text-gray-500">
            Powered by Anthropic Claude & Watt Data MCP Server
          </p>
        </div>
      </footer>
    </div>
  );
}
