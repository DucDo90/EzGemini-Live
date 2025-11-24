import React, { useState, useRef, useEffect } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useGeminiChat, ChatModelType } from './hooks/useGeminiChat';
import { LiveMode, PromptScenario } from './types';
import AudioVisualizer from './components/AudioVisualizer';
import PromptCard from './components/PromptCard';
import SaveRecordingDialog from './components/SaveRecordingDialog';
import AuthScreen from './components/AuthScreen';
import { useAuth } from './contexts/AuthContext';
import { blobToBase64 } from './utils/audio';

const SCENARIOS: PromptScenario[] = [
  {
    id: 'code-fix',
    title: 'Fix My Code',
    description: "Look at this coding error on my screen and explain how to solve it.",
    mode: LiveMode.SCREEN,
    icon: '💻'
  },
  {
    id: 'edit-sync',
    title: 'Video Editing',
    description: "Analyze my timeline and tell me how to sync this audio perfectly.",
    mode: LiveMode.SCREEN,
    icon: '🎬'
  },
  {
    id: 'analyze-object',
    title: 'Analyze Object',
    description: "Tell me what this object is, if it looks damaged, and how to fix it.",
    mode: LiveMode.CAMERA,
    icon: '🔍'
  },
  {
    id: 'food-check',
    title: 'Food Analysis',
    description: "Does this food look healthy? Recommend some alternatives.",
    mode: LiveMode.CAMERA,
    icon: '🥑'
  },
];

type ViewMode = 'live' | 'chat';

interface MediaCapabilities {
  zoom?: {
    min: number;
    max: number;
    step: number;
  };
  focus?: {
    min: number;
    max: number;
    step: number;
    modes: string[];
  };
  torch?: boolean;
}

