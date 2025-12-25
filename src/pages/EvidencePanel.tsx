import { useState } from 'react';
import type { EvidenceItem, SourceItem } from '../contracts/types';
import './EvidencePanel.css';

interface EvidencePanelProps {
  evidence: EvidenceItem[];
  query: string;
  refused?: boolean;
  sources?: SourceItem[];
}

/**
 * Highlight query tokens in text (case-insensitive)
 */
function highlightText(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text];

  // Extract meaningful tokens from query (ignore common words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'what', 'when', 'where', 'who', 'how', 'why']);
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  if (tokens.length === 0) return [text];

  // Create regex pattern for all tokens
  const pattern = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, idx) => {
    const isMatch = tokens.some(token => part.toLowerCase() === token);
    return isMatch ? (
      <mark key={idx} className="highlight">{part}</mark>
    ) : (
      <span key={idx}>{part}</span>
    );
  });
}

/**
 * Count matched query tokens in text
 */
function countMatches(text: string, query: string): number {
  if (!query.trim()) return 0;

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'what', 'when', 'where', 'who', 'how', 'why']);
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  if (tokens.length === 0) return 0;

  const lowerText = text.toLowerCase();
  let count = 0;

  for (const token of tokens) {
    const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

interface EvidenceItemComponentProps {
  evidence: EvidenceItem;
  index: number;
  query: string;
}

function EvidenceItemComponent({ evidence, index, query }: EvidenceItemComponentProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const matchCount = countMatches(evidence.snippet, query);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(evidence.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="evidence-item">
      <div className="evidence-header" onClick={() => setExpanded(!expanded)}>
        <div className="evidence-title">
          {evidence.heading && <span className="evidence-heading">{evidence.heading}</span>}
          {!evidence.heading && <span className="evidence-heading">Evidence {index + 1}</span>}
          {matchCount > 0 && (
            <span className="match-badge">Time anchor detected</span>
          )}
        </div>
        <div className="evidence-actions">
          <button 
            className="copy-button" 
            onClick={handleCopy}
            aria-label="Copy snippet"
            title="Copy to clipboard"
          >
            {copied ? '✓' : '📋'}
          </button>
          <button className="expand-toggle" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="evidence-body">
          <div className="evidence-snippet">
            {highlightText(evidence.snippet, query)}
          </div>
          <div className="evidence-meta">
            Chunk: {evidence.chunk_id}
            {evidence.doc_id && ` | Doc ID: ${evidence.doc_id}`}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EvidencePanel({ evidence, query, refused, sources }: EvidencePanelProps) {
  // If refused, show banner and hide evidence
  if (refused) {
    return (
      <div className="evidence-section">
        <div className="evidence-refusal-banner">
          <div className="refusal-icon">🚫</div>
          <div className="refusal-text">
            <strong>No evidence available</strong>
            <p>The query could not be answered from the uploaded documents.</p>
          </div>
        </div>
      </div>
    );
  }

  if (evidence.length === 0) return null;

  // Deduplicate sources by filename
  const uniqueSources = sources ? Array.from(
    new Map(sources.map(src => [src.filename, src])).values()
  ) : [];

  return (
    <div className="evidence-section">
      <h3>Evidence ({evidence.length})</h3>
      <div className="evidence-list">
        {evidence.map((ev, idx) => (
          <EvidenceItemComponent
            key={idx}
            evidence={ev}
            index={idx}
            query={query}
          />
        ))}
      </div>

      {uniqueSources.length > 0 && (
        <div className="sources-list-section">
          <h4>Sources</h4>
          <ul className="sources-list">
            {uniqueSources.map((src, idx) => (
              <li key={idx} className="source-item">
                📄 {src.filename}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
