import { useState, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';

export type ChatModelType = 'fast' | 'smart' | 'thinking';

interface Message {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export const useGeminiChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getClient = () => {
    if (!process.env.API_KEY) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  };

  const sendMessage = useCallback(async (text: string, type: ChatModelType) => {
    setIsLoading(true);
    setError(null);
    
    // Optimistic update
    setMessages(prev => [...prev, { role: 'user', text }]);

    try {
      const ai = getClient();
      let model = 'gemini-2.5-flash'; // Default fallback
      let config: any = {};

      switch (type) {
        case 'fast':
          model = 'gemini-2.5-flash-lite'; // Low latency
          break;
        case 'smart':
          model = 'gemini-3-pro-preview'; // High intelligence
          break;
        case 'thinking':
          model = 'gemini-3-pro-preview';
          config = {
            thinkingConfig: { thinkingBudget: 32768 } // Max thinking budget
            // Do not set maxOutputTokens as per instructions
          };
          break;
      }

      const response = await ai.models.generateContent({
        model,
        contents: {
            role: 'user',
            parts: [{ text }]
        },
        config
      });

      const responseText = response.text;
      
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: responseText || "No response generated.",
        isThinking: type === 'thinking'
      }]);

    } catch (err: any) {
      console.error("Chat Error:", err);
      setError(err.message || "Failed to generate response");
      setMessages(prev => [...prev, { role: 'model', text: "Error: Could not generate response." }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const transcribeAudio = useCallback(async (audioBase64: string): Promise<string> => {
    try {
      const ai = getClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Specific model for transcription
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav', // Assuming recorder sends wav/webm, but genai handles standard audio
                data: audioBase64
              }
            },
            { text: "Transcribe this audio exactly as spoken." }
          ]
        }
      });
      return response.text || "";
    } catch (err: any) {
      console.error("Transcription Error:", err);
      throw err;
    }
  }, []);

  const clearMessages = () => setMessages([]);

  return {
    messages,
    sendMessage,
    transcribeAudio,
    isLoading,
    error,
    clearMessages
  };
};