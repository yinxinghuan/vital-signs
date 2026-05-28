// Type declarations for @shared alias.
// Vite resolves the actual files; tsc uses these for type checking.

declare module '@shared/save' {
  export interface UseGameSave<T> {
    savedData: T | null | undefined;
    loaded: boolean;
    hasSave: boolean;
    persist: (data: T) => void;
    clear: () => Promise<void>;
  }
  export function useGameSave<T>(gameId: string): UseGameSave<T>;
}
