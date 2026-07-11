import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'marquee.prefs.v1';

export const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

type Prefs = {
  radiusMiles: number;
  remindersEnabled: boolean;
};

const DEFAULTS: Prefs = {
  radiusMiles: 50,
  remindersEnabled: false,
};

type PrefsContextValue = Prefs & {
  ready: boolean;
  setRadiusMiles: (miles: number) => void;
  setRemindersEnabled: (enabled: boolean) => void;
};

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch (err) {
        console.warn('failed to load prefs:', err);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch((err) =>
      console.warn('failed to save prefs:', err),
    );
  }, [prefs, ready]);

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...prefs,
      ready,
      setRadiusMiles: (radiusMiles) => setPrefs((p) => ({ ...p, radiusMiles })),
      setRemindersEnabled: (remindersEnabled) =>
        setPrefs((p) => ({ ...p, remindersEnabled })),
    }),
    [prefs, ready],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider');
  return ctx;
}
