/**
 * The session handlers' refusals, each with the status and sentence the web
 * reads (ADR-0071: answered through their declared routes). The web tells a
 * wrong current password apart from an expired token by its 401, and offers a
 * resend on `EMAIL_NOT_VERIFIED` — both are contracts, not wording.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('passport', () => ({
  default: { authenticate: vi.fn() },
}));
vi.mock('../../services/authService.js', () => ({
  findUserById: vi.fn(),
  generateTokenPair: vi.fn(),
  toPublicUser: vi.fn((u: { id: number }) => ({ id: u.id })),
  verifyRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  generateAccessToken: vi.fn(),
  getPasswordHash: vi.fn(),
  verifyPassword: vi.fn(),
  REFRESH_TOKEN_EXPIRY_DAYS: 7,
}));
vi.mock('../../services/emailService.js', () => ({ sendVerificationEmail: vi.fn() }));

import passport from 'passport';
import { findUserById, getPasswordHash, verifyPassword, verifyRefreshToken } from '../../services/authService.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { authRoutes } from '../../routes/authRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const postLogin = routeAt(authRoutes, '/login', 'post');
const postRefresh = routeAt(authRoutes, '/refresh', 'post');
const postExchangeCode = routeAt(authRoutes, '/exchange-code', 'post');
const postChangePassword = routeAt(authRoutes, '/change-password', 'post');

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

/** The local strategy's verdict, as passport hands it to the handler's callback. */
function strategyAnswers(user: Express.User | false): void {
  mocked(passport.authenticate).mockImplementation((_name: string, _opts: unknown, callback: (err: null, u: unknown) => void) => () => callback(null, user));
}

const LOGIN = { body: { email: 'traveller@example.org', password: 'long enough' } };
const CALLER = { id: 7, uuid: 'u', role: 'user' } as Express.User;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('login', () => {
  it('answers every refusal of the strategy with one sentence, whatever it was', async () => {
    strategyAnswers(false);
    const res = makeRes();
    await answerRoute(postLogin, { ...LOGIN }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid email or password' });
  });

  it('refuses an unverified local account with the code the web offers a resend on', async () => {
    strategyAnswers({ id: 7 } as Express.User);
    mocked(findUserById).mockResolvedValue({ id: 7, emailVerified: false, authProvider: 'local' });
    const res = makeRes();
    await answerRoute(postLogin, { ...LOGIN }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Please verify your email before logging in',
      code: 'EMAIL_NOT_VERIFIED',
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('refresh', () => {
  it('refuses a request with no refresh token', async () => {
    const res = makeRes();
    await answerRoute(postRefresh, {}, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No refresh token provided' });
  });

  it('clears the cookie of a token it refuses, so the web stops offering it', async () => {
    mocked(verifyRefreshToken).mockResolvedValue(null);
    const res = makeRes();
    // The harness hands the handler an empty request; the token rides in the body here.
    await expect(postRefresh.handler({ params: undefined, query: undefined, body: undefined }, {
      req: { cookies: {}, body: { refreshToken: 'stale' } } as never, res: res as never,
    })).rejects.toMatchObject({ statusCode: 401, message: 'Invalid or expired refresh token' });
    expect(res.clearCookie).toHaveBeenCalledWith('tyr-refresh-token', expect.objectContaining({ path: '/api/auth' }));
  });
});

describe('exchange-code', () => {
  it('refuses a code nobody issued', async () => {
    const res = makeRes();
    await answerRoute(postExchangeCode, { body: { code: 'f'.repeat(64) } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired authorization code' });
  });

  it('refuses a request that carries no code before any lookup', async () => {
    await expect(answerRoute(postExchangeCode, { body: {} }, makeRes())).rejects.toThrow();
  });
});

describe('change-password', () => {
  it('answers a wrong current password 401, which the web reads apart from an expired token', async () => {
    mocked(getPasswordHash).mockResolvedValue('hash');
    mocked(verifyPassword).mockResolvedValue(false);
    const res = makeRes();
    await answerRoute(postChangePassword, {
      body: { currentPassword: 'wrong', newPassword: 'a new long one' }, user: CALLER,
    }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' });
  });

  it('refuses an account that signs in through a provider', async () => {
    mocked(getPasswordHash).mockResolvedValue(null);
    const res = makeRes();
    await answerRoute(postChangePassword, {
      body: { currentPassword: 'x', newPassword: 'a new long one' }, user: CALLER,
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password change is not available for OAuth accounts' });
  });
});
