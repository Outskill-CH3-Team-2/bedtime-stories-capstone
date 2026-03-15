import { useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import RagUploadTab from './components/RagUploadTab'

// Hidden tabs (re-enable by adding back to TABS and imports):
// import { Activity, BookOpen, Mic, Sparkles } from 'lucide-react'
// import HealthTab        from './components/HealthTab'
// import StoryPipelineTab from './components/StoryPipelineTab'
// import DebugSttTab      from './components/DebugSttTab'
// import RagStoryTab      from './components/RagStoryTab'
// { id: 'rag', label: 'RAG Story', icon: <Sparkles size={15} /> }

type Tab = 'upload'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'upload', label: 'Generate Stories from PDF', icon: <Upload size={15} /> },
]

export default function App() {
  const [active, setActive] = useState<Tab>('upload')

  return (
    <div className="app">
      <header className="app-header">
        <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>✦</span>
        <div>
          <h1>Dream Weaver</h1>
          <span className="subtitle">Parent Dashboard · localhost:8000</span>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${active === t.id ? 'active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {active === 'upload' && <RagUploadTab />}
      </main>
    </div>
  )
}
