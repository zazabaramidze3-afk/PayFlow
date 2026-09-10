import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import styles from './Login.module.scss';
import LanguageSwitcher from '../components/LanguageSwitcher';

interface LoginResult {
  error?: string;
  requiresPasswordReset?: boolean;
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ახლა UUID string-ია.
  userId?: string;
}

interface ResolvedOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface LoginProps {
  // 🏢 Multi-Tenant SaaS — `users.name` per-org unique გახდა (migration 016,
  // Roadmap "24.08.2026") — login-ს ახლა `slug`-იც სჭირდება (App.tsx-ის
  // handleLoginAttempt POST /login-ს ამ ველითაც აგზავნის).
  onLoginAttempt: (slug: string, username: string, password: string, callback: (result: LoginResult) => void) => void;
  // 🔐 საწყისი პაროლის განახლების დასრულების შემდეგ ბექენდი აბრუნებს
  // ჩვეულებრივ login-ტოკენს — ამ callback-ით ვაცნობებთ App.tsx-ს, რომ
  // სესია დაამყაროს (ისე, თითქოს ჩვეულებრივად შემოვიდა).
  onPasswordResetComplete: (token: string, user: any) => void;
  // 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — router-ის
  // არარსებობის გამო App.tsx state-ტოგლით გადადის Register.tsx-ზე.
  onNavigateToRegister: () => void;
}

// 🏢 Multi-Tenant SaaS — subdomain routing (STEP 7) ჯერ ვერ ხერხდება
// (`*.vercel.app`-ზე wildcard subdomain არ მუშაობს, საკუთარი domain-ის
// მოლოდინშია) — ამ ეტაპზე login ორსაფეხურიანია: 1) კომპანიის slug-ის
// დადასტურება (`GET /organizations/resolve/:slug`), 2) username/password.
// Roadmap "24.08.2026", "🔒 გადაწყვეტილება — users.name uniqueness"-ის
// პირდაპირი გაგრძელება.
const LAST_SLUG_STORAGE_KEY = 'payflow_last_org_slug';

