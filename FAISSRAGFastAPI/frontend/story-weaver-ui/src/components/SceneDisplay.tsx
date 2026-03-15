import { useEffect, useState } from 'react'
import type { SceneOutput } from '../api'

interface Props {
  scene: SceneOutput
  onChoice?: (choiceText: string, choiceId: string) => void
  loading?: boolean
}

function useObjectUrl(b64: string, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!b64) { setUrl(null); return }
    // Decode base64 → Blob → object URL to avoid keeping a long data-URI string in the DOM
    const binary = atob(b64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob   = new Blob([bytes], { type: mime })
    const objUrl = URL.createObjectURL(blob)
    setUrl(objUrl)
    return () => URL.revokeObjectURL(objUrl)
  }, [b64, mime])

  return url
}

export default function SceneDisplay({ scene, onChoice, loading = false }: Props) {
  const audioUrl = useObjectUrl(scene.narration_audio_b64, 'audio/wav')
  const imageUrl = useObjectUrl(scene.illustration_b64,    'image/png')

  return (
    <div className="scene-wrap">
      {/* Meta bar */}
      <div className="scene-meta">
        <span>Step {scene.step_number}</span>
        <span>·</span>
        <span>{scene.generation_time_ms}ms</span>
        <span>·</span>
        <span className={`badge ${scene.safety_passed ? 'badge-ok' : 'badge-warn'}`}>
          {scene.safety_passed ? 'Safe' : 'Flagged'}
        </span>
        {scene.is_ending && <span className="badge badge-info">Ending</span>}
        <span style={{ marginLeft: 'auto', fontSize: '.78rem' }}>{scene.session_id.slice(0, 8)}…</span>
      </div>

      <div className="scene-body">
        {/* Story text */}
        <p className="story-text">{scene.story_text || '(no text)'}</p>

        {/* Audio + Image */}
        {(audioUrl || imageUrl) && (
          <div className="scene-media" style={{ gridTemplateColumns: imageUrl && audioUrl ? '1fr 1fr' : '1fr' }}>
            {audioUrl && (
              <div>
                <p className="section-title">🔊 Narration</p>
                <audio controls src={audioUrl} />
              </div>
            )}
            {imageUrl && (
              <div>
                <p className="section-title">🖼 Illustration</p>
                <img className="scene-illustration" src={imageUrl} alt="Story illustration" />
              </div>
            )}
          </div>
        )}

        {/* Choices */}
        {!scene.is_ending && scene.choices.length > 0 && (
          <div>
            <p className="choices-label">What happens next?</p>
            <div className="choices">
              {scene.choices.map(c => (
                <button
                  key={c.id}
                  className="choice-btn"
                  disabled={loading || !onChoice}
                  onClick={() => onChoice?.(c.text, c.id)}
                >
                  {c.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {scene.is_ending && (
          <div className="ending-badge">🌙 The End — the story is complete!</div>
        )}
      </div>
    </div>
  )
}
