import React, { useState, useEffect } from 'react';
import { loadGoogleScripts, uploadToDrive } from '../utils/drive';

interface SaveRecordingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  blob: Blob | null;
  defaultFilename?: string;
}

const SaveRecordingDialog: React.FC<SaveRecordingDialogProps> = ({ 
  isOpen, 
  onClose, 
  blob,
  defaultFilename = 'gemini-session'
}) => {
  const [filename, setFilename] = useState(defaultFilename);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
        setFilename(`${defaultFilename}-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}`);
        setDriveError(null);
        setUploadSuccess(false);
        setUploadProgress(0);
    }
  }, [isOpen, defaultFilename]);

  if (!isOpen || !blob) return null;

  const handleDownload = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `${filename}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    onClose();
  };

  const handleDriveUpload = async () => {
    try {
      setIsUploading(true);
      setDriveError(null);
      await loadGoogleScripts();

      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID_PLACEHOLDER', // Fallback or throw if missing
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: async (tokenResponse: any) => {
          if (tokenResponse.access_token) {
            try {
              await uploadToDrive(
                blob, 
                `${filename}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, 
                tokenResponse.access_token,
                (progress) => setUploadProgress(progress)
              );
              setUploadSuccess(true);
              setTimeout(onClose, 1500);
            } catch (err: any) {
              setDriveError(err.message);
            } finally {
              setIsUploading(false);
            }
          } else {
             setDriveError("Failed to obtain access token.");
             setIsUploading(false);
          }
        },
      });

      client.requestAccessToken();
    } catch (err: any) {
      console.error(err);
      setDriveError("Could not initialize Google Sign-In. Make sure GOOGLE_CLIENT_ID is set.");
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-6">
        
        <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-white">Save Recording</h3>
            <button onClick={onClose} className="text-zinc-500 hover:text-white">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>

        <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase">Filename</label>
            <input 
                type="text" 
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            <p className="text-xs text-zinc-500">Size: {(blob.size / (1024 * 1024)).toFixed(2)} MB</p>
        </div>

        {driveError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {driveError}
            </div>
        )}

        {uploadSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Uploaded to Drive successfully!
            </div>
        )}

        <div className="grid grid-cols-2 gap-3">
            <button 
                onClick={handleDownload}
                className="px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-all flex items-center justify-center gap-2"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
            </button>
            <button 
                onClick={handleDriveUpload}
                disabled={isUploading || uploadSuccess}
                className="px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-medium transition-all flex items-center justify-center gap-2 relative overflow-hidden"
            >
                {isUploading ? (
                    <>
                        <div className="absolute inset-0 bg-blue-700" style={{ width: `${uploadProgress}%`, transition: 'width 0.2s' }} />
                        <span className="relative z-10 text-xs">{uploadProgress.toFixed(0)}%</span>
                    </>
                ) : (
                    <>
                        <svg className="w-5 h-5" viewBox="0 0 87.3 78" fill="currentColor"><path d="M6.6 66.85l25.3-43.8 25.3 43.8H6.6z" fill="#00AC47"/><path d="M43.65 23.05l25.3 43.8 25.3-43.8h-50.6z" fill="#EA4335"/><path d="M43.65 23.05L18.35 66.85H6.6l25.3-43.8h11.75z" fill="#0066DA"/><path d="M43.65 23.05h25.3L43.65 66.85l-25.3-43.8h25.3z" fill="#FFBA00"/></svg>
                        <span className="relative z-10">Save to Drive</span>
                    </>
                )}
            </button>
        </div>
      </div>
    </div>
  );
};

export default SaveRecordingDialog;