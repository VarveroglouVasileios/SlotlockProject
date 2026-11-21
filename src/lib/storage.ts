/** Safe localStorage wrapper: private mode or blocked storage must not break the demo. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* demo data just stays in memory */
  }
}

export const img = (name: string): string => `${import.meta.env.BASE_URL}images/${name}.webp`
