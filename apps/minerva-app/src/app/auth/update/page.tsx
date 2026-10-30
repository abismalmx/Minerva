'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { authClient } from '@/services/authClient';
import { isSelfHostedBackend } from '@/services/selfhostedBackend';

export default function UpdateEmailPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { isDarkMode } = useThemeStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // A self-hosted deployment has no mail server, so the address is changed
  // directly: the passphrase is the proof that the caller owns the account.
  // The hosted backend confirms the change by email instead.
  const selfHosted = isSelfHostedBackend();

  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const { error: updateError } = await authClient().updateUser({
        email: email,
        password: selfHosted ? password : undefined,
      });

      if (updateError) throw updateError;

      setMessage(
        selfHosted
          ? _('Your account email has been updated.')
          : _(
              'Confirmation email sent! Please check your old and new email addresses to confirm the change.',
            ),
      );
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Failed to update email'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-md p-8'>
        <div className={`rounded-md p-8`}>
          <form onSubmit={handleSubmit} className='space-y-6'>
            <div className='space-y-1'>
              <label
                htmlFor='email'
                className={`block text-sm font-normal ${isDarkMode ? 'text-gray-300' : 'text-gray-400'}`}
              >
                {_('New Email')}
              </label>
              <input
                id='email'
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={_('Your new email')}
                required
                disabled={loading}
                className={`w-full rounded-md border bg-transparent px-4 py-2.5 focus:outline-hidden focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${isDarkMode ? 'text-gray-300' : 'text-gray-400'}`}
              />
            </div>

            {selfHosted && (
              <div className='space-y-1'>
                <label
                  htmlFor='password'
                  className={`block text-sm font-normal ${isDarkMode ? 'text-gray-300' : 'text-gray-400'}`}
                >
                  {_('Current Passphrase')}
                </label>
                <input
                  id='password'
                  type='password'
                  autoComplete='current-password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={_('Your current passphrase')}
                  required
                  disabled={loading}
                  className={`w-full rounded-md border bg-transparent px-4 py-2.5 focus:outline-hidden focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${isDarkMode ? 'text-gray-300' : 'text-gray-400'}`}
                />
              </div>
            )}

            {error && <div className={`text-sm text-red-500`}>{error}</div>}

            {message && <div className={`text-base-content text-sm`}>{message}</div>}

            <button
              type='submit'
              disabled={loading || !email}
              className={`w-full rounded-md bg-green-400 px-4 py-2.5 font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed`}
            >
              {loading ? _('Updating email ...') : _('Update email')}
            </button>

            <button
              onClick={() => router.back()}
              className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors ${
                isDarkMode
                  ? 'border-gray-600 text-gray-300 hover:bg-gray-800'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg
                xmlns='http://www.w3.org/2000/svg'
                className='h-4 w-4'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M15 19l-7-7 7-7'
                />
              </svg>
              {_('Back')}
            </button>
          </form>

          {user?.email && (
            <div className={`mt-6 text-center text-sm text-gray-300`}>
              {_('Current email')}: {user.email}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
