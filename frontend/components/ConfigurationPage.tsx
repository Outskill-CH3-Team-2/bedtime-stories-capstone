import React, { useState, useEffect } from 'react';
import { StoryConfig } from '../types';

interface ConfigurationPageProps {
    config: StoryConfig;
    onSave: (config: StoryConfig) => void;
    onClose: () => void;
}

const PRESET_FOODS = ['Pizza', 'Ice cream', 'Fruit', 'Cake', 'Pancakes'];
const PRESET_COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'Purple'];
const PRESET_ACTIVITIES = ['Playing outside', 'Drawing', 'Reading', 'Riding a bicycle', 'Playing with friends'];

const ConfigurationPage: React.FC<ConfigurationPageProps> = ({ config: initialConfig, onSave, onClose }) => {
    const [config, setConfig] = useState<StoryConfig>(initialConfig);
    const [previewUrl, setPreviewUrl] = useState<string | null>(initialConfig.childPhoto || null);

    // Track which favorites fields are in "custom" mode
    const [customFood, setCustomFood] = useState(!PRESET_FOODS.includes(initialConfig.favoriteFood) && !!initialConfig.favoriteFood);
    const [customColor, setCustomColor] = useState(!PRESET_COLORS.includes(initialConfig.favoriteColor) && !!initialConfig.favoriteColor);
    const [customActivity, setCustomActivity] = useState(!PRESET_ACTIVITIES.includes(initialConfig.favoriteActivity) && !!initialConfig.favoriteActivity);

    useEffect(() => {
        setConfig(initialConfig);
        setPreviewUrl(initialConfig.childPhoto || null);
        setCustomFood(!PRESET_FOODS.includes(initialConfig.favoriteFood) && !!initialConfig.favoriteFood);
        setCustomColor(!PRESET_COLORS.includes(initialConfig.favoriteColor) && !!initialConfig.favoriteColor);
        setCustomActivity(!PRESET_ACTIVITIES.includes(initialConfig.favoriteActivity) && !!initialConfig.favoriteActivity);
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
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
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
                                <input
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

                    {/* Child Preferences */}
                    <section>
                        <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Favorites</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Favorite Food */}
                            <div>
                                <label className="block text-sm font-semibold mb-1" htmlFor="favoriteFood">Food</label>
                                <select
                                    id="favoriteFood"
                                    value={customFood ? 'Custom' : config.favoriteFood}
                                    onChange={(e) => {
                                        if (e.target.value === 'Custom') {
                                            setCustomFood(true);
                                            setConfig(prev => ({ ...prev, favoriteFood: '' }));
                                        } else {
                                            setCustomFood(false);
                                            setConfig(prev => ({ ...prev, favoriteFood: e.target.value }));
                                        }
                                    }}
                                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner appearance-none cursor-pointer">
                                    <option value="">Select...</option>
                                    {PRESET_FOODS.map(f => <option key={f} value={f}>{f}</option>)}
                                    <option value="Custom">✏️ Custom...</option>
                                </select>
                                {customFood && (
                                    <input
                                        type="text"
                                        name="favoriteFood"
                                        value={config.favoriteFood}
                                        onChange={handleChange}
                                        autoFocus
                                        placeholder="Type your child's favourite food…"
                                        className="w-full mt-2 bg-[#fcf9f2] border border-[#8b4513]/50 rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner text-sm"
                                    />
                                )}
                            </div>
                            {/* Favorite Color */}
                            <div>
                                <label className="block text-sm font-semibold mb-1" htmlFor="favoriteColor">Color</label>
                                <select
                                    id="favoriteColor"
                                    value={customColor ? 'Custom' : config.favoriteColor}
                                    onChange={(e) => {
                                        if (e.target.value === 'Custom') {
                                            setCustomColor(true);
                                            setConfig(prev => ({ ...prev, favoriteColor: '' }));
                                        } else {
                                            setCustomColor(false);
                                            setConfig(prev => ({ ...prev, favoriteColor: e.target.value }));
                                        }
                                    }}
                                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner appearance-none cursor-pointer">
                                    <option value="">Select...</option>
                                    {PRESET_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    <option value="Custom">✏️ Custom...</option>
                                </select>
                                {customColor && (
                                    <input
                                        type="text"
                                        name="favoriteColor"
                                        value={config.favoriteColor}
                                        onChange={handleChange}
                                        autoFocus
                                        placeholder="Type your child's favourite color…"
                                        className="w-full mt-2 bg-[#fcf9f2] border border-[#8b4513]/50 rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner text-sm"
                                    />
                                )}
                            </div>
                            {/* Favorite Activity */}
                            <div>
                                <label className="block text-sm font-semibold mb-1" htmlFor="favoriteActivity">Activity</label>
                                <select
                                    id="favoriteActivity"
                                    value={customActivity ? 'Custom' : config.favoriteActivity}
                                    onChange={(e) => {
                                        if (e.target.value === 'Custom') {
                                            setCustomActivity(true);
                                            setConfig(prev => ({ ...prev, favoriteActivity: '' }));
                                        } else {
                                            setCustomActivity(false);
                                            setConfig(prev => ({ ...prev, favoriteActivity: e.target.value }));
                                        }
                                    }}
                                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner appearance-none cursor-pointer">
                                    <option value="">Select...</option>
                                    {PRESET_ACTIVITIES.map(a => <option key={a} value={a}>{a}</option>)}
                                    <option value="Custom">✏️ Custom...</option>
                                </select>
                                {customActivity && (
                                    <input
                                        type="text"
                                        name="favoriteActivity"
                                        value={config.favoriteActivity}
                                        onChange={handleChange}
                                        autoFocus
                                        placeholder="Type your child's favourite activity…"
                                        className="w-full mt-2 bg-[#fcf9f2] border border-[#8b4513]/50 rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner text-sm"
                                    />
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Friends & Family */}
                    <section>
                        <h3 className="font-cinzel text-lg mb-4 text-[#3d1f0d] border-b border-[#8b4513]/10 pb-1 inline-block">Companions & Family</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-sm font-semibold mb-1" htmlFor="petName">Pet's Name</label>
                                    <input type="text" id="petName" name="petName" value={config.petName} onChange={handleChange}
                                        className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="e.g. Buster" />
                                </div>
                                <div className="w-1/3">
                                    <label className="block text-sm font-semibold mb-1" htmlFor="petType">Type</label>
                                    <input type="text" id="petType" name="petType" value={config.petType} onChange={handleChange}
                                        className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="Dog" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-1" htmlFor="friendName">Best Friend</label>
                                <input type="text" id="friendName" name="friendName" value={config.friendName} onChange={handleChange}
                                    className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="Friend's Name" />
                            </div>
                            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold mb-1" htmlFor="siblings">Siblings (Optional)</label>
                                    <input type="text" id="siblings" name="siblings" value={config.siblings} onChange={handleChange}
                                        className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="e.g. sister Mia" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold mb-1" htmlFor="parents">Parents</label>
                                    <input type="text" id="parents" name="parents" value={config.parents} onChange={handleChange}
                                        className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="e.g. Mom and Dad" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold mb-1" htmlFor="grandparents">Grandparents</label>
                                    <input type="text" id="grandparents" name="grandparents" value={config.grandparents} onChange={handleChange}
                                        className="w-full bg-[#fcf9f2] border border-[#d4c48a] rounded-sm p-2.5 outline-none focus:border-[#8b4513] transition-colors shadow-inner" placeholder="e.g. Grandma Rose" />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Child Picture Upload */}
                    <section className="bg-[#fcf9f2]/50 p-4 rounded-sm border border-[#d4c48a]/50">
                        <h3 className="font-cinzel text-lg mb-2 text-[#3d1f0d]">Child Picture (Optional)</h3>
                        <p className="text-xs italic opacity-70 mb-4">Upload a picture (.jpg or .png) to help create a more personalized story. This stays on your device.</p>

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
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path></svg>
                                </div>
                            )}
                        </div>
                    </section>

                    <div className="pt-6 border-t border-[#8b4513]/20">
                        <button type="submit"
                            className="w-full py-4 bg-[#8b4513] text-[#f2e8cf] font-cinzel text-sm rounded-sm hover:bg-[#a0521a] transition-all shadow-xl uppercase tracking-[0.3em]">
                            Save and Begin the Story
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
};

export default ConfigurationPage;
