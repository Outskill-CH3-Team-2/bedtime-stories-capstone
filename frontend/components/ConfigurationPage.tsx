import React, { useState, useEffect, useRef } from 'react';
import { StoryConfig, FamilyMember } from '../types';
import { storyService } from '../services/storyService';

// ── Input safety validation ───────────────────────────────────────────────────
const _SUSPICIOUS_CHARS_RE = /[{}\[\]<>$`\\|%#^~_=@]/;
const _COMMAND_VERB_RE = /^\s*(show|reveal|tell|print|display|output|give|list|say|write|repeat|dump|expose|return|send|forward|share|leak|log|echo|describe|explain|ignore|disregard|forget|pretend|act|switch|change|modify|update|set|reset|override|bypass|execute|run|eval|call|invoke|fetch|get|post|delete|patch|inject|hack)\s+/i;
const _QUESTION_RE = /^\s*(what\s+is|what\s+are|tell\s+me|show\s+me|give\s+me|can\s+you|do\s+you|how\s+do|who\s+are|where\s+is)\s+/i;
const _CLASSIC_INJECTION_RE = /ignore\s+(all\s+)?previous|disregard.*previous|you\s+are\s+now|act\s+as\s+\w|pretend\s+(you\s+are|to\s+be)|your\s+new\s+(role|persona|instructions?)|jailbreak|dan\s+mode|developer\s+mode|<\s*system\s*>|\[\s*system\s*\]/i;
const _SENSITIVE_KEYWORD_RE = /\b(api[_\s]?key|secret|password|credential|token|bearer|openrouter|openai|anthropic|system\s*prompt|instruction|execute|eval|inject|bypass|override|env\s*var|environment\s*variable)\b/i;
const _ENV_VAR_RE = /[A-Z]{2,}_[A-Z]{2,}/;

function hasInjectionRisk(text: string): boolean {
  if (!text.trim()) return false;
  return (
    _SUSPICIOUS_CHARS_RE.test(text)   ||
    _COMMAND_VERB_RE.test(text)        ||
    _QUESTION_RE.test(text)            ||
    _CLASSIC_INJECTION_RE.test(text)   ||
    _SENSITIVE_KEYWORD_RE.test(text)   ||
    _ENV_VAR_RE.test(text)
  );
}

// ── Validated text input ──────────────────────────────────────────────────────
interface SafeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
const SafeInput: React.FC<SafeInputProps> = ({ value, onChange, ...rest }) => {
  const [warn, setWarn] = useState(false);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWarn(hasInjectionRisk(e.target.value));
    onChange(e);
  };
  return (
    <div className="w-full">
      <input value={value} onChange={handleChange} {...rest} />
      {warn && (
        <p className="text-xs text-[#c0392b] mt-0.5 font-serif italic">
          ⚠ Disallowed pattern.
        </p>
      )}
    </div>
  );
};

// ── Multi-chip selector ───────────────────────────────────────────────────────
interface MultiChipSelectProps {
  label: string;
  presets: string[];
  value: string[];
  onChange: (values: string[]) => void;
}
const MultiChipSelect: React.FC<MultiChipSelectProps> = ({ label, presets, value, onChange }) => {
  const [customInput, setCustomInput] = useState('');
  const [inputWarn, setInputWarn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = (item: string) => {
    onChange(value.includes(item) ? value.filter(v => v !== item) : [...value, item]);
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (hasInjectionRisk(trimmed)) { setInputWarn(true); return; }
    if (trimmed.length > 40) return;
    if (!value.includes(trimmed)) onChange([...value, trimmed]);
    setCustomInput('');
    setInputWarn(false);
  };

  const customValues = value.filter(v => !presets.includes(v));

  return (
    <div>
      <label className="block text-sm font-semibold mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {presets.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            className="px-3 py-1 rounded-full text-xs font-serif border transition-all"
            style={{
              background: value.includes(p) ? '#8b4513' : '#fcf9f2',
              color: value.includes(p) ? '#f2e8cf' : '#2c1810',
              borderColor: value.includes(p) ? '#8b4513' : '#d4c48a',
            }}
          >
            {value.includes(p) ? '✓ ' : ''}{p}
          </button>
        ))}
      </div>
      {customValues.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {customValues.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-serif border"
              style={{ background: '#f0e8d4', borderColor: '#c9a87c', color: '#2c1810' }}
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                className="text-[#8b4513] hover:text-[#3d1f0d] leading-none"
                aria-label={`Remove ${v}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-1">
        <input
          ref={inputRef}
          type="text"
          value={customInput}
          maxLength={40}
          onChange={e => { setCustomInput(e.target.value); setInputWarn(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="Add custom…"
          className="flex-1 min-w-[80px] bg-[#fcf9f2] border border-[#d4c48a] rounded-sm px-2 py-1.5 text-sm outline-none focus:border-[#8b4513] transition-colors shadow-inner font-serif"
        />
        <button
          type="button"
          onClick={addCustom}
          className="flex-shrink-0 whitespace-nowrap text-xs font-cinzel tracking-wide uppercase border border-[#8b4513]/30 rounded-sm px-3 hover:border-[#8b4513] hover:bg-[#8b4513]/5 text-[#8b4513] transition-all"
        >
          + Add
        </button>
      </div>
      {inputWarn && (
        <p className="text-xs text-[#c0392b] mt-1 font-serif italic">
          ⚠ That text contains disallowed patterns.
        </p>
      )}
    </div>
  );
};

// ── Shared character card used in all carousels ────────────────────────────────
interface CharacterCardProps {
  member: FamilyMember;
  onChange: (updated: FamilyMember) => void;
  onRemove?: () => void;
  fixedRelation?: boolean;
}

const CARD_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  textAlign: 'center',
  fontSize: 12,
  background: '#fcf9f2',
  border: '1px solid #d4c48a',
  borderRadius: 3,
  padding: '4px 6px',
  outline: 'none',
  fontFamily: "'Georgia', serif",
  color: '#2c1810',
  boxSizing: 'border-box',
};

const CharacterCard: React.FC<CharacterCardProps> = ({ member, onChange, onRemove, fixedRelation }) => {
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onChange({ ...member, photo: reader.result as string });
    reader.readAsDataURL(file);
  };

  return (
    <div style={{
      width: 148,
      flexShrink: 0,
      background: '#fcf9f2',
      border: '1px solid #d4c48a',
      borderRadius: 6,
      padding: '12px 10px 14px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      position: 'relative',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          style={{
            position: 'absolute', top: 5, right: 5,
            width: 20, height: 20, borderRadius: '50%',
            background: 'rgba(139,69,19,0.1)',
            border: '1px solid rgba(139,69,19,0.2)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#8b4513', fontSize: 13, lineHeight: 1,
          }}
        >×</button>
      )}

      <label className="cursor-pointer" style={{ marginTop: onRemove ? 6 : 0 }}>
        {member.photo ? (
          <img
            src={member.photo}
            alt={member.name || 'character'}
            style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid #8b4513' }}
          />
        ) : (
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            border: '1px dashed #c9a87c', background: '#f5edd8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c9a87c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
            </svg>
          </div>
        )}
        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handlePhoto} />
      </label>

      {fixedRelation ? (
        <span style={{ fontSize: 10, color: '#8b4513', fontFamily: "'Cinzel', serif", letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {member.relation || '—'}
        </span>
      ) : (
        <SafeInput
          type="text"
          value={member.relation}
          onChange={e => onChange({ ...member, relation: e.target.value })}
          placeholder="Role"
          style={{ ...CARD_INPUT_STYLE, fontSize: 11, fontFamily: "'Cinzel', serif" }}
        />
      )}

      <SafeInput
        type="text"
        value={member.name}
        onChange={e => onChange({ ...member, name: e.target.value })}
        placeholder="Name"
        style={{ ...CARD_INPUT_STYLE, fontSize: 13, fontWeight: 600 }}
      />

      <input
        type="number"
        min="0"
        value={member.age ?? ''}
        onChange={e => onChange({ ...member, age: e.target.value })}
        placeholder="Age"
        style={CARD_INPUT_STYLE}
      />
    </div>
  );
};

