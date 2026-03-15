import { useRef, useState } from 'react'
import { Mic, Play } from 'lucide-react'
import { debugStt } from '../api'
import type { SttDebugResponse } from '../api'

export default function DebugSttTab() {
  const inputRef   = useRef<HTMLInputElement>(null)
  const [file,     setFile]     = useState<File | null>(null)
  const [jobId,    setJobId]    = useState('')
  const [storyTxt, setStoryTxt] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [result,   setResult]   = useState<SttDebugResponse | null>(null)

  async function run() {
    if (!file) return
    setLoading(true); setErr(''); setResult(null)
    try {
      const b64 = await fileToBase64(file)
      const res = await debugStt(b64, jobId, storyTxt)
      setResult(res)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="card">
        <p className="card-title">POST /story/debug/stt — Whisper Transcription Diagnostic</p>
        <p className="muted" style={{ marginBottom: 16 }}>
          Transcribes a WAV file with Whisper and measures word-overlap against the expected
          story text. Useful for diagnosing TTS/audio mismatches.
        </p>

        {/* WAV file */}
        <div className="field">
          <label>WAV Audio File</label>
          <div
            style={{ border: '1px dashed var(--border)', borderRadius: 7, padding: '14px 16px',
                     cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10 }}
            onClick={() => inputRef.current?.click()}
          >
            <Mic size={16} />
            <span>{file ? file.name : 'Click to select a .wav file'}</span>
            <input ref={inputRef} type="file" accept=".wav,audio/wav" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
          </div>
        </div>

        <div className="field">
          <label>Job ID (optional)</label>
          <input type="text" placeholder="e.g. abc123" value={jobId} onChange={e => setJobId(e.target.value)} />
        </div>

        <div className="field">
          <label>Expected Story Text (optional — for overlap calculation)</label>
          <textarea rows={4} placeholder="Paste the story narration text here…"
            value={storyTxt} onChange={e => setStoryTxt(e.target.value)} />
        </div>

        {err && <div className="error-box">{err}</div>}

        <button className="btn btn-primary" onClick={run} disabled={!file || loading}>
          <Play size={15} /> {loading ? 'Transcribing…' : 'Run Whisper STT'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="card">
          <p className="card-title">Result</p>

          {result.skipped ? (
            <div className="error-box">{result.reason ?? 'Skipped (DEBUG=true not set on server)'}</div>
          ) : (
            <>
              <div className="kv-row">
                <span className="kv-key">Word Overlap</span>
                <span className="kv-val">
                  <span className={`badge ${(result.word_overlap_pct ?? 0) >= 40
                    ? 'badge-ok' : 'badge-warn'}`}>
                    {result.word_overlap_pct ?? '—'}%
                  </span>
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Match (&gt;40%)</span>
                <span className="kv-val">
                  {result.match === null
                    ? '—'
                    : result.match
                      ? <span className="badge badge-ok">yes</span>
                      : <span className="badge badge-warn">no</span>
                  }
                </span>
              </div>
              <p className="muted" style={{ marginTop: 10, fontSize: '.8rem' }}>
                Note: transcript and story text are no longer returned in the response (privacy fix).
                Word-overlap is computed server-side.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => {
      const result = reader.result as string
      // Strip the data URI prefix — API expects raw base64
      resolve(result.split(',')[1] ?? result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
