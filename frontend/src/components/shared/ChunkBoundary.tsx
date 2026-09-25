import { Component, Suspense, type ReactNode } from 'react';
import { Alert, Button, IconButton, Snackbar } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ChunkLoadError } from '../../utils/lazyChunk';

interface ChunkBoundaryProps {
  children: ReactNode;
  /** Shown while the chunk is on its way. */
  fallback?: ReactNode;
}

interface ChunkBoundaryState {
  error: Error | null;
  /** The curator closed the prompt and chose to go on without the part that failed. */
  dismissed: boolean;
}

/**
 * Where a chunk loaded on demand is mounted (#643): `Suspense` for the wait,
 * and a boundary for the chunk that never arrives.
 *
 * Without the boundary a failed import is a render error with nothing above it
 * to catch it, and React unmounts the whole root — a curator who pressed Edit
 * after a deployment would lose the map to a blank page. Here the rest of the
 * page stays, and the curator is offered the reload that fetches the new file
 * names, or to close the prompt and go on without that part: the boundary
 * stays mounted where its screen does, and a prompt that cannot be closed
 * would sit over the map until a reload. Only a `ChunkLoadError` is caught:
 * any other error is rethrown, so a bug inside the screen is not dressed up
 * as a missing download.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { error: null, dismissed: false };

  static getDerivedStateFromError(error: Error): Partial<ChunkBoundaryState> {
    return { error };
  }

  render() {
    const { error, dismissed } = this.state;
    if (error && !(error instanceof ChunkLoadError)) throw error;
    if (error) {
      const dismiss = () => this.setState({ dismissed: true });
      return (
        <Snackbar open={!dismissed} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert
            severity="error"
            action={(
              <>
                <Button color="inherit" size="small" onClick={() => window.location.reload()}>Reload</Button>
                <IconButton color="inherit" size="small" aria-label="Close" onClick={dismiss}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            )}
          >
            This part of the page could not be loaded — a new version may have been published. Reload to get it.
          </Alert>
        </Snackbar>
      );
    }
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}
