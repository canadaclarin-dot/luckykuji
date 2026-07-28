import { useCallback, useEffect, useState } from "react";
import {
  getCurrentSession,
  signInWithPassword,
  signOut,
  subscribeToAuthChanges,
} from "../services/auth";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        const currentSession = await getCurrentSession();

        if (isMounted) {
          setSession(currentSession);
        }
      } catch (error) {
        console.error("로그인 세션 확인 실패:", error);

        if (isMounted) {
          setSession(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const unsubscribe = subscribeToAuthChanges((nextSession) => {
      if (!isMounted) return;

      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await signInWithPassword(email, password);
    setSession(data.session);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setSession(null);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    login,
    logout,
  };
}
