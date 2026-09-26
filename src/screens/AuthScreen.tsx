import { useRef, useState } from 'react';
import { ArrowLeft, KeyRound, LogIn, Mail, UserPlus, X } from 'lucide-react';
import { api, ApiError, setSession, type PublicUser } from '../api';
import { useFocusTrap } from '../accessibility/FocusManager';
import { Alert, Button, Card, CardContent, CardHeader, Field, Input } from '../components/ui';

export function AuthScreen({
  onAuthenticated,
  initialMode = 'login',
  onClose,
}: {
  onAuthenticated: (user: PublicUser) => void;
  initialMode?: 'login' | 'signup';
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [flow, setFlow] = useState<'auth' | 'forgot' | 'reset'>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  // Blind-user-perspective audit (2026-08-07): this dialog had role=dialog
  // aria-modal=true but no actual focus trap, so Tab could escape into the
  // page behind it and focus was never restored to the triggering control
  // on close — both real screen-reader/keyboard usability defects, not just
  // Lighthouse-invisible ones (Lighthouse does not check for a real trap).
  const authDialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(authDialogRef, true);
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && !fullName.trim()) {
      setError('Enter your name.');
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === 'signup'
          ? await api.signup({ email: email.trim(), password, fullName: fullName.trim() })
          : await api.login({ email: email.trim(), password });
      setSession(result.token, result.refreshToken);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function forgot() {
    setError('');
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.forgotPassword(email.trim());
      const msg = result.devToken
        ? `Reset issued. Dev token (self-hosted, no email configured): ${result.devToken} — open Settings → Forgot password → enter it below.`
        : 'If an account exists, a reset link has been issued.';
      setError(msg);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not request a reset.');
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    setError('');
    if (!resetToken.trim() || password.length < 8) {
      setError('Enter the reset token and a new password (at least 8 characters).');
      return;
    }
    setLoading(true);
    try {
      const result = await api.resetPassword(resetToken.trim(), password);
      setSession(result.token, result.refreshToken);
      setResetToken('');
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={authDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="flex-row items-start justify-between gap-4 p-6 pb-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">watchora</p>
            <h2 id="auth-title" className="font-display text-2xl font-semibold leading-tight tracking-tight text-foreground">
              {mode === 'signup' ? 'Create your account' : 'Sign in'}
            </h2>
          </div>
          {onClose ? (
            <Button variant="ghost" size="md" onClick={onClose} aria-label="Close">
              <X aria-hidden="true" />
              Close
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6 p-6 pt-2">
          {flow === 'forgot' ? (
            <>
              <Field label="Email" htmlFor="auth-email">
                <Input
                  aria-label="Email"
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              {error ? (
                <Alert politeness="assertive" tone="danger" className="whitespace-pre-wrap">
                  {error}
                </Alert>
              ) : null}
              <div className="flex flex-col gap-3">
                <Button size="lg" onClick={forgot} disabled={loading}>
                  <Mail aria-hidden="true" />
                  {loading ? 'Please wait…' : 'Send reset link'}
                </Button>
                <Button variant="ghost" onClick={() => setFlow('auth')}>
                  <ArrowLeft aria-hidden="true" />
                  Back to sign in
                </Button>
              </div>
            </>
          ) : flow === 'reset' ? (
            <>
              <Field label="Reset token" htmlFor="auth-reset-token">
                <Input
                  aria-label="Reset token"
                  id="auth-reset-token"
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  placeholder="Paste the reset token"
                />
              </Field>
              <Field label="New password" htmlFor="auth-reset-password">
                <Input
                  aria-label="New password"
                  id="auth-reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </Field>
              {error ? (
                <Alert politeness="assertive" tone="danger" className="whitespace-pre-wrap">
                  {error}
                </Alert>
              ) : null}
              <div className="flex flex-col gap-3">
                <Button size="lg" onClick={reset} disabled={loading}>
                  <KeyRound aria-hidden="true" />
                  {loading ? 'Please wait…' : 'Set new password'}
                </Button>
                <Button variant="ghost" onClick={() => setFlow('auth')}>
                  <ArrowLeft aria-hidden="true" />
                  Back to sign in
                </Button>
              </div>
            </>
          ) : (
            <>
              {mode === 'signup' ? (
                <Field label="Full name" htmlFor="auth-full-name">
                  <Input
                    aria-label="Full name"
                    id="auth-full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your name"
                  />
                </Field>
              ) : null}
              <Field label="Email" htmlFor="auth-email">
                <Input
                  aria-label="Email"
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password" htmlFor="auth-password">
                <Input
                  aria-label="Password"
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  onKeyDown={(event) => event.key === 'Enter' && submit()}
                />
              </Field>
              {error ? (
                <Alert politeness="assertive" tone="danger" className="whitespace-pre-wrap">
                  {error}
                </Alert>
              ) : null}
              <div className="flex flex-col gap-3">
                <Button size="lg" onClick={submit} disabled={loading}>
                  {mode === 'signup' ? <UserPlus aria-hidden="true" /> : <LogIn aria-hidden="true" />}
                  {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </Button>
                <Button variant="ghost" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
                  {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
                </Button>
                {mode === 'login' ? (
                  <Button variant="ghost" onClick={() => setFlow('forgot')}>
                    Forgot your password?
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
