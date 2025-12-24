import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { queryWithSSE } from '../sse';
import { listDocuments } from '../api';
import type { QueryFinalResponse, DebugInfo, DocumentRecord } from '../contracts/types';
import { getSelectedDocIds } from '../utils/documentSelection';
import EvidencePanel from './EvidencePanel';
import DebugDrawer from './DebugDrawer';
import './Query.css';

// Demo mode configuration from environment
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Simple in-memory cache for document status (10 second TTL)
let docStatusCache: { hasPending: boolean; timestamp: number } | null = null;
const CACHE_TTL = 10000; // 10 seconds

export default function Query() {
  const [question, setQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [answer, setAnswer] = useState('');
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [finalResponse, setFinalResponse] = useState<QueryFinalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPendingDocs, setHasPendingDocs] = useState(false);
  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>(() => getSelectedDocIds());
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const abortRef = useRef<(() => void) | null>(null);

  // Readiness check: fetch documents on mount and check for pending status
  useEffect(() => {
    const checkReadiness = async () => {
      // Check cache first
      if (docStatusCache && Date.now() - docStatusCache.timestamp < CACHE_TTL) {
        setHasPendingDocs(docStatusCache.hasPending);
        return;
      }

      try {
        const response = await listDocuments();
        const pending = response.documents.some(doc => doc.status === 'pending');
        
        // Update cache
        docStatusCache = {
          hasPending: pending,
          timestamp: Date.now(),
        };
        
        setHasPendingDocs(pending);
        setDocuments(response.documents);
      } catch (err) {
        console.error('Failed to check document readiness:', err);
      }
    };

    checkReadiness();
    
    // Refresh selected doc IDs when page loads (in case changed on Docs page)
    setSelectedDocIds(getSelectedDocIds());
  }, []);

  const executeQuery = (questionText: string) => {
    if (!questionText.trim()) return;

    setStreaming(true);
    setAnswer('');
    setDebugInfo(null);
    setFinalResponse(null);
    setError(null);
    setLastQuery(questionText.trim()); // Store for retry

    // Build query request with optional doc_ids filter
    const queryRequest = {
      question: questionText.trim(),
      mode: 'full' as const,
      top_k: 4,
      debug: debugDrawerOpen ? 2 : 0, // Enable verbose debug when drawer is open
      ...(selectedDocIds.length > 0 && { doc_ids: selectedDocIds }), // Only include if specific docs selected
    };

    const { abort } = queryWithSSE(
      queryRequest,
      {
        onDebug: (debug) => {
          setDebugInfo(debug);
        },
        onToken: (token) => {
          setAnswer((prev) => prev + token);
        },
        onFinal: (final) => {
          setFinalResponse(final);
          setStreaming(false);
          abortRef.current = null;
        },
        onError: (err) => {
          setError(err.message);
          setStreaming(false);
          abortRef.current = null;
        },
      }
    );

    abortRef.current = abort;
  };

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    executeQuery(question);
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setStreaming(false);
  };

  const handleClear = () => {
    setQuestion('');
    setAnswer('');
    setDebugInfo(null);
    setFinalResponse(null);
    setError(null);
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setStreaming(false);
  };

  const handleRetry = () => {
    if (lastQuery) {
      executeQuery(lastQuery);
    }
  };

  const runDemoQuery = (demoQuestion: string) => {
    setQuestion(demoQuestion);
    setTimeout(() => executeQuery(demoQuestion), 100);
  };

  // Get scope display text
  const getScopeText = () => {
    if (selectedDocIds.length === 0) {
      return 'All docs';
    }
    const selectedDocs = documents.filter(d => selectedDocIds.includes(d.id));
    if (selectedDocs.length === 1) {
      return selectedDocs[0].filename;
    }
    return `${selectedDocs.length} documents`;
  };

  // Extract request_id from debug info or final response
  const requestId = debugInfo?.request_id || finalResponse?.debug_info?.request_id;

  return (
    <div className="query-page">
      <div className="query-container">
        <div className="page-guidance">
          <div className="step-header">
            <span className="step-badge">Step 2 of 2</span>
            <h1>Ask Questions</h1>
          </div>
          <p className="step-description">
            Ask questions about your uploaded documents. The AI will search your knowledge base and provide answers with sources.
          </p>
        </div>

        {/* Readiness Banner - Show if documents are still indexing */}
        {hasPendingDocs && (
          <div className="readiness-banner">
            <span className="readiness-icon">⏳</span>
            Indexing in progress — answers may refuse until ready.{' '}
            <Link to="/docs" className="readiness-link">View documents →</Link>
          </div>
        )}

        {/* Demo Mode: Try demo questions */}
        {DEMO_MODE && (
          <div className="demo-questions-card">
            <h3>✨ Try demo questions</h3>
            <div className="demo-buttons">
              <button
                onClick={() => runDemoQuery("What are the main security protocols?")}
                disabled={streaming}
                className="demo-question-btn"
              >
                What are the main security protocols?
              </button>
              <button
                onClick={() => runDemoQuery("Explain the data retention policy")}
                disabled={streaming}
                className="demo-question-btn"
              >
                Explain the data retention policy
              </button>
            </div>
          </div>
        )}

        {/* Top Section: Question Input */}
        <div className="query-input-card">
          <form onSubmit={handleQuery} className="query-form">
            <div className="form-group">
              <label htmlFor="question">Your Question</label>
              <textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What is the company vacation policy?"
                rows={3}
                disabled={streaming}
                required
              />
            </div>
            <div className="button-group">
              <button type="submit" disabled={streaming || !question.trim()} className="ask-button">
                {streaming ? 'Asking...' : 'Ask'}
              </button>
              {streaming && (
                <button type="button" onClick={handleCancel} className="cancel-button">
                  Cancel
                </button>
              )}
              {(question || answer || finalResponse || error) && !streaming && (
                <button type="button" onClick={handleClear} className="clear-button">
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Document Scope Indicator */}
        <div className="scope-indicator">
          <span className="scope-label">Scope:</span>
          <span className="scope-value">{getScopeText()}</span>
          <Link to="/docs" className="scope-link">Change →</Link>
        </div>

        {requestId && (
          <div className="request-id">
            Request ID: <code>{requestId}</code>
          </div>
        )}

        {error && (
          <div className="error-message">
            {error}
            {error.toLowerCase().includes('timeout') && lastQuery && (
              <button 
                type="button" 
                onClick={handleRetry} 
                className="retry-button"
                style={{ marginLeft: '12px' }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Middle & Right: Answer and Evidence */}
        {(answer || finalResponse) && (
          <div className="results-grid">
            {/* Middle: Answer Panel */}
            <div className="answer-panel">
              <h2>Answer</h2>
              
              {/* Refusal Banner */}
              {finalResponse?.refused && (
                <div className="refusal-banner">
                  <div className="refusal-title">⚠️ Answer not found in uploaded documents</div>
                  {finalResponse.refusal_reason && (
                    <div className="refusal-reason">
                      Reason: {finalResponse.refusal_reason}
                    </div>
                  )}
                </div>
              )}

              <div className="answer-content">
                {finalResponse?.answer || answer}
                {streaming && <span className="cursor">▊</span>}
              </div>

              {debugInfo && (
                <div className="debug-info">
                  <strong>Debug:</strong> {debugInfo.evidence_count} evidence chunks, {debugInfo.sources_count} sources
                </div>
              )}
            </div>

            {/* Right/Below: Evidence Panel (hide if refused) */}
            {finalResponse && !finalResponse.refused && (
              <div className="evidence-panel-container">
                <EvidencePanel 
                  evidence={finalResponse.evidence} 
                  query={question}
                  refused={finalResponse.refused}
                  sources={finalResponse.sources}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Debug Drawer */}
      <DebugDrawer
        isOpen={debugDrawerOpen}
        onToggle={() => setDebugDrawerOpen(!debugDrawerOpen)}
        debugInfo={debugInfo}
      />
    </div>
  );
}
