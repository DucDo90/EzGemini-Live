import React from 'react';
import { AudioStatus } from '../types';

interface AudioVisualizerProps {
  status: AudioStatus;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ status }) => {
  const isSpeaking = status === 'speaking';
  const isListening = status === 'listening';
  const isProcessing = status === 'processing';

  // Symmetrical bar configuration for a centered waveform feel
  const bars = [0.3, 0.5, 0.8, 1.0, 0.8, 0.5, 0.3];

  return (
    <div className="flex items-center justify-center gap-1.5 h-12 px-2">
      {bars.map((scale, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full transition-all duration-500 ease-in-out ${
            isSpeaking 
              ? 'bg-gradient-to-t from-blue-400 to-indigo-300 animate-waveform shadow-[0_0_8px_rgba(96,165,250,0.6)]' 
              : isProcessing
                ? 'bg-violet-400 animate-pulse shadow-[0_0_8px_rgba(167,139,250,0.5)]'
                : isListening 
                  ? 'bg-emerald-400/80' 
                  : 'bg-zinc-700'
          }`}
          style={{
            height: isSpeaking 
              ? `${Math.max(15, Math.random() * 100)}%` // Dynamic height simulation
              : isListening 
                ? `${10 + (scale * 12)}px` 
                : '4px',
            animation: isSpeaking ? `waveform 0.8s ease-in-out infinite ${i * 0.1}s` : undefined,
            opacity: status === 'inactive' ? 0.3 : 1,
            transformOrigin: 'center'
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;