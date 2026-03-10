import { useState, useRef, useCallback } from "react";

const API_BASE = "http://localhost:8000";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@300;400&display=swap');
`;

const styles = `
  ${FONTS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #1a1208;
    --paper: #f5efe3;
    --paper-dark: #ede4d0;
    --amber: #c8790a;
    --amber-light: #e8971a;
    --rust: #9c3a1a;
    --sage: #4a6741;
    --muted: #7a6a52;
    --line: rgba(26,18,8,0.12);
    --shadow: 0 4px 24px rgba(26,18,8,0.14);
  }

  body { background: var(--paper); font-family: 'DM Mono', monospace; color: var(--ink); }

  .app {
    min-height: 100vh;
    background: var(--paper);
    background-image:
      repeating-linear-gradient(
        0deg,
        transparent,
        transparent 27px,
        rgba(200,121,10,0.06) 27px,
        rgba(200,121,10,0.06) 28px
      );
  }

  .header {
    border-bottom: 2px solid var(--ink);
    padding: 28px 48px 20px;
    display: flex;
    align-items: baseline;
    gap: 16px;
    background: var(--paper);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-title {
    font-family: 'Playfair Display', serif;
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--ink);
  }

  .header-title em {
    color: var(--amber);
    font-style: italic;
  }

  .header-sub {
    font-size: 0.7rem;
    color: var(--muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-top: 2px;
  }

  .health-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-left: auto;
    transition: background 0.4s;
  }
  .health-dot.healthy { background: var(--sage); box-shadow: 0 0 8px var(--sage); }
  .health-dot.error   { background: var(--rust); box-shadow: 0 0 8px var(--rust); }
  .health-dot.unknown { background: var(--muted); }

  .health-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }

  .main {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 0;
    min-height: calc(100vh - 85px);
  }

  /* === SIDEBAR === */
  .sidebar {
    border-right: 2px solid var(--ink);
    padding: 32px 28px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .section-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--muted);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  /* Upload Zone */
  .upload-zone {
    border: 2px dashed var(--amber);
    border-radius: 2px;
    padding: 28px 16px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: transparent;
    position: relative;
    overflow: hidden;
  }
  .upload-zone:hover, .upload-zone.drag-over {
    background: rgba(200,121,10,0.06);
    border-color: var(--amber-light);
  }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

  .upload-icon { font-size: 2rem; margin-bottom: 8px; }
  .upload-text { font-size: 0.75rem; color: var(--muted); line-height: 1.6; }
  .upload-text strong { color: var(--ink); }

  .upload-status {
    margin-top: 10px;
    font-size: 0.7rem;
    padding: 6px 10px;
    border-radius: 1px;
    text-align: center;
  }
  .upload-status.loading { background: rgba(200,121,10,0.12); color: var(--amber); }
  .upload-status.success { background: rgba(74,103,65,0.12); color: var(--sage); }
  .upload-status.error   { background: rgba(156,58,26,0.12); color: var(--rust); }

  /* File registry */
  .file-list { display: flex; flex-direction: column; gap: 8px; }
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.7rem;
    padding: 8px 10px;
    background: var(--paper-dark);
    border-left: 3px solid var(--amber);
  }
  .file-item .file-name { flex: 1; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-item .file-chunks { color: var(--muted); font-size: 0.62rem; }

  .empty-files { font-size: 0.68rem; color: var(--muted); font-style: italic; }

  /* Stats */
  .stats-row { display: flex; gap: 16px; }
  .stat-box {
    flex: 1;
    padding: 12px;
    background: var(--paper-dark);
    border: 1px solid var(--line);
    text-align: center;
  }
  .stat-value { font-family: 'Playfair Display', serif; font-size: 1.6rem; color: var(--amber); }
  .stat-key { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-top: 2px; }

  /* === CONTENT AREA === */
  .content { padding: 36px 48px; display: flex; flex-direction: column; gap: 32px; }

  /* Story Form */
  .story-form { display: flex; flex-direction: column; gap: 20px; }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted); }

  textarea, select, input[type="range"] {
    font-family: 'DM Mono', monospace;
    font-size: 0.82rem;
    color: var(--ink);
    background: var(--paper-dark);
    border: 1.5px solid var(--line);
    border-radius: 1px;
    outline: none;
    transition: border-color 0.2s;
  }
  textarea:focus, select:focus { border-color: var(--amber); }

  textarea {
    padding: 14px 16px;
    resize: vertical;
    min-height: 90px;
    line-height: 1.6;
  }
  select { padding: 10px 14px; appearance: none; cursor: pointer; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .temp-row { display: flex; align-items: center; gap: 12px; }
  .temp-val { font-family: 'Playfair Display', serif; font-size: 1.1rem; color: var(--amber); min-width: 36px; }
  input[type="range"] {
    flex: 1;
    height: 3px;
    -webkit-appearance: none;
    border: none;
    background: linear-gradient(to right, var(--amber) 0%, var(--amber) var(--pct, 50%), var(--line) var(--pct, 50%));
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: var(--amber);
    border: 2px solid var(--paper);
    box-shadow: 0 0 0 1px var(--amber);
  }

  .generate-btn {
    padding: 14px 28px;
    background: var(--ink);
    color: var(--paper);
    border: none;
    font-family: 'DM Mono', monospace;
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    position: relative;
    overflow: hidden;
  }
  .generate-btn::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 0;
    background: var(--amber);
    transition: width 0.3s ease;
    z-index: 0;
  }
  .generate-btn:hover::before { width: 100%; }
  .generate-btn span { position: relative; z-index: 1; }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .generate-btn:disabled::before { display: none; }

  /* Story Output */
  .story-output {
    border: 2px solid var(--ink);
    padding: 40px 44px;
    background: #fffdf7;
    position: relative;
    animation: fadeIn 0.4s ease;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .story-output::before {
    content: '';
    position: absolute;
    left: 6px; top: 6px;
    right: -6px; bottom: -6px;
    border: 2px solid var(--amber);
    z-index: -1;
  }

  .story-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }

  .story-title-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--muted);
  }

  .source-tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .source-tag {
    font-size: 0.6rem;
    padding: 3px 8px;
    background: rgba(200,121,10,0.1);
    color: var(--amber);
    border: 1px solid rgba(200,121,10,0.3);
    letter-spacing: 0.06em;
  }

  .story-body {
    font-family: 'Playfair Display', serif;
    font-size: 1.05rem;
    line-height: 1.9;
    color: var(--ink);
    white-space: pre-wrap;
  }
  .story-body p:first-child::first-letter {
    font-size: 3.2rem;
    float: left;
    line-height: 0.8;
    margin: 6px 10px 0 0;
    color: var(--amber);
    font-weight: 700;
  }

  .copy-btn {
    margin-top: 24px;
    align-self: flex-start;
    padding: 8px 18px;
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: transparent;
    border: 1.5px solid var(--ink);
    color: var(--ink);
    cursor: pointer;
    transition: all 0.2s;
  }
  .copy-btn:hover { background: var(--ink); color: var(--paper); }

  .spinner {
    display: inline-block;
    width: 14px; height: 14px;
    border: 2px solid rgba(245,239,227,0.3);
    border-top-color: var(--paper);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-box {
    padding: 14px 18px;
    background: rgba(156,58,26,0.08);
    border-left: 3px solid var(--rust);
    font-size: 0.75rem;
    color: var(--rust);
    animation: fadeIn 0.3s ease;
  }

  @media (max-width: 900px) {
    .main { grid-template-columns: 1fr; }
    .sidebar { border-right: none; border-bottom: 2px solid var(--ink); }
    .content { padding: 24px 20px; }
    .header { padding: 20px 20px 16px; }
  }
`;

export default function App() {
  const [health, setHealth] = useState({ status: "unknown", chunks: 0 });
  const [files, setFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [isDrag, setIsDrag] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [ageGroup, setAgeGroup] = useState("4-6");
  const [storyLength, setStoryLength] = useState("10_minutes");
  const [temperature, setTemperature] = useState(0.5);
  const [generating, setGenerating] = useState(false);
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef();

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setHealth({ status: data.status, chunks: data.indexed_chunks ?? 0 });
    } catch {
      setHealth({ status: "error", chunks: 0 });
    }
  }, []);

  useState(() => { checkHealth(); }, []);

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "epub"].includes(ext)) {
      setUploadStatus({ type: "error", msg: "Only PDF or EPUB files allowed." });
      return;
    }
    setUploadStatus({ type: "loading", msg: `Uploading ${file.name}…` });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/v1/upload`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Upload failed"); }
      const data = await res.json();
      setFiles(f => [...f, { id: data.file_id, name: file.name, chunks: data.chunks }]);
      setUploadStatus({ type: "success", msg: `✓ ${data.chunks} chunks indexed` });
      checkHealth();
    } catch (e) {
      setUploadStatus({ type: "error", msg: e.message });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setIsDrag(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true); setError(null); setStory(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, age_group: ageGroup, story_length: storyLength, temperature }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Generation failed"); }
      const data = await res.json();
      setStory(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (story?.story) {
      navigator.clipboard.writeText(story.story);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const tempPct = ((temperature - 0) / (1 - 0)) * 100;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div>
            <div className="header-title">Story <em>Engine</em></div>
            <div className="header-sub">RAG-powered children's book author</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="health-label">{health.status}</span>
            <div className={`health-dot ${health.status}`} title={`API: ${health.status}`} />
            <button onClick={checkHealth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--muted)" }}>↺</button>
          </div>
        </header>

        <div className="main">
          {/* Sidebar */}
          <aside className="sidebar">

            {/* Stats */}
            <div>
              <div className="section-label">Index Stats</div>
              <div className="stats-row">
                <div className="stat-box">
                  <div className="stat-value">{health.chunks}</div>
                  <div className="stat-key">Chunks</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value">{files.length}</div>
                  <div className="stat-key">Files</div>
                </div>
              </div>
            </div>

            {/* Upload */}
            <div>
              <div className="section-label">Upload Reference</div>
              <div
                className={`upload-zone ${isDrag ? "drag-over" : ""}`}
                onDragOver={e => { e.preventDefault(); setIsDrag(true); }}
                onDragLeave={() => setIsDrag(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.epub" onChange={e => handleFile(e.target.files[0])} />
                <div className="upload-icon">📚</div>
                <div className="upload-text">
                  <strong>Drop a file here</strong><br />
                  or click to browse<br />
                  PDF &amp; EPUB supported
                </div>
              </div>
              {uploadStatus && (
                <div className={`upload-status ${uploadStatus.type}`}>{uploadStatus.msg}</div>
              )}
            </div>

            {/* File list */}
            <div>
              <div className="section-label">Indexed Files</div>
              {files.length === 0
                ? <div className="empty-files">No files uploaded yet.</div>
                : <div className="file-list">
                    {files.map(f => (
                      <div className="file-item" key={f.id}>
                        <span className="file-name" title={f.name}>📄 {f.name}</span>
                        <span className="file-chunks">{f.chunks}ch</span>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </aside>

          {/* Main Content */}
          <main className="content">
            <div className="story-form">
              <div className="section-label">Story Parameters</div>

              <div className="field">
                <label>Story Prompt</label>
                <textarea
                  placeholder="e.g. A brave little fox who learns to share with her forest friends…"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && e.metaKey && handleGenerate()}
                />
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Age Group</label>
                  <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)}>
                    <option value="0-2">0 – 2 years</option>
                    <option value="2-4">2 – 4 years</option>
                    <option value="4-6">4 – 6 years</option>
                    <option value="6-8">6 – 8 years</option>
                    <option value="8-12">8 – 12 years</option>
                  </select>
                </div>
                <div className="field">
                  <label>Story Length</label>
                  <select value={storyLength} onChange={e => setStoryLength(e.target.value)}>
                    <option value="5_minutes">5 min  (~700 words)</option>
                    <option value="10_minutes">10 min (~1400 words)</option>
                    <option value="15_minutes">15 min (~2100 words)</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Creativity / Temperature</label>
                <div className="temp-row">
                  <span className="temp-val">{temperature.toFixed(1)}</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={temperature}
                    style={{ "--pct": `${tempPct}%` }}
                    onChange={e => setTemperature(parseFloat(e.target.value))}
                  />
                </div>
              </div>

              <button
                className="generate-btn"
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
              >
                {generating
                  ? <><span className="spinner" /> <span>Crafting your story…</span></>
                  : <span>✦ Generate Story</span>
                }
              </button>
            </div>

            {error && <div className="error-box">⚠ {error}</div>}

            {story && (
              <div className="story-output">
                <div className="story-header">
                  <span className="story-title-label">Generated Story</span>
                  {story.sources?.length > 0 && (
                    <div className="source-tags">
                      {story.sources.filter(Boolean).map((s, i) => (
                        <span className="source-tag" key={i}>{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="story-body">
                  <p>{story.story}</p>
                </div>
                <button className="copy-btn" onClick={handleCopy}>
                  {copied ? "✓ Copied!" : "Copy Story"}
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
