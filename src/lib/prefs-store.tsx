import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  // Keys the user changed before the stored prefs came back, so hydration
  // doesn't undo them.
  const touched = useRef(new Set<keyof Prefs>());

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as Partial<Prefs>;
          setPrefs((current) => {
            const next: Prefs = { ...DEFAULTS, ...stored };
            if (touched.current.has('radiusMiles')) next.radiusMiles = current.radiusMiles;
            if (touched.current.has('remindersEnabled')) next.remindersEnabled = current.remindersEnabled;
            return next;
          });
        }
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
      setRadiusMiles: (radiusMiles) => {
        touched.current.add('radiusMiles');
        setPrefs((p) => ({ ...p, radiusMiles }));
      },
      setRemindersEnabled: (remindersEnabled) => {
        touched.current.add('remindersEnabled');
        setPrefs((p) => ({ ...p, remindersEnabled }));
      },
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
