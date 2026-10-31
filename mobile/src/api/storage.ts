import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persistent key-value store. Failures (private mode, full disk) never crash the app. */
export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function save(key: string, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function remove(key: string) {
  try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
}
