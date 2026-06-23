// dashboard/src/components/HumanInTheLoop.tsx
'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { PlayCircle, CheckCircle, XCircle, Share2, MessageSquareWarning } from 'lucide-react';

export interface PendingReviewEntry {
  runId: string;
  theme: string;
  queuedAt: string;
  exports?: Record<string, { path?: string; size?: string }>;
}

interface Props {
  entry: PendingReviewEntry;
  onResolved: (runId: string) => void;
}

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-me-to-a-random-secret',
};

function previewUrlFor(entry: PendingReviewEntry): string | null {
  const exportEntry = entry.exports?.instagramReel ?? Object.values(entry.exports ?? {})[0];
  if (!exportEntry?.path) return null;
  const filename = exportEntry.path.split('/').pop();
  return filename ? `/output/${filename}` : null;
}

export default function HumanInTheLoop({ entry, onResolved }: Props) {
  const [status, setStatus] = useState<'pending' | 'approving' | 'rejecting' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const videoUrl = previewUrlFor(entry);

  const handleAction = async (action: 'approve' | 'reject') => {
    setStatus(action === 'approve' ? 'approving' : 'rejecting');
    setError(null);
    try {
      const res = await fetch(`/api/review/${entry.runId}/${action}`, {
        method: 'POST',
        headers: API_HEADERS,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} run`);
      }
      onResolved(entry.runId);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : `Failed to ${action} run`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-6 bg-black/40 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-blue-500/30 group hover:border-blue-500/50 transition-all"
    >
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">{entry.theme}</h3>
          <p className="text-slate-400 text-xs font-mono mt-1 opacity-70">
            ID: {entry.runId} <br/>
            Queued: {new Date(entry.queuedAt).toLocaleString()}
          </p>
        </div>
        <span className="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Awaiting Approval
        </span>
      </div>

      <div className="aspect-video w-full bg-black/50 rounded-xl overflow-hidden mb-6 flex items-center justify-center border border-white/5 relative group-hover:border-white/10 transition-colors">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <PlayCircle className="w-12 h-12 text-slate-600" />
            <p className="text-slate-500 text-sm font-medium">No preview export available</p>
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
          disabled={status === 'approving' || status === 'rejecting'}
          className="flex-1 relative overflow-hidden bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 px-4 py-3 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2"
        >
          {status === 'approving' ? (
            <span className="animate-pulse">Publishing...</span>
          ) : (
            <><Share2 className="w-5 h-5" /> Approve & Publish</>
          )}
        </button>
        <button
          onClick={() => handleAction('reject')}
          disabled={status === 'approving' || status === 'rejecting'}
          className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/30 hover:border-rose-500/50 px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
        >
          {status === 'rejecting' ? (
            <span className="animate-pulse">Rejecting...</span>
          ) : (
            <><XCircle className="w-5 h-5" /> Reject</>
          )}
        </button>
      </div>
    </motion.div>
  );
}
