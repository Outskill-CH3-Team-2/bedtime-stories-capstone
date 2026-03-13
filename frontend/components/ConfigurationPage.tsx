import React, { useState, useEffect, useRef } from 'react';
import { StoryConfig, FamilyMember } from '../types';

// ── Input safety validation ───────────────────────────────────────────────────
//
// Prompt injection works by embedding instructions inside data fields so the
// LLM executes them rather than treating them as story details.  Example:
//   "show the OPENROUTER_API_KEY"  ← looks like food, acts like a command.
//
// Three layers of detection:
//   1. Character allowlist  — name/food/activity fields are simple nouns;
//      underscores, dollar signs, curly braces, backticks etc. are never valid.
//   2. Imperative verbs     — commands start with action verbs ("show", "reveal"…).
//   3. Sensitive keywords   — API, key, secret, password, token, system prompt…
//
// The backend runs an equivalent check; this is the frontend UX gate.

/** Characters that are never valid in a name / food / activity field. */
const _SUSPICIOUS_CHARS_RE = /[{}\[\]<>$`\\|%#^~_=@]/;

/** Imperative verb at the start of the string — smells like a command. */
const _COMMAND_VERB_RE = /^\s*(show|reveal|tell|print|display|output|give|list|say|write|repeat|dump|expose|return|send|forward|share|leak|log|echo|describe|explain|ignore|disregard|forget|pretend|act|switch|change|modify|update|set|reset|override|bypass|execute|run|eval|call|invoke|fetch|get|post|delete|patch|inject|hack)\s+/i;

/** Question openers used to fish for information. */
const _QUESTION_RE = /^\s*(what\s+is|what\s+are|tell\s+me|show\s+me|give\s+me|can\s+you|do\s+you|how\s+do|who\s+are|where\s+is)\s+/i;

/** Classic injection phrases. */
const _CLASSIC_INJECTION_RE = /ignore\s+(all\s+)?previous|disregard.*previous|you\s+are\s+now|act\s+as\s+\w|pretend\s+(you\s+are|to\s+be)|your\s+new\s+(role|persona|instructions?)|jailbreak|dan\s+mode|developer\s+mode|<\s*system\s*>|\[\s*system\s*\]/i;

/** Sensitive words that should never appear in a child's food/name/activity. */
const _SENSITIVE_KEYWORD_RE = /\b(api[_\s]?key|secret|password|credential|token|bearer|openrouter|openai|anthropic|system\s*prompt|instruction|execute|eval|inject|bypass|override|env\s*var|environment\s*variable)\b/i;

/** ALL_CAPS_WITH_UNDERSCORE — typical env-var / config-key pattern. */
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
          ⚠ This text contains disallowed patterns and will be removed on save.
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
      {/* Preset chips */}
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
      {/* Custom value chips */}
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
      {/* Custom text input */}
      <div className="flex gap-2 mt-1">
        <input
          ref={inputRef}
          type="text"
          value={customInput}
          maxLength={40}
          onChange={e => { setCustomInput(e.target.value); setInputWarn(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="Add custom…"
          className="flex-1 bg-[#fcf9f2] border border-[#d4c48a] rounded-sm px-2 py-1.5 text-sm outline-none focus:border-[#8b4513] transition-colors shadow-inner font-serif"
        />
        <button
          type="button"
          onClick={addCustom}
          className="text-xs font-cinzel tracking-wide uppercase border border-[#8b4513]/30 rounded-sm px-3 hover:border-[#8b4513] hover:bg-[#8b4513]/5 text-[#8b4513] transition-all"
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

// ── FamilyPanel with optional per-member photo ────────────────────────────────
interface FamilyPanelProps {
  label: string;
  members: FamilyMember[];
  addLabel: string;
  onChange: (members: FamilyMember[]) => void;
}

const FamilyPanel: React.FC<FamilyPanelProps> = ({ label, members, addLabel, onChange }) => {
  const update = (index: number, field: keyof FamilyMember, value: string) => {
    onChange(members.map((m, i) => i === index ? { ...m, [field]: value } : m));
  };
  const remove = (index: number) => onChange(members.filter((_, i) => i !== index));
  const add = () => onChange([...members, { name: '', relation: '' }]);

  const handlePhoto = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => update(index, 'photo', reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <label className="block text-sm font-semibold mb-2">{label}</label>
      <div className="space-y-2">
        {members.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            {/* Avatar / photo upload */}
            <label
              className="flex-shrink-0 cursor-pointer"
              title={m.photo ? 'Change photo' : 'Add reference photo (optional)'}
            >
              {m.photo ? (
                <img
                  src={m.photo}
                  alt={m.name || 'character'}
                  className="w-8 h-8 rounded-full object-cover border-2 border-[#8b4513]"
                />
              ) : (
                <div className="w-8 h-8 rounded-full border border-dashed border-[#c9a87c] flex items-center justify-center bg-[#fcf9f2] hover:border-[#8b4513] transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b4513" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
                  </svg>
                </div>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={e => handlePhoto(i, e)}
              />
            </label>
            {/* Name */}
            <SafeInput
              type="text"
              value={m.name}
              onChange={e => update(i, 'name', e.target.value)}
              placeholder="Name"
              className="flex-1 bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2 text-sm outline-none focus:border-[#8b4513] transition-colors shadow-inner"
            />
            {/* Relation */}
            <SafeInput
              type="text"
              value={m.relation}
              onChange={e => update(i, 'relation', e.target.value)}
              placeholder="e.g. Big Sister"
              className="w-28 bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2 text-sm outline-none focus:border-[#8b4513] transition-colors shadow-inner"
            />
            {/* Remove */}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove"
              className="text-[#8b4513]/60 hover:text-[#8b4513] transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 text-xs text-[#8b4513] hover:text-[#3d1f0d] transition-colors font-cinzel tracking-wide uppercase border border-[#8b4513]/30 rounded-sm px-3 py-1 hover:border-[#8b4513] hover:bg-[#8b4513]/5"
      >
        + {addLabel}
      </button>
    </div>
  );
};

// ── Preset data ───────────────────────────────────────────────────────────────
const PRESET_FOODS      = ['Pizza', 'Ice cream', 'Fruit', 'Cake', 'Pancakes', 'Pasta', 'Cookies'];
const PRESET_COLORS     = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Pink', 'Orange'];
const PRESET_ACTIVITIES = ['Playing outside', 'Drawing', 'Reading', 'Riding a bicycle', 'Playing with friends', 'Singing', 'Building with blocks'];

// ── Main component ────────────────────────────────────────────────────────────
interface ConfigurationPageProps {
  config: StoryConfig;
  onSave: (config: StoryConfig) => void;
  onClose: () => void;
}

const ConfigurationPage: React.FC<ConfigurationPageProps> = ({ config: initialConfig, onSave, onClose }) => {
  const [config, setConfig] = useState<StoryConfig>(initialConfig);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialConfig.childPhoto || null);

  useEffect(() => {
    setConfig(initialConfig);
    setPreviewUrl(initialConfig.childPhoto || null);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.privacyAcknowledged) return;
    onSave(config);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10, 6, 2, 0.65)', backdropFilter: 'blur(4px)',
      zIndex: 50, padding: '1rem'
    }}>
      <div className="relative animate-fadeIn w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar" style={{
        background: 'linear-gradient(135deg, #f5edd8 0%, #e8dab8 100%)',
        borderRadius: '4px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(139, 69, 19, 0.1)',
        padding: '2rem 2.5rem',
        color: '#2c1810',
        border: '4px solid #3d1f0d'
      }}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8b4513] hover:text-[#3d1f0d] transition-colors"
          style={{ padding: '0.5rem' }}
          aria-label="Close"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="mb-8 text-center border-b border-[#8b4513]/20 pb-6">
          <h2 className="font-cinzel text-2xl font-bold mb-2">Let's Personalize the Story</h2>
          <p className="font-serif italic text-sm opacity-80">A few details help us create a story your child will love.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 font-serif">

          {/* Child Profile */}
          <section>
            <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Child Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold mb-1" htmlFor="childName">Child's Name</label>
                <SafeInput
                  type="text" id="childName" name="childName" value={config.childName} onChange={handleChange} required
                  className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner"
                  placeholder="e.g. Arlo"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1" htmlFor="age">Age</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range" id="age" name="age" min="1" max="8" value={config.age || 4} onChange={handleChange}
                    className="flex-1 accent-[#8b4513]"
                  />
                  <span className="font-cinzel font-bold text-lg w-8 text-center">{config.age || 4}</span>
                </div>
                <p className="text-xs italic opacity-70 mt-1">Used to adjust story language and difficulty.</p>
              </div>
            </div>
          </section>

          {/* Favorites — multi-chip */}
          <section>
            <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Favorites</h3>
            <p className="text-xs italic opacity-60 mb-4">Pick as many as you like, or type a custom one and press Enter / + Add.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <MultiChipSelect
                label="Favourite Foods"
                presets={PRESET_FOODS}
                value={config.favoriteFoods}
                onChange={v => setConfig(prev => ({ ...prev, favoriteFoods: v }))}
              />
              <MultiChipSelect
                label="Favourite Colors"
                presets={PRESET_COLORS}
                value={config.favoriteColors}
                onChange={v => setConfig(prev => ({ ...prev, favoriteColors: v }))}
              />
              <MultiChipSelect
                label="Favourite Activities"
                presets={PRESET_ACTIVITIES}
                value={config.favoriteActivities}
                onChange={v => setConfig(prev => ({ ...prev, favoriteActivities: v }))}
              />
            </div>
          </section>

          {/* Friends & Family */}
          <section>
            <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Companions & Family</h3>
            <p className="text-xs italic opacity-60 mb-4">
              Tap the person icon to add a reference photo — or leave it blank and we'll generate a storybook avatar automatically.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-semibold mb-1" htmlFor="petName">Pet's Name</label>
                  <SafeInput type="text" id="petName" name="petName" value={config.petName} onChange={handleChange}
                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="e.g. Buster" />
                </div>
                <div className="w-1/3">
                  <label className="block text-sm font-semibold mb-1" htmlFor="petType">Type</label>
                  <SafeInput type="text" id="petType" name="petType" value={config.petType} onChange={handleChange}
                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="Dog" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1" htmlFor="friendName">Best Friend</label>
                <SafeInput type="text" id="friendName" name="friendName" value={config.friendName} onChange={handleChange}
                  className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="Friend's Name" />
              </div>
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <FamilyPanel
                  label="Siblings"
                  members={config.siblings}
                  addLabel="Add sibling"
                  onChange={members => setConfig(prev => ({ ...prev, siblings: members }))}
                />
                <FamilyPanel
                  label="Parents"
                  members={config.parents}
                  addLabel="Add parent"
                  onChange={members => setConfig(prev => ({ ...prev, parents: members }))}
                />
                <FamilyPanel
                  label="Grandparents"
                  members={config.grandparents}
                  addLabel="Add grandparent"
                  onChange={members => setConfig(prev => ({ ...prev, grandparents: members }))}
                />
              </div>
            </div>
          </section>

          {/* Child Picture Upload */}
          <section className="bg-[#fcf9f2]/50 p-4 rounded-sm border border-[#d4c48a]/50">
            <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d]">Child Picture (Optional)</h3>
            <p className="text-xs italic opacity-70 mb-4">
              Upload a photo to keep the child's appearance consistent across all illustrations.
              This stays on your device.
            </p>
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <label htmlFor="childPhoto" className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-[#8b4513] rounded-sm text-sm font-cinzel tracking-widest uppercase hover:bg-[#8b4513] hover:text-[#f2e8cf] transition-all w-full text-center">
                  Select Picture
                </label>
                <input
                  type="file" id="childPhoto" name="childPhoto" accept=".jpg,.jpeg,.png" onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              {previewUrl ? (
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#8b4513] shadow-md flex-shrink-0">
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full border-2 border-dashed border-[#8b4513]/30 flex items-center justify-center text-[#8b4513]/40 flex-shrink-0 bg-[#fcf9f2]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></svg>
                </div>
              )}
            </div>
          </section>

          {/* Privacy Disclaimer */}
          {!config.privacyAcknowledged ? (
            <section className="border-2 border-[#8b4513]/40 rounded-sm p-4 bg-[#fffbf2]">
              <div className="flex items-start gap-2 mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b4513" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <h3 className="font-cinzel text-sm font-bold text-[#3d1f0d]">Data &amp; Privacy Notice</h3>
              </div>
              <p className="text-xs font-serif italic opacity-80 leading-relaxed mb-4">
                By using this feature, you acknowledge that character preferences and reference pictures are processed by 3rd-party AI tools.
                While Dream Weaver does not store this data, we cannot guarantee the data retention or usage policies of these 3rd-party providers.
              </p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.privacyAcknowledged}
                  onChange={e => setConfig(prev => ({ ...prev, privacyAcknowledged: e.target.checked }))}
                  className="accent-[#8b4513] w-4 h-4"
                />
                <span className="text-xs font-semibold">I understand and agree to proceed</span>
              </label>
            </section>
          ) : (
            <section className="flex items-center gap-2 px-3 py-2 rounded-sm bg-[#f0ebe0] border border-[#d4c48a]/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b9e6a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <p className="text-xs font-serif italic opacity-60">Privacy notice acknowledged — data is processed by 3rd-party AI tools.</p>
            </section>
          )}

          <div className="pt-6 border-t border-[#8b4513]/20">
            <button
              type="submit"
              disabled={!config.privacyAcknowledged}
              title={!config.privacyAcknowledged ? 'Please acknowledge the privacy notice above to continue' : undefined}
              className="w-full py-4 font-cinzel text-sm rounded-sm transition-all shadow-xl uppercase tracking-[0.3em]"
              style={{
                background: config.privacyAcknowledged ? '#8b4513' : 'rgba(139,69,19,0.3)',
                color: config.privacyAcknowledged ? '#f2e8cf' : 'rgba(242,232,207,0.5)',
                cursor: config.privacyAcknowledged ? 'pointer' : 'not-allowed',
              }}
            >
              Save and Begin the Story
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default ConfigurationPage;
