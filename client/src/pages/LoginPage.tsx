/**
 * LoginPage — Google OAuth + Email OTP login.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useNayin } from '@/features/nayin/NayinContext';
import WuxingDrinkIcon from '@/features/nayin/views/WuxingDrinkIcon';
import { useAuth } from '@/_core/hooks/useAuth';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

type EmailStep = 'input' | 'code';
type GoogleAuthConfig = {
  configured: boolean;
  redirectUri: string;
};

export default function LoginPage() {
  const { element } = useNayin();
  const { isAuthenticated, loading, refresh } = useAuth();
  const [, navigate] = useLocation();

  const [emailStep, setEmailStep] = useState<EmailStep>('input');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [googleConfig, setGoogleConfig] = useState<GoogleAuthConfig | null>(null);

  // Already logged in → go home
  useEffect(() => {
    if (!loading && isAuthenticated && import.meta.env.PROD) {
      navigate('/');
    }
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/google/config')
      .then(res => (res.ok ? res.json() : null))
      .then((data: GoogleAuthConfig | null) => {
        if (!cancelled && data?.redirectUri) {
          setGoogleConfig(data);
        }
      })
      .catch(() => {
        if (!cancelled) setGoogleConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get('error');

  async function handleEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    setEmailError('');
    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEmailError(data.error === 'invalid_email' ? '请输入有效的邮箱地址' : '发送失败，请重试');
        return;
      }
      setEmailStep('code');
    } catch {
      setEmailError('网络错误，请重试');
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleEmailVerify(e: React.FormEvent) {
    e.preventDefault();
    setEmailError('');
    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        setEmailError('验证码错误或已过期，请重试');
        return;
      }
      await refresh();
      navigate('/');
    } catch {
      setEmailError('网络错误，请重试');
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: 'var(--background)' }}
    >
      {/* Nayin color strip at top */}
      <div className="nayin-strip fixed top-0 left-0 right-0" />

      <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <WuxingDrinkIcon element={element} size={52} />
          <div className="text-center">
            <h1
              className="text-lg font-semibold tracking-[0.2em] text-foreground"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              DRINKING TIME
            </h1>
            <p className="text-xs text-muted-foreground mt-1 tracking-wide">
              影视视觉开发平台
            </p>
          </div>
        </div>

        {/* Login card */}
        <div
          className="w-full rounded-xl border p-6 flex flex-col gap-4"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--nayin-border)',
            boxShadow: '0 0 40px -12px var(--nayin-glow)',
          }}
        >
          <div className="text-xs text-muted-foreground text-center font-mono uppercase tracking-widest">
            登录 / Sign in
          </div>

          {!loading && isAuthenticated && (
            <div
              className="text-xs text-center py-2 px-3 rounded-md leading-relaxed"
              style={{
                background: 'oklch(0.72 0.12 120 / 0.14)',
                color: 'oklch(0.78 0.13 120)',
              }}
            >
              当前已处于本地访客模式，可以先进入工作台，不必被 Google 登录卡住。
            </div>
          )}

          {oauthError && (
            <div
              className="text-xs text-center py-2 px-3 rounded-md"
              style={{ background: 'oklch(0.45 0.15 25 / 0.15)', color: 'oklch(0.7 0.15 25)' }}
            >
              {oauthError === 'oauth_failed' ? '登录失败，请重试' : '登录出错，请重试'}
            </div>
          )}

          {!loading && isAuthenticated && (
            <button
              type="button"
              onClick={() => navigate('/analysis')}
              className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: 'var(--nayin-surface)',
                color: 'var(--foreground)',
                border: '1px solid var(--nayin-border)',
              }}
            >
              先进入 Analysis Engine
            </button>
          )}

          {/* Google */}
          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-3 w-full py-2.5 px-4 rounded-lg border text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98]"
            style={{
              background: 'var(--background)',
              borderColor: 'var(--nayin-border)',
              color: 'var(--foreground)',
            }}
          >
            <GoogleIcon />
            用 Google 帐号继续
          </a>

          <div
            className="rounded-lg border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground"
            style={{
              background: 'var(--background)',
              borderColor: 'var(--nayin-border)',
            }}
          >
            <div className="mb-1 font-mono uppercase tracking-widest text-foreground/70">
              Google OAuth 回调地址
            </div>
            <div className="break-all font-mono">
              {googleConfig?.redirectUri ?? '读取中…'}
            </div>
            <div className="mt-1">
              如果 Google 显示 redirect_uri_mismatch，请把上面这行完整加入 Google Cloud
              Console 的“已获授权的重定向 URI”。
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: 'var(--nayin-border)' }} />
            <span className="text-[10px] text-muted-foreground font-mono">或</span>
            <div className="flex-1 h-px" style={{ background: 'var(--nayin-border)' }} />
          </div>

          {/* Email OTP */}
          {emailStep === 'input' ? (
            <form onSubmit={handleEmailRequest} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full py-2.5 px-3 rounded-lg border text-sm bg-transparent outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--nayin-border)',
                  color: 'var(--foreground)',
                }}
              />
              {emailError && (
                <p className="text-xs text-center" style={{ color: 'oklch(0.7 0.15 25)' }}>
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--nayin-surface)', color: 'var(--foreground)', border: '1px solid var(--nayin-border)' }}
              >
                {emailLoading ? '发送中…' : '发送验证码'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailVerify} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground text-center">
                验证码已发送至 <span className="text-foreground">{email}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="6位验证码"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                className="w-full py-2.5 px-3 rounded-lg border text-sm bg-transparent outline-none text-center tracking-[0.5em] font-mono"
                style={{ borderColor: 'var(--nayin-border)', color: 'var(--foreground)' }}
              />
              {emailError && (
                <p className="text-xs text-center" style={{ color: 'oklch(0.7 0.15 25)' }}>
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                disabled={emailLoading || code.length < 6}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--nayin-surface)', color: 'var(--foreground)', border: '1px solid var(--nayin-border)' }}
              >
                {emailLoading ? '验证中…' : '确认登录'}
              </button>
              <button
                type="button"
                onClick={() => { setEmailStep('input'); setCode(''); setEmailError(''); }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                重新输入邮箱
              </button>
            </form>
          )}

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            登录即表示你同意我们存储你的创作数据。
            <br />
            数据仅用于本平台服务。
          </p>
        </div>
      </div>
    </div>
  );
}
