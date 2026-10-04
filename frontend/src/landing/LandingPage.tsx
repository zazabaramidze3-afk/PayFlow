import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import styles from './LandingPage.module.scss';

// ==========================================
// 🌐 PayFlow — საჯარო landing გვერდი (`/landing`)
// ==========================================
// აპლიკაციისგან დამოუკიდებელი root (იხ. index.tsx): /landing-ზე App.tsx
// საერთოდ არ იტვირთება (ამიტომ მისი გლობალური axios interceptor-ებიც
// არ ირთვება) — იგივე პრინციპი, რაც /admin-ზე. სტატიკური, ავტორიზაციის
// გარეშე; "Sign in" და "Register" ღილაკები აპის ძირეულ მისამართზე გადადის.
//
// ჰერო-ბლოკის მარჯვენა მხარე — დახრილი (perspective) POS-ეკრანის მაკეტები,
// რომლებიც ჩატვირთვისას სათითაოდ შემოდის, შიგთავსი ეტაპობრივად ივსება და
// "Payment" ბარათში spinner ტრიალებს, სანამ "Paid ✓" არ გამოჩნდება.
// ყველა ანიმაცია წმინდა CSS-ია და `prefers-reduced-motion`-ს პატივს სცემს.

const REGISTER_URL = '/?register=1';
// `?login=1` — index.tsx-ს ეუბნება, რომ landing აღარ აჩვენოს და აპი (Login) ჩატვირთოს.
const SIGN_IN_URL = '/?login=1';

