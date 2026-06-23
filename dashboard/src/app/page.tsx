// dashboard/src/app/page.tsx
'use client';

import ThemeBuilder from '@/components/ThemeBuilder';
import ReviewQueue from '@/components/ReviewQueue';
import PhaseReviewQueue from '@/components/PhaseReviewQueue';
import LiveConsole from '@/components/LiveConsole';
import { motion } from 'framer-motion';
import { Sparkles, TerminalSquare } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Animated Background Mesh */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-900/30 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-900/20 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute top-[30%] left-[40%] w-[40%] h-[40%] bg-pink-900/20 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 mix-blend-overlay"></div>
      </div>

      <div className="max-w-7xl mx-auto space-y-12 p-8 relative z-10 pt-16">
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="border-b border-white/10 pb-8 flex flex-col md:flex-row items-start md:items-end justify-between gap-4"
        >
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-white/10 rounded-lg border border-white/20 shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                <Sparkles className="w-6 h-6 text-purple-400" />
              </div>
              <h1 className="text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 glow-text">
                TempleSciFi Transform
              </h1>
            </div>
            <p className="text-slate-400 text-lg flex items-center gap-2 font-mono">
              <TerminalSquare className="w-4 h-4" /> Enterprise Video Generation Studio
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_#10b981]"></span>
            </span>
            <span className="text-sm font-medium text-emerald-400 tracking-wide uppercase">System Online</span>
          </div>
        </motion.header>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-1 xl:grid-cols-12 gap-8"
        >
          {/* Main Workspace (Left/Top) */}
          <div className="xl:col-span-7 space-y-8">
            <ThemeBuilder />
          </div>

          {/* Queues (Right/Bottom) */}
          <div className="xl:col-span-5 space-y-8 flex flex-col">
            <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group h-full">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-[40px] group-hover:bg-purple-500/20 transition-all duration-500" />
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <span className="w-2 h-6 bg-purple-500 rounded-full shadow-[0_0_10px_#a855f7]" />
                Per-Phase Review Gate
              </h2>
              <PhaseReviewQueue />
            </div>

            <LiveConsole />

            <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group h-full">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-[40px] group-hover:bg-blue-500/20 transition-all duration-500" />
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <span className="w-2 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_#3b82f6]" />
                Aleph Manual Queue
              </h2>
              <ReviewQueue />
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
