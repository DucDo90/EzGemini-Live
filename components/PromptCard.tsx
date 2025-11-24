import React from 'react';
import { PromptScenario } from '../types';

interface PromptCardProps {
  scenario: PromptScenario;
  onClick: () => void;
}

const PromptCard: React.FC<PromptCardProps> = ({ scenario, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-zinc-900/50 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 rounded-xl transition-all duration-200 group flex items-start gap-4 backdrop-blur-sm"
    >
      <div className="text-2xl p-2 bg-zinc-950 rounded-lg group-hover:scale-110 transition-transform">
        {scenario.icon}
      </div>
      <div>
        <h3 className="font-semibold text-zinc-100 mb-1 group-hover:text-blue-400 transition-colors">
          {scenario.title}
        </h3>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {scenario.description}
        </p>
      </div>
    </button>
  );
};

export default PromptCard;
