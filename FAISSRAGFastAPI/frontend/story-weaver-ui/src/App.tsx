import { useState, type ReactNode } from 'react'
import { Activity, BookOpen, Upload, Sparkles, Mic } from 'lucide-react'
import HealthTab        from './components/HealthTab'
import StoryPipelineTab from './components/StoryPipelineTab'
import RagUploadTab     from './components/RagUploadTab'
import RagStoryTab      from './components/RagStoryTab'
import DebugSttTab      from './components/DebugSttTab'

type Tab = 'health' | 'story' | 'upload' | 'rag' | 'stt'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'health', label: 'Health',         icon: <Activity size={15} /> },
  { id: 'story',  label: 'Story Pipeline', icon: <BookOpen size={15} /> },
  { id: 'upload', label: 'RAG Upload',     icon: <Upload   size={15} /> },
  { id: 'rag',    label: 'RAG Story',      icon: <Sparkles size={15} /> },
  { id: 'stt',    label: 'Debug STT',      icon: <Mic      size={15} /> },
]

export default function App() {
  const [active, setActive] = useState<Tab>('health')

  return (
    <div className="app">
      <header className="app-header">
        <span style={{ fontSize: '1.4rem' }}>🌙</span>
        <div>
          <h1>Story Weaver API Tester</h1>
          <span className="subtitle">backend · localhost:8000</span>
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
        {active === 'health' && <HealthTab />}
        {active === 'story'  && <StoryPipelineTab />}
        {active === 'upload' && <RagUploadTab />}
        {active === 'rag'    && <RagStoryTab />}
        {active === 'stt'    && <DebugSttTab />}
      </main>
    </div>
  )
}
