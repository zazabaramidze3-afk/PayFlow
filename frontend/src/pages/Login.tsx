import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import gsap from 'gsap';
import styles from './Login.module.scss';

interface LoginResult {
  error?: string;
  requiresPasswordReset?: boolean;
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ახლა UUID string-ია.
  userId?: string;
}

interface LoginProps {
  onLoginAttempt: (username: string, password: string, callback: (result: LoginResult) => void) => void;
  // 🔐 საწყისი პაროლის განახლების დასრულების შემდეგ ბექენდი აბრუნებს
  // ჩვეულებრივ login-ტოკენს — ამ callback-ით ვაცნობებთ App.tsx-ს, რომ
  // სესია დაამყაროს (ისე, თითქოს ჩვეულებრივად შემოვიდა).
  onPasswordResetComplete: (token: string, user: any) => void;
}

export default function Login({ onLoginAttempt, onPasswordResetComplete }: LoginProps) {
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
  // needsReset დამოკიდებულებით ხელახლა ეშვება, რომ პაროლის განახლების
  // ფორმაზე გადართვისასაც იგივე stagger-რეველი გამეორდეს.
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
  }, [needsReset]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) return setError('გთხოვთ შეავსოთ ყველა ველი!');

    // ვუგზავნით მონაცემებს App.tsx-ს შესამოწმებლად
    onLoginAttempt(username, password, (result) => {
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
      setResetError('პაროლი უნდა შედგებოდეს მინიმუმ 4 სიმბოლოსგან!');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('პაროლები არ ემთხვევა!');
      return;
    }
    if (!resetUserId) {
      setResetError('სესია ვადაგასულია — გთხოვთ სცადოთ თავიდან შესვლა.');
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
      setResetError(err.response?.data?.error || 'პაროლის განახლება ჩავარდა');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card} ref={cardRef}>
        {!needsReset ? (
          <>
            <h2 className={styles.title} data-gsap-field>PayFlow</h2>
            <p className={styles.subtitle} data-gsap-field>სისტემაში შესვლა</p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>მომხმარებელი</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin, manager ან cashier" className={styles.input} />
              </div>

              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>პაროლი</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="ჩაწერეთ 1234" className={styles.input} />
              </div>

              {error && <p className={styles.error}>⚠️ {error}</p>}

              <button type="submit" className={styles.submitBtn} data-gsap-field>შესვლა</button>
            </form>
          </>
        ) : (
          <>
            <h2 className={styles.title} style={{ fontSize: '18px', lineHeight: 1.4 }} data-gsap-field>
              🔒 უსაფრთხოების წესები: გთხოვთ შეცვალოთ საწყისი პაროლი
            </h2>
            <p className={styles.subtitle} data-gsap-field>
              [ {username} ], გასაგრძელებლად საჭიროა ახალი პაროლის დაყენება
            </p>

            <form onSubmit={handleResetSubmit} className={styles.form}>
              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>ახალი პაროლი</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="მინიმუმ 4 სიმბოლო" className={styles.input} autoFocus />
              </div>

              <div className={styles.field} data-gsap-field>
                <label className={styles.label}>გაიმეორეთ ახალი პაროლი</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="დაადასტურეთ ახალი პაროლი" className={styles.input} />
              </div>

              {resetError && <p className={styles.error}>⚠️ {resetError}</p>}

              <button
                type="submit"
                disabled={resetLoading}
                className={styles.submitBtn}
                data-gsap-field
              >
                {resetLoading ? 'მიმდინარეობს...' : 'პაროლის განახლება და შესვლა'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
