'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Auth } from '@supabase/auth-ui-react';
import { supabase } from '@/utils/supabase';
import { authClient } from '@/services/authClient';
import { isSelfHostedBackend } from '@/services/selfhostedBackend';

export default function ResetPasswordPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { isDarkMode } = useThemeStore();

  const getAuthLocalization = () => {
    return {
      variables: {
        update_password: {
          password_label: _('New Password'),
          password_input_placeholder: _('Your new password'),
          button_label: _('Update password'),
          loading_button_label: _('Updating password ...'),
          confirmation_text: _('Your password has been updated'),
        },
      },
    };
  };

  useEffect(() => {
    const { data: subscription } = authClient().onAuthStateChange((event, session) => {
      if (session?.access_token && session.user && event === 'USER_UPDATED') {
        login(session.access_token, session.user);
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        router.push(redirectTo ?? '/library');
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // A self-hosted deployment has no mail server, so there is no recovery
  // email to click and the Supabase password-update widget cannot work.
  // The page is unreachable there (the sign-in page hides the link); render a
  // plain message instead of a widget that would fail.
  if (isSelfHostedBackend()) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='w-full max-w-md p-8'>
          <p className='text-base-content text-sm'>
            {_('Password recovery is not available on this server.')}
          </p>
          <button
            onClick={() => router.back()}
            className='mt-6 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors'
          >
            {_('Back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-md p-8'>
        <Auth
          supabaseClient={supabase}
          view='update_password'
          appearance={{ theme: ThemeSupa }}
          theme={isDarkMode ? 'dark' : 'light'}
          magicLink={false}
          providers={[]}
          localization={getAuthLocalization()}
        />

        <button
          onClick={() => router.back()}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors ${
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
      </div>
    </div>
  );
}
