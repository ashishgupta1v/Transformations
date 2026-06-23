// dashboard/src/components/PhaseReviewQueue.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import PhaseGateCard, { PendingPhaseEntry } from './PhaseGateCard';
import { motion } from 'framer-motion';
import { Layers, Loader2 } from 'lucide-react';

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-me-to-a-random-secret',
};

const POLL_INTERVAL_MS = 8_000;

export default function PhaseReviewQueue() {
  const [pending, setPending] = useState<PendingPhaseEntry[]>([]);
  const [gateEnabled, setGateEnabled] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const [pendingRes, statusRes] = await Promise.all([
        fetch('/api/phase-review/pending', { headers: API_HEADERS }),
        fetch('/api/phase-review/status', { headers: API_HEADERS }),
      ]);
      const pendingData = await pendingRes.json();
      const statusData = await statusRes.json();
      if (!pendingRes.ok) throw new Error(pendingData.error || 'Failed to load phase review queue');
      setPending(pendingData.pending || []);
      if (statusRes.ok) setGateEnabled(Boolean(statusData.gateEnabled));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load phase review queue');
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
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-4" />
        <p className="text-slate-400 font-medium">Checking Inter-Phase Gates...</p>
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
        <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
          <Layers className="w-8 h-8 text-purple-400 opacity-80" />
        </div>
        <p className="text-slate-300 font-semibold text-lg">No Active Gates</p>
        <p className="text-slate-500 text-sm mt-2 text-center max-w-sm">
          {gateEnabled === false
            ? 'Per-phase gate is disabled. Runs proceed automatically.'
            : 'Runs will appear here after each phase finishes generating.'}
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {pending.map((entry) => (
        <PhaseGateCard key={`${entry.runId}-${entry.phase}`} entry={entry} onResolved={handleResolved} />
      ))}
    </div>
  );
}