// ხატულები — პატარა inline SVG-ები (დამატებითი დამოკიდებულების გარეშე).
function IconOffline() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" />
    </svg>
  );
}
function IconTable() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="13" rx="0.5" />
    </svg>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `PayFlow · ${t('meta.landing')}`;
  }, [t]);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <nav className={styles.nav}>
          <a href="/" className={styles.brand}>
            <span className={styles.brandDot} />
            PayFlow
          </a>
          <div className={styles.navRight}>
            <a href="#features" className={`${styles.navLink} ${styles.navFeatures}`}>
              {t('landing.nav.features')}
            </a>
            <LanguageSwitcher className={styles.lang} />
            <a href={SIGN_IN_URL} className={styles.navLink}>
              {t('landing.nav.signIn')}
            </a>
          </div>
        </nav>

        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <p className={styles.tagline}>{t('landing.tagline')}</p>
            <h1 className={styles.title}>{t('landing.hero.title')}</h1>
            <p className={styles.subtitle}>{t('landing.hero.subtitle')}</p>
            <div className={styles.ctaRow}>
              <a href={REGISTER_URL} className={styles.ctaPrimary}>
                {t('landing.hero.ctaPrimary')}
              </a>
              <a href={SIGN_IN_URL} className={styles.ctaSecondary}>
                {t('landing.hero.ctaSecondary')}
              </a>
            </div>
          </div>

          <div className={styles.stage} aria-hidden="true">
            <div className={styles.board}>
              {/* 1 — შეკვეთა */}
              <section className={`${styles.card} ${styles.c1}`}>
                <div className={styles.cardHead}>{t('landing.mock.order')}</div>
                <div className={styles.cardBody}>
                  <div className={`${styles.row} ${styles.r1}`}>
                    <span>{t('landing.mock.burger')}</span>
                    <span>1 × 12.00</span>
                  </div>
                  <div className={`${styles.row} ${styles.r2}`}>
                    <span>{t('landing.mock.cola')}</span>
                    <span>2 × 3.50</span>
                  </div>
                  <div className={`${styles.row} ${styles.r3}`}>
                    <span>{t('landing.mock.coffee')}</span>
                    <span>1 × 5.50</span>
                  </div>
                  <div className={`${styles.row} ${styles.r4}`}>
                    <span>{t('landing.mock.cake')}</span>
                    <span>1 × 6.00</span>
                  </div>
                  <div className={`${styles.row} ${styles.r5}`}>
                    <span>{t('landing.mock.water')}</span>
                    <span>2 × 1.50</span>
                  </div>
                  <span className={`${styles.bar} ${styles.b1}`} />
                  <span className={`${styles.bar} ${styles.b2}`} />
                  <span className={`${styles.bar} ${styles.b3}`} />
                  <span className={`${styles.bar} ${styles.b4}`} />
                </div>
              </section>

              {/* 2 — სამზარეულო */}
              <section className={`${styles.card} ${styles.c2}`}>
                <div className={styles.cardHead}>{t('landing.mock.kitchen')}</div>
                <div className={styles.cardBody}>
                  <div className={`${styles.chipRow} ${styles.r1}`}>
                    <span className={`${styles.chip} ${styles.chipNew}`}>{t('landing.mock.statusNew')}</span>
                    <span className={styles.chipLine} />
                  </div>
                  <div className={`${styles.chipRow} ${styles.r2}`}>
                    <span className={`${styles.chip} ${styles.chipCook}`}>{t('landing.mock.statusCooking')}</span>
                    <span className={styles.chipLine} />
                  </div>
                  <div className={`${styles.chipRow} ${styles.r3}`}>
                    <span className={`${styles.chip} ${styles.chipReady}`}>{t('landing.mock.statusReady')}</span>
                    <span className={styles.chipLine} />
                  </div>
                  <div className={`${styles.chipRow} ${styles.r4}`}>
                    <span className={`${styles.chip} ${styles.chipCancelled}`}>{t('landing.mock.statusCancelled')}</span>
                    <span className={styles.chipLine} />
                  </div>
                  <div className={`${styles.chipRow} ${styles.r5}`}>
                    <span className={`${styles.chip} ${styles.chipServed}`}>{t('landing.mock.statusServed')}</span>
                    <span className={styles.chipLine} />
                  </div>
                </div>
              </section>

              {/* 3 — მარაგი */}
              <section className={`${styles.card} ${styles.c3}`}>
                <div className={styles.cardHead}>{t('landing.mock.stock')}</div>
                <div className={styles.cardBody}>
                  <div className={`${styles.stockRow} ${styles.r1}`}>
                    <span>{t('landing.mock.flour')}</span>
                    <span className={styles.track}><span className={`${styles.fill} ${styles.f1}`} /></span>
                  </div>
                  <div className={`${styles.stockRow} ${styles.r2}`}>
                    <span>{t('landing.mock.meat')}</span>
                    <span className={styles.track}><span className={`${styles.fill} ${styles.f2}`} /></span>
                  </div>
                  <div className={`${styles.stockRow} ${styles.r3}`}>
                    <span>{t('landing.mock.milk')}</span>
                    <span className={styles.track}><span className={`${styles.fill} ${styles.f3}`} /></span>
                  </div>
                </div>
              </section>

              {/* 4 — გადახდა: spinner → Paid */}
              <section className={`${styles.card} ${styles.c4}`}>
                <div className={styles.cardHead}>
                  <span>{t('landing.mock.payment')}</span>
                  <span className={styles.payBtn}>{t('landing.mock.pay')}</span>
                </div>
                <div className={`${styles.cardBody} ${styles.payBody}`}>
                  <div className={styles.total}>
                    <span>{t('landing.mock.total')}</span>
                    <strong>33.50 ₾</strong>
                  </div>
                  <div className={styles.spinnerWrap}>
                    <span className={styles.spinner} />
                  </div>
                  <div className={styles.paid}>✓ {t('landing.mock.paid')}</div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="features" className={styles.features}>
          <h2 className={styles.featuresTitle}>{t('landing.features.title')}</h2>
          <div className={styles.featureGrid}>
            <article className={styles.feature}>
              <IconOffline />
              <h3>{t('landing.features.offlineTitle')}</h3>
              <p>{t('landing.features.offlineText')}</p>
            </article>
            <article className={styles.feature}>
              <IconTable />
              <h3>{t('landing.features.restaurantTitle')}</h3>
              <p>{t('landing.features.restaurantText')}</p>
            </article>
            <article className={styles.feature}>
              <IconChart />
              <h3>{t('landing.features.reportsTitle')}</h3>
              <p>{t('landing.features.reportsText')}</p>
            </article>
          </div>
        </section>

        <section className={styles.cta}>
          <h2>{t('landing.cta.title')}</h2>
          <a href={REGISTER_URL} className={styles.ctaPrimary}>
            {t('landing.hero.ctaPrimary')}
          </a>
        </section>
      </main>

      <footer className={styles.footer}>© PayFlow</footer>
    </div>
  );
}
