import React, { useRef, useEffect, useState } from 'react';

// --- Animated SVG Doodle Background Component ---
const DoodlesBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden opacity-30 mix-blend-multiply">
      {/* Top Left: Star */}
      <svg className="absolute top-10 left-10 w-16 h-16 text-[#8b4513] animate-spin-superslow" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 10 L58 40 L90 40 L65 60 L75 90 L50 72 L25 90 L35 60 L10 40 L42 40 Z" />
      </svg>
      {/* Top Right: Swirl */}
      <svg className="absolute top-24 right-16 w-20 h-20 text-[#8b4513] animate-wiggle" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M50 50 m -10 0 a 10 10 0 1 1 20 0 a 20 20 0 1 1 -40 0 a 30 30 0 1 1 60 0" />
      </svg>
      {/* Middle Left: Paper Plane */}
      <svg className="absolute top-1/3 left-4 w-24 h-24 text-[#a0521a] animate-float-random" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 50 L90 10 L60 90 L50 63 L80 20 L40 50 Z" />
        <path d="M40 50 L35 75 L50 63" />
      </svg>
      {/* Middle Right: Cloud */}
      <svg className="absolute top-1/2 right-10 w-32 h-20 text-[#8b4513] animate-float-slow" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 60 A 15 15 0 0 1 30 30 A 20 20 0 0 1 65 25 A 15 15 0 0 1 80 50 A 10 10 0 0 1 80 70 L 30 70" />
        <path d="M35 70 L 25 70 A 10 10 0 0 1 25 50" />
      </svg>
      {/* Bottom Center: Magic Wand */}
      <svg className="absolute bottom-32 left-1/3 w-16 h-16 text-[#8b4513] animate-wiggle" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 80 L70 30" />
        <circle cx="75" cy="25" r="8" fill="currentColor" />
        <path d="M85 15 L95 5 M85 35 L95 45 M65 15 L55 5" strokeWidth="2" />
      </svg>
      {/* Bottom Right: Moon */}
      <svg className="absolute bottom-20 right-1/4 w-20 h-20 text-[#a0521a] animate-spin-superslow" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 20 A 30 30 0 1 0 80 50 A 20 20 0 1 1 50 20 Z" />
      </svg>
      {/* Tiny Sparkles scattered randomly */}
      <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-[#8b4513] animate-ping"></div>
      <div className="absolute bottom-1/4 right-1/3 w-3 h-3 rounded-full bg-[#8b4513] animate-pulse"></div>
      <div className="absolute top-3/4 left-20 w-2 h-2 rounded-full bg-[#a0521a] animate-ping"></div>
    </div>
  );
};


interface LandingPageProps {
  onGetStarted: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showLegal, setShowLegal] = useState(false);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.9;
    }
  }, []);

  return (
    <div 
      className="custom-scrollbar"
      style={{ 
        position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden',
        background: 'radial-gradient(ellipse at 50% 0%, #fef3d7 0%, #f5e6c8 50%, #e6d3a3 100%)', 
        zIndex: 60, color: '#2c1810' 
      }}
    >
      <DoodlesBackground />
      <div className="paper-noise" style={{ opacity: 0.5, pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 1 }} />

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 py-12 md:py-20 flex flex-col items-center animate-fadeIn">
        
        {/* Header Section */}
        <header className="text-center mb-16 max-w-3xl">
          <div aria-hidden="true" style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8b4513', marginBottom: '1rem', opacity: 0.8 }}>
            Every night, a new adventure
          </div>
          <h1 className="font-cinzel text-5xl md:text-7xl font-bold mb-6 tracking-tight" style={{ color: '#3d1f0d', textShadow: '0 4px 12px rgba(139, 69, 19, 0.15)' }}>
            Dream Weaver
          </h1>
          <p className="font-serif text-lg md:text-xl text-[#2c1810]/80 leading-relaxed max-w-2xl mx-auto italic">
            Create infinite, personalized bedtime stories for your child using the magic of AI. You provide the spark, and we weave the tale.
          </p>
        </header>

        {/* Hero Video Player (Embedded) */}
        <section className="w-full max-w-4xl mb-24 relative">
          <div className="absolute -inset-4 bg-gradient-to-r from-[#d4c48a]/30 via-[#fcf9f2]/40 to-[#d4c48a]/30 blur-2xl rounded-[3rem] -z-10" />
          <div className="book-shadow border-4 border-[#8b4513]/80 rounded-xl overflow-hidden relative bg-[#0a0705] aspect-video">
            <video 
              ref={videoRef}
              src="/BedtimeStoryIntro.mp4" 
              autoPlay 
              loop 
              muted 
              playsInline 
              controls
              className="w-full h-full object-cover relative z-20" 
            />
          </div>
        </section>

        {/* --- Content Sections --- */}
        <div className="w-full space-y-24 md:space-y-32 mb-24">

          {/* Section 1: Concept & Educational Value */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1 font-serif text-[#2c1810]/90 space-y-6">
              <h2 className="font-cinzel text-3xl font-bold text-[#3d1f0d] border-b border-[#8b4513]/30 pb-3">
                Learning Through Magic
              </h2>
              <p className="text-lg leading-relaxed text-justify">
                Dream Weaver isn't just about entertainment—it's about learning. Each personalized story weaves in valuable social and educational teachings, helping children learn about <strong>sharing, helping others, and mutual respect</strong>. 
              </p>
              <p className="text-lg leading-relaxed text-justify">
                By facing choices and seeing the consequences of their actions in a safe, magical environment, children build empathy and problem-solving skills, all while enjoying a captivating bedtime routine.
              </p>
            </div>
            <div className="order-1 md:order-2">
              <img src="/storybook_kids_adventure.png" alt="Children embarking on a magical adventure" className="w-full rounded-2xl book-shadow border-4 border-[#c9a87c]/50 object-cover aspect-square md:aspect-auto" />
            </div>
          </section>

          {/* Section 2: Story Mechanics */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <img src="/storybook_interactive_choice.png" alt="Child choosing a magic path" className="w-full rounded-2xl book-shadow border-4 border-[#c9a87c]/50 object-cover aspect-square md:aspect-auto" />
            </div>
            <div className="font-serif text-[#2c1810]/90 space-y-6">
              <h2 className="font-cinzel text-3xl font-bold text-[#3d1f0d] border-b border-[#8b4513]/30 pb-3">
                The Power of Choice
              </h2>
              <p className="text-lg leading-relaxed text-justify">
                Every story starts with a simple idea you provide. The app will then generate a <strong>5 to 8 scene adventure</strong>, complete with expressive voice narration and beautiful illustrations.
              </p>
              <p className="text-lg leading-relaxed text-justify">
                Unlike a traditional book, the Magic lies in interactivity: at the end of every scene, your child is presented with <strong>two choices</strong> on how to proceed. While the parent helps click the buttons, it should be the child who decides the path, increasing their involvement and excitement!
              </p>
              <p className="text-lg leading-relaxed italic opacity-80 border-l-4 border-[#8b4513] pl-4">
                Bonus: Once you reach the end, you can export your child's unique adventure as a beautiful PDF booklet to keep forever!
              </p>
            </div>
          </section>

          {/* Section 3: Configuration Guide */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1 font-serif text-[#2c1810]/90 space-y-6">
              <h2 className="font-cinzel text-3xl font-bold text-[#3d1f0d] border-b border-[#8b4513]/30 pb-3">
                Crafting the Perfect Cast
              </h2>
              <p className="text-lg leading-relaxed text-justify">
                To tailor the magic specifically to your child, simply visit the Configuration screen. The details you provide become the heart of the story!
              </p>
              <ul className="list-disc pl-5 mt-4 space-y-4 text-lg">
                <li><strong className="text-[#8b4513]">Character Stability:</strong> Upload a <strong>full-body picture</strong> of your child! If the photo only shows their head, their clothes might wildly change scene-by-scene. A full body shot anchors their appearance.</li>
                <li><strong className="text-[#8b4513]">Personal Preferences:</strong> Add their favorite foods, colors, and activities. The AI will weave these naturally into the plot!</li>
                <li><strong className="text-[#8b4513]">Side Characters:</strong> Introduce siblings, parents, or pets. Adding these side characters provides stability and familiar faces to the story world.</li>
              </ul>
            </div>
            <div className="order-1 md:order-2">
              <img src="/storybook_family_setup.png" alt="Family preparing for an adventure" className="w-full rounded-2xl book-shadow border-4 border-[#c9a87c]/50 object-cover aspect-square md:aspect-auto" />
            </div>
          </section>

          {/* Section 4: Under the Hood - RAG, Keys & Privacy */}
          <section className="bg-[#fcf9f2]/60 border border-[#c9a87c]/50 rounded-2xl p-8 md:p-12 shadow-sm relative overflow-hidden backdrop-blur-sm">
            <div className="text-center mb-10 text-[#3d1f0d] relative z-10">
              <h2 className="font-cinzel text-3xl font-bold border-b border-[#8b4513]/20 pb-3 inline-block">Behind the Magic</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 relative z-10">
              {/* Bring Your Own Key */}
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 mb-4 text-[#8b4513] animate-float opacity-80">
                    {/* Hand-drawn style Key SVG */}
                    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full drop-shadow-md">
                       <circle cx="70" cy="30" r="15" />
                       <circle cx="70" cy="30" r="5" fill="currentColor" />
                       <path d="M59 41 L20 80" />
                       <path d="M30 70 L20 60 M40 60 L30 50" />
                    </svg>
                  </div>
                  <h3 className="font-cinzel font-bold text-[#3d1f0d] text-[18px]">Bring Your Own Key</h3>
                </div>
                <p className="font-serif text-[#2c1810]/80 text-[15px] leading-relaxed text-center">
                  Using cutting-edge AI isn't free. Instead of locking you into a costly monthly subscription, Dream Weaver requires you to provide an <a href="https://openrouter.ai/" target="_blank" rel="noreferrer" className="text-[#8b4513] font-bold underline hover:text-[#a0521a]">OpenRouter API key</a>. This allows you to completely control your costs and only pay-on-the-go!
                </p>
              </div>

              {/* RAG / Custom Lore */}
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 mb-4 text-[#8b4513] animate-wiggle opacity-80">
                    {/* Hand-drawn style Book SVG */}
                    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full drop-shadow-md">
                      <path d="M50 80 Q25 70 10 90 L10 30 Q25 10 50 20 Q75 10 90 30 L90 90 Q75 70 50 80 Z" />
                      <path d="M50 20 L50 80" />
                      <path d="M20 40 L40 45 M70 45 L80 40 M20 60 L40 65 M70 65 L80 60" strokeWidth="2" strokeDasharray="4 4" />
                      <circle cx="50" cy="10" r="2" fill="currentColor" stroke="none" />
                      <circle cx="30" cy="5" r="1.5" fill="currentColor" stroke="none" />
                    </svg>
                  </div>
                  <h3 className="font-cinzel font-bold text-[#3d1f0d] text-[18px]">Expand the Lore</h3>
                </div>
                <p className="font-serif text-[#2c1810]/80 text-[15px] leading-relaxed text-center">
                  Dream Weaver has incredible memory. You can upload PDFs of favorite fairy tales to teach the AI what plots to use. Moreover, every completed story is saved, allowing future tales to reference past adventures for a continuous universe!
                </p>
              </div>

              {/* Privacy */}
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 mb-4 text-[#8b4513] animate-float-delayed opacity-80">
                    {/* Hand-drawn style Shield Shield/Lock SVG */}
                    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full drop-shadow-md">
                      <path d="M50 10 L15 25 L15 50 C15 75 50 90 50 90 C50 90 85 75 85 50 L85 25 Z" />
                      <rect x="40" y="40" width="20" height="20" rx="3" />
                      <path d="M45 45 L55 45 M45 50 L55 50" strokeWidth="2" />
                      <path d="M50 40 V30" strokeWidth="3" />
                    </svg>
                  </div>
                  <h3 className="font-cinzel font-bold text-[#3d1f0d] text-[18px]">Privacy Notice</h3>
                </div>
                <p className="font-serif text-[#2c1810]/80 text-[15px] leading-relaxed text-center">
                  We use a strong local-first privacy architecture: your keys and config stay strictly in your browser. <strong>However</strong>, to generate stories, your preferred names and reference pictures <i>are sent to AI models</i>. We cannot guarantee they won't log data.
                </p>
              </div>
            </div>
          </section>

        </div>

        {/* Setup Guide & CTA */}
        <section className="w-full max-w-2xl text-center bg-[#fdf6e9] border border-[#d4c48a] shadow-xl p-8 md:p-12 rounded-[2rem] relative transform transition-all hover:-translate-y-2 hover:shadow-2xl">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-[#8b4513] rounded-full border-[6px] border-[#fef3d7] flex items-center justify-center shadow-lg animate-bounce">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f2e8cf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
             </svg>
          </div>
          
          <h2 className="font-cinzel text-3xl font-bold text-[#3d1f0d] mt-6 mb-4">Ready to Begin?</h2>
          <p className="font-serif text-[#2c1810]/80 text-lg leading-relaxed mb-8">
            You only need to set up your child's profile once to unlock infinite bedtime stories.
          </p>

          <button 
            onClick={onGetStarted}
            className="w-full py-5 bg-[#8b4513] text-[#f2e8cf] font-cinzel text-[16px] md:text-lg rounded-2xl hover:bg-[#a0521a] transform transition-all shadow-md hover:shadow-xl uppercase tracking-[0.3em] origin-center active:scale-95"
          >
            Enter Configuration &rarr;
          </button>
        </section>

        {/* Footer */}
        <footer className="mt-20 w-full flex flex-col items-center opacity-80 font-serif text-[12px] md:text-sm pb-8">
          <p className="mb-2">Powered by OpenRouter API & LangGraph</p>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-12 mt-4 pt-6 border-t border-[#8b4513]/20 w-full max-w-4xl justify-center items-center text-[#8b4513] font-cinzel tracking-widest uppercase">
            <span>Created as a Capstone Project for <a href="https://www.outskill.com/6-month-ai-engineering" target="_blank" rel="noreferrer" className="font-bold underline cursor-pointer hover:text-[#a0521a]">Outskill</a></span>
            <button onClick={() => setShowLegal(true)} className="hover:underline font-bold cursor-pointer">Impressum & Legal</button>
          </div>
          <p className="mt-4 italic opacity-80 text-[11px] font-sans">A special thanks to the Outskill team for the excellent training.</p>
        </footer>

      </main>

      {/* Legal & Impressum Modal */}
      {showLegal && (
         <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm pointer-events-auto" onClick={() => setShowLegal(false)}>
            <div className="bg-[#fef3d7] border-4 border-[#8b4513] rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto text-[#2c1810] shadow-2xl relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowLegal(false)} className="absolute top-4 right-5 text-[#8b4513] hover:text-[#3d1f0d] text-4xl" aria-label="Close modal">&times;</button>
                <h2 className="font-cinzel text-3xl font-bold mb-6 text-[#3d1f0d] border-b border-[#8b4513]/20 pb-3 mt-2">Impressum & Legal</h2>
                
                <section className="mb-6 font-serif text-sm leading-relaxed text-justify space-y-1">
                  <h3 className="font-cinzel font-bold text-[#8b4513] text-lg uppercase tracking-wider mb-2">Operator</h3>
                  <p>Tamas Deak</p>
                  <p>Wetzlarer Str 4</p>
                  <p>63128 Dietzenbach, Germany</p>
                  <p className="pt-2"><strong>Contact:</strong> Phone: +49 15202592239</p>
                </section>

                <section className="mb-8 font-serif text-sm leading-relaxed text-justify space-y-4 bg-[#fdf6e9] p-5 border border-[#d4c48a] rounded-lg shadow-inner">
                  <h3 className="font-cinzel font-bold text-[#8b4513] text-lg uppercase tracking-wider mb-2 flex items-center gap-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    Disclaimer
                  </h3>
                  <p>This application is provided 'as is' without any warranties. The creators are not liable for any direct or indirect consequences, damages, or losses resulting from the use of this app. Use of this service, including the provision of API keys, is entirely at the user's own risk.</p>
                </section>

                <section className="font-serif text-sm leading-relaxed text-justify space-y-4">
                  <h3 className="font-cinzel font-bold text-[#8b4513] text-lg uppercase tracking-wider mb-2 flex items-center gap-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    About the Team
                  </h3>
                  <p>Developed by Tamas Deak in collaboration with <strong>Alessandro</strong>, <strong>Ravi Gabbita</strong>, <strong>Om</strong>, and <strong>Kumarguru</strong>.</p>
                  <p className="italic opacity-80 mt-2">This application was explicitly created as a collective effort for the Outskill AI Engineering Capstone Project. A special thanks to the Outskill team for the training!</p>
                </section>
            </div>
         </div>
      )}
    </div>
  );
};

export default LandingPage;
