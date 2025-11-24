export enum LiveMode {
  SCREEN = 'SCREEN',
  CAMERA = 'CAMERA',
  NONE = 'NONE'
}

export interface LiveConfig {
  model: string;
  systemInstruction?: string;
  voiceName?: string;
}

export type AudioStatus = 'inactive' | 'listening' | 'speaking' | 'processing';

export interface PromptScenario {
  id: string;
  title: string;
  description: string;
  mode: LiveMode;
  icon: string;
}