const App: React.FC = () => {
  // --- Auth State ---
  const { user, loading: authLoading, signOut } = useAuth();

  // --- View State ---
  const [view, setView] = useState<ViewMode>('live');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // --- Live Hook ---
  const { 
    connect, 
    disconnect, 
    startVideoStream, 
    toggleMic,
    isMicOn,
    isConnected, 
    isStreaming,
    status, 
    error: liveError 
  } = useGeminiLive();

  // --- Chat Hook ---
  const {
    messages,
    sendMessage,
    transcribeAudio,
    isLoading: isChatLoading
  } = useGeminiChat();

  // --- Local State ---
  const [liveMode, setLiveMode] = useState<LiveMode>(LiveMode.NONE);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatModel, setChatModel] = useState<ChatModelType>('smart');
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);

  // --- Media Capabilities State ---
  const [mediaCapabilities, setMediaCapabilities] = useState<MediaCapabilities | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusDistance, setFocusDistance] = useState(0);
  const [focusMode, setFocusMode] = useState<'continuous' | 'manual'>('continuous');
  const [tapTarget, setTapTarget] = useState<{x: number, y: number, visible: boolean} | null>(null);
  const [isTorchOn, setIsTorchOn] = useState(false);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startMediaRequestRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const pinchStartRef = useRef<{dist: number, zoom: number} | null>(null);
  const tapTimeoutRef = useRef<number | null>(null);

  // --- Helper: Auto-scroll chat ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatLoading]);

  // --- Helper: Auto-focus chat input ---
  useEffect(() => {
    if (view === 'chat' && user) {
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 50);
    }
  }, [view, user]);

  // --- Notification Helper ---
  const showNotification = (text: string) => {
    setNotification(text);
    setTimeout(() => setNotification(null), 3000);
  };

  // --- Helper: Zoom & Focus Logic ---
  const applyZoom = async (level: number) => {
    if (!mediaCapabilities?.zoom || !streamRef.current) return;
    
    const clamped = Math.min(Math.max(level, mediaCapabilities.zoom.min), mediaCapabilities.zoom.max);
    setZoomLevel(clamped);

    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped } as any] });
      } catch (e) {
        console.debug("Zoom failed or not supported", e);
      }
    }
  };

  const applyManualFocus = async (distance: number) => {
    if (!mediaCapabilities?.focus || !streamRef.current) return;
    
    setFocusDistance(distance);
    setFocusMode('manual');

    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ 
            advanced: [{ 
                focusMode: 'manual', 
                focusDistance: distance 
            } as any] 
        });
      } catch (e) {
        console.debug("Manual focus failed", e);
      }
    }
  };

  const triggerAutoFocus = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    
    setFocusMode('continuous');
    try {
        // Re-applying continuous mode triggers a re-focus on many devices
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
    } catch (e) {
        console.debug("Auto focus trigger failed", e);
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current || !mediaCapabilities?.torch) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    
    try {
        await track.applyConstraints({
            advanced: [{ torch: !isTorchOn } as any]
        });
        setIsTorchOn(!isTorchOn);
    } catch (err) {
        console.error("Error toggling torch:", err);
    }
  };

  const handleVideoTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (liveMode !== LiveMode.CAMERA) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Show visual indicator
    setTapTarget({ x, y, visible: true });
    if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = window.setTimeout(() => {
        setTapTarget(prev => prev ? { ...prev, visible: false } : null);
    }, 1000);

    // Trigger focus logic
    triggerAutoFocus();
  };

  const handlePinchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
      pinchStartRef.current = { dist, zoom: zoomLevel };
    }
  };

  const handlePinchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current && mediaCapabilities?.zoom) {
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
      const scale = dist / pinchStartRef.current.dist;
      const newZoom = pinchStartRef.current.zoom * scale;
      applyZoom(newZoom);
    }
  };

  // --- Helper: Start Live Media ---
  const startMedia = async (
    selectedMode: LiveMode, 
    facingModeOverride?: 'user' | 'environment',
    resolutionOverride?: '720p' | '1080p'
  ) => {
    const requestId = ++startMediaRequestRef.current;
    const targetFacingMode = facingModeOverride || cameraFacingMode;
    const targetResolution = resolutionOverride || resolution;
    
    setIsMediaLoading(true);
    setMediaCapabilities(null); // Reset capabilities
    setIsTorchOn(false);

    try {
      let stream: MediaStream;

      if (selectedMode === LiveMode.SCREEN) {
        stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { width: 1920, height: 1080 }, // Request higher res for screen
          audio: false 
        });
      } else {
        const width = targetResolution === '1080p' ? 1920 : 1280;
        const height = targetResolution === '1080p' ? 1080 : 720;

        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: targetFacingMode, 
            width: { ideal: width }, 
            height: { ideal: height },
            // Try to request pan/tilt/zoom permissions if browser supports it (Chrome)
            pan: true, tilt: true, zoom: true 
          } as any,
          audio: false
        });
      }

      if (requestId !== startMediaRequestRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Detect Capabilities
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      const settings = track.getSettings() as any;
      
      const newCapabilities: MediaCapabilities = {};

      // Zoom Capabilities
      if (capabilities.zoom) {
        newCapabilities.zoom = {
            min: capabilities.zoom.min,
            max: capabilities.zoom.max,
            step: capabilities.zoom.step
        };
        setZoomLevel(settings.zoom || capabilities.zoom.min);
      }

      // Focus Capabilities
      if (capabilities.focusMode) {
        newCapabilities.focus = {
            min: capabilities.focusDistance?.min || 0,
            max: capabilities.focusDistance?.max || 100, // Some drivers don't report max correctly
            step: capabilities.focusDistance?.step || 10,
            modes: capabilities.focusMode
        };
        // Set initial focus state if available
        if (settings.focusMode) setFocusMode(settings.focusMode);
        if (settings.focusDistance) setFocusDistance(settings.focusDistance);
      }

      // Torch Capabilities
      if (capabilities.torch) {
        newCapabilities.torch = true;
      }

      setMediaCapabilities(newCapabilities);

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
          if (requestId === startMediaRequestRef.current) {
            startVideoStream(videoRef.current);
          }
        } catch (e: any) {
          if (e.name !== 'AbortError') console.error("Video playback failed:", e);
        }
      }
      setLiveMode(selectedMode);

      stream.getVideoTracks()[0].onended = () => {
         if (streamRef.current === stream) handleDisconnect();
      };

    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') return;
      console.error("Error starting media:", err);
    } finally {
        if (requestId === startMediaRequestRef.current) {
            setIsMediaLoading(false);
        }
    }
  };

  const handleStartLive = async () => {
    await connect("gemini-2.5-flash-native-audio-preview-09-2025");
  };

  const handleToggleScreenRecord = () => {
    if (isScreenRecording) {
      screenRecorderRef.current?.stop();
      setIsScreenRecording(false);
    } else {
      if (!streamRef.current) return;

      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      
      const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
      
      if (!mimeType) {
        alert("Screen recording is not supported in this browser.");
        return;
      }

      try {
        const recorder = new MediaRecorder(streamRef.current, { mimeType });
        
        screenRecorderRef.current = recorder;
        screenChunksRef.current = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            screenChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(screenChunksRef.current, { type: mimeType });
          setRecordedBlob(blob);
          setIsSaveDialogOpen(true);
        };

        recorder.start();
        setIsScreenRecording(true);
      } catch (err) {
        console.error("Failed to start recording:", err);
        alert("Failed to start screen recording.");
      }
    }
  };

  const handleDisconnect = () => {
    if (isScreenRecording) {
      screenRecorderRef.current?.stop();
      setIsScreenRecording(false);
    }
    disconnect();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setLiveMode(LiveMode.NONE);
    setMediaCapabilities(null);
    setIsTorchOn(false);
  };

  const switchLiveMode = async (newMode: LiveMode) => {
    if (!isConnected) return;
    if (isScreenRecording) handleToggleScreenRecord();
    await startMedia(newMode);
  };

  const toggleCamera = async () => {
    if (liveMode !== LiveMode.CAMERA) return;
    const newFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(newFacingMode);
    await startMedia(LiveMode.CAMERA, newFacingMode);
  };

  const changeResolution = async (res: '720p' | '1080p') => {
    setResolution(res);
    if (isConnected && liveMode === LiveMode.CAMERA) {
      await startMedia(LiveMode.CAMERA, undefined, res);
    }
  };

  const handleScenarioClick = (scenario: PromptScenario) => {
    if (!isConnected) return;
    if (liveMode !== scenario.mode) {
        switchLiveMode(scenario.mode);
    }
    showNotification(`Context set: ${scenario.title}`);
  };

  // --- Chat Functions ---
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && !isChatLoading) {
      sendMessage(chatInput, chatModel);
      setChatInput('');
    }
  };

  const handleMicClick = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => audioChunksRef.current.push(event.data);
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          const base64Audio = await blobToBase64(audioBlob);
          try {
             const text = await transcribeAudio(base64Audio);
             setChatInput(prev => prev + (prev ? ' ' : '') + text);
          } catch (e) {
             alert("Transcription failed");
          }
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Error accessing microphone:", err);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // --- Dynamic Styles based on Status ---
  const getAmbientGlow = () => {
    switch(status) {
      case 'speaking': return 'shadow-[inset_0_0_80px_rgba(59,130,246,0.3)] border-blue-500/20'; // Blue glow
      case 'processing': return 'shadow-[inset_0_0_80px_rgba(139,92,246,0.3)] border-violet-500/20'; // Purple glow
      case 'listening': return 'shadow-[inset_0_0_60px_rgba(16,185,129,0.1)] border-emerald-500/10'; // Subtle green glow
      default: return 'border-transparent';
    }
  };

  // --- Render Auth Gate ---
  if (authLoading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const renderSidebar = () => (
    <div className="w-20 md:w-24 bg-zinc-950 border-r border-white/5 flex flex-col items-center py-6 gap-6 z-50 flex-shrink-0">
       <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4 group cursor-default">
          <svg className="w-7 h-7 text-white group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
       </div>

       <button 
         onClick={() => setView('live')}
         className={`p-3 rounded-2xl transition-all group relative ${view === 'live' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
       >
         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
         <span className="absolute left-16 bg-zinc-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/10 z-50">
            Live Vision
         </span>
       </button>

       <button 
         onClick={() => setView('chat')}
         className={`p-3 rounded-2xl transition-all group relative ${view === 'chat' ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
       >
         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
         <span className="absolute left-16 bg-zinc-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/10 z-50">
            Deep Chat
         </span>
       </button>

       <div className="flex-1" />

       <button 
         onClick={signOut}
         className="p-3 rounded-2xl text-zinc-500 hover:bg-red-500/10 hover:text-red-500 transition-all group relative"
         title="Sign Out"
       >
         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
         <span className="absolute left-16 bg-zinc-800 text-white text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/10 z-50">
            Sign Out
         </span>
       </button>
    </div>
  );

  const renderLiveView = () => (
    <div 
      className="flex-1 relative bg-black overflow-hidden flex flex-col md:flex-row"
    >
      {/* --- Notification Toast --- */}
      <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${notification ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
         <div className="bg-zinc-800/90 backdrop-blur-md text-white px-6 py-2 rounded-full shadow-2xl border border-white/10 flex items-center gap-3">
            <span className="text-green-400">✓</span>
            <span className="text-sm font-medium">{notification}</span>
         </div>
      </div>

      {/* --- Main Video Area --- */}
      <div 
        className="flex-1 relative flex items-center justify-center bg-black select-none overflow-hidden"
        onTouchStart={(e) => {
            if (e.touches.length === 2) handlePinchStart(e);
        }}
        onTouchMove={(e) => {
            if (e.touches.length === 2) handlePinchMove(e);
        }}
        onTouchEnd={() => { pinchStartRef.current = null; }}
        onClick={handleVideoTap}
      >
        {/* Ambient Glow Border */}
        {isConnected && (
            <div className={`absolute inset-0 pointer-events-none transition-all duration-700 ease-in-out border-[0px] md:border-[6px] ${getAmbientGlow()} z-10`} />
        )}

        {!isConnected ? (
            // Disconnected State
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20">
               {/* Background Effects */}
               <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black opacity-80" />
               <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150" />
               
               <div className="relative z-10 max-w-2xl space-y-12 animate-in fade-in zoom-in duration-700">
                 <div className="space-y-4">
                    <div className="inline-block p-4 rounded-3xl bg-zinc-900/50 backdrop-blur-xl border border-white/5 mb-6 shadow-2xl">
                        <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                        </svg>
                    </div>
                    <h2 className="text-5xl md:text-7xl font-bold tracking-tighter text-white drop-shadow-xl">
                        EzGemini <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Live</span>
                    </h2>
                    <p className="text-lg text-zinc-400 font-light max-w-md mx-auto leading-relaxed">
                        Multimodal real-time reasoning. Connect to start a natural voice conversation with vision capabilities.
                    </p>
                 </div>

                 <button 
                    onClick={handleStartLive}
                    className="group relative inline-flex items-center justify-center px-12 py-5 font-semibold text-white transition-all duration-300 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-black overflow-hidden"
                 >
                    <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-600/20 to-indigo-600/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="relative flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        Initialize Session
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </span>
                 </button>

                 {liveError && (
                    <div className="animate-in slide-in-from-bottom-2 fade-in">
                        <p className="text-red-400 text-sm bg-red-500/10 px-6 py-3 rounded-xl border border-red-500/20 mx-auto inline-flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            {liveError}
                        </p>
                    </div>
                 )}
               </div>
            </div>
        ) : (
            // Connected State
            <>
                {/* Connecting Overlay */}
                {!isStreaming && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4 animate-pulse">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-zinc-400 font-mono text-sm tracking-widest uppercase">Connecting...</span>
                        </div>
                    </div>
                )}

                {/* Camera Loading / Placeholder */}
                {(isMediaLoading || (liveMode === LiveMode.CAMERA && !streamRef.current)) && (
                   <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10 animate-in fade-in duration-300">
                      <div className="absolute inset-0 opacity-10" style={{ 
                          backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)', 
                          backgroundSize: '40px 40px' 
                      }}></div>
                      <div className="text-center space-y-4 animate-pulse relative z-10 bg-zinc-900/50 p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
                          <span className="text-3xl relative z-10">📸</span>
                          <div className="space-y-1">
                            <p className="text-zinc-200 font-semibold tracking-wide">Initializing Feed</p>
                            <p className="text-xs text-zinc-500 font-mono">{resolution}</p>
                          </div>
                      </div>
                   </div>
                )}

                <video 
                  ref={videoRef} 
                  muted 
                  autoPlay 
                  playsInline 
                  className={`absolute inset-0 w-full h-full transition-all duration-500 ${
                     liveMode === LiveMode.SCREEN ? 'object-contain bg-zinc-900' : 'object-cover'
                  } ${cameraFacingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                />
                
                {/* Tap Target Visualizer */}
                {tapTarget && (
                    <div 
                        className={`absolute w-16 h-16 border-2 border-white/60 rounded-lg pointer-events-none transition-all duration-500 ${tapTarget.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-150'}`}
                        style={{ 
                            left: tapTarget.x - 32, 
                            top: tapTarget.y - 32,
                            boxShadow: '0 0 15px rgba(255,255,255,0.3), inset 0 0 10px rgba(255,255,255,0.1)'
                        }}
                    >
                         <div className="absolute inset-0 border border-white/30 rounded m-1" />
                         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full" />
                    </div>
                )}

                {/* Mode Selection Overlay (if connected but no mode) */}
                {liveMode === LiveMode.NONE && !isMediaLoading && isStreaming && (
                  <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/60 backdrop-blur-md">
                    <div className="text-center space-y-8 animate-in zoom-in duration-300">
                      <h3 className="text-2xl font-light text-white tracking-tight">Select Input Source</h3>
                      <div className="flex gap-6 justify-center">
                        <button onClick={() => switchLiveMode(LiveMode.CAMERA)} className="group flex flex-col items-center gap-4 p-8 rounded-3xl bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 hover:border-blue-500/50 transition-all hover:-translate-y-1 shadow-2xl">
                          <span className="text-4xl group-hover:scale-110 transition-transform">📸</span>
                          <span className="font-medium text-zinc-300">Camera</span>
                        </button>
                        <button onClick={() => switchLiveMode(LiveMode.SCREEN)} className="group flex flex-col items-center gap-4 p-8 rounded-3xl bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 hover:border-blue-500/50 transition-all hover:-translate-y-1 shadow-2xl">
                          <span className="text-4xl group-hover:scale-110 transition-transform">🖥️</span>
                          <span className="font-medium text-zinc-300">Screen</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
            </>
        )}

        {/* --- HUD: Top Status Bar --- */}
        {isConnected && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 pointer-events-none">
                <div className="flex items-center gap-3 bg-zinc-900/60 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full shadow-lg pointer-events-auto">
                    <div className={`w-2.5 h-2.5 rounded-full ${status === 'inactive' ? 'bg-zinc-500' : 'bg-green-500 animate-pulse'}`} />
                    <span className="text-xs font-bold text-zinc-200 tracking-wider">
                        {status === 'speaking' ? 'SPEAKING' : status === 'listening' ? 'LISTENING' : 'LIVE'}
                    </span>
                    
                    {isScreenRecording && (
                        <>
                            <div className="w-px h-3 bg-white/20 mx-1" />
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs font-bold text-red-400 tracking-wider">REC</span>
                        </>
                    )}
                </div>
            </div>
        )}

        {/* --- HUD: Sidebar Toggle --- */}
        {isConnected && (
            <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`absolute top-6 right-6 z-50 p-3 rounded-full bg-zinc-900/60 backdrop-blur-xl border border-white/10 text-white hover:bg-white/10 transition-all ${isSidebarOpen ? 'bg-white/10' : ''}`}
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
        )}

        {/* --- HUD: Media Controls (Left Side) --- */}
        {liveMode === LiveMode.CAMERA && !isMediaLoading && isConnected && (
          <div className="absolute left-6 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-6 animate-in fade-in slide-in-from-left-4 pointer-events-auto">
            
            {/* Zoom Slider */}
            {mediaCapabilities?.zoom && (
                <div className="flex flex-col items-center gap-3 bg-zinc-900/60 backdrop-blur-xl py-4 px-2 rounded-full border border-white/10 shadow-lg">
                    <span className="text-[10px] font-mono text-zinc-400 font-bold">ZOOM</span>
                    <div className="h-32 w-6 flex items-center justify-center relative">
                        <input
                            type="range"
                            min={mediaCapabilities.zoom.min}
                            max={mediaCapabilities.zoom.max}
                            step={mediaCapabilities.zoom.step || 0.1}
                            value={zoomLevel}
                            onChange={(e) => applyZoom(parseFloat(e.target.value))}
                            className="w-32 h-1.5 appearance-none bg-zinc-700 rounded-full outline-none accent-blue-500 cursor-pointer hover:bg-zinc-600 transition-colors -rotate-90 origin-center absolute"
                        />
                    </div>
                </div>
            )}
          </div>
        )}

        {/* --- HUD: Bottom Dock --- */}
        {isConnected && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 pointer-events-auto w-full max-w-2xl px-4 flex justify-center">
                <div className="flex items-center gap-3 p-2 pl-3 bg-zinc-900/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl transition-all hover:bg-zinc-900/90 hover:scale-[1.01]">
                    
                    {/* Mic Toggle */}
                    <button 
                        onClick={toggleMic}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${isMicOn ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500 text-white hover:bg-red-600'}`}
                    >
                        {isMicOn ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                        )}
                    </button>

                    <div className="w-px h-8 bg-white/10" />

                    {/* Camera Controls Group */}
                    <div className="flex gap-2">
                        {liveMode === LiveMode.CAMERA && (
                            <button 
                                onClick={toggleCamera}
                                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white transition-all"
                                title="Switch Camera"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </button>
                        )}
                        {liveMode === LiveMode.CAMERA && mediaCapabilities?.torch && (
                            <button 
                                onClick={toggleTorch}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isTorchOn ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            </button>
                        )}
                    </div>

                    <div className="w-px h-8 bg-white/10" />

                    {/* Visualizer */}
                    <div className="h-12 px-6 flex items-center justify-center min-w-[140px] bg-black/40 rounded-full border border-white/5 shadow-inner">
                        <AudioVisualizer status={status} />
                    </div>

                    <div className="w-px h-8 bg-white/10" />

                    {/* Screen Record */}
                    <button
                      onClick={handleToggleScreenRecord}
                      disabled={liveMode === LiveMode.NONE}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isScreenRecording ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                    >
                      <div className={`transition-all duration-300 ${isScreenRecording ? 'w-3 h-3 bg-red-500 rounded-sm' : 'w-3 h-3 bg-current rounded-full'}`} />
                    </button>

                    {/* End Call */}
                    <button 
                        onClick={handleDisconnect}
                        className="w-12 h-12 ml-2 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
        )}
      </div>

      {/* --- Right Intelligence Sidebar --- */}
      {isConnected && (
        <div 
            className={`absolute right-0 top-0 bottom-0 w-80 z-30 transition-transform duration-300 ease-in-out border-l border-white/10 ${
                isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
            <div className="h-full flex flex-col bg-zinc-950/90 backdrop-blur-2xl shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <h3 className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Intelligence</h3>
                    <div className="flex gap-2">
                        <div className={`w-2 h-2 rounded-full ${status === 'listening' ? 'bg-green-500' : 'bg-zinc-700'}`} />
                        <div className={`w-2 h-2 rounded-full ${status === 'processing' ? 'bg-violet-500' : 'bg-zinc-700'}`} />
                        <div className={`w-2 h-2 rounded-full ${status === 'speaking' ? 'bg-blue-500' : 'bg-zinc-700'}`} />
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="p-6 space-y-6">
                    <div className="space-y-3">
                         <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider ml-1">Input Source</label>
                         <div className="grid grid-cols-2 gap-3">
                             <button 
                                onClick={() => switchLiveMode(LiveMode.CAMERA)} 
                                className={`p-4 rounded-xl border transition-all flex flex-col items-center gap-2 group ${liveMode === LiveMode.CAMERA ? 'bg-blue-500/10 border-blue-500/30 text-blue-200' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
                            >
                                <span className="text-2xl group-hover:scale-110 transition-transform">📸</span>
                                <span className="text-xs font-medium">Camera</span>
                             </button>
                             <button 
                                onClick={() => switchLiveMode(LiveMode.SCREEN)} 
                                className={`p-4 rounded-xl border transition-all flex flex-col items-center gap-2 group ${liveMode === LiveMode.SCREEN ? 'bg-blue-500/10 border-blue-500/30 text-blue-200' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
                            >
                                <span className="text-2xl group-hover:scale-110 transition-transform">🖥️</span>
                                <span className="text-xs font-medium">Screen</span>
                             </button>
                         </div>
                    </div>

                    {liveMode === LiveMode.CAMERA && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-right-4">
                            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider ml-1">Stream Quality</label>
                            <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                                {(['720p', '1080p'] as const).map(res => (
                                    <button
                                        key={res}
                                        onClick={() => changeResolution(res)}
                                        className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                                            resolution === res 
                                            ? 'bg-zinc-700 text-white shadow-sm' 
                                            : 'text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        {res}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Context Scenarios */}
                <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4 custom-scrollbar">
                    <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider ml-1">Context Injection</label>
                    <div className="space-y-3">
                        {SCENARIOS.map(s => (
                            <PromptCard 
                                key={s.id} 
                                scenario={s} 
                                onClick={() => handleScenarioClick(s)} 
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- Save Recording Dialog --- */}
      <SaveRecordingDialog 
        isOpen={isSaveDialogOpen}
        onClose={() => {
            setIsSaveDialogOpen(false);
            setRecordedBlob(null);
        }}
        blob={recordedBlob}
      />
    </div>
  );

  const renderChatView = () => (
    <div className="flex-1 flex flex-col bg-zinc-950 relative">
        {/* Chat Header */}
        <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-zinc-950/50 backdrop-blur-sm z-10 sticky top-0">
            <div className="flex items-center gap-3">
                <span className="text-xl font-bold tracking-tight text-zinc-100">EzGemini Intelligence</span>
            </div>
            
            {/* Model Selector */}
            <div className="flex bg-zinc-900 p-1 rounded-lg border border-white/10">
                <button 
                    onClick={() => setChatModel('fast')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${chatModel === 'fast' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                    ⚡ Flash Lite
                </button>
                <button 
                    onClick={() => setChatModel('smart')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${chatModel === 'smart' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                    🧠 Pro
                </button>
            </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-8">
                    <div className="flex flex-col items-center space-y-2">
                         <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-3xl shadow-lg">
                             💬
                         </div>
                         <p className="text-zinc-400">Start a conversation using the models above or pick a scenario.</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl w-full">
                        {SCENARIOS.map(scenario => (
                            <PromptCard 
                                key={scenario.id} 
                                scenario={scenario} 
                                onClick={() => {
                                    setChatInput(scenario.description);
                                    chatInputRef.current?.focus();
                                }} 
                            />
                        ))}
                    </div>
                </div>
            )}
            
            {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl p-4 whitespace-pre-wrap ${
                        msg.role === 'user' 
                            ? 'bg-blue-600 text-white' 
                            : msg.isThinking 
                                ? 'bg-violet-900/20 border border-violet-500/30 text-zinc-200' 
                                : 'bg-zinc-800 text-zinc-200'
                    }`}>
                        {msg.isThinking && (
                            <div className="text-xs font-bold text-violet-400 mb-2 uppercase tracking-wider flex items-center gap-2">
                                <span>Thinking Process</span>
                                <div className="h-px flex-1 bg-violet-500/20" />
                            </div>
                        )}
                        {msg.text}
                    </div>
                </div>
            ))}
            {isChatLoading && (
                <div className="flex justify-start">
                    <div className="bg-zinc-800 rounded-2xl p-4 flex items-center gap-2">
                        <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                        <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                        <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                </div>
            )}
            <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 pt-0">
            {/* Quick Prompts Section */}
            <div className="flex gap-2 overflow-x-auto pb-3 mb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                {SCENARIOS.map(s => (
                    <button
                        key={s.id}
                        onClick={() => {
                            setChatInput(s.description);
                            chatInputRef.current?.focus();
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-white/10 rounded-full text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white hover:border-white/20 whitespace-nowrap transition-all shadow-sm flex-shrink-0"
                    >
                        <span className="text-sm">{s.icon}</span>
                        <span>{s.title}</span>
                    </button>
                ))}
            </div>

            <div className="relative bg-zinc-900 rounded-2xl border border-white/10 p-2 flex items-end gap-2 shadow-lg">
                <button 
                    onClick={handleMicClick}
                    className={`p-3 rounded-xl transition-all flex-shrink-0 ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`}
                    title="Transcribe Audio"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                </button>
                <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (chatInput.trim() && !isChatLoading) {
                                sendMessage(chatInput, chatModel);
                                setChatInput('');
                            }
                        }
                    }}
                    placeholder={isRecording ? "Listening..." : "Type a message..."}
                    className="w-full bg-transparent border-none outline-none text-white placeholder-zinc-500 resize-none py-3 max-h-32"
                    rows={1}
                />
                <button 
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="p-3 rounded-xl bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-white transition-all flex-shrink-0"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </button>
            </div>
            <div className="text-center mt-2">
                <p className="text-[10px] text-zinc-600">
                    {chatModel === 'fast' && "Using Gemini 2.5 Flash Lite for speed."}
                    {chatModel === 'smart' && "Using Gemini 3.0 Pro Preview for reasoning."}
                </p>
            </div>
        </div>
    </div>
  );

  return (
    <div className="h-screen bg-black text-zinc-100 flex overflow-hidden font-sans selection:bg-blue-500/30">
        {renderSidebar()}
        {view === 'live' ? renderLiveView() : renderChatView()}
    </div>
  );
};

export default App;