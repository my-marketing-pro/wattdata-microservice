'use client';

import { useState, useEffect, useRef } from 'react';
import { StoredMessage, getMessages, addMessage, clearCurrentSession } from '@/lib/chat-storage';
import { EnrichedRow, ICPAnalysisResult } from '@/lib/csv-processor';

export type WorkflowMode = 'enrich' | 'find-similar';

interface ChatInterfaceProps {
  uploadedData?: any;
  enrichedData?: EnrichedRow[] | null;
  workflowMode: WorkflowMode;
  onWorkflowModeChange: (mode: WorkflowMode) => void;
  onDataEnriched?: (result: { rows: EnrichedRow[]; exportLinks?: string[]; resolvedCount?: number; enrichedCount?: number; icpAnalysis?: ICPAnalysisResult }) => void;
  icpAnalysis?: ICPAnalysisResult | null; // kept for potential future use in chat display
  icpStep?: 'analyzing' | 'selecting' | 'searching' | 'complete' | null;
}

export default function ChatInterface({
  uploadedData,
  enrichedData,
  workflowMode,
  onWorkflowModeChange,
  onDataEnriched,
  icpStep,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const enrichSuggestionPrompts = [
    'Resolve all identifiers and enrich my CSV with full profiles.',
    'Enrich the first 10 rows with demographics and interests.',
    'Summarize key insights from the enriched data.',
    'Find missing person_ids and fill any gaps in the CSV.',
  ];

  const findSimilarSuggestionPrompts = [
    'Find contacts similar to my uploaded list.',
    'Build a lookalike audience from my customers.',
    'Discover new leads matching my customer profile.',
  ];

  const suggestionPrompts = workflowMode === 'enrich'
    ? enrichSuggestionPrompts
    : findSimilarSuggestionPrompts;

  // Load messages from localStorage on mount
  useEffect(() => {
    setMessages(getMessages());
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to UI and storage
    const userMsg = addMessage({
      role: 'user',
      content: userMessage,
    });
    setMessages(prev => [...prev, userMsg]);

    try {
      // Use enriched data if available, otherwise use uploaded data
      // When enriched data exists, we need to reconstruct the data structure
      let dataToSend = uploadedData;

      if (enrichedData && enrichedData.length > 0 && uploadedData) {
        // Use enriched data as the rows, but keep the original metadata
        dataToSend = {
          ...uploadedData,
          rows: enrichedData,
          // Update headers to include all enriched fields from the first row
          headers: Object.keys(enrichedData[0]),
        };
      }

      // Send to API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({
            role: m.role,
            content: m.content,
          })),
          uploadedData: dataToSend,
          workflowMode,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();

      // Add assistant message to UI and storage
      const assistantMsg = addMessage({
        role: 'assistant',
        content: data.response,
        toolCalls: data.toolCalls,
      });
      setMessages(prev => [...prev, assistantMsg]);

      // If there's enriched data, notify parent
      if (data.enrichedData) {
        onDataEnriched?.({
          rows: data.enrichedData,
          exportLinks: data.exportLinks || [],
          resolvedCount: data.resolvedCount,
          enrichedCount: data.enrichedCount,
          icpAnalysis: data.icpAnalysis,
        });
      } else if (data.similarContacts) {
        // Handle find-similar response
        onDataEnriched?.({
          rows: data.similarContacts,
          exportLinks: data.exportLinks || [],
        });
      } else if (data.exportLinks && data.exportLinks.length > 0) {
        onDataEnriched?.({ rows: [], exportLinks: data.exportLinks, resolvedCount: data.resolvedCount, enrichedCount: data.enrichedCount });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMsg = addMessage({
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      });
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = () => {
    clearCurrentSession();
    setMessages([]);
  };

  const handleCopyChat = () => {
    if (messages.length === 0) {
      alert('No messages to copy');
      return;
    }

    // Format the conversation as text
    const chatText = messages.map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      const timestamp = new Date(message.timestamp).toLocaleString();
      let text = `[${timestamp}] ${role}:\n${message.content}\n`;

      return text;
    }).join('\n---\n\n');

    // Copy to clipboard
    navigator.clipboard.writeText(chatText).then(() => {
      alert('Chat copied to clipboard!');
    }).catch((err) => {
      console.error('Failed to copy:', err);
      alert('Failed to copy chat to clipboard');
    });
  };

  return (
    <div className="h-full flex flex-col bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0 bg-gradient-to-r from-gray-50/80 to-white/80">
        <div className="flex items-center space-x-4">
          {/* Logo/Icon */}
          <div className={`p-2 rounded-xl bg-gradient-to-br ${
            workflowMode === 'enrich'
              ? 'from-blue-500 to-cyan-600'
              : 'from-purple-500 to-indigo-600'
          }`}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Watt Data Assistant</h2>
            <p className="text-xs text-gray-500">AI-powered data enrichment</p>
          </div>
        </div>

        {/* Workflow Mode Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100/80 rounded-xl p-1 shadow-inner">
            <button
              onClick={() => onWorkflowModeChange('enrich')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                workflowMode === 'enrich'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white shadow-md'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              disabled={isLoading}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Enrich
              </span>
            </button>
            <button
              onClick={() => onWorkflowModeChange('find-similar')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                workflowMode === 'find-similar'
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-md'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              disabled={isLoading}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Find Similar
              </span>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 border-l border-gray-200 pl-3">
            <button
              onClick={handleCopyChat}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Copy Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={handleClear}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Clear Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-scroll p-5 space-y-4 bg-gradient-to-b from-gray-50/50 to-white/50" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className={`p-4 rounded-2xl mb-4 bg-gradient-to-br ${
              workflowMode === 'enrich'
                ? 'from-blue-100 to-cyan-100'
                : 'from-purple-100 to-indigo-100'
            }`}>
              <svg className={`w-12 h-12 ${
                workflowMode === 'enrich' ? 'text-blue-500' : 'text-purple-500'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-1">Hi! I'm your Watt Data assistant</h3>
            <p className="text-sm text-gray-500 max-w-md">
              {workflowMode === 'enrich'
                ? 'Upload a CSV file and I\'ll help you enrich your contacts with demographic, interest, and lifestyle data.'
                : 'Upload your customer list and I\'ll help you find similar contacts and build lookalike audiences.'}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex items-end gap-2 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-600'
                  : 'bg-gradient-to-br from-gray-600 to-gray-700'
              }`}>
                {message.role === 'user' ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`rounded-2xl px-4 py-3 shadow-sm ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-br-md'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-bl-md'
                }`}
              >
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</div>
                <div className={`text-xs mt-2 ${
                  message.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                }`}>
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-end gap-2">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white/80">
        {/* Suggestion Prompts */}
        <div className={`px-5 py-3 border-b ${
          workflowMode === 'enrich'
            ? 'bg-gradient-to-r from-blue-50/80 to-cyan-50/80 border-blue-100'
            : 'bg-gradient-to-r from-purple-50/80 to-indigo-50/80 border-purple-100'
        }`}>
          <p className={`text-xs font-semibold mb-2 uppercase tracking-wide ${
            workflowMode === 'enrich' ? 'text-blue-600' : 'text-purple-600'
          }`}>
            Quick prompts
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestionPrompts.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border shadow-sm transition-all hover:shadow ${
                  workflowMode === 'enrich'
                    ? 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
                    : 'bg-white border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300'
                }`}
                disabled={isLoading || icpStep === 'selecting'}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Message Input */}
        <div className="p-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={
                  icpStep === 'selecting'
                    ? 'Select characteristics above to find similar contacts...'
                    : 'Type your message... (Press Enter to send)'
                }
                className={`w-full resize-none border-2 rounded-xl px-4 py-3 pr-12 focus:outline-none transition-all text-gray-900 placeholder:text-gray-400 ${
                  workflowMode === 'enrich'
                    ? 'border-gray-200 focus:border-blue-400 focus:ring-4 focus:ring-blue-100'
                    : 'border-gray-200 focus:border-purple-400 focus:ring-4 focus:ring-purple-100'
                } disabled:bg-gray-50 disabled:text-gray-400`}
                rows={2}
                disabled={isLoading || icpStep === 'selecting'}
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading || icpStep === 'selecting'}
              className={`px-5 py-3 text-white rounded-xl font-semibold disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center gap-2 ${
                workflowMode === 'enrich'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700'
                  : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
