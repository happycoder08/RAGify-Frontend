import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { queryWithSSE } from '../sse';
import { listDocuments } from '../api';
import type { DebugInfo, DocumentRecord } from '../contracts/types';
import { getSelectedDocIds } from '../utils/documentSelection';
import EvidencePanel from './EvidencePanel';
import DebugDrawer from './DebugDrawer';
import './Query.css';

// Demo mode configuration from environment
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Dev tools flag from environment or URL param
const SHOW_DEVTOOLS = import.meta.env.VITE_SHOW_DEVTOOLS === 'true' || 
  new URLSearchParams(window.location.search).get('debug') === '1' ||
  (globalThis as any).__TEST_SHOW_DEVTOOLS__ === true;

// Simple in-memory cache for document status (10 second TTL)
let docStatusCache: { hasPending: boolean; timestamp: number } | null = null;
const CACHE_TTL = 10000; // 10 seconds

export default function Query() {
  const [question, setQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  // State machine states
  const [answerText, setAnswerText] = useState('');
  const answerBufferRef = useRef('');
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dev-only diagnostic banners
  const [devInvariantMsg, setDevInvariantMsg] = useState<string | null>(null);
  const [devMismatchMsg, setDevMismatchMsg] = useState<string | null>(null);
  const [hasPendingDocs, setHasPendingDocs] = useState(false);
  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>(() => getSelectedDocIds());
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [rawResponse, setRawResponse] = useState<string>('');
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
    setAnswerText('');
    answerBufferRef.current = '';
    setDebugInfo(null);
    setEvidence([]);
    setSources([]);
    setRefused(false);
    setError(null);
    setRawResponse('');
    setLastQuery(questionText.trim());

    const queryRequest = {
      question: questionText.trim(),
      mode: 'full' as const,
      top_k: 4,
      debug: debugDrawerOpen ? 2 : 0,
      stream: false,
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
        // Rule 1: On 'debug' event: setDebugInfo(data) only. Do NOT set answer.
        onDebug: (data) => {
          console.log('[SSE debug] Setting debugInfo:', data);
          setDebugInfo(data);
        },
        // Rule 2: On 'token' event: append data.t to answerBufferRef and setAnswerText(answerBufferRef) for live streaming.
        onToken: (token) => {
          answerBufferRef.current += token;
          setAnswerText(answerBufferRef.current);
        },
        // Rule 3: On 'final' event: set all final state
        onFinal: (data) => {
          console.log('[SSE final] Setting final state with answer:', data.answer);
          setRawResponse(JSON.stringify(data, null, 2));
          setRefused(data.refused);
          setAnswerText(data.answer);
          setEvidence(data.evidence);
          setSources(data.sources);
          setDebugInfo(prev => data.debug_info ?? prev);
          setStreaming(false);
          abortRef.current = null;

          // DEV validation: check invariants
          if (!data.evidence || !data.sources || data.evidence.length === 0 || data.sources.length === 0) {
            setDevInvariantMsg('DEV ERROR: final payload missing evidence or sources');
          } else {
            setDevInvariantMsg(null);
          }

          // DEV validation: check for answer/evidence mismatch
          if (data.answer && data.evidence && data.evidence.length > 0) {
            const answerLower = data.answer.toLowerCase();
            const hasTimeInAnswer = /\b\d{1,2}:\d{2}\b/.test(answerLower) || /\b\d{1,2}(am|pm)\b/i.test(answerLower);
            const hasTimeInEvidence = data.evidence.some(ev => 
              ev.snippet && (/\b\d{1,2}:\d{2}\b/.test(ev.snippet) || /\b\d{1,2}(am|pm)\b/i.test(ev.snippet))
            );
            if (hasTimeInAnswer && !hasTimeInEvidence) {
              setDevMismatchMsg('Answer/Evidence mismatch');
            } else {
              setDevMismatchMsg(null);
            }
          } else {
            setDevMismatchMsg(null);
          }

          // DEV validation: check canonical refusal
          const canonicalRefusal = 'The document does not specify this.';
          if (!data.refused && data.answer === canonicalRefusal) {
            setDevInvariantMsg('DEV ERROR: final.answer equals canonical refusal while refused=false');
          }
        },
        // Rule 4: On 'error': show error state and stop.
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
    setAnswerText('');
    answerBufferRef.current = '';
    setDevInvariantMsg(null);
    setDevMismatchMsg(null);
  };

  const handleClear = () => {
    setQuestion('');
    setAnswerText('');
    answerBufferRef.current = '';
    setDebugInfo(null);
    setEvidence([]);
    setSources([]);
    setRefused(false);
    setError(null);
    setRawResponse('');
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
              {(question || answerText || error) && !streaming && (
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
        {(streaming || answerText) && (
          <div className="results-grid">
            {/* Middle: Answer Panel */}
            <div className="answer-panel">
              <h2>Answer</h2>
              
              {/* Refusal Banner */}
              {refused && (
                <div className="refusal-banner">
                  <div className="refusal-title">⚠️ Answer not found in uploaded documents</div>
                  {/* Note: refusal_reason not available in new state machine */}
                </div>
              )}

              {/* DEV diagnostic banners */}
              {SHOW_DEVTOOLS && devInvariantMsg && (
                <div className="dev-error-banner" style={{ background: '#ffdddd', padding: 8, marginBottom: 8, borderRadius: 6 }}>
                  <strong>{devInvariantMsg}</strong>
                </div>
              )}
              {SHOW_DEVTOOLS && devMismatchMsg && (
                <div className="dev-mismatch-banner" style={{ background: '#fff3bf', padding: 8, marginBottom: 8, borderRadius: 6 }}>
                  <strong>{devMismatchMsg}</strong>
                </div>
              )}

              <div className="answer-content">
                {answerText}
                {streaming && <span className="cursor">▊</span>}
              </div>

              {SHOW_DEVTOOLS && debugInfo && (
                <div className="debug-info">
                  <strong>Debug:</strong> {debugInfo.evidence_count} evidence chunks, {debugInfo.sources_count} sources
                </div>
              )}
            </div>

            {/* Right/Below: Evidence Panel (hide if refused) */}
            {!refused && evidence && evidence.length > 0 && (
              <div className="evidence-panel-container">
                {evidence[0].anchor_type && (
                  <div className="anchor-type-banner">
                    {evidence[0].anchor_type === 'WIFI' && '🔗 WIFI ANCHOR DETECTED'}
                    {evidence[0].anchor_type === 'TIME' && '⏰ TIME ANCHOR DETECTED'}
                  </div>
                )}
                <EvidencePanel 
                  evidence={[evidence[0]]} 
                  query={question}
                  refused={refused}
                  sources={sources}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Temporary Debug Panel */}
      {SHOW_DEVTOOLS && rawResponse && (
        <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
          <h3>Raw Response JSON</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>{rawResponse}</pre>
        </div>
      )}

      {/* Debug Drawer */}
      {SHOW_DEVTOOLS && (
        <DebugDrawer
          isOpen={debugDrawerOpen}
          onToggle={() => setDebugDrawerOpen(!debugDrawerOpen)}
          debugInfo={debugInfo}
        />
      )}
    </div>
  );
}
