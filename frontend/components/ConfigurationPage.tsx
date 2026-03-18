import React, { useState, useEffect, useRef } from 'react';
import { StoryConfig, FamilyMember } from '../types';

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

// ── Shared character card used in all carousels ────────────────────────────────
interface CharacterCardProps {
  member: FamilyMember;
  onChange: (updated: FamilyMember) => void;
  onRemove?: () => void;
  /** If true, relation label is read-only display; otherwise editable */
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
      {/* Remove button */}
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

      {/* Photo upload */}
      <label
        className="cursor-pointer"
        title={member.photo ? 'Change photo' : 'Add reference photo (optional)'}
        style={{ marginTop: onRemove ? 6 : 0 }}
      >
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

      {/* Relation — editable or fixed label */}
      {fixedRelation ? (
        <span style={{
          fontSize: 10, color: '#8b4513',
          fontFamily: "'Cinzel', serif",
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          {member.relation || '—'}
        </span>
      ) : (
        <SafeInput
          type="text"
          value={member.relation}
          onChange={e => onChange({ ...member, relation: e.target.value })}
          placeholder="Role (e.g. Sister)"
          style={{ ...CARD_INPUT_STYLE, fontSize: 11, fontFamily: "'Cinzel', serif" }}
        />
      )}

      {/* Name */}
      <SafeInput
        type="text"
        value={member.name}
        onChange={e => onChange({ ...member, name: e.target.value })}
        placeholder="Name"
        style={{ ...CARD_INPUT_STYLE, fontSize: 13, fontWeight: 600 }}
      />

      {/* Age */}
      <input
        type="number"
        min="0"
        max="120"
        value={member.age ?? ''}
        onChange={e => onChange({ ...member, age: e.target.value })}
        placeholder="Age"
        style={CARD_INPUT_STYLE}
      />

      {/* Favourites */}
      <input
        type="text"
        value={member.favourites ?? ''}
        onChange={e => onChange({ ...member, favourites: e.target.value })}
        placeholder="Loves…"
        maxLength={60}
        style={{ ...CARD_INPUT_STYLE, fontStyle: 'italic', fontSize: 11 }}
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
  /** Default relation string pre-filled on new cards (e.g. 'Sibling') */
  defaultRelation?: string;
  /** If true, relation column is a read-only badge (pre-set like Mother/Father) */
  fixedRelations?: boolean;
  /** If true, cards cannot be removed */
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
        {/* Add button — styled as a ghost card */}
        <button
          type="button"
          onClick={add}
          style={{
            width: 80,
            minHeight: 200,
            flexShrink: 0,
            border: '1px dashed #c9a87c',
            borderRadius: 6,
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: '#8b4513',
          }}
        >
          <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
          <span style={{
            fontSize: 9,
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textAlign: 'center',
            lineHeight: 1.3,
          }}>
            {addLabel}
          </span>
        </button>
      </div>
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
      background: 'rgba(8, 4, 1, 0.88)',
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

          {/* ── Child Profile ────────────────────────────────────────────── */}
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
                <input
                  type="number"
                  id="age"
                  name="age"
                  min="1"
                  max="12"
                  value={config.age || ''}
                  onChange={handleChange}
                  placeholder="e.g. 5"
                  className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner"
                />
                <p className="text-xs italic opacity-70 mt-1">Used to adjust story language and difficulty.</p>
              </div>
            </div>
          </section>

          {/* ── Favorites ────────────────────────────────────────────────── */}
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

          {/* ── Companions & Family — all use the same CharacterCarousel ─── */}
          <section>
            <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Companions & Family</h3>
            <p className="text-xs italic opacity-60 mb-4">
              Each card has a name, age, favourite things, and an optional photo. Tap the avatar to upload one.
            </p>
            <div className="space-y-6">

              <CharacterCarousel
                label="Companions (pets, friends…)"
                members={config.companions}
                addLabel="Add"
                defaultRelation=""
                onChange={members => setConfig(prev => ({ ...prev, companions: members }))}
              />

              <CharacterCarousel
                label="Siblings"
                members={config.siblings}
                addLabel="Add sibling"
                defaultRelation="Sibling"
                onChange={members => setConfig(prev => ({ ...prev, siblings: members }))}
              />

              <CharacterCarousel
                label="Parents"
                members={config.parents}
                addLabel="Add parent"
                defaultRelation="Parent"
                fixedRelations
                onChange={members => setConfig(prev => ({ ...prev, parents: members }))}
              />

              <CharacterCarousel
                label="Grandparents"
                members={config.grandparents}
                addLabel="Add grandparent"
                defaultRelation="Grandparent"
                fixedRelations
                onChange={members => setConfig(prev => ({ ...prev, grandparents: members }))}
              />

            </div>
          </section>

          {/* ── Child Picture Upload ──────────────────────────────────────── */}
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

          {/* ── API Settings ──────────────────────────────────────────────── */}
          <section className="bg-[#fcf9f2]/50 p-4 rounded-sm border border-[#d4c48a]/50">
            <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d]">API Settings (Optional)</h3>
            <p className="text-xs italic opacity-70 mb-3">
              This app uses <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline text-[#8b4513]">OpenRouter</a> to
              generate stories. You can provide your own API key to use your own credits instead of the shared demo key.
            </p>

            <label className="block text-sm font-semibold mb-1" htmlFor="openrouterApiKey">OpenRouter API Key</label>
            <input
              type="password"
              id="openrouterApiKey"
              name="openrouterApiKey"
              value={config.openrouterApiKey || ''}
              onChange={e => setConfig(prev => ({ ...prev, openrouterApiKey: e.target.value }))}
              placeholder="sk-or-v1-..."
              autoComplete="off"
              className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner font-mono text-sm"
            />
            <p className="text-xs italic opacity-60 mt-1 mb-4">
              Your key stays in your browser and is sent only to the story server. Never shared or stored server-side.
            </p>

            {/* Cost estimate table */}
            <div className="border border-[#d4c48a]/60 rounded-sm overflow-hidden">
              <div className="bg-[#f0e8d4] px-3 py-1.5 border-b border-[#d4c48a]/60">
                <span className="font-cinzel text-xs font-bold tracking-wide uppercase text-[#3d1f0d]">Estimated Cost per Story</span>
              </div>
              <div className="px-3 py-2 text-xs font-serif space-y-1">
                <div className="flex justify-between">
                  <span className="opacity-70">Text generation (GPT-4o)</span>
                  <span className="font-semibold">~$0.02 / scene</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Safety check (GPT-4o-mini)</span>
                  <span className="font-semibold">~$0.001 / scene</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Illustration (Gemini Flash)</span>
                  <span className="font-semibold">~$0.04 / scene</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Narration audio (GPT-4o Audio)</span>
                  <span className="font-semibold">~$0.05 / scene</span>
                </div>
                <div className="flex justify-between border-t border-[#d4c48a]/40 pt-1 mt-1">
                  <span className="opacity-70">Per scene total</span>
                  <span className="font-semibold">~$0.10 &ndash; $0.15</span>
                </div>
                <div className="flex justify-between font-bold text-[#3d1f0d]">
                  <span>Full story (6&ndash;8 scenes)</span>
                  <span>~$1.00 &ndash; $2.00</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Privacy Disclaimer ───────────────────────────────────────── */}
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
