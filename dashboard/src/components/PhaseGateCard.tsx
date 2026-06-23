// dashboard/src/components/PhaseGateCard.tsx
'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayCircle, CheckCircle, XCircle, ArrowRight, MessageSquareWarning, RefreshCw } from 'lucide-react';

export interface PendingPhaseEntry {
  runId: string;
  theme: string;
  phase: number;
  videoUrl?: string;
  queuedAt: string;
  status: string;
}

interface Props {
  entry: PendingPhaseEntry;
  onResolved: (runId: string) => void;
}

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-me-to-a-random-secret',
};

const PHASE_LABELS: Record<number, string> = {
  1: 'Phase 1 — Baseline',
  2: 'Phase 2 — Transformation',
  3: 'Phase 3 — Resolution',
};

export default function PhaseGateCard({ entry, onResolved }: Props) {
  const [state, setState] = useState<'pending' | 'approving' | 'rejecting' | 'regenerating' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [isRegenModalOpen, setIsRegenModalOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState('');

  const handleAction = async (action: 'approve' | 'reject') => {
    setState(action === 'approve' ? 'approving' : 'rejecting');
    setError(null);
    try {
      const res = await fetch(`/api/phase-review/${entry.runId}/${action}`, {
        method: 'POST',
        headers: API_HEADERS,
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} phase`);
      }
      onResolved(entry.runId);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : `Failed to ${action} phase`);
    }
  };

  const handleRegenerate = async () => {
    setState('regenerating');
    setError(null);
    try {
      const res = await fetch(`/api/phase-review/${entry.runId}/regenerate`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ prompt: regenPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate phase');
      setIsRegenModalOpen(false);
      onResolved(entry.runId);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to regenerate phase');
    }
  };

  const isPhase3 = entry.phase >= 3;

  return (
    <>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-6 bg-black/40 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-purple-500/30 group hover:border-purple-500/50 transition-all relative"
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">{entry.theme}</h3>
            <p className="text-slate-400 text-xs font-mono mt-1 opacity-70">
              ID: {entry.runId} <br/>
              Queued: {new Date(entry.queuedAt).toLocaleString()}
            </p>
          </div>
          <span className="bg-purple-500/10 border border-purple-500/30 text-purple-300 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-[0_0_10px_rgba(168,85,247,0.2)]">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            {PHASE_LABELS[entry.phase] || `Phase ${entry.phase}`}
          </span>
        </div>

        <div className="aspect-video w-full bg-black/50 rounded-xl overflow-hidden mb-6 flex items-center justify-center border border-white/5 relative group-hover:border-white/10 transition-colors">
          {entry.videoUrl ? (
            <video
              src={entry.videoUrl}
              controls
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <PlayCircle className="w-12 h-12 text-slate-600" />
              <p className="text-slate-500 text-sm font-medium">No clip URL available</p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
            <MessageSquareWarning className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={() => handleAction('approve')}
            disabled={state !== 'pending' && state !== 'error'}
            className="flex-1 relative overflow-hidden bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 px-4 py-3 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] flex items-center justify-center gap-2"
          >
            {state === 'approving' ? (
              <span className="animate-pulse">Resuming...</span>
            ) : isPhase3 ? (
              <><CheckCircle className="w-5 h-5" /> Approve & Finish</>
            ) : (
              <><CheckCircle className="w-5 h-5" /> Approve <ArrowRight className="w-4 h-4 ml-1" /> Phase {entry.phase + 1}</>
            )}
          </button>

          <button
            onClick={() => setIsRegenModalOpen(true)}
            disabled={state !== 'pending' && state !== 'error'}
            className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-amber-400 border border-amber-500/30 hover:border-amber-500/50 px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" /> Regenerate
          </button>

          <button
            onClick={() => handleAction('reject')}
            disabled={state !== 'pending' && state !== 'error'}
            className="bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/30 hover:border-rose-500/50 px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center"
            title="Abort Run"
          >
            {state === 'rejecting' ? (
              <XCircle className="w-5 h-5 animate-pulse" />
            ) : (
              <XCircle className="w-5 h-5" />
            )}
          </button>
        </div>
      </motion.div>

      {/* Regen Modal Overlay */}
      <AnimatePresence>
        {isRegenModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl relative"
            >
              <h2 className="text-xl font-bold text-white mb-2">Regenerate Phase {entry.phase}</h2>
              <p className="text-gray-400 text-sm mb-4">
                Update the prompt for this phase to fix any issues. Leave blank to regenerate with the exact same prompt.
              </p>
              <textarea 
                value={regenPrompt}
                onChange={e => setRegenPrompt(e.target.value)}
                placeholder="New prompt..."
                className="w-full h-32 bg-black border border-gray-700 rounded-lg p-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500 transition-colors mb-4"
              />
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => setIsRegenModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition-colors"
                  disabled={state === 'regenerating'}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRegenerate}
                  disabled={state === 'regenerating'}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {state === 'regenerating' ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Regenerating...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4" /> Confirm Regenerate</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