// ── Horizontal carousel of character cards ────────────────────────────────────
interface CharacterCarouselProps {
  label: string;
  members: FamilyMember[];
  addLabel: string;
  onChange: (members: FamilyMember[]) => void;
  defaultRelation?: string;
  fixedRelations?: boolean;
  noRemove?: boolean;
}

const CharacterCarousel: React.FC<CharacterCarouselProps> = ({
  label, members, addLabel, onChange,
  defaultRelation = '', fixedRelations = false, noRemove = false,
}) => {
  const update = (index: number, updated: FamilyMember) =>
    onChange(members.map((m, i) => i === index ? updated : m));
  const remove = (index: number) => onChange(members.filter((_, i) => i !== index));
  const add = () => onChange([...members, { name: '', relation: defaultRelation, age: '', favourites: '' }]);

  return (
    <div>
      <label className="block text-sm font-semibold mb-2">{label}</label>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
        {members.map((m, i) => (
          <CharacterCard
            key={i}
            member={m}
            onChange={updated => update(i, updated)}
            onRemove={noRemove ? undefined : () => remove(i)}
            fixedRelation={fixedRelations}
          />
        ))}
        <button
          type="button"
          onClick={add}
          style={{
            width: 80, minHeight: 180, flexShrink: 0, border: '1px dashed #c9a87c',
            borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: '#8b4513',
          }}
        >
          <span style={{ fontSize: 24 }}>+</span>
          <span style={{ fontSize: 9, fontFamily: "'Cinzel', serif", textTransform: 'uppercase' }}>{addLabel}</span>
        </button>
      </div>
    </div>
  );
};

