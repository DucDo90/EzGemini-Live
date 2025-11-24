import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createAudioBlob, decodeAudioData, base64Decode, blobToBase64 } from '../utils/audio';
import { AudioStatus } from '../types';

const FRAME_RATE = 2; // Frames per second for video stream
const JPEG_QUALITY = 0.5;

export const useGeminiLive = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [status, setStatus] = useState<AudioStatus>('inactive');
  const [error, setError] = useState<string | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // State Refs for callbacks
  const isMicOnRef = useRef(true);
  
  // Output Audio Refs
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const outputGainNodeRef = useRef<GainNode | null>(null);

  // Video/Session Refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  
  const disconnect = useCallback(() => {
    // Cleanup Audio Inputs
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }

    // Cleanup Audio Outputs
    audioSourcesRef.current.forEach(s => s.stop());
    audioSourcesRef.current.clear();
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop Video Loop
    if (videoIntervalRef.current) {
      window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    setIsConnected(false);
    setIsStreaming(false);
    setStatus('inactive');
    sessionPromiseRef.current = null;
  }, []);

  const connect = useCallback(async (model: string, systemInstruction?: string) => {
    // Ensure clean state before connecting
    disconnect();

    try {
      setError(null);
      setStatus('listening');
      
      if (!process.env.API_KEY) {
        throw new Error("API Key not found in environment variables.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // Initialize Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Ensure contexts are running (browsers may suspend them)
      if (inputAudioContextRef.current.state === 'suspended') {
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
      }

      outputGainNodeRef.current = outputAudioContextRef.current.createGain();
      outputGainNodeRef.current.connect(outputAudioContextRef.current.destination);

      // Get Microphone Stream
      audioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Apply initial mute state
      audioStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMicOnRef.current;
      });

      const config = {
        model: model,
        config: {
          responseModalities: [Modality.AUDIO], 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: {
            parts: [
              {
                text: systemInstruction || "You are a helpful AI assistant. You can see what the user sees and hear what they say. Be concise and friendly."
              }
            ]
          },
        },
      };

      const callbacks = {
        onopen: () => {
          console.log("EzGemini Live Connection Opened");
          setIsConnected(true);
          setIsStreaming(true);
          
          // Start Audio Input Stream
          if (inputAudioContextRef.current && audioStreamRef.current) {
            inputSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(audioStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (e) => {
              if (!isMicOnRef.current) return; // Don't process audio if mic is off

              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createAudioBlob(inputData);
              
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                }).catch(err => {
                    // Check if error is due to session closure which is expected
                    if (err.message?.includes('closed') || !isConnected) return;
                    console.error("Error sending input:", err);
                });
              }
            };
            
            inputSourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
          }
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle Audio Output
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio && outputAudioContextRef.current && outputGainNodeRef.current) {
            setStatus('speaking');
            const ctx = outputAudioContextRef.current;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            
            try {
                const audioBuffer = await decodeAudioData(
                  base64Decode(base64Audio),
                  ctx,
                  24000,
                  1
                );

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputGainNodeRef.current);
                
                source.addEventListener('ended', () => {
                  audioSourcesRef.current.delete(source);
                  if (audioSourcesRef.current.size === 0) {
                    setStatus('listening');
                  }
                });
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
            } catch (e) {
                console.error("Error decoding audio", e);
            }
          }

          // Handle Interruption
          if (message.serverContent?.interrupted) {
             console.log("Model interrupted by user");
             audioSourcesRef.current.forEach(source => source.stop());
             audioSourcesRef.current.clear();
             nextStartTimeRef.current = 0;
             setStatus('listening');
          }
        },
        onclose: () => {
          console.log("EzGemini Live Connection Closed");
          setIsConnected(false);
          setIsStreaming(false);
          setStatus('inactive');
        },
        onerror: (err: any) => {
          console.error("EzGemini Live Error:", err);
          setError(err.message || "Network error occurred");
          setIsConnected(false);
          setIsStreaming(false);
          disconnect(); // Ensure cleanup happens on error
        }
      };

      // Initiate Connection
      const sessionPromise = ai.live.connect({ ...config, callbacks });
      sessionPromiseRef.current = sessionPromise;
      
      // Catch connection establishment errors
      sessionPromise.catch((err) => {
          console.error("Connection failed:", err);
          setError(err.message || "Connection failed");
          setIsConnected(false);
          setIsStreaming(false);
          setStatus('inactive');
          disconnect();
      });

    } catch (err: any) {
      console.error("Failed to connect:", err);
      setError(err.message);
      setStatus('inactive');
      disconnect();
    }
  }, [disconnect]);

  const toggleMic = useCallback(() => {
    const newState = !isMicOnRef.current;
    isMicOnRef.current = newState;
    setIsMicOn(newState);
    
    if (audioStreamRef.current) {
      audioStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = newState;
      });
    }
  }, []);

  // Function to start pushing video frames
  const startVideoStream = useCallback((videoElement: HTMLVideoElement) => {
    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    videoIntervalRef.current = window.setInterval(async () => {
      if (!videoElement || !ctx || !sessionPromiseRef.current) return;

      // Ensure video dimensions are valid
      if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;

      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0);
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          const base64Data = await blobToBase64(blob);
          sessionPromiseRef.current?.then(session => {
              session.sendRealtimeInput({
                media: { mimeType: 'image/jpeg', data: base64Data }
              });
          }).catch(e => {
             // Ignore errors if session is closed
          });
        }
      }, 'image/jpeg', JPEG_QUALITY);

    }, 1000 / FRAME_RATE);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    }
  }, [disconnect]);

  return {
    connect,
    disconnect,
    startVideoStream,
    toggleMic,
    isMicOn,
    isConnected,
    isStreaming,
    status,
    error
  };
};