export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: Array<{
    name: string;
    input: any;
    result: any;
  }>;
}

export interface ChatSession {
  id: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'watt-data-chat-history';
const CURRENT_SESSION_KEY = 'watt-data-current-session';

/**
 * Get all chat sessions from localStorage
 */
export function getAllSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading chat sessions:', error);
    return [];
  }
}

/**
 * Get current active session ID
 */
export function getCurrentSessionId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return localStorage.getItem(CURRENT_SESSION_KEY);
  } catch (error) {
    console.error('Error loading current session:', error);
    return null;
  }
}

/**
 * Get a specific session by ID
 */
export function getSession(sessionId: string): ChatSession | null {
  const sessions = getAllSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Get current active session
 */
export function getCurrentSession(): ChatSession {
  const currentId = getCurrentSessionId();

  if (currentId) {
    const session = getSession(currentId);
    if (session) return session;
  }

  // Create new session if none exists
  return createNewSession();
}

/**
 * Create a new chat session
 */
export function createNewSession(): ChatSession {
  const session: ChatSession = {
    id: generateId(),
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  saveSession(session);
  setCurrentSession(session.id);

  return session;
}

/**
 * Save a session to localStorage
 */
export function saveSession(session: ChatSession) {
  if (typeof window === 'undefined') return;

  try {
    const sessions = getAllSessions();
    const index = sessions.findIndex(s => s.id === session.id);

    session.updatedAt = Date.now();

    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

/**
 * Set current active session
 */
export function setCurrentSession(sessionId: string) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
  } catch (error) {
    console.error('Error setting current session:', error);
  }
}

/**
 * Add a message to the current session
 */
export function addMessage(message: Omit<StoredMessage, 'id' | 'timestamp'>): StoredMessage {
  const session = getCurrentSession();

  const storedMessage: StoredMessage = {
    ...message,
    id: generateId(),
    timestamp: Date.now(),
  };

  session.messages.push(storedMessage);
  saveSession(session);

  return storedMessage;
}

/**
 * Clear all messages in current session
 */
export function clearCurrentSession() {
  const session = getCurrentSession();
  session.messages = [];
  saveSession(session);
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string) {
  if (typeof window === 'undefined') return;

  try {
    const sessions = getAllSessions().filter(s => s.id !== sessionId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));

    // If we deleted the current session, create a new one
    if (getCurrentSessionId() === sessionId) {
      createNewSession();
    }
  } catch (error) {
    console.error('Error deleting session:', error);
  }
}

/**
 * Get messages from current session
 */
export function getMessages(): StoredMessage[] {
  const session = getCurrentSession();
  return session.messages;
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Export chat history as JSON
 */
export function exportChatHistory(): string {
  const sessions = getAllSessions();
  return JSON.stringify(sessions, null, 2);
}

/**
 * Import chat history from JSON
 */
export function importChatHistory(json: string) {
  if (typeof window === 'undefined') return;

  try {
    const sessions = JSON.parse(json) as ChatSession[];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('Error importing chat history:', error);
    throw error;
  }
}
