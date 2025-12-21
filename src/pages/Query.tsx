import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { queryWithSSE } from '../sse';
import { listDocuments } from '../api';
import type { QueryFinalResponse, DebugInfo } from '../contracts/types';
import EvidencePanel from './EvidencePanel';
import DemoModePanel from './DemoModePanel';
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
      } catch (err) {
        console.error('Failed to check document readiness:', err);
      }
    };

    checkReadiness();
  }, []);

  const executeQuery = (questionText: string) => {
    if (!questionText.trim()) return;

    setStreaming(true);
    setAnswer('');
    setDebugInfo(null);
    setFinalResponse(null);
    setError(null);
    setLastQuery(questionText.trim()); // Store for retry

    const { abort } = queryWithSSE(
      {
        question: questionText.trim(),
        mode: 'full',
        top_k: 4,
        debug: debugDrawerOpen ? 2 : 0, // Enable verbose debug when drawer is open
      },
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

  // Extract request_id from debug info or final response
  const requestId = debugInfo?.request_id || finalResponse?.debug_info?.request_id;

  return (
    <div className="query-page">
      <div className="query-container">
        <h1>RAG Query</h1>

        {/* Readiness Banner - Show if documents are still indexing */}
        {hasPendingDocs && (
          <div className="readiness-banner">
            <span className="readiness-icon">⏳</span>
            Indexing in progress — answers may refuse until ready.{' '}
            <Link to="/docs" className="readiness-link">View documents →</Link>
          </div>
        )}

        {/* Demo Mode Panel */}
        {DEMO_MODE && (
          <DemoModePanel
            onRunDemo={runDemoQuery}
            onClear={handleClear}
            disabled={streaming}
          />
        )}

        <form onSubmit={handleQuery} className="query-form">
          <div className="form-group">
            <label htmlFor="question">Ask a question about your documents</label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is the company vacation policy?"
              rows={4}
              disabled={streaming}
              required
            />
          </div>
          <div className="button-group">
            <button type="submit" disabled={streaming || !question.trim()} className="query-button">
              {streaming ? 'Querying...' : 'Ask'}
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

        {debugInfo && (
          <div className="debug-info">
            <strong>Debug Info:</strong> {debugInfo.evidence_count} evidence chunks,{' '}
            {debugInfo.sources_count} sources
          </div>
        )}

        {(answer || finalResponse) && (
          <div className="answer-section">
            <h2>Answer</h2>
            
            {finalResponse?.refused && (
              <div className="refusal-banner">
                <div className="refusal-title">⚠ Answer not found in uploaded documents</div>
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

            {finalResponse && (
              <EvidencePanel 
                evidence={finalResponse.evidence} 
                query={question}
                refused={finalResponse.refused}
                sources={finalResponse.sources}
              />
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
