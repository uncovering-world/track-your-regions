import passport from 'passport';
import { configureLocalStrategy, configureGoogleStrategy, configureAppleStrategy } from './strategies/index.js';

/**
 * Initialize Passport with all authentication strategies
 */
export function initializePassport(): void {
  // Configure all strategies
  configureLocalStrategy();
  configureGoogleStrategy();
  configureAppleStrategy();

  // Note: We don't use passport sessions since we use JWT tokens
  // The serialize/deserialize functions are not needed
}

export { passport };
