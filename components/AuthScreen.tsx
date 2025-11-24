import React, { useState, useEffect, useRef } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  GoogleAuthProvider, 
  signInWithPopup, 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  ConfirmationResult
} from 'firebase/auth';
import { auth } from '../utils/firebase';
import { useAuth } from '../contexts/AuthContext';

type AuthView = 'login' | 'signup' | 'phone' | 'forgot-password';

const AuthScreen: React.FC = () => {
  const { continueAsGuest } = useAuth();
  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  // Initialize Recaptcha for Phone Auth
  const setupRecaptcha = () => {
    if (!auth) return;
    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible',
          'callback': () => {
            // reCAPTCHA solved
          }
        });
      }
    } catch (e) {
      console.error("Recaptcha setup failed", e);
    }
  };

  const mapAuthError = (code: string) => {
    switch (code) {
      case 'auth/invalid-email': return 'Invalid email address.';
      case 'auth/user-disabled': return 'User account disabled.';
      case 'auth/user-not-found': return 'No account found with this email.';
      case 'auth/wrong-password': return 'Incorrect password.';
      case 'auth/email-already-in-use': return 'Email already in use.';
      case 'auth/weak-password': return 'Password is too weak.';
      case 'auth/popup-closed-by-user': return 'Sign in cancelled.';
      case 'auth/invalid-verification-code': return 'Invalid OTP code.';
      case 'auth/invalid-phone-number': return 'Invalid phone number format. Use +1...';
      case 'auth/unauthorized-domain': return 'Domain not authorized. Switching to Guest Mode...';
      case 'auth/api-key-not-valid': return 'Firebase API Key is invalid. Check config.';
      case 'auth/operation-not-allowed': return 'This sign-in method is not enabled in Firebase Console.';
      default: return `Authentication failed (${code}). Please try again.`;
    }
  };

  const handleAuthError = (err: any) => {
    console.error("Auth Error:", err);
    
    const errorMessage = err.message?.toLowerCase() || '';
    const errorCode = err.code || '';

    // Check for unauthorized domain error specifically (case-insensitive)
    if (errorCode === 'auth/unauthorized-domain' || 
        errorMessage.includes('unauthorized domain') ||
        errorMessage.includes('auth/unauthorized-domain')) {
      
      setError("Preview environment detected. Switching to Guest Mode automatically...");
      
      // Automatically switch to guest mode after a brief pause to show the message
      setTimeout(() => {
        continueAsGuest();
      }, 1000);
    } else {
      setError(mapAuthError(errorCode));
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      setError("Firebase not initialized.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      // Set persistence based on "Remember Me"
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      if (view === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (!auth) return;
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError(null);
    setLoading(true);

    try {
      setupRecaptcha();
      if (!recaptchaVerifierRef.current) throw new Error("Recaptcha setup failed");

      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierRef.current);
      setConfirmationResult(confirmation);
      setInfoMessage("OTP sent to your phone.");
    } catch (err: any) {
      handleAuthError(err);
      
      if (recaptchaVerifierRef.current) {
        try {
            recaptchaVerifierRef.current.clear();
        } catch (e) {}
        recaptchaVerifierRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    setError(null);
    setLoading(true);

    try {
      await confirmationResult.confirm(otp);
    } catch (err: any) {
      setError("Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !email) {
      setError("Please enter your email address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfoMessage("Password reset email sent. Check your inbox.");
      setTimeout(() => setView('login'), 3000);
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  if (!auth) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
           <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[120px] animate-pulse-slow" />
        </div>
        <div className="w-full max-w-lg bg-zinc-900/50 backdrop-blur-xl border border-red-500/20 rounded-2xl shadow-2xl p-8 relative z-10 text-center space-y-6">
           <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/20">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
           </div>
           <div>
             <h2 className="text-2xl font-bold text-white mb-2">Configuration Issue</h2>
             <p className="text-zinc-400 text-sm leading-relaxed">
               Firebase has not been initialized correctly. You can still use the application in Guest Mode.
             </p>
           </div>
           
           <button 
              onClick={continueAsGuest}
              className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-colors"
            >
              Continue as Guest
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="w-full max-w-md bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-8 relative z-10 animate-in fade-in zoom-in duration-300">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20 mb-4">
             <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Welcome Back</h2>
          <p className="text-zinc-400 text-sm mt-2">Sign in to access your EzGemini Live Assistant</p>
        </div>

        {/* Error / Info Messages */}
        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}
        {infoMessage && (
          <div className="mb-6 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-xs flex items-center gap-2">
             <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
             {infoMessage}
          </div>
        )}

        {/* --- Phone Auth Flow --- */}
        {view === 'phone' ? (
           <div className="space-y-4">
              {!confirmationResult ? (
                <form onSubmit={handlePhoneSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Phone Number</label>
                    <input 
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+1 555 123 4567"
                      className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      required
                    />
                  </div>
                  <div id="recaptcha-container"></div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Sending OTP...' : 'Send Code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleOtpVerify} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Verification Code</label>
                    <input 
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors text-center tracking-widest text-lg"
                      required
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                </form>
              )}
              <button onClick={() => { setView('login'); setConfirmationResult(null); setError(null); }} className="w-full text-zinc-500 text-xs hover:text-zinc-300">
                Back to Login
              </button>
           </div>
        ) : (
          /* --- Email / Password / Social Flow --- */
          <>
            {view === 'forgot-password' ? (
               <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      required
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                  <button type="button" onClick={() => setView('login')} className="w-full text-zinc-500 text-xs hover:text-zinc-300">
                    Back to Login
                  </button>
               </form>
            ) : (
              /* --- Login / Signup Form --- */
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Password</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    required
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                   <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${rememberMe ? 'bg-blue-600 border-blue-600' : 'border-zinc-700 bg-zinc-900'}`}>
                         {rememberMe && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="hidden" />
                      <span className="text-zinc-400 group-hover:text-zinc-300">Remember me</span>
                   </label>
                   {view === 'login' && (
                     <button type="button" onClick={() => setView('forgot-password')} className="text-blue-400 hover:text-blue-300">
                       Forgot password?
                     </button>
                   )}
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 mt-2"
                >
                  {loading ? 'Processing...' : (view === 'login' ? 'Sign In' : 'Create Account')}
                </button>
              </form>
            )}

            {/* Divider */}
            {view !== 'forgot-password' && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-zinc-900 px-2 text-zinc-500">Or continue with</span></div>
                </div>

                {/* Social Buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={handleGoogleAuth}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-colors"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    <span className="text-sm font-medium text-zinc-300">Google</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => setView('phone')}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-colors"
                  >
                    <svg className="w-5 h-5 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    <span className="text-sm font-medium text-zinc-300">Phone</span>
                  </button>
                </div>

                {/* Switch View */}
                <div className="mt-6 text-center">
                  <p className="text-sm text-zinc-500">
                    {view === 'login' ? "Don't have an account? " : "Already have an account? "}
                    <button 
                      onClick={() => { setError(null); setView(view === 'login' ? 'signup' : 'login'); }} 
                      className="text-white hover:underline font-medium"
                    >
                      {view === 'login' ? 'Sign up' : 'Log in'}
                    </button>
                  </p>
                </div>

                {/* Guest Button - Always visible at bottom of main auth view */}
                <button 
                  type="button"
                  onClick={continueAsGuest}
                  className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 bg-zinc-950/50 hover:bg-zinc-900 rounded-xl border border-white/5 hover:border-white/10 transition-all group"
                >
                  <span className="text-sm font-medium text-zinc-400 group-hover:text-zinc-300">No account? Continue as Guest</span>
                  <svg className="w-4 h-4 text-zinc-500 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;