'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Wand2, Plus, X, UploadCloud, Rocket, CheckCircle2 } from 'lucide-react';

type ThemeSummary = { id: string; displayName: string; subjectType: string; tagline: string };

export default function ThemeBuilder() {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>('');

  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Advanced Configuration State
  const [moduleType, setModuleType] = useState<'module1' | 'module2'>('module2');
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [images, setImages] = useState({
    phase1Base: '',
    phase1Target: '',
    phase2Base: '',
    phase2Target: '',
    phase3Base: '',
    phase3Target: '',
  });

  // Theme details
  const [themeName, setThemeName] = useState('New Theme');
  const [prompt1, setPrompt1] = useState('');
  const [prompt2, setPrompt2] = useState('');

  const API_HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-me-to-a-random-secret'
  };

  useEffect(() => {
    fetchThemes();
  }, []);

  const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3000';

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${ADMIN_URL}/api/themes`, { headers: API_HEADERS });
      const data = await res.json();
      if (data.themes) {
        setThemes(data.themes);
        if (data.themes.length > 0 && !selectedThemeId) {
          handleThemeSelect(data.themes[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch themes', error);
    }
  };

  useEffect(() => {
    if (!selectedThemeId) return;

    const syncThemePrompts = async () => {
      try {
        const fetchId = moduleType === 'module1' ? `${selectedThemeId}-10s` : selectedThemeId;
        const res = await fetch(`${ADMIN_URL}/api/themes/${fetchId}`, { headers: API_HEADERS });
        let data = await res.json();
        
        // If the 10s variant doesn't exist, gracefully fallback to the base theme
        if (data.error && moduleType === 'module1') {
          const fallbackRes = await fetch(`${ADMIN_URL}/api/themes/${selectedThemeId}`, { headers: API_HEADERS });
          data = await fallbackRes.json();
        }

        if (!data.error) {
          setThemeName(data.displayName || data.id);
          setPrompt1(data.phases?.phase1?.prompt || '');
          setPrompt2(data.phases?.phase2?.prompt || '');
        }
      } catch (error) {
        console.error('Failed to sync theme details', error);
      }
    };

    syncThemePrompts();
  }, [selectedThemeId, moduleType]);

  const handleThemeSelect = (id: string) => {
    setSelectedThemeId(id);
    setIsCreatingNew(false);
    setImages({
      phase1Base: '', phase1Target: '',
      phase2Base: '', phase2Target: '',
      phase3Base: '', phase3Target: '',
    }); // Reset on theme change
  };

  const generateWithAI = async () => {
    if (!aiPrompt) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`${ADMIN_URL}/api/themes/generate`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ prompt: aiPrompt })
      });
      const data = await res.json();
      if (data.success && data.theme) {
        await fetchThemes();
        await handleThemeSelect(data.theme.id);
      } else {
        alert(data.error || 'Failed to generate theme');
      }
    } catch (error) {
      console.error('Generation failed', error);
    } finally {
      setIsGenerating(false);
      setAiPrompt('');
    }
  };

  const runPipeline = async () => {
    if (!selectedThemeId) return;
    setIsRunning(true);
    try {
      const targetThemeId = moduleType === 'module1' ? `${selectedThemeId}-10s` : selectedThemeId;
      const res = await fetch(`${ADMIN_URL}/api/pipeline/start`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ 
          theme: targetThemeId,
          moduleType,
          phase1BaseImageUrl: images.phase1Base,
          phase1TargetImageUrl: images.phase1Target,
          phase2BaseImageUrl: images.phase2Base,
          phase2TargetImageUrl: images.phase2Target,
          phase3BaseImageUrl: images.phase3Base,
          phase3TargetImageUrl: images.phase3Target,
        })
      });
      const data = await res.json();
      if (data.accepted) {
        alert(`Pipeline run started! Run ID: ${data.runId}`);
      } else {
        alert(data.error || 'Failed to start pipeline');
      }
    } catch (error) {
      console.error('Pipeline failed', error);
      alert('Error starting pipeline. Check console.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: keyof typeof images) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingKey(key);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const img = new Image();
        img.onload = async () => {
          const MAX_SIZE = 1280;
          let width = img.width;
          let height = img.height;
          if (width > height && width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0, width, height);
          
          const base64 = canvas.toDataURL('image/jpeg', 0.85);

          try {
            const res = await fetch(`${ADMIN_URL}/api/assets/upload`, {
              method: 'POST',
              headers: API_HEADERS,
              body: JSON.stringify({
                filename: file.name,
                base64: base64,
                folder: 'user-inputs'
              })
            });
            
            const data = await res.json();
            if (data.uploaded && data.url) {
              setImages(prev => ({ ...prev, [key]: data.url }));
            } else {
              alert(data.error || 'Failed to upload image');
            }
          } catch (fetchErr) {
            console.error('Upload fetch failed', fetchErr);
          } finally {
            setUploadingKey(null);
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload failed', error);
      alert('Error uploading image');
      setUploadingKey(null);
    }
  };

  const renderUploadBox = (label: string, key: keyof typeof images) => (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      <div className="relative">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleImageUpload(e, key)}
          disabled={uploadingKey !== null}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
        />
        <div className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed transition-all ${uploadingKey === key ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' : 'border-white/20 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
          <UploadCloud className="w-4 h-4" />
          <span className="text-sm font-medium">{uploadingKey === key ? 'Uploading...' : 'Choose File'}</span>
        </div>
      </div>
      {images[key] && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-2 relative group">
          <img src={images[key]} alt={label} className="h-20 w-full object-cover rounded-lg border border-white/10 shadow-lg" />
          <button 
            onClick={() => setImages(p => ({ ...p, [key]: '' }))}
            className="absolute top-1 right-1 bg-black/60 hover:bg-red-500/80 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        </motion.div>
      )}
    </div>
  );

  return (
    <div className="glass-panel p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden h-full">
      <div className="absolute -top-32 -left-32 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-[80px]" />
      
      <div className="relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <Wand2 className="w-5 h-5 text-purple-400" />
            </div>
            Visual Theme Builder
          </h2>
          <div className="flex items-center gap-3 w-full md:w-auto">
            {!isCreatingNew && (
              <div className="relative w-full md:w-64">
                <select
                  className="w-full appearance-none bg-black/40 border border-white/10 text-white rounded-xl py-2.5 pl-4 pr-10 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all cursor-pointer backdrop-blur-md"
                  value={selectedThemeId}
                  onChange={(e) => handleThemeSelect(e.target.value)}
                >
                  <option value="" disabled>Select a theme...</option>
                  {themes.map(t => (
                    <option key={t.id} value={t.id}>{t.displayName} ({t.id})</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white/50">
                  ▼
                </div>
              </div>
            )}
            <button
              onClick={() => setIsCreatingNew(!isCreatingNew)}
              className={`p-2.5 rounded-xl transition-all flex items-center justify-center border shadow-lg ${
                isCreatingNew 
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30' 
                  : 'bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30'
              }`}
              title={isCreatingNew ? "Cancel" : "Create New Theme"}
            >
              {isCreatingNew ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {isCreatingNew ? (
              <motion.div 
                key="create-new"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-indigo-900/20 p-6 rounded-2xl border border-indigo-500/30 backdrop-blur-md"
              >
                <label className="flex items-center gap-2 text-sm font-medium text-indigo-300 mb-3">
                  <Sparkles className="w-4 h-4" /> Generate New Theme with AI
                </label>
                <textarea
                  className="w-full rounded-xl bg-black/40 border border-white/10 text-white p-4 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none placeholder-white/30"
                  rows={3}
                  placeholder="e.g. A futuristic cyberpunk coffee shop on Mars with neon lights..."
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
                <button
                  onClick={generateWithAI}
                  disabled={isGenerating || !aiPrompt}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-6 py-2.5 rounded-xl font-semibold transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(79,70,229,0.4)]"
                >
                  {isGenerating ? (
                    <><span className="animate-spin-slow">✨</span> Generating...</>
                  ) : (
                    <>✨ Generate Theme</>
                  )}
                </button>
              </motion.div>
            ) : (
              <motion.div 
                key="view-theme"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                <div className="group">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Theme Name</label>
                  <input
                    type="text"
                    readOnly
                    className="block w-full rounded-xl bg-black/20 border border-white/5 text-white p-3 cursor-default focus:outline-none group-hover:bg-black/30 transition-colors"
                    value={themeName}
                  />
                </div>

                <div className="group">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Phase 1 Prompt (Baseline)</label>
                  <textarea
                    readOnly
                    className="block w-full rounded-xl bg-black/20 border border-white/5 text-slate-300 p-3 text-sm leading-relaxed cursor-default focus:outline-none group-hover:bg-black/30 transition-colors resize-none"
                    rows={3}
                    value={prompt1}
                  />
                </div>

                {moduleType === 'module2' && (
                  <div className="group">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Phase 2 Prompt (Transformation)</label>
                    <textarea
                      readOnly
                      className="block w-full rounded-xl bg-black/20 border border-white/5 text-slate-300 p-3 text-sm leading-relaxed cursor-default focus:outline-none group-hover:bg-black/30 transition-colors resize-none"
                      rows={3}
                      value={prompt2}
                    />
                  </div>
                )}

                <div className="bg-black/20 p-5 rounded-2xl border border-white/5 group hover:border-white/10 transition-colors">
                  <div className="flex items-center justify-between mb-6">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Advanced Generation Module</label>
                    <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
                      <button 
                        onClick={() => setModuleType('module1')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${moduleType === 'module1' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                      >
                        Module 1 (1 Phase, 10s)
                      </button>
                      <button 
                        onClick={() => setModuleType('module2')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${moduleType === 'module2' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                      >
                        Module 2 (3 Phases, 15s)
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold border border-blue-500/30">1</div>
                        Phase 1 Setup
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        {renderUploadBox("Phase 1 Base Image", "phase1Base")}
                        {renderUploadBox("Phase 1 Target Image", "phase1Target")}
                      </div>
                    </div>

                    <AnimatePresence>
                      {moduleType === 'module2' && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-6 overflow-hidden"
                        >
                          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold border border-purple-500/30">2</div>
                              Phase 2 Setup
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                              {renderUploadBox("Phase 2 Base Image", "phase2Base")}
                              {renderUploadBox("Phase 2 Target Image", "phase2Target")}
                            </div>
                            <p className="text-xs text-slate-500 mt-3 italic">Note: If Base Image is left empty, Phase 2 will seamlessly auto-chain from the end of Phase 1.</p>
                          </div>

                          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs font-bold border border-pink-500/30">3</div>
                              Phase 3 Setup
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                              {renderUploadBox("Phase 3 Base Image", "phase3Base")}
                              {renderUploadBox("Phase 3 Target Image", "phase3Target")}
                            </div>
                            <p className="text-xs text-slate-500 mt-3 italic">Note: If Base Image is left empty, Phase 3 will seamlessly auto-chain from the end of Phase 2.</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="pt-6 mt-6 border-t border-white/10 flex justify-end">
                  <button
                    onClick={runPipeline}
                    disabled={isRunning || !selectedThemeId}
                    className="relative group overflow-hidden bg-purple-600 disabled:bg-slate-700 disabled:opacity-50 px-8 py-3.5 rounded-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(168,85,247,0.3)] disabled:hover:scale-100 disabled:shadow-none"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <span className="relative z-10 flex items-center gap-2 text-white">
                      <Rocket className={`w-5 h-5 ${isRunning ? 'animate-bounce' : ''}`} />
                      {isRunning ? 'Initiating Pipeline...' : 'Run Full Pipeline Test'}
                    </span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
