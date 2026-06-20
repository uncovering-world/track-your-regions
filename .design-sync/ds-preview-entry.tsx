// Manual bundle entry for design-sync (package shape).
// `frontend` is an app, not a published package, so there is no dist entry and a
// whole-src synth entry would pull in main.tsx's ReactDOM.createRoot side effect.
// This minimal entry re-exports only the seed components + the preview provider.
export { EmptyState } from '../frontend/src/components/shared/EmptyState';
export { LoadingSpinner } from '../frontend/src/components/shared/LoadingSpinner';
export { DsPreviewProvider } from './DsPreviewProvider';
