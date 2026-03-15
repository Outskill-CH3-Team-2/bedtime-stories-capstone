import { useRef, useState } from 'react'
import { Upload, FileText } from 'lucide-react'
import { uploadFile } from '../api'
import type { UploadResponse } from '../api'

interface UploadRecord {
  filename: string
  file_id: string
  chunks: number
  at: string
}

export default function RagUploadTab() {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [file,    setFile]    = useState<File | null>(null)
  const [over,    setOver]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])

  function pickFile(f: File) {
    const ok = f.name.endsWith('.pdf') || f.name.endsWith('.epub')
    if (!ok) { setErr('Only .pdf and .epub files are supported.'); return }
    setFile(f); setErr('')
  }

  async function doUpload() {
    if (!file) return
    setLoading(true); setErr('')
    try {
      const res: UploadResponse = await uploadFile(file)
      setHistory(h => [{
        filename: file.name,
        file_id:  res.file_id,
        chunks:   res.chunks,
        at:       new Date().toLocaleTimeString(),
      }, ...h])
      setFile(null)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="card">
        <p className="card-title">POST /api/v1/upload — Upload Reference Book</p>
        <p className="muted" style={{ marginBottom: 16 }}>
          Upload a PDF or EPUB. The text is chunked and indexed in FAISS so the story pipeline
          can retrieve style references when generating stories.
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

        {err && <div className="error-box" style={{ marginTop: 12 }}>{err}</div>}

        <button className="btn btn-primary" style={{ marginTop: 14 }}
          onClick={doUpload} disabled={!file || loading}>
          <Upload size={15} /> {loading ? 'Uploading & indexing…' : 'Upload & Index'}
        </button>
      </div>

      {/* Upload history */}
      {history.length > 0 && (
        <div className="card">
          <p className="card-title">Indexed Files</p>
          {history.map(r => (
            <div key={r.file_id} className="kv-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={14} style={{ color: 'var(--accent)' }} />
                <strong>{r.filename}</strong>
                <span className="badge badge-ok">{r.chunks} chunks</span>
                <span className="muted">{r.at}</span>
              </div>
              <code style={{ fontSize: '.75rem', color: 'var(--muted)' }}>file_id: {r.file_id}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
