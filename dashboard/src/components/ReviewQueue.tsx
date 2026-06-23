// dashboard/src/components/ReviewQueue.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import HumanInTheLoop, { PendingReviewEntry } from './HumanInTheLoop';
import { motion } from 'framer-motion';
import { Archive, Loader2 } from 'lucide-react';

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-me-to-a-random-secret',
};

const POLL_INTERVAL_MS = 10_000;

export default function ReviewQueue() {
  const [pending, setPending] = useState<PendingReviewEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/review/pending', { headers: API_HEADERS });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load review queue');
      setPending(data.pending || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPending]);

  const handleResolved = (runId: string) => {
    setPending((prev) => prev.filter((e) => e.runId !== runId));
  };

  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 rounded-2xl bg-black/20 border border-white/5">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin mb-4" />
        <p className="text-slate-400 font-medium">Scanning Aleph Queue...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 rounded-2xl border border-red-500/30 text-center">
        <p className="text-red-400 font-medium">{error}</p>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-16 px-6 bg-black/20 rounded-2xl border border-dashed border-white/10"
      >
        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
          <Archive className="w-8 h-8 text-blue-400 opacity-80" />
        </div>
        <p className="text-slate-300 font-semibold text-lg">Queue is Empty</p>
        <p className="text-slate-500 text-sm mt-2 text-center max-w-xs">
          Only the first few Aleph (Tier C) runs are held for review.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {pending.map((entry) => (
        <HumanInTheLoop key={entry.runId} entry={entry} onResolved={handleResolved} />
      ))}
    </div>
  );
}
