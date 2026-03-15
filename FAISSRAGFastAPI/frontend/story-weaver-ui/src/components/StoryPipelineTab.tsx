import { useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { storyGenerate, pollUntilDone } from '../api'
import type { SceneOutput, ChildConfig } from '../api'
import SceneDisplay from './SceneDisplay'

interface Turn {
  scene: SceneOutput
  jobId: string
  choiceText: string
}

const VOICES = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']

export default function StoryPipelineTab() {
  // Config form
  const [childName,  setChildName]  = useState('Alex')
  const [childAge,   setChildAge]   = useState(5)
  const [storyIdea,  setStoryIdea]  = useState('A brave rabbit who discovers a hidden door in the forest')
  const [voice,      setVoice]      = useState('onyx')

  // Personalization (collapsible)
  const [showPersonal, setShowPersonal] = useState(false)
  const [animal,    setAnimal]    = useState('')
  const [colour,    setColour]    = useState('')
  const [food,      setFood]      = useState('')
  const [place,     setPlace]     = useState('')

  // Session state
  const [sessionId,  setSessionId]  = useState<string | null>(null)
  const [prevJobId,  setPrevJobId]  = useState<string | null>(null)
  const [turns,      setTurns]      = useState<Turn[]>([])
  const [pollStatus, setPollStatus] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [err,        setErr]        = useState('')

  async function startStory() {
    setLoading(true); setErr(''); setPollStatus('starting…')
    setTurns([]); setSessionId(null); setPrevJobId(null)
    try {
      const config: ChildConfig = {
        child_name: childName || 'Friend',
        child_age:  childAge,
        voice,
        personalization: { favourite_animal: animal, favourite_colour: colour,
                           favourite_food: food, place_to_visit: place },
      }
      const { session_id, job_id } = await storyGenerate({ config, story_idea: storyIdea })
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
      {/* Config card */}
      <div className="card">
        <p className="card-title">POST /story/generate — Story Configuration</p>
        <div className="row2">
          <div className="field">
            <label>Child Name</label>
            <input type="text" value={childName} onChange={e => setChildName(e.target.value)} />
          </div>
          <div className="field">
            <label>Child Age</label>
            <input type="number" min={3} max={8} value={childAge} onChange={e => setChildAge(+e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Story Idea</label>
          <textarea value={storyIdea} onChange={e => setStoryIdea(e.target.value)} rows={3} />
        </div>
        <div className="field">
          <label>Voice</label>
          <select value={voice} onChange={e => setVoice(e.target.value)}>
            {VOICES.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>

        {/* Personalization toggle */}
        <button className="btn btn-outline btn-sm" style={{ marginBottom: 14 }}
          onClick={() => setShowPersonal(!showPersonal)}>
          {showPersonal ? '▲' : '▼'} Personalization (optional)
        </button>
        {showPersonal && (
          <div className="row2" style={{ marginBottom: 14 }}>
            <div className="field"><label>Favourite Animal</label>
              <input type="text" value={animal} onChange={e => setAnimal(e.target.value)} /></div>
            <div className="field"><label>Favourite Colour</label>
              <input type="text" value={colour} onChange={e => setColour(e.target.value)} /></div>
            <div className="field"><label>Favourite Food</label>
              <input type="text" value={food} onChange={e => setFood(e.target.value)} /></div>
            <div className="field"><label>Dream Destination</label>
              <input type="text" value={place} onChange={e => setPlace(e.target.value)} /></div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={startStory} disabled={loading}>
            <Play size={15} /> {loading && !hasStory ? 'Generating…' : 'Start Story'}
          </button>
          {hasStory && (
            <button className="btn btn-outline" onClick={reset} disabled={loading}>
              <RotateCcw size={15} /> New Story
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      {loading && (
        <div className="status-bar">
          <div className="spinner" />
          <span>{pollStatus || 'working…'}</span>
        </div>
      )}

      {/* Session info */}
      {sessionId && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="muted">session: <code style={{ color: 'var(--accent2)' }}>{sessionId.slice(0,8)}…</code></span>
          <span className="muted">turns: {turns.length}</span>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}

      {/* Story turns */}
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