const PRESET_FOODS      = ['Pizza', 'Ice cream', 'Fruit', 'Cake', 'Pancakes', 'Pasta', 'Cookies'];
const PRESET_COLORS     = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Pink', 'Orange'];
const PRESET_ACTIVITIES = ['Playing outside', 'Drawing', 'Reading', 'Riding a bicycle', 'Singing'];

// ── Main Component ────────────────────────────────────────────────────────────
interface ConfigurationPageProps {
  config: StoryConfig;
  onSave: (config: StoryConfig) => void;
  onClose: () => void;
}

const ConfigurationPage: React.FC<ConfigurationPageProps> = ({ config: initialConfig, onSave, onClose }) => {
  const [config, setConfig] = useState<StoryConfig>(initialConfig);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialConfig.childPhoto || null);
  const [isValidating, setIsValidating] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [libraryFiles, setLibraryFiles] = useState<{name: string, chunks: number, source: string}[]>([]);

  const refreshLibrary = async () => {
    try {
      const data = await storyService.getLibrary();
      const files = Object.entries(data.files || {}).map(([name, info]: [string, any]) => ({
        name,
        chunks: info.chunk_count,
        source: info.source_type
      }));
      setLibraryFiles(files);
    } catch (e) {
      console.warn("Could not fetch library:", e);
    }
  };

  useEffect(() => {
    setConfig(initialConfig);
    setPreviewUrl(initialConfig.childPhoto || null);
    refreshLibrary();
  }, [initialConfig]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setConfig(prev => ({ ...prev, childPhoto: result }));
        setPreviewUrl(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeFile = async (filename: string) => {
    if (!confirm(`Remove "${filename}" from the story library?`)) return;
    try {
      const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${baseUrl}/story/library/${filename}`, { method: 'DELETE' });
      if (response.ok) refreshLibrary();
    } catch (e) {
      alert("Failed to delete file.");
    }
  };

  const clearAllLibrary = async () => {
    if (!confirm("Clear all documents from the library? This cannot be undone.")) return;
    const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
    for (const file of libraryFiles) {
      await fetch(`${baseUrl}/story/library/${file.name}`, { method: 'DELETE' });
    }
    refreshLibrary();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.privacyAcknowledged) return;
    
    if (config.openrouterApiKey?.trim()) {
      setIsValidating(true);
      setKeyError('');
      const isValid = await storyService.validateKey(config.openrouterApiKey);
      setIsValidating(false);
      
      if (!isValid) {
        setKeyError('Invalid API Key. Please check your OpenRouter key.');
        return;
      }
    }
    onSave(config);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8, 4, 1, 0.88)', zIndex: 50, padding: '1rem' }}>
      <div className="relative animate-fadeIn w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar" style={{ background: 'linear-gradient(135deg, #f5edd8 0%, #e8dab8 100%)', borderRadius: '4px', border: '4px solid #3d1f0d', padding: '2rem 2.5rem', color: '#2c1810' }}>
        
        <button onClick={onClose} className="absolute top-4 right-4 text-[#8b4513] hover:text-[#3d1f0d]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="mb-8 text-center border-b border-[#8b4513]/20 pb-6">
          <h2 className="font-cinzel text-2xl font-bold mb-2">Personalize the Story</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 font-serif">
          
          <section>
            <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1">Child Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold mb-1">Name</label>
                <SafeInput type="text" name="childName" value={config.childName} onChange={handleChange} required className="w-full bg-[#fcf9f2] border border-[#d4c48a] p-2.5 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Age</label>
                <input type="number" name="age" min="1" max="12" value={config.age || ''} onChange={handleChange} className="w-full bg-[#fcf9f2] border border-[#d4c48a] p-2.5 outline-none" />
              </div>
            </div>
          </section>

          <section>
            <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1">Favorites</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <MultiChipSelect label="Foods" presets={PRESET_FOODS} value={config.favoriteFoods} onChange={v => setConfig(p => ({ ...p, favoriteFoods: v }))} />
              <MultiChipSelect label="Colors" presets={PRESET_COLORS} value={config.favoriteColors} onChange={v => setConfig(p => ({ ...p, favoriteColors: v }))} />
              <MultiChipSelect label="Activities" presets={PRESET_ACTIVITIES} value={config.favoriteActivities} onChange={v => setConfig(p => ({ ...p, favoriteActivities: v }))} />
            </div>
          </section>

          {/* ── Knowledge Library (RAG) ─────────────────────────────────── */}
          <section className="bg-[#fcf9f2]/50 p-4 rounded-sm border border-[#d4c48a]/50">
            <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d]">Story Library</h3>
            <div className="flex flex-col gap-3 mb-6">
              <label className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-[#8b4513]/40 rounded-sm text-xs font-cinzel tracking-widest uppercase hover:bg-[#8b4513]/5 transition-all w-full text-center">
                Upload Style Reference (PDF)
                <input type="file" accept=".pdf" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const res = await storyService.uploadDocument(file);
                      alert(`Indexed ${res.chunks_added} sections.`);
                      refreshLibrary();
                    } catch (err: any) { alert(`Failed: ${err.message}`); }
                  }
                }} />
              </label>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              <h4 className="text-[10px] font-cinzel tracking-widest uppercase opacity-50 mb-2">Indexed Documents</h4>
              {libraryFiles.length === 0 ? (
                <p className="text-xs italic opacity-40 text-center py-2">Library is empty.</p>
              ) : (
                libraryFiles.map((file) => (
                  <div key={file.name} className="flex items-center justify-between bg-white/40 p-2 rounded-sm border border-[#d4c48a]/30">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium truncate max-w-[180px]">{file.name}</span>
                      <span className="text-[9px] opacity-50 uppercase">{file.chunks} chunks • {file.source}</span>
                    </div>
                    <button type="button" onClick={() => removeFile(file.name)} className="text-[#c0392b] p-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            {libraryFiles.length > 0 && (
              <button type="button" onClick={clearAllLibrary} className="mt-4 w-full text-[10px] font-cinzel text-[#c0392b]/60 hover:text-[#c0392b]">
                Clear Entire Library
              </button>
            )}
          </section>

          <section className="bg-[#fcf9f2]/50 p-4 border border-[#d4c48a]/50">
            <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d]">API Settings</h3>
            <input type="password" name="openrouterApiKey" value={config.openrouterApiKey || ''} onChange={e => { setConfig(p => ({ ...p, openrouterApiKey: e.target.value })); setKeyError(''); }} placeholder="sk-or-v1-..." className="w-full bg-[#fcf9f2] border border-[#d4c48a] p-2.5 outline-none font-mono text-sm" />
            {keyError && <p className="text-xs text-[#c0392b] mt-1 font-semibold">{keyError}</p>}
          </section>

          <section className="border-2 border-[#8b4513]/40 p-4 bg-[#fffbf2]">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={config.privacyAcknowledged} onChange={e => setConfig(p => ({ ...p, privacyAcknowledged: e.target.checked }))} className="accent-[#8b4513] w-4 h-4" />
              <span className="text-xs font-semibold">I understand and agree to the privacy notice.</span>
            </label>
          </section>

          <div className="pt-6 border-t border-[#8b4513]/20">
            <button type="submit" disabled={!config.privacyAcknowledged || isValidating} className="w-full py-4 font-cinzel text-sm rounded-sm shadow-xl uppercase tracking-[0.3em] flex items-center justify-center" style={{ background: config.privacyAcknowledged && !isValidating ? '#8b4513' : 'rgba(139,69,19,0.3)', color: '#f2e8cf' }}>
              {isValidating ? 'Validating Key...' : 'Save and Begin'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default ConfigurationPage;