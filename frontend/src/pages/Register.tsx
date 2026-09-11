import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import gsap from 'gsap';
import styles from './Register.module.scss';
import { useTranslation } from 'react-i18next';

// 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — კომპანიის
// self-service რეგისტრაციის გვერდი. ბექენდის შესაბამისი endpoint-ია
// POST /api/organizations/register (იხ. backend/src/routes/organizations.ts).
//
// ⚠️ არქიტექტურული შენიშვნა: პროექტს router ბიბლიოთეკა (react-router) არ
// აქვს — App.tsx state-ტოგლით (`showRegister`) ერთმანეთს ცვლის Login-სა
// და ამ კომპონენტს შორის, ამიტომ აქაც "ნავიგაცია" callback prop-ია,
// URL-ის ნაცვლად.

interface RegisterUser {
  id: string;
  username: string;
  role: 'admin' | 'manager' | 'cashier';
  status: string;
  can_view_history: boolean;
  requires_password_reset: boolean;
}

interface RegisterProps {
  // 🔐 წარმატებული რეგისტრაციის შემდეგ ბექენდი აბრუნებს ჩვეულებრივ
  // login-ტოკენს (auto-login) — App.tsx-ს ვაცნობებთ, რომ სესია
  // დაამყაროს, ისევე როგორც handlePasswordResetComplete-ის შემთხვევაში.
  onRegisterSuccess: (token: string, user: RegisterUser) => void;
  onNavigateToLogin: () => void;
}

// 🔤 slug-ის live preview — ვიმეორებთ ბექენდის (organizations.ts) იმავე
// slugify() ლოგიკას, რომ მომხმარებელმა submit-მდე ზუსტად დაინახოს, რა
// subdomain-კანდიდატი გაიგზავნება. საბოლოო ვალიდაცია მაინც ბექენდზეა.
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register({ onRegisterSuccess, onNavigateToLogin }: RegisterProps) {
  const { t } = useTranslation();
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  // ✍️ თუ მომხმარებელმა slug ველი ხელით შეცვალა, აღარ გადავაწერთ
  // ავტომატური "auto-suggest"-ით — მხოლოდ მანამდე ვასინქრონებთ
  // companyName-თან.
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState('');
  // 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — თვითრეგისტრაციაზე
  // ბიზნესის ტიპის არჩევა. Retail default-ია (migration 019-ის DB
  // DEFAULT-ის იდენტურად) — არსებული registration flow-ისთვის
  // ვიზუალურადაც და ქცევითაც უცვლელი, ვინც ამ ველს არ შეეხება.
  const [businessType, setBusinessType] = useState<'retail' | 'horeca'>('retail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(companyName));
  }, [companyName, slugTouched]);

  // ✨ იგივე GSAP staggered entrance პატერნი, რაც Login.tsx-შია.
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-gsap-field]', {
        opacity: 0,
        y: 18,
        duration: 0.45,
        ease: 'power2.out',
        stagger: 0.06,
        delay: 0.1,
        clearProps: 'opacity,transform',
      });
    }, cardRef);

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
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedCompanyName = companyName.trim();
    const normalizedSlug = slugify(slug);
    const trimmedAdminName = adminName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedCompanyName || !normalizedSlug || !trimmedAdminName || !trimmedEmail || !password || !confirmPassword) {
      setError(t('login.fillAllFields'));
      return;
    }
    if (trimmedCompanyName.length < 2) {
      setError(t('register.errors.companyNameTooShort'));
      return;
    }
    if (!SLUG_REGEX.test(normalizedSlug)) {
      setError(t('register.errors.slugInvalid'));
      return;
    }
    if (trimmedAdminName.length < 2) {
      setError(t('register.errors.adminNameTooShort'));
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError(t('register.errors.emailInvalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('register.errors.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('login.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post('/api/organizations/register', {
        companyName: trimmedCompanyName,
        slug: normalizedSlug,
        adminName: trimmedAdminName,
        email: trimmedEmail,
        password,
        businessType,
      });
      const { token, user } = response.data;
      onRegisterSuccess(token, user);
    } catch (err: any) {
      setError(err.response?.data?.error || t('register.errors.registrationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card} ref={cardRef}>
        <h2 className={styles.title} data-gsap-field>PayFlow</h2>
        <p className={styles.subtitle} data-gsap-field>{t('register.subtitle')}</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('register.companyNameLabel')}</label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder={t('register.companyNamePlaceholder')}
              className={styles.input}
              autoFocus
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('register.businessTypeLabel')}</label>
            <div className={styles.segmentedGroup} role="radiogroup" aria-label={t('register.businessTypeLabel')}>
              <button
                type="button"
                role="radio"
                aria-checked={businessType === 'retail'}
                onClick={() => setBusinessType('retail')}
                className={`${styles.segmentedBtn} ${businessType === 'retail' ? styles.segmentedBtnActive : ''}`}
              >
                {t('register.businessType.retail')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={businessType === 'horeca'}
                onClick={() => setBusinessType('horeca')}
                className={`${styles.segmentedBtn} ${businessType === 'horeca' ? styles.segmentedBtnActive : ''}`}
              >
                {t('register.businessType.horeca')}
              </button>
            </div>
            <p className={styles.hint}>
              {businessType === 'horeca'
                ? t('register.businessType.horecaHint')
                : t('register.businessType.retailHint')}
            </p>
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('login.slugLabel')}</label>
            <input
              type="text"
              value={slug}
              onChange={e => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder={t('login.slugPlaceholder')}
              className={styles.input}
            />
            {slug && <p className={styles.hint}>{slug}.payflow.app</p>}
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('register.adminNameLabel')}</label>
            <input
              type="text"
              value={adminName}
              onChange={e => setAdminName(e.target.value)}
              placeholder={t('register.adminNamePlaceholder')}
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('register.emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('register.passwordPlaceholder')}
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>{t('register.confirmPasswordLabel')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder={t('register.confirmPasswordPlaceholder')}
              className={styles.input}
            />
          </div>

          {error && <p className={styles.error}>⚠️ {error}</p>}

          <button type="submit" disabled={loading} className={styles.submitBtn} data-gsap-field>
            {loading ? t('login.loading') : t('register.submitBtn')}
          </button>

          <button
            type="button"
            onClick={onNavigateToLogin}
            className={styles.backLink}
            data-gsap-field
          >
            {t('register.backToLoginLink')}
          </button>
        </form>
      </div>
    </div>
  );
}
