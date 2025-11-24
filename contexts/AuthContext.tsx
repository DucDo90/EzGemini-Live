import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signOut as firebaseSignOut
} from 'firebase/auth';
import { auth } from '../utils/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  continueAsGuest: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signOut = async () => {
    if (user?.isAnonymous && user?.email === 'guest@preview.app') {
      setUser(null);
      return;
    }

    if (auth) {
      await firebaseSignOut(auth);
    }
    setUser(null);
  };

  const continueAsGuest = () => {
    const guestUser = {
      uid: 'guest-' + Date.now(),
      email: 'guest@preview.app',
      displayName: 'Guest User',
      emailVerified: true,
      isAnonymous: true,
      metadata: {},
      providerData: [],
      refreshToken: '',
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => 'guest-token',
      getIdTokenResult: async () => ({
        token: 'guest-token',
        signInProvider: 'guest',
        claims: {},
        authTime: Date.now().toString(),
        issuedAtTime: Date.now().toString(),
        expirationTime: (Date.now() + 3600000).toString(),
      }),
      reload: async () => {},
      toJSON: () => ({}),
      phoneNumber: null,
      photoURL: null,
      providerId: 'guest',
    } as unknown as User;
    
    setUser(guestUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut, continueAsGuest }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};