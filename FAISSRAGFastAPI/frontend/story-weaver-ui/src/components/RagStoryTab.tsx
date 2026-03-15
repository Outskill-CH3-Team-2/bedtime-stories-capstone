import { useState } from 'react'
import { Sparkles, RotateCcw } from 'lucide-react'
import { ragGenerate, storyGenerate, pollUntilDone } from '../api'
import type { SceneOutput, StoryRequest } from '../api'
import SceneDisplay from './SceneDisplay'

const VOICES      = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']
const AGE_GROUPS  = ['3-5', '4-6', '5-7', '6-8']
const LENGTHS     = ['5_minutes', '10_minutes', '15_minutes']

interface Turn { scene: SceneOutput; jobId: string; choiceText: string }

export default function RagStoryTab() {
  const [prompt,      setPrompt]      = useState('A dragon who is afraid of fire learns to be brave')
  const [ageGroup,    setAgeGroup]    = useState('4-6')
  const [storyLength, setStoryLength] = useState('10_minutes')
  const [childName,   setChildName]   = useState('Sam')
  const [voice,       setVoice]       = useState('nova')

  const [sessionId,   setSessionId]   = useState<string | null>(null)
  const [prevJobId,   setPrevJobId]   = useState<string | null>(null)
  const [turns,       setTurns]       = useState<Turn[]>([])
  const [pollStatus,  setPollStatus]  = useState('')
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')

  async function startRagStory() {
    setLoading(true); setErr(''); setPollStatus('starting…')
    setTurns([]); setSessionId(null); setPrevJobId(null)
    try {
      const body: StoryRequest = {
        prompt, age_group: ageGroup, story_length: storyLength,
        child_name: childName || 'Friend', voice,
      }
      const { session_id, job_id } = await ragGenerate(body)
      setSessionId(session_id)
      const scene = await pollUntilDone(job_id, setPollStatus)
      setTurns([{ scene, jobId: job_id, choiceText: '' }])
      setPrevJobId(job_id)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false); setPollStatus('')
    }
  }

  async function chooseOption(choiceText: string) {
    if (!sessionId) return
    setLoading(true); setErr(''); setPollStatus('generating next scene…')
    try {
      const { job_id } = await storyGenerate({
        session_id: sessionId,
        choice_text: choiceText,
        prev_job_id: prevJobId ?? undefined,
        prev_choice_text: turns.at(-1)?.choiceText ?? '',
      })
      const scene = await pollUntilDone(job_id, setPollStatus)
      setTurns(prev => [...prev, { scene, jobId: job_id, choiceText }])
      setPrevJobId(job_id)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false); setPollStatus('')
    }
  }

  function reset() {
    setTurns([]); setSessionId(null); setPrevJobId(null); setErr(''); setPollStatus('')
  }

  const hasStory = turns.length > 0

  return (
    <div>
      <div className="card">
        <p className="card-title">POST /api/v1/generate — RAG-Enhanced Story (Full Pipeline)</p>
        <p className="muted" style={{ marginBottom: 16 }}>
          Generates a story using style from uploaded books (FAISS RAG) + full pipeline:
          audio + illustration + branching choices + session continuations.
        </p>

        <div className="field">
          <label>Story Prompt</label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
        </div>

        <div className="row3">
          <div className="field">
            <label>Child Name</label>
            <input type="text" value={childName} onChange={e => setChildName(e.target.value)} />
          </div>
          <div className="field">
            <label>Age Group</label>
            <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)}>
              {AGE_GROUPS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Story Length</label>
            <select value={storyLength} onChange={e => setStoryLength(e.target.value)}>
              {LENGTHS.map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Voice</label>
          <select value={voice} onChange={e => setVoice(e.target.value)}>
            {VOICES.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={startRagStory} disabled={loading}>
            <Sparkles size={15} /> {loading && !hasStory ? 'Generating…' : 'Generate Story'}
          </button>
          {hasStory && (
            <button className="btn btn-outline" onClick={reset} disabled={loading}>
              <RotateCcw size={15} /> New Story
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="status-bar">
          <div className="spinner" />
          <span>{pollStatus || 'working…'}</span>
        </div>
      )}

      {sessionId && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="muted">session: <code style={{ color: 'var(--accent2)' }}>{sessionId.slice(0,8)}…</code></span>
          <span className="muted">turns: {turns.length}</span>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}

      {turns.map((turn, i) => (
        <div key={turn.jobId} style={{ marginBottom: 16 }}>
          {i > 0 && (
            <div style={{ padding: '8px 0', color: 'var(--muted)', fontSize: '.82rem', marginBottom: 8 }}>
              ▶ Choice: <em>"{turn.choiceText}"</em>
            </div>
          )}
          <SceneDisplay
            scene={turn.scene}
            loading={loading}
            onChoice={i === turns.length - 1 ? chooseOption : undefined}
          />
        </div>
      ))}
    </div>
  )
}
