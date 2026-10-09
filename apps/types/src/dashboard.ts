export type DataState = 'loading' | 'error' | 'empty' | 'stale' | 'unavailable' | 'ready';

export type SourceMode = 'LIVE' | 'DEMO';

export interface SourceModeState {
  mode: SourceMode;
}
