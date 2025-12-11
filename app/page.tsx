'use client';

import { useState, useEffect } from 'react';
import ChatInterface, { WorkflowMode } from '@/components/ChatInterface';
import FileUpload from '@/components/FileUpload';
import ExportButton from '@/components/ExportButton';
import ICPCharacteristicSelector from '@/components/ICPCharacteristicSelector';
import { ParsedCSV, EnrichedRow, ICPAttribute, ICPAnalysisResult } from '@/lib/csv-processor';

/**
 * Formats an attribute name and value into a human-friendly label.
 */
function formatAttributeLabel(name: string, value: string): string {
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

  // Pattern matching
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

  // Default
  const formatted = formatWords(remainingParts);
  return isBoolean ? (isFalse ? `No ${formatted.toLowerCase()}` : formatted) : `${formatted}: ${value}`;
}

export default function Home() {
  const [uploadedData, setUploadedData] = useState<ParsedCSV | null>(null);
  const [enrichedData, setEnrichedData] = useState<EnrichedRow[] | null>(null);
  const [exportLinks, setExportLinks] = useState<string[]>([]);

  // Workflow mode state
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('enrich');
  const [icpAnalysis, setIcpAnalysis] = useState<ICPAnalysisResult | null>(null);
  const [icpStep, setIcpStep] = useState<'analyzing' | 'selecting' | 'searching' | 'complete' | null>(null);
  const [similarContacts, setSimilarContacts] = useState<EnrichedRow[] | null>(null);
  const [localIcpAttributes, setLocalIcpAttributes] = useState<ICPAttribute[]>([]);

  // Sync local ICP attributes when icpAnalysis changes
  useEffect(() => {
    if (icpAnalysis?.topAttributes) {
      setLocalIcpAttributes(icpAnalysis.topAttributes);
    }
  }, [icpAnalysis]);

  const handleFileUploaded = (data: ParsedCSV) => {
    setUploadedData(data);
    setEnrichedData(null);
    setExportLinks([]);
    // Reset ICP state when new file uploaded
    setIcpAnalysis(null);
    setIcpStep(null);
    setSimilarContacts(null);
    setLocalIcpAttributes([]);
  };

  const handleWorkflowModeChange = (mode: WorkflowMode) => {
    setWorkflowMode(mode);
    // Reset ICP state when switching modes
    if (mode === 'enrich') {
      setIcpAnalysis(null);
      setIcpStep(null);
      setSimilarContacts(null);
      setLocalIcpAttributes([]);
    }
  };

  const handleDataEnriched = ({
    rows,
    exportLinks = [],
    icpAnalysis: newIcpAnalysis,
  }: {
    rows: EnrichedRow[];
    exportLinks?: string[];
    resolvedCount?: number;
    enrichedCount?: number;
    icpAnalysis?: ICPAnalysisResult;
  }) => {
    setEnrichedData(rows.length > 0 ? rows : null);
    setExportLinks(exportLinks);

    // Handle ICP analysis for find-similar workflow
    if (newIcpAnalysis && workflowMode === 'find-similar') {
      setIcpAnalysis(newIcpAnalysis);
      setIcpStep('selecting');
    }
  };

  const handleSearchSimilar = async (selectedAttributes: ICPAttribute[]) => {
    setIcpStep('searching');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          uploadedData: uploadedData ? { ...uploadedData, rows: enrichedData || uploadedData.rows } : null,
          workflowMode: 'find-similar',
          icpSearchParams: { selectedAttributes },
        }),
      });

      const data = await response.json();

      if (data.similarContacts) {
        setSimilarContacts(data.similarContacts);
        setExportLinks(data.exportLinks || []);
      }
      setIcpStep('complete');
    } catch (error) {
      console.error('Page: Error searching for similar contacts:', error);
      setIcpStep('selecting'); // Go back to selecting on error
    }
  };

  // Estimate audience size for selected attributes (called by ICPCharacteristicSelector)
  const handleEstimateAudience = async (selectedAttributes: ICPAttribute[]): Promise<number | null> => {
    if (selectedAttributes.length === 0) return null;

    try {
      const response = await fetch('/api/estimate-audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAttributes }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.estimate || null;
    } catch (error) {
      console.error('Error estimating audience:', error);
      return null;
    }
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Always 4-column grid with persistent right sidebar */}
          <div className="grid grid-cols-1 gap-6 h-full lg:grid-cols-4">
          {/* Left Sidebar - File Upload & Data Preview */}
          <div className="lg:col-span-1 flex flex-col gap-4 h-full min-h-0">
            {/* File Upload Card */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-5 flex-shrink-0">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-800">Upload CSV</h2>
              </div>
              <FileUpload onFileUploaded={handleFileUploaded} />
            </div>

            {/* Data Preview Card */}
            {uploadedData && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-5 flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-gray-800">Data Preview</h2>
                </div>

                <div className="space-y-3 flex-1 min-h-0">
                      {/* Stats Row */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-3 rounded-xl border border-blue-100">
                          <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">Total Rows</p>
                          <p className="text-2xl font-bold text-blue-900">{uploadedData.rows.length}</p>
                        </div>
                        <div className="bg-gradient-to-br from-emerald-50 to-green-50 p-3 rounded-xl border border-emerald-100">
                          <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Fields</p>
                          <p className="text-2xl font-bold text-emerald-900">{uploadedData.headers.length}</p>
                        </div>
                      </div>

                      {/* Detected Fields */}
                      <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-100">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Detected Identifiers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {uploadedData.detectedFields.emails && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              Emails
                            </span>
                          )}
                          {uploadedData.detectedFields.phones && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              Phones
                            </span>
                          )}
                          {uploadedData.detectedFields.addresses && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              Addresses
                            </span>
                          )}
                          {uploadedData.detectedFields.personIds && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              Person IDs
                            </span>
                          )}
                          {!uploadedData.detectedFields.emails && !uploadedData.detectedFields.phones && !uploadedData.detectedFields.addresses && !uploadedData.detectedFields.personIds && (
                            <span className="text-xs text-gray-400">No identifiers detected</span>
                          )}
                        </div>
                      </div>

                      {/* Data Table */}
                      <div className="flex flex-col min-h-0 flex-1">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Sample Data</p>
                        <div className="bg-white rounded-xl border border-gray-200 text-xs overflow-auto flex-1 max-h-40">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                {uploadedData.headers.slice(0, 5).map((header, idx) => (
                                  <th key={idx} className="text-left px-3 py-2 text-gray-600 font-semibold whitespace-nowrap">
                                    {header}
                                  </th>
                                ))}
                                {uploadedData.headers.length > 5 && (
                                  <th className="px-3 py-2 text-gray-400 font-medium">+{uploadedData.headers.length - 5} more</th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {uploadedData.rows.slice(0, 5).map((row, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  {uploadedData.headers.slice(0, 5).map((header, hidx) => (
                                    <td key={hidx} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[120px] truncate">
                                      {row[header]}
                                    </td>
                                  ))}
                                  {uploadedData.headers.length > 5 && (
                                    <td className="px-3 py-2 text-gray-400">...</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                </div>
              </div>
            )}
          </div>

          {/* Center - Chat Interface */}
          <div className="lg:col-span-2 min-h-0">
            <ChatInterface
              uploadedData={uploadedData}
              enrichedData={enrichedData}
              workflowMode={workflowMode}
              onWorkflowModeChange={handleWorkflowModeChange}
              onDataEnriched={handleDataEnriched}
              icpAnalysis={icpAnalysis}
              icpStep={icpStep}
            />
          </div>

          {/* Right Sidebar - Always visible with contextual content */}
          <div className="lg:col-span-1 flex flex-col h-full min-h-0">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-5 flex flex-col h-full min-h-0">
              {/* Enrich Data Mode */}
              {workflowMode === 'enrich' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-800">Enrichment</h2>
                  </div>

                  {!uploadedData && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                      <div className="p-4 bg-gray-100 rounded-2xl mb-4">
                        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-700">Upload a CSV to get started</p>
                      <p className="text-xs mt-2 text-gray-400 max-w-[200px]">We&apos;ll match your contacts with demographic, interest, and lifestyle data</p>
                    </div>
                  )}

                  {uploadedData && !enrichedData && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                      <div className="p-4 bg-blue-100 rounded-2xl mb-4">
                        <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">Ready to Enrich</p>
                      <p className="text-xs mt-2 text-gray-500">{uploadedData.rows.length} contacts loaded</p>
                      <p className="text-xs mt-1 text-gray-400">Use the chat to start enrichment</p>
                    </div>
                  )}

                  {enrichedData && (
                    <div className="flex-1 flex flex-col">
                      <div className="space-y-3 flex-1">
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-xl border border-green-200">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="p-1.5 bg-green-500 rounded-full">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <span className="font-bold text-green-800">Enrichment Complete</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white/60 rounded-lg p-2 text-center">
                              <p className="text-2xl font-bold text-green-700">{enrichedData.length}</p>
                              <p className="text-xs text-green-600">Total</p>
                            </div>
                            <div className="bg-white/60 rounded-lg p-2 text-center">
                              <p className="text-2xl font-bold text-green-700">{enrichedData.filter(r => Object.keys(r).length > 5).length}</p>
                              <p className="text-xs text-green-600">Matched</p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-200">
                          <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">Data Categories</p>
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">Demographics</span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">Financial</span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">Interests</span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">Lifestyle</span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">Household</span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md">More...</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <ExportButton
                          data={enrichedData}
                          filename="enriched-data.csv"
                          downloadUrl={exportLinks?.[0]}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Find Similar Contacts Mode */}
              {workflowMode === 'find-similar' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4 flex-shrink-0">
                    <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-800">Find Similar</h2>
                  </div>

                  {!uploadedData && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                      <div className="p-4 bg-purple-100 rounded-2xl mb-4">
                        <svg className="w-12 h-12 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-700">Upload your customer list</p>
                      <p className="text-xs mt-2 text-gray-400 max-w-[200px]">We&apos;ll analyze their profiles and find lookalike audiences</p>
                    </div>
                  )}

                  {uploadedData && !icpStep && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                      <div className="p-4 bg-purple-100 rounded-2xl mb-4">
                        <svg className="w-12 h-12 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">Ready to Analyze</p>
                      <p className="text-xs mt-2 text-gray-500">{uploadedData.rows.length} contacts loaded</p>
                      <p className="text-xs mt-1 text-gray-400">Use the chat to find similar contacts</p>
                    </div>
                  )}

                  {icpStep === 'analyzing' && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                      <div className="relative">
                        <div className="p-4 bg-purple-100 rounded-2xl">
                          <svg className="w-12 h-12 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 rounded-full animate-ping"></div>
                      </div>
                      <p className="text-sm font-semibold text-purple-700 mt-4">Analyzing Profiles...</p>
                      <p className="text-xs mt-2 text-gray-500">Enriching contacts and identifying patterns</p>
                    </div>
                  )}

                  {(icpStep === 'selecting' || icpStep === 'searching') && localIcpAttributes.length > 0 && (
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <div className="flex-1 min-h-0">
                        <ICPCharacteristicSelector
                          attributes={localIcpAttributes}
                          onAttributesChange={setLocalIcpAttributes}
                          onSearch={handleSearchSimilar}
                          isSearching={icpStep === 'searching'}
                          onEstimateAudience={handleEstimateAudience}
                        />
                      </div>
                    </div>
                  )}

                  {icpStep === 'complete' && similarContacts && (
                    <div className="flex-1 flex flex-col">
                      <div className="space-y-3 flex-1">
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-xl border border-green-200">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="p-1.5 bg-green-500 rounded-full">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <span className="font-bold text-green-800">Search Complete</span>
                          </div>
                          <p className="text-2xl font-bold text-green-700">{similarContacts.length}</p>
                          <p className="text-xs text-green-600">Sample contacts found</p>
                        </div>

                        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 p-4 rounded-xl border border-purple-200">
                          <p className="text-xs font-bold text-purple-800 uppercase tracking-wide mb-2">Selected Criteria</p>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {localIcpAttributes.filter(a => a.selected).map((attr, idx) => (
                              <span key={idx} className="px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-xs">
                                {formatAttributeLabel(attr.attributeName, attr.attributeValue)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                        <ExportButton
                          data={similarContacts}
                          filename="similar-contacts.csv"
                          downloadUrl={exportLinks?.[0]}
                        />
                        <button
                          onClick={() => setIcpStep('selecting')}
                          className="w-full py-2.5 text-sm font-medium text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                          </svg>
                          Modify Criteria
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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