export default function Login({ onLoginAttempt, onPasswordResetComplete, onNavigateToRegister }: LoginProps) {
  const { t } = useTranslation();

  // 🏢 Step 1 — კომპანიის slug-ის დადასტურება.
  const [step, setStep] = useState<'slug' | 'credentials'>('slug');
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState('');
  const [slugLoading, setSlugLoading] = useState(false);
  const [resolvedOrg, setResolvedOrg] = useState<ResolvedOrganization | null>(null);

  useEffect(() => {
    try {
      const savedSlug = localStorage.getItem(LAST_SLUG_STORAGE_KEY);
      if (savedSlug) setSlugInput(savedSlug);
    } catch {
      // 🛟 localStorage მიუწვდომელია (private-mode და ა.შ.) — უბრალოდ
      // ცარიელი ველით ვაგრძელებთ, კრიტიკული არაფერია.
    }
  }, []);

  // Step 2 — username/password (ჩვეულებრივი credentials).
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // 🔐 იძულებითი საწყისი პაროლის შეცვლა — /login-მა თუ დააბრუნა
  // requiresPasswordReset: true, ლოგინის ველების ნაცვლად იმავე
  // ბარათში ვაჩენთ ახალი პაროლის ფორმას.
  const [needsReset, setNeedsReset] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // ✨ GSAP staggered entrance — card-ის შიგნით ელემენტები (სათაური, ველები,
  // ღილაკი) თანმიმდევრულად, mount-ზე ჩნდება. `gsap.context` ფარგლავს
  // selector-ს cardRef-ის ქვეშ და cleanup-ზე (`ctx.revert()`) აბრუნებს
  // inline style-ებს — StrictMode-ის double-effect/re-mount-ზეც უსაფრთხოა.
  // `step`/`needsReset` დამოკიდებულებით ხელახლა ეშვება, რომ ეკრანებს
  // შორის გადართვისასაც იგივე stagger-ეფექტი გამეორდეს.
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-gsap-field]', {
        opacity: 0,
        y: 18,
        duration: 0.45,
        ease: 'power2.out',
        stagger: 0.08,
        delay: 0.1,
        // 🔧 tween-ის დასრულების შემდეგ GSAP-ის მიერ დასმული inline
        // opacity/transform style-ები საერთოდ იშლება — ელემენტი უბრალო
        // CSS-ის default მდგომარეობას უბრუნდება, ისე რომ ვერანაირად ვერ
        // "გაიყინება" ნახევრად-გამჭვირვალე/გადანაცვლებულ მდგომარეობაში.
        clearProps: 'opacity,transform',
      });
    }, cardRef);

    // 🛟 უსაფრთხოების ბადე: თუ რაიმე მიზეზით (StrictMode-ის double-invoke,
    // fast re-render და ა.შ.) tween ვერ დასრულდა ნორმალურად, 1.2წმ-ში
    // იძულებით ვხსნით opacity/transform-ს ყველა [data-gsap-field]-ზე —
    // ავტორიზაციის ღილაკი არასდროს დარჩეს უხილავი.
    const safetyTimer = setTimeout(() => {
      cardRef.current?.querySelectorAll<HTMLElement>('[data-gsap-field]').forEach(el => {
        el.style.opacity = '';
        el.style.transform = '';
      });
    }, 1200);

    return () => {
      ctx.revert();
      clearTimeout(safetyTimer);
    };
  }, [step, needsReset]);

  const handleSlugSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlugError('');

    const trimmedSlug = slugInput.trim().toLowerCase();
    if (!trimmedSlug) {
      setSlugError(t('login.slugRequired'));
      return;
    }

    setSlugLoading(true);
    try {
      const response = await axios.get<ResolvedOrganization>(
        `/api/organizations/resolve/${encodeURIComponent(trimmedSlug)}`
      );
      setResolvedOrg(response.data);
      try {
        localStorage.setItem(LAST_SLUG_STORAGE_KEY, trimmedSlug);
      } catch {
        // 🛟 localStorage მიუწვდომელია — non-critical, ვაგრძელებთ მის გარეშე.
      }
      setStep('credentials');
    } catch (err: any) {
      setSlugError(err.response?.data?.error || t('login.companyNotFound'));
    } finally {
      setSlugLoading(false);
    }
  };

  const handleChangeCompany = () => {
    setResolvedOrg(null);
    setError('');
    setStep('slug');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!resolvedOrg) {
      // 🛟 თეორიულად ვერ მოხდება (step 'credentials' მხოლოდ resolvedOrg-ის
      // დადგენის შემდეგ ჩნდება) — უსაფრთხოების ბადედ მაინც ვამოწმებთ.
      setStep('slug');
      return;
    }
    if (!username.trim() || !password) return setError(t('login.fillAllFields'));

    // ვუგზავნით მონაცემებს App.tsx-ს შესამოწმებლად
    onLoginAttempt(resolvedOrg.slug, username, password, (result) => {
      if (result.requiresPasswordReset && result.userId) {
        setResetUserId(result.userId);
        setNeedsReset(true);
        return;
      }
      if (result.error) {
        setError(result.error); // თუ არის შეცდომა (მაგ. დაბლოკილია), გამოვაჩენთ ერორს
      }
    });
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (newPassword.trim().length < 4) {
      setResetError(t('login.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError(t('login.passwordMismatch'));
      return;
    }
    if (!resetUserId) {
      setResetError(t('login.sessionExpired'));
      setNeedsReset(false);
      return;
    }

    setResetLoading(true);
    try {
      const response = await axios.post('/api/auth/reset-password-initial', {
        userId: resetUserId,
        newPassword,
      });
      const { token, user } = response.data;
      onPasswordResetComplete(token, user);
    } catch (err: any) {
      setResetError(err.response?.data?.error || t('login.resetFailed'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card} ref={cardRef}>
        <LanguageSwitcher className={styles.langSwitcherCorner} />
        {needsReset ? (
          <>
            <h2 className={styles.title} style={{ fontSize: '18px', lineHeight: 1.4 }} data-gsap-field>
              {t('login.resetTitle')}
            </h2>
            <p className={styles.subtitle} data-gsap-field>
              {t('login.resetSubtitle', { username })}
            </p>

            <form onSubmit={handleResetSubmit} className={styles.form}>
              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>{t('login.newPassword')}</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('login.newPasswordPlaceholder')} className={styles.input} autoFocus />
              </div>

              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>{t('login.confirmPassword')}</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder={t('login.confirmPasswordPlaceholder')} className={styles.input} />
              </div>

              {resetError && <p className={styles.error}>⚠️ {resetError}</p>}

              <button
                type="submit"
                disabled={resetLoading}
                className={styles.submitBtn}
                data-gsap-field
              >
                {resetLoading ? t('login.loading') : t('login.updatePasswordAndSignIn')}
              </button>
            </form>
          </>
        ) : step === 'slug' ? (
          <>
            <h2 className={styles.title} data-gsap-field>{t('login.brandTitle')}</h2>
            <p className={styles.subtitle} data-gsap-field>{t('login.slugPrompt')}</p>

            <form onSubmit={handleSlugSubmit} className={styles.form}>
              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>{t('login.slugLabel')}</label>
                <input
                  type="text"
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value)}
                  placeholder={t('login.slugPlaceholder')}
                  className={styles.input}
                  autoFocus
                />
              </div>

              {slugError && <p className={styles.error}>⚠️ {slugError}</p>}

              <button type="submit" disabled={slugLoading} className={styles.submitBtn} data-gsap-field>
                {slugLoading ? t('login.loading') : t('login.continue')}
              </button>

              <button
                type="button"
                onClick={onNavigateToRegister}
                className={styles.registerLink}
                data-gsap-field
              >
                {t('login.noCompany')}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className={styles.title} data-gsap-field>{resolvedOrg?.name}</h2>
            <p className={styles.subtitle} data-gsap-field>{t('login.signInTitle')}</p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>{t('login.username')}</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder={t('login.usernamePlaceholder')} className={styles.input} autoFocus />
              </div>

              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>{t('login.password')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('login.passwordPlaceholder')} className={styles.input} />
              </div>

              {error && <p className={styles.error}>⚠️ {error}</p>}

              <button type="submit" className={styles.submitBtn} data-gsap-field>{t('login.signIn')}</button>

              <button
                type="button"
                onClick={handleChangeCompany}
                className={styles.registerLink}
                data-gsap-field
              >
                {t('login.changeCompany')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
