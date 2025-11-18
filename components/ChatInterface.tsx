'use client';

import { useState, useEffect, useRef } from 'react';
import { StoredMessage, getMessages, addMessage, clearCurrentSession } from '@/lib/chat-storage';

interface ChatInterfaceProps {
  uploadedData?: any;
  enrichedData?: any;
  onDataEnriched?: (data: any) => void;
}

export default function ChatInterface({ uploadedData, enrichedData, onDataEnriched }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        console.log('ChatInterface: Received enriched data with', data.enrichedData.length, 'rows');
        console.log('ChatInterface: First row keys count:', Object.keys(data.enrichedData[0] || {}).length);
        console.log('ChatInterface: First row sample keys:', Object.keys(data.enrichedData[0] || {}).slice(0, 20).join(', '));
        console.log('ChatInterface: First row full data:', data.enrichedData[0]);
        onDataEnriched?.(data.enrichedData);
      } else {
        console.log('ChatInterface: No enriched data in response');
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

      // Add tool calls if present
      if (message.toolCalls && message.toolCalls.length > 0) {
        text += '\nTools used:\n';
        message.toolCalls.forEach((tool) => {
          text += `- ${tool.name}\n`;
        });
      }

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
    <div className="h-full flex flex-col bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
        <h2 className="text-xl font-semibold text-gray-800">Watt Data Assistant</h2>
        <div className="flex space-x-2">
          <button
            onClick={handleCopyChat}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
          >
            Copy Chat
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
          >
            Clear Chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-scroll p-4 space-y-4" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg mb-2">👋 Hi! I'm your Watt Data assistant.</p>
            <p className="text-sm">Upload a CSV file or ask me anything about the Watt Data tools.</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{message.content}</div>

              {/* Show tool calls if present */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-300 text-xs">
                  <p className="font-semibold mb-1">Tools used:</p>
                  {message.toolCalls.map((tool, idx) => (
                    <div key={idx} className="mb-1">
                      <span className="font-mono">{tool.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs mt-1 opacity-70">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t p-4">
        <div className="flex space-x-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type your message... (Press Enter to send)"
            className="flex-1 resize-none border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-400"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
