import { useState, useEffect, useRef } from 'react';
import { listDocuments, uploadDocuments } from '../api';
import type { DocumentRecord } from '../contracts/types';
import './Docs.css';

export default function Docs() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pollingTimeoutReached, setPollingTimeoutReached] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null);

  // Fetch documents
  const fetchDocuments = async () => {
    try {
      const response = await listDocuments();
      setDocuments(response.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  // Check if polling is needed
  const shouldPoll = (docs: DocumentRecord[]): boolean => {
    return docs.some(doc => doc.status === 'pending');
  };

  // Setup or clear polling based on document status
  useEffect(() => {
    const setupPolling = () => {
      // Clear existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      // Check if we need to poll
      if (shouldPoll(documents)) {
        // Start polling timer if not started
        if (!pollingStartTimeRef.current) {
          pollingStartTimeRef.current = Date.now();
          setPollingTimeoutReached(false);
        }

        // Check if 60 seconds have elapsed
        const elapsed = Date.now() - (pollingStartTimeRef.current || 0);
        if (elapsed >= 60000) {
          setPollingTimeoutReached(true);
          pollingStartTimeRef.current = null;
          return;
        }

        // Start polling every 2 seconds
        pollingIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - (pollingStartTimeRef.current || 0);
          if (elapsed >= 60000) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setPollingTimeoutReached(true);
            pollingStartTimeRef.current = null;
          } else {
            fetchDocuments();
          }
        }, 2000);
      } else {
        // No polling needed, reset timer
        pollingStartTimeRef.current = null;
        setPollingTimeoutReached(false);
      }
    };

    setupPolling();

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [documents]);

  // Initial fetch
  useEffect(() => {
    fetchDocuments();
  }, []);

  // Handle file upload
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    try {
      const fileArray = Array.from(files);
      await uploadDocuments(fileArray);
      
      // Refresh document list
      await fetchDocuments();
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // Determine banner message
  const isPolling = shouldPoll(documents);
  const hasIndexedDocs = documents.some(doc => doc.status === 'indexed');
  
  let bannerMessage = '';
  let bannerClass = '';
  
  if (isPolling) {
    bannerMessage = pollingTimeoutReached 
      ? 'Indexing is taking longer than expected. Documents may still be processing.'
      : 'Indexing in progress...';
    bannerClass = 'banner-indexing';
  } else if (hasIndexedDocs) {
    bannerMessage = 'Ready to query';
    bannerClass = 'banner-ready';
  }

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="docs-page">
      {bannerMessage && (
        <div className={`banner ${bannerClass}`}>
          {bannerMessage}
        </div>
      )}

      <div className="docs-content">
        <h1>Documents</h1>

        {/* Upload Section */}
        <div className="upload-section">
          <div
            className={`upload-area ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleUpload(e.target.files)}
              className="file-input"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="upload-label">
              {uploading ? (
                'Uploading...'
              ) : (
                <>
                  <span className="upload-icon">📁</span>
                  <span>Click to select files or drag & drop</span>
                </>
              )}
            </label>
          </div>
          {uploadError && <div className="error-message">{uploadError}</div>}
        </div>

        {/* Documents Table */}
        {loading && documents.length === 0 ? (
          <div className="loading">Loading documents...</div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : documents.length === 0 ? (
          <div className="empty-state">No documents yet. Upload your first document above.</div>
        ) : (
          <div className="table-container">
            <table className="documents-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Uploaded At</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="filename-cell">{doc.filename}</td>
                    <td>
                      <span className={`status-badge status-${doc.status}`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="date-cell">
                      {doc.created_at ? formatDate(doc.created_at) : '-'}
                    </td>
                    <td className="error-cell">
                      {doc.error_message || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
