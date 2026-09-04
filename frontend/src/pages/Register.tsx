import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import gsap from 'gsap';
import styles from './Register.module.scss';

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
      setError('გთხოვთ შეავსოთ ყველა ველი!');
      return;
    }
    if (trimmedCompanyName.length < 2) {
      setError('კომპანიის სახელი ძალიან მოკლეა!');
      return;
    }
    if (!SLUG_REGEX.test(normalizedSlug)) {
      setError('subdomain არავალიდურია — მხოლოდ პატარა ლათინური ასოები, ციფრები და დეფისი (3-40 სიმბოლო)');
      return;
    }
    if (trimmedAdminName.length < 2) {
      setError('ადმინის სახელი ძალიან მოკლეა!');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Email არავალიდურია!');
      return;
    }
    if (password.length < 8) {
      setError('პაროლი უნდა შედგებოდეს მინიმუმ 8 სიმბოლოსგან!');
      return;
    }
    if (password !== confirmPassword) {
      setError('პაროლები არ ემთხვევა!');
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
      setError(err.response?.data?.error || 'რეგისტრაცია ჩავარდა — სცადეთ თავიდან');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card} ref={cardRef}>
        <h2 className={styles.title} data-gsap-field>PayFlow</h2>
        <p className={styles.subtitle} data-gsap-field>ახალი კომპანიის რეგისტრაცია</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>კომპანიის სახელი</label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="მაგ. შპს „მაღაზია+“"
              className={styles.input}
              autoFocus
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>საქმიანობის ტიპი</label>
            <div className={styles.segmentedGroup} role="radiogroup" aria-label="საქმიანობის ტიპი">
              <button
                type="button"
                role="radio"
                aria-checked={businessType === 'retail'}
                onClick={() => setBusinessType('retail')}
                className={`${styles.segmentedBtn} ${businessType === 'retail' ? styles.segmentedBtnActive : ''}`}
              >
                🏪 Retail (მარკეტი/საცალო)
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={businessType === 'horeca'}
                onClick={() => setBusinessType('horeca')}
                className={`${styles.segmentedBtn} ${businessType === 'horeca' ? styles.segmentedBtnActive : ''}`}
              >
                🍽️ HoReCa (რესტორანი/კაფე/ბარი)
              </button>
            </div>
            <p className={styles.hint}>
              {businessType === 'horeca'
                ? 'მაგიდები, ღია შეკვეთები და სამზარეულოს routing ჩაირთვება.'
                : 'შეგიძლიათ მოგვიანებით მიგვმართოთ HoReCa-ზე გადასართველად.'}
            </p>
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>Subdomain (slug)</label>
            <input
              type="text"
              value={slug}
              onChange={e => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="magaliti-magazia"
              className={styles.input}
            />
            {slug && <p className={styles.hint}>{slug}.payflow.app</p>}
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>ადმინის სახელი</label>
            <input
              type="text"
              value={adminName}
              onChange={e => setAdminName(e.target.value)}
              placeholder="ეს იქნება თქვენი login მომხმარებელიც"
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>პაროლი</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="მინიმუმ 8 სიმბოლო"
              className={styles.input}
            />
          </div>

          <div className={styles.field} data-gsap-field>
            <label className={styles.label}>გაიმეორეთ პაროლი</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="დაადასტურეთ პაროლი"
              className={styles.input}
            />
          </div>

          {error && <p className={styles.error}>⚠️ {error}</p>}

          <button type="submit" disabled={loading} className={styles.submitBtn} data-gsap-field>
            {loading ? 'მიმდინარეობს...' : 'კომპანიის რეგისტრაცია'}
          </button>

          <button
            type="button"
            onClick={onNavigateToLogin}
            className={styles.backLink}
            data-gsap-field
          >
            ← უკვე გაქვთ ანგარიში? შესვლა
          </button>
        </form>
      </div>
    </div>
  );
}
