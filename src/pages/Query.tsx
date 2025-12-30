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
  // `streamingAnswer` is the temporary buffer updated by token events.
  // `answer` is the canonical, committed answer updated only from the final event.
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [answer, setAnswer] = useState('');
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [finalResponse, setFinalResponse] = useState<QueryFinalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dev-only diagnostic banners
  const [devInvariantMsg, setDevInvariantMsg] = useState<string | null>(null);
  const [devMismatchMsg, setDevMismatchMsg] = useState<string | null>(null);
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
    setStreamingAnswer('');
    setAnswer('');
    setDebugInfo(null);
    setFinalResponse(null);
    setError(null);
    setLastQuery(questionText.trim());

    const queryRequest = {
      question: questionText.trim(),
      mode: 'full' as const,
      top_k: 4,
      debug: debugDrawerOpen ? 2 : 0,
      ...(selectedDocIds.length > 0 && { doc_ids: selectedDocIds }),
    };

    // DEV logging: print outgoing query payload and doc_ids status
    if (import.meta.env.DEV) {
      if ('doc_ids' in queryRequest) {
        console.log('[Query] Sending request with doc_ids:', (queryRequest as any).doc_ids, queryRequest);
      } else {
        console.log('[Query] Sending request for ALL docs (no doc_ids):', queryRequest);
      }
    }

    const { abort } = queryWithSSE(
      queryRequest,
      {
        onDebug: (debug) => setDebugInfo(debug),
        onToken: (token) => handleSSEToken(token),
        onFinal: (final) => handleSSEFinal(final),
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
    setStreamingAnswer('');
    setDevInvariantMsg(null);
    setDevMismatchMsg(null);
  };

  const handleClear = () => {
    setQuestion('');
    setAnswer('');
    setStreamingAnswer('');
    setDebugInfo(null);
    setFinalResponse(null);
    setError(null);
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setStreaming(false);
    setDevInvariantMsg(null);
    setDevMismatchMsg(null);
  };

  const handleRetry = () => {
    if (lastQuery) {
      executeQuery(lastQuery);
    }
  };

  // --- SSE handlers extracted so they can be reused by a DEV-only simulator ---
  const handleSSEToken = (token: string) => {
    setStreamingAnswer((prev) => {
      const next = prev + token;
      if (import.meta.env.DEV) {
        console.log('[SSE stream] streamingAnswer (first120):', next.slice(0, 120));
      }
      return next;
    });
  };

  const handleSSEFinal = (final: QueryFinalResponse) => {
    const canonicalRefusal = 'The document does not specify this.';

    if (final.refused) {
      const finalObj = {
        ...final,
        answer: canonicalRefusal,
        evidence: [],
        sources: [],
      } as QueryFinalResponse;
      setFinalResponse(finalObj);
      setAnswer(canonicalRefusal);
    } else {
      setFinalResponse(final);
      setAnswer(final.answer || '');
    }

    if (final.debug_info) {
      setDebugInfo(final.debug_info);
    }

    setStreamingAnswer('');
    setStreaming(false);
    abortRef.current = null;

    if (import.meta.env.DEV) {
      console.log('[SSE final] final.answer:', (final.answer || '').slice(0, 200));
      if (final.evidence && final.evidence.length > 0) {
        console.log('[SSE final] final.evidence[0].chunk_id:', final.evidence[0].chunk_id);
      }

      // Dev-only invariant: final must include evidence and sources when not refused
      if (!final.refused && (!final.evidence || final.evidence.length === 0 || !final.sources || final.sources.length === 0)) {
        setDevInvariantMsg('DEV ERROR: final payload missing evidence or sources.');
      } else {
        setDevInvariantMsg(null);
      }

      // Dev-only mismatch detector: if answer contains a clock time but evidence snippet doesn't
      setDevMismatchMsg(null);
      if (!final.refused && final.answer) {
        const timeRegex = /\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i;
        const timeMatch = final.answer.match(timeRegex);
        if (timeMatch && final.evidence && final.evidence.length > 0) {
          const snippet = final.evidence[0].snippet || '';
          if (!snippet.includes(timeMatch[0])) {
            setDevMismatchMsg('DEV: Answer/Evidence mismatch');
            console.error('[DEV] Answer/Evidence mismatch', final);
          }
        }
      }
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

        {/* DEV: SSE simulator to test streaming vs final alignment */}
        {import.meta.env.DEV && (
          <div className="dev-sse-simulator" style={{ marginTop: 12 }}>
            <h4>DEV: Simulate SSE</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  // Simulate tokens then a matching final
                  setStreaming(true);
                  setStreamingAnswer('');
                  const tokens = ['The ', 'document ', 'states ', 'that ', 'health ', 'insurance ', 'is ', 'provided.'];
                  tokens.forEach((t, i) => setTimeout(() => handleSSEToken(t), 100 * (i + 1)));
                  setTimeout(() => {
                    handleSSEFinal({
                      answer: 'The document states that health insurance is provided.',
                      refused: false,
                      evidence: [{ chunk_id: '20_Employee_Onboarding_Guide_1.txt_30', snippet: '...' } as any],
                      sources: [{ filename: 'Employee_Onboarding_Guide_1.txt' } as any],
                    } as QueryFinalResponse);
                  }, 100 * (tokens.length + 2));
                }}
              >
                Simulate matching final
              </button>

              <button
                onClick={() => {
                  // Simulate tokens that disagree, then a refusal final
                  setStreaming(true);
                  setStreamingAnswer('');
                  const tokens = ['ARRIVE ', 'AT ', '8:00 ', 'AM'];
                  tokens.forEach((t, i) => setTimeout(() => handleSSEToken(t), 120 * (i + 1)));
                  setTimeout(() => {
                    handleSSEFinal({
                      answer: 'ARRIVE AT 8:00 AM',
                      refused: true,
                      refusal_reason: 'No matching info',
                      evidence: [{ chunk_id: '20_Employee_Onboarding_Guide_1.txt_30', snippet: '...' } as any],
                      sources: [{ filename: 'Employee_Onboarding_Guide_1.txt' } as any],
                    } as QueryFinalResponse);
                  }, 120 * (tokens.length + 2));
                }}
              >
                Simulate refusal final
              </button>
            </div>
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

              {/* DEV diagnostic banners */}
              {devInvariantMsg && (
                <div className="dev-error-banner" style={{ background: '#ffdddd', padding: 8, marginBottom: 8, borderRadius: 6 }}>
                  <strong>{devInvariantMsg}</strong>
                </div>
              )}
              {devMismatchMsg && (
                <div className="dev-mismatch-banner" style={{ background: '#fff3bf', padding: 8, marginBottom: 8, borderRadius: 6 }}>
                  <strong>{devMismatchMsg}</strong>
                </div>
              )}

              <div className="answer-content">
                {finalResponse ? (finalResponse.answer) : (streaming ? streamingAnswer : answer)}
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
