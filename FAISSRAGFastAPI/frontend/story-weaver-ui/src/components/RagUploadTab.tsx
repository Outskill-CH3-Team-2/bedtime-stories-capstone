import { useRef, useState } from 'react'
import { Upload, FileText, Trash2, AlertTriangle } from 'lucide-react'
import { uploadFile, deleteFile } from '../api'
import type { UploadResponse } from '../api'

const STORAGE_KEY = 'dreamweaver_upload_history'

interface UploadRecord {
  filename: string
  file_id: string
  chunks: number
  at: string
  deleting?: boolean
  deleted?: boolean
}

function loadHistory(): UploadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: UploadRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export default function RagUploadTab() {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [file,      setFile]      = useState<File | null>(null)
  const [over,      setOver]      = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState('')
  const [duplicate, setDuplicate] = useState<UploadRecord | null>(null)
  const [history,   setHistory]   = useState<UploadRecord[]>(loadHistory)

  function updateHistory(next: UploadRecord[]) {
    setHistory(next)
    saveHistory(next)
  }

  function pickFile(f: File) {
    const ok = f.name.endsWith('.pdf') || f.name.endsWith('.epub')
    if (!ok) { setErr('Only .pdf and .epub files are supported.'); return }

    // Check for duplicate — find any non-deleted record with the same filename
    const existing = history.find(r => !r.deleted && r.filename === f.name)
    setDuplicate(existing ?? null)
    setFile(f)
    setErr('')
  }

  async function doUpload(force = false) {
    if (!file) return
    if (duplicate && !force) return   // guard: shouldn't reach here normally

    setLoading(true); setErr(''); setDuplicate(null)
    try {
      const res: UploadResponse = await uploadFile(file)
      const record: UploadRecord = {
        filename: file.name,
        file_id:  res.file_id,
        chunks:   res.chunks,
        at:       new Date().toLocaleTimeString(),
      }
      // Replace any existing record for this filename (re-upload)
      updateHistory([record, ...history.filter(r => r.filename !== file.name)])
      setFile(null)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  async function doDelete(fileId: string) {
    setHistory(h => h.map(r => r.file_id === fileId ? { ...r, deleting: true } : r))
    try {
      await deleteFile(fileId)
      const next = history.map(r => r.file_id === fileId ? { ...r, deleted: true, deleting: false } : r)
      updateHistory(next)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
      setHistory(h => h.map(r => r.file_id === fileId ? { ...r, deleting: false } : r))
    }
  }

  const activeHistory = history.filter(r => !r.deleted)

  return (
    <div>
      <div className="card">
        <p className="card-title">Upload Reference Book</p>
        <p className="muted" style={{ marginBottom: 16 }}>
          Upload a PDF or EPUB. The text is chunked and indexed so the story pipeline
          can draw from your books when generating bedtime stories.
        </p>

        {/* Drop zone */}
        <div
          className={`drop-zone ${over ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
        >
          <input ref={inputRef} type="file" accept=".pdf,.epub"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
          <Upload size={28} style={{ marginBottom: 8, opacity: .6 }} />
          <p>{file ? <strong>{file.name}</strong> : 'Click or drag a PDF / EPUB here'}</p>
          {file && <p className="muted" style={{ marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</p>}
        </div>

        {/* Duplicate warning */}
        {duplicate && (
          <div className="error-box" style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(180,120,0,0.12)', borderColor: '#b47800' }}>
            <AlertTriangle size={16} style={{ color: '#b47800', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: '#b47800' }}>Already uploaded</strong>
              <p style={{ margin: '2px 0 8px', fontSize: '.85rem' }}>
                <em>{duplicate.filename}</em> was uploaded at {duplicate.at} ({duplicate.chunks} chunks indexed).
                Uploading again will replace the existing index entry.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ fontSize: '.8rem', padding: '4px 12px' }}
                  onClick={() => doUpload(true)} disabled={loading}>
                  Upload Anyway
                </button>
                <button className="btn" style={{ fontSize: '.8rem', padding: '4px 12px' }}
                  onClick={() => { setFile(null); setDuplicate(null) }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {err && <div className="error-box" style={{ marginTop: 12 }}>{err}</div>}

        {!duplicate && (
          <button className="btn btn-primary" style={{ marginTop: 14 }}
            onClick={() => doUpload(false)} disabled={!file || loading}>
            <Upload size={15} /> {loading ? 'Uploading & indexing…' : 'Upload & Index'}
          </button>
        )}
        {loading && (
          <p className="muted" style={{ marginTop: 10 }}>
            Parsing, chunking and embedding — this may take a few minutes for large files.
          </p>
        )}
      </div>

      {/* Upload history */}
      {activeHistory.length > 0 && (
        <div className="card">
          <p className="card-title">Indexed Files</p>
          {activeHistory.map(r => (
            <div key={r.file_id} className="kv-row"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <FileText size={14} style={{ color: 'var(--accent)' }} />
                <strong style={{ flex: 1 }}>{r.filename}</strong>
                <span className="badge badge-ok">{r.chunks} chunks</span>
                <span className="muted">{r.at}</span>
                <button className="btn btn-danger btn-sm" title="Delete from FAISS index"
                  disabled={r.deleting} onClick={() => doDelete(r.file_id)}>
                  <Trash2 size={12} /> {r.deleting ? 'Removing…' : 'Delete'}
                </button>
              </div>
              <code style={{ fontSize: '.75rem', color: 'var(--muted)' }}>file_id: {r.file_id}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
