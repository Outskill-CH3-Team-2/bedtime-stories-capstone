import type { SceneOutput } from '../api'

interface Props {
  scene: SceneOutput
  onChoice?: (choiceText: string, choiceId: string) => void
  loading?: boolean
}

export default function SceneDisplay({ scene, onChoice, loading = false }: Props) {
  const audioSrc = scene.narration_audio_b64
    ? `data:audio/wav;base64,${scene.narration_audio_b64}`
    : null
  const imageSrc = scene.illustration_b64
    ? `data:image/png;base64,${scene.illustration_b64}`
    : null

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
        {(audioSrc || imageSrc) && (
          <div className="scene-media" style={{ gridTemplateColumns: imageSrc && audioSrc ? '1fr 1fr' : '1fr' }}>
            {audioSrc && (
              <div>
                <p className="section-title">🔊 Narration</p>
                <audio controls src={audioSrc} />
              </div>
            )}
            {imageSrc && (
              <div>
                <p className="section-title">🖼 Illustration</p>
                <img className="scene-illustration" src={imageSrc} alt="Story illustration" />
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
