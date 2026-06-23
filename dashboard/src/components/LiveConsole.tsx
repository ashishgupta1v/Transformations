'use client';

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal } from 'lucide-react';

interface LogMessage {
  level: string;
  message: string;
  timestamp: string;
  meta?: any;
}

export default function LiveConsole() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Determine admin API URL. Since next is running on port 3001 and admin on 3000
    // normally we would inject this via env, but hardcoding to localhost:3000 for local dev
    const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3000';
    
    const socket: Socket = io(adminUrl);

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('worker-log', (log: LogMessage) => {
      setLogs((prev) => [...prev, log].slice(-200)); // Keep last 200 logs
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'info': return 'text-cyan-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col h-96 mt-6">
      <div className="bg-gray-950 px-4 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Live Worker Console</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1"
      >
        {logs.length === 0 ? (
          <div className="text-gray-600 italic">Waiting for logs...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-3 hover:bg-gray-800/50 rounded px-1 -mx-1">
              <span className="text-gray-600 shrink-0">{log.timestamp.split(' ')[1] || log.timestamp}</span>
              <span className={`shrink-0 w-12 font-bold ${getColor(log.level)}`}>{log.level.toUpperCase()}</span>
              <span className="text-gray-300 whitespace-pre-wrap break-words">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
