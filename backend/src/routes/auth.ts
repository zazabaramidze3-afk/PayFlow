import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index';
import { User } from '../types';
import { checkRateLimit, registerFailedAttempt, clearAttempts, getRateLimitKey } from '../middleware/managerPinRateLimit';
import { signManagerOverrideToken } from '../middleware/managerOverride';

const router = Router();

// 🧯 catch(err: unknown)-იდან უსაფრთხოდ შეტყობინების ამოღების helper —
// "any"-ის გარეშე (Clean Architecture წესი). ფაილის ძველი routes ჯერ
// კიდევ იყენებს catch(err: any)-ს ისტორიულად, მაგრამ ახალი კოდი (PIN
// endpoint-ები) აქედან იღებს შეტყობინებას.
const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

export interface CustomRequest extends Request {
    // 🆔 UUID მიგრაცია (Roadmap STEP 1, migration 009) — id ახლა UUID
    // string-ია, აღარ არის SERIAL INTEGER (users.id).
    // 🏢 Multi-Tenant SaaS STEP 2 (route-level tenant scoping, Roadmap
    // "23.08.2026") — organizationId ემატება JWT payload-ს POST /login-სა
    // და POST /auth/reset-password-initial-ში (იხ. ორივე ქვემოთ). STEP
    // 2-ით გადასინჯული ყველა route ამ ველზეა დამოკიდებული
    // `WHERE organization_id = $1` scoping-ისთვის.
    user?: { id: string; role: string; username: string; organizationId: string };
}

// 🛡️ Middleware ტოკენის შესამოწმებლად
export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'წვდომა უარყოფილია, ტოკენი არ არსებობს!' });

  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  jwt.verify(token, secretKey, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });
    // 🆔 UUID მიგრაცია — id ახლა UUID string-ია (login-ზე jwt.sign-ში
    // ჩაწერილი users.id უკვე UUID-ია, იხ. POST /login ქვემოთ).
    req.user = user as { id: string; role: string; username: string; organizationId: string };
    next();
  });
};

// 🔓 LOGIN ენდპოინტი (ავტორიზაცია)
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    // PostgreSQL-ში ვიყენებთ db.query-ს და $1 პარამეტრს
    // 🏢 organization_id დაემატა (Roadmap "23.08.2026", STEP 2) — JWT
    // token-ს სჭირდება მომხმარებლის org, რომ STEP 2-ით გადასინჯულმა
    // route-ებმა შეძლონ `WHERE organization_id = $1` scoping.
    const result = await db.query(
      `SELECT id, name AS username, password_hash, role, status, can_view_history, requires_password_reset, organization_id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [username?.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    }

    const user = result.rows[0];

    if (user.status === 'inactive' || user.status === 'დაბლოკილი') {
      return res.status(403).json({ error: 'მომხმარებელი აქტიური არ არის!' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'არასწორი პაროლი!' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, organizationId: user.organization_id },
      process.env.JWT_SECRET || 'super-secret-key',
      { expiresIn: '1d' }
    );

    // 🔐 requiresPasswordReset: camelCase, top-level — ფრონტენდის Login
    // ფორმა ამ ველს ამოწმებს და, თუ true-ია, დეშბორდზე გადასვლის
    // ნაცვლად საწყისი პაროლის განახლების ფორმას აჩვენებს.
    res.json({
      token,
      requiresPasswordReset: !!user.requires_password_reset,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        can_view_history: user.can_view_history,
        requires_password_reset: user.requires_password_reset
      }
    });

  } catch (err: any) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + err.message });
  }
});

// 🔐 საწყისი (იძულებითი) პაროლის შეცვლა — Login ფორმა ამას იძახებს მაშინვე,
// როცა /login-მა დააბრუნა requiresPasswordReset: true. ჯერ არავითარი
// სრული სესია არ არსებობს (ტოკენი ჯერ არ არის შენახული ბრაუზერში),
// ამიტომ authenticateToken აქ ვერ გამოვიყენებთ — userId პირდაპირ
// request body-დან მოდის.
//
// ⚠️ უსაფრთხოება: ეს ენდპოინტი მუშაობს მხოლოდ იმ userId-ებზე, ვისაც
// ბაზაში ჯერ კიდევ requires_password_reset = true უწერია. ამის
// წყალობით ვინმემ, ვინც უბრალოდ იცის/გამოიცნობს userId-ს, ვერ
// შეძლებს უკვე ერთხელ დარესეტებული (ან თავიდანვე ჩვეულებრივი)
// ანგარიშის პაროლის გადაწერას — ეს ენდპოინტი მისთვის "მკვდარია"
// წარმატებული პირველი გამოყენების შემდეგ.
router.post('/auth/reset-password-initial', async (req: Request, res: Response) => {
  const { userId, newPassword } = req.body;

  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'userId და newPassword სავალდებულოა!' });
  }

  if (typeof newPassword !== 'string' || newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'პაროლი უნდა იყოს მინიმუმ 4 სიმბოლო!' });
  }

  try {
    const userCheck = await db.query(
      'SELECT id, requires_password_reset FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    }

    if (userCheck.rows[0].requires_password_reset !== true) {
      return res.status(403).json({ error: 'ამ მომხმარებლისთვის პაროლის სავალდებულო შეცვლა საჭირო აღარ არის!' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 🏢 organization_id დაემატა RETURNING-ში (Roadmap "23.08.2026", STEP 2)
    // — ამ ენდპოინტსაც სჭირდება login-ის იგივე, org-ის შემცველი ტოკენი.
    const result = await db.query(
      `UPDATE users
       SET password_hash = $1, requires_password_reset = false
       WHERE id = $2
       RETURNING id, name AS username, role, status, can_view_history, can_use_discount, requires_password_reset, organization_id`,
      [hashedPassword, userId]
    );

    const user = result.rows[0];

    // ჩვეულებრივი login ტოკენი — რომ ფრონტენდმა ავტომატურად შეიყვანოს
    // მომხმარებელი, ისე თითქოს ჩვეულებრივად შევიდა.
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, organizationId: user.organization_id },
      process.env.JWT_SECRET || 'super-secret-key',
      { expiresIn: '1d' }
    );

    res.json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + err.message });
  }
});

// 👤 მიმდინარე მომხმარებლის აქტუალური მონაცემები (მათ შორის can_view_history, can_use_discount,
// can_void_receipt, requires_password_reset)
// ⚠️ განზრახ არ ვეყრდნობით JWT-ში ჩაწერილ მონაცემებს, რადგან ადმინმა შეიძლება
// უფლება გამორთოს უკვე შესული მოლარისთვის — ტოკენის ხელახლა გაცემის გარეშეც
// ეს ცვლილება მომენტალურად უნდა ჩანდეს ფრონტენდზე.
// 🧾 can_void_receipt დაემატა Roadmap ეტაპი 4-ისთვის — POS ეკრანს სჭირდება ფრეშად
// იცოდეს, აქვს თუ არა მოლარეს ჩეკის გაუქმების უფლება (Sales.tsx-ის handleVoidReceiptClick).
// 🧺 can_clear_cart დაემატა Roadmap ეტაპი 5-ისთვის — იგივე მიზეზით, კალათის
// გასუფთავების/პროდუქტის წაშლის ღილაკებისთვის (Sales.tsx-ის handleClearCartClick/
// handleRemoveItemClick).
router.get('/me', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const result = await db.query(
      'SELECT id, name AS username, role, status, can_view_history, can_use_discount, can_void_receipt, can_clear_cart, requires_password_reset FROM users WHERE id = $1',
      [req.user?.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🔑 მენეჯერის PIN-კოდით ავტორიზაცია (Manager PIN Override — Roadmap ეტაპი 2)
// მოლარეს (ან ნებისმიერ დალოგინებულ მომხმარებელს), რომელსაც აკლია
// კონკრეტული უფლება (მაგ. ფასდაკლების გაკეთება), POS ეკრანზე უჩნდება
// მოდალი — თუ ამ ენდპოინტზე გაგზავნილი 4-ციფრიანი PIN დაემთხვევა
// რომელიმე აქტიური MANAGER-ის ბაზაში დაცულ bcrypt ჰეშს, ერთჯერადი
// override დაშვებულია (ფრონტენდი ამას მხოლოდ მიმდინარე ჩეკზე ინახავს
// state-ში — ბექენდი აქ არაფერს "იხსომებს" შემდეგი გამოძახებისთვის).
//
// ⚠️ authenticateToken აუცილებელია — ეს ენდპოინტი მიუწვდომელია
// ავტორიზებული სესიის გარეშე, რომ ანონიმურმა მომხმარებელმა ვერ სცადოს
// PIN brute-force. Rate limiting (მაქს. 5 მცდელობა 15 წუთში) ცალკე
// იცავს კონკრეტულ "IP + userId" წყვილს brute-force-ისგან.
router.post('/auth/verify-manager-pin', authenticateToken, async (req: CustomRequest, res: Response) => {
  // ⚠️ authenticateToken უკვე უზრუნველყოფს req.user-ის არსებობას პრაქტიკაში,
  // მაგრამ TypeScript-ისთვის (და შემდეგ managerOverrideToken-ის cashierId
  // ველისთვის) საჭიროა ცალსახა, non-optional number.
  const cashierId = req.user?.id;
  if (!cashierId) {
    return res.status(401).json({ error: 'ავტორიზაცია საჭიროა!' });
  }

  const rateLimitKey = getRateLimitKey(req, cashierId);
  const { limited, retryAfterSeconds } = checkRateLimit(rateLimitKey);

  if (limited) {
    const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
    return res.status(429).json({
      error: `ძალიან ბევრი მცდელობა. სცადეთ ${retryAfterMinutes} წუთში ხელახლა.`,
    });
  }

  const { pin } = req.body;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN-კოდი უნდა შედგებოდეს ზუსტად 4 ციფრისგან!' });
  }

  try {
    // ბაზაში ვეძებთ ყველა მენეჯერს, ვისაც PIN დაყენებული აქვს — username
    // არ გვჭირდება, რადგან PIN თავად ავტორიზებს ("ვინმე მენეჯერმა
    // დაადასტურა", არა კონკრეტულად "ესა და ეს მენეჯერი").
    // 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `organization_id
    // = $1` დაემატა. ამის გარეშე ნებისმიერი org-ის მოლარეს შეეძლო SAAS-ის
    // ნებისმიერი სხვა org-ის მენეჯერის PIN-ით override-ის მიღება (bcrypt
    // compare ყველა org-ის მენეჯერზე მიდიოდა cashierId-ის org-ის
    // გათვალისწინების გარეშე) — read-only route არაა, მაგრამ
    // ავთენტიფიკაციის query-ია, ამიტომ იგივე STEP 2 review-ის ფარგლებში
    // გასწორდა.
    const result = await db.query<Pick<User, 'id' | 'name' | 'status' | 'manager_pin'>>(
      `SELECT id, name, status, manager_pin FROM users WHERE role = 'manager' AND manager_pin IS NOT NULL AND organization_id = $1`,
      [req.user?.organizationId]
    );

    // 🔒 დაბლოკილი მენეჯერის PIN აღარ მუშაობს — იგივე სტატუსის შემოწმების
    // ლოგიკა, რასაც /login იყენებს (status მნიშვნელობები ისტორიულად
    // არაერთგვაროვანია ბაზაში, იხ. types.ts-ის კომენტარი).
    const activeManagers = result.rows.filter(
      (u) => u.status !== 'inactive' && u.status !== 'დაბლოკილი'
    );

    let matchedManager: { id: string; name: string } | null = null;
    for (const manager of activeManagers) {
      if (!manager.manager_pin) continue;
      const isMatch = await bcrypt.compare(pin, manager.manager_pin);
      if (isMatch) {
        matchedManager = { id: manager.id, name: manager.name };
        break;
      }
    }

    if (!matchedManager) {
      registerFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'PIN-კოდი არასწორია!' });
    }

    // ✅ წარმატებული ავტორიზაციის შემდეგ ამ სესიის ჩათვლადი განულდება.
    clearAttempts(rateLimitKey);

    // 🕵️ აუდიტის ლოგი: რომელმა მენეჯერმა (actor) დაუშვა override
    // რომელი მოლარის (target) მიმდინარე ტრანზაქციისთვის.
    await writeAuditLog(matchedManager.id, cashierId, 'manager-pin-override', 'approved');

    // 🔑 მოკლევადიანი (5წთ) JWT — POST /api/payments ამას X-Manager-Override
    // ჰედერით მიიღებს და გამოიყენებს, თუ მოლარეს can_use_discount გამორთული
    // აქვს. cashierId ჩაშენებულია ტოკენში, რომ სხვა სესიამ ვერ გამოიყენოს.
    const { token: managerOverrideToken, expiresInSeconds } = signManagerOverrideToken({
      managerId: matchedManager.id,
      managerUsername: matchedManager.name,
      cashierId,
    });

    res.json({
      success: true,
      message: 'ავტორიზაცია წარმატებულია!',
      authorizedBy: { id: matchedManager.id, username: matchedManager.name },
      managerOverrideToken,
      expiresInSeconds,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ➕ ახალი მომხმარებლის რეგისტრაცია
router.post('/users', authenticateToken, async (req: CustomRequest, res) => {
  const { username, password, role, can_view_history } = req.body;

  // 1. მიმდინარე მომხმარებლის როლის შემოწმება (მხოლოდ ადმინს შეუძლია იუზერის შექმნა)
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს აქვს წვდომა!' });
  }

  // 2. ვალიდაცია
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'ყველა ველი სავალდებულოა!' });
  }

  if (password.trim().length < 4) {
    return res.status(400).json({ error: 'პაროლი უნდა იყოს მინიმუმ 4 სიმბოლო!' });
  }

  try {
    // 3. პაროლის ჰეშირება
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. ბაზაში ჩაწერა (PostgreSQL სინტაქსით და RETURNING id-ით)
    // can_view_history: თუ ფრონტენდმა არ გამოაგზავნა, DEFAULT true ბაზაშივე ავტომატურად ჩაიწერება.
    // requires_password_reset ცალკე არ იგზავნება — ბაზის DEFAULT true
    // ავტომატურად ავალდებულებს ახალ მომხმარებელს პაროლის შეცვლას.
    // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 2 (Roadmap "23.08.2026", write-blocker
    // fix) — organization_id დაემატა: migration 013-ის შემდეგ ეს სვეტი
    // NOT NULL-ია, ამის გარეშე ეს INSERT 500-ით ჩავარდებოდა. ახალი user
    // ყოველთვის ადმინის (req.user, ე.ი. ვინც ქმნის) საკუთარ org-ში იქმნება
    // — ეს ერთადერთი სწორი მნიშვნელობაა authenticateToken-ის შემდეგ, სხვა
    // org-ის ID არსად მოდის request body-დან და არც უნდა მოვიდეს.
    const query = `
      INSERT INTO users (name, password_hash, role, status, can_view_history, organization_id)
      VALUES ($1, $2, $3, 'active', COALESCE($4, true), $5)
      RETURNING id, can_view_history, requires_password_reset
    `;

    const result = await db.query(query, [
      username.trim(),
      hashedPassword,
      role,
      can_view_history,
      req.user?.organizationId,
    ]);
    const newUserId = result.rows[0].id;

    res.status(201).json({
      success: true,
      message: 'მომხმარებელი წარმატებით დაემატა!',
      user: {
        id: newUserId,
        username,
        role,
        status: 'active',
        can_view_history: result.rows[0].can_view_history,
        requires_password_reset: result.rows[0].requires_password_reset
      }
    });

  } catch (err: any) {
    if (err.message && err.message.includes('unique')) {
      return res.status(400).json({ error: 'ეს მომხმარებლის სახელი უკვე დაკავებულია!' });
    }
    res.status(500).json({ error: 'ბაზის შეცდომა: ' + err.message });
  }
});

// იუზერების წაკითხვა
// has_manager_pin: ბულეანი წარმოებული ველი (manager_pin IS NOT NULL) —
// Users Control პანელს სჭირდება მხოლოდ "დაყენებულია თუ არა" ინფორმაცია,
// bcrypt ჰეში (manager_pin თავად) ფრონტენდისკენ არასდროს არ იგზავნება.
// 🧾 can_void_receipt/can_clear_cart დაემატა (Roadmap ეტაპი 4/5) — UsersManagement.tsx-ის
// ახალ ჩეკბოქსებს სჭირდება ამ ველების ფრეშად წამოღება, თორემ checkbox-ები ყოველთვის
// გამორთულად აჩვენებდა (ბაზაში DEFAULT false-ია), თუნდაც ადმინს რეალურად ჩართული ჰქონდეს.
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE organization_id
// = $1` დაემატა: STEP 1-მდე ეს query ყველა org-ის (production-ზე ჯერ
// მხოლოდ ერთია) ყველა user-ს აბრუნებდა განურჩევლად. `backend/tests/isolation/
// tenant-isolation.test.ts`-ის "GET /api/users" ორივე მიმართულების ტესტი
// ამ ცვლილებას ამოწმებს.
router.get('/users', authenticateToken, async (req: CustomRequest, res) => {
  try {
    const result = await db.query(
      `SELECT id, name AS username, role, status, can_view_history, can_use_discount,
              can_void_receipt, can_clear_cart,
              requires_password_reset, (manager_pin IS NOT NULL) AS has_manager_pin
       FROM users WHERE organization_id = $1 ORDER BY id ASC`,
      [req.user?.organizationId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// როლის/სტატუსის შეცვლა
router.put('/users/:id', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  // can_view_history არასავალდებულოა — თუ UI ჯერ არ აგზავნის მას, COALESCE
  // ინარჩუნებს ბაზაში უკვე არსებულ მნიშვნელობას (ძველი ფრონტენდის შემთხვევაშიც არაფერი გატყდება).
  const { role, status, can_view_history } = req.body;
  
  try {
    const result = await db.query(
      `UPDATE users 
       SET role = $1, status = $2, can_view_history = COALESCE($3, can_view_history) 
       WHERE id = $4 
       RETURNING id, name AS username, role, status, can_view_history`,
      [role, status, can_view_history, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🕵️ საერთო აუდიტის ლოგირების ჰელფერი — ორივე toggle-ენდპოინტი (history-access,
// discount-access) ამას იყენებს, რომ ჩანაწერის ფორმატი ერთნაირი დარჩეს.
// განზრახ არ ვისვრით error-ს ზემოთ — ლოგირების შეცდომამ არ უნდა შეაფერხოს
// უკვე წარმატებით შენახული რეალური ცვლილება.
// 🕵️ export-ული — sales.ts-საც სჭირდება (manager-pin-override-used ლოგისთვის
// checkout-ის დროს), რომ ლოგის ფორმატი ერთი წყაროდან იმართებოდეს.
// 🆔 UUID მიგრაცია — actorId/targetId ახლა ორივე UUID string-ია
// (users.id-ის ტიპის შესაბამისად).
export const writeAuditLog = async (actorId: string | undefined, targetId: string | undefined, action: string, newValue: unknown) => {
  try {
    await db.query(
      'INSERT INTO audit_logs (actor_id, target_id, action, new_value) VALUES ($1, $2, $3, $4)',
      [actorId, targetId, action, String(newValue)]
    );
  } catch (logErr: any) {
    console.error('⚠️ აუდიტის ლოგის ჩაწერა ჩავარდა:', logErr.message);
  }
};

// 🔐 მხოლოდ can_view_history-ის სწრაფი გადართვა (checkbox toggle ადმინ პანელში)
router.put('/users/:id/history-access', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { can_view_history } = req.body;
  if (typeof can_view_history !== 'boolean') {
    return res.status(400).json({ error: 'can_view_history უნდა იყოს true ან false' });
  }

  try {
    const result = await db.query(
      'UPDATE users SET can_view_history = $1 WHERE id = $2 RETURNING id, name AS username, can_view_history',
      [can_view_history, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    // 🕵️ აუდიტის ლოგი: ვინ (actor) ვის (target) შეუცვალა ისტორიის ნახვის უფლება.
    await writeAuditLog(req.user?.id, req.params.id, 'history-access', can_view_history);

    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🏷️ მხოლოდ can_use_discount-ის სწრაფი გადართვა (checkbox toggle მენეჯერის/ადმინის პანელში)
// history-access-ის ზუსტი ანალოგიით, გარდა როლის შემოწმებისა — აქ admin-ის გარდა
// manager-საც შეუძლია მოლარეებისთვის ფასდაკლების უფლების ჩართვა/გამორთვა.
router.put('/users/:id/discount-access', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისთვის ან მენეჯერისთვის!' });
  }
  const { can_use_discount } = req.body;
  if (typeof can_use_discount !== 'boolean') {
    return res.status(400).json({ error: 'can_use_discount უნდა იყოს true ან false' });
  }

  try {
    const result = await db.query(
      'UPDATE users SET can_use_discount = $1 WHERE id = $2 RETURNING id, name AS username, can_use_discount',
      [can_use_discount, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    // 🕵️ აუდიტის ლოგი: ვინ (actor) ვის (target) რა უფლება შეუცვალა.
    await writeAuditLog(req.user?.id, req.params.id, 'discount-access', can_use_discount);

    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🧾 მხოლოდ can_void_receipt-ის სწრაფი გადართვა (checkbox toggle) — Roadmap ეტაპი 4.
// discount-access-ის ზუსტი ანალოგიით — admin-ის გარდა manager-საც შეუძლია.
router.put('/users/:id/void-access', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისთვის ან მენეჯერისთვის!' });
  }
  const { can_void_receipt } = req.body;
  if (typeof can_void_receipt !== 'boolean') {
    return res.status(400).json({ error: 'can_void_receipt უნდა იყოს true ან false' });
  }

  try {
    const result = await db.query(
      'UPDATE users SET can_void_receipt = $1 WHERE id = $2 RETURNING id, name AS username, can_void_receipt',
      [can_void_receipt, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    // 🕵️ აუდიტის ლოგი: ვინ (actor) ვის (target) შეუცვალა ჩეკის გაუქმების უფლება.
    await writeAuditLog(req.user?.id, req.params.id, 'void-access', can_void_receipt);

    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🧺 მხოლოდ can_clear_cart-ის სწრაფი გადართვა (checkbox toggle) — Roadmap ეტაპი 5.
// იგივე პატერნი, რაც void-access/discount-access-ს.
router.put('/users/:id/clear-cart-access', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისთვის ან მენეჯერისთვის!' });
  }
  const { can_clear_cart } = req.body;
  if (typeof can_clear_cart !== 'boolean') {
    return res.status(400).json({ error: 'can_clear_cart უნდა იყოს true ან false' });
  }

  try {
    const result = await db.query(
      'UPDATE users SET can_clear_cart = $1 WHERE id = $2 RETURNING id, name AS username, can_clear_cart',
      [can_clear_cart, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    // 🕵️ აუდიტის ლოგი: ვინ (actor) ვის (target) შეუცვალა კალათის გასუფთავების უფლება.
    await writeAuditLog(req.user?.id, req.params.id, 'clear-cart-access', can_clear_cart);

    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 📜 აუდიტის ლოგები — ფასდაკლების და ისტორიის ნახვის უფლების ცვლილებების ისტორია (admin/manager)
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `al.organization_id
// = $1` დაემატა WHERE-ში. LEFT JOIN users actor/target-ზე organization_id-ს
// განზრახ არ ვამატებთ — ეს მხოლოდ სახელების საჩვენებლად join-ავს, filter-ი
// უკვე თავად audit_logs-ის ჩანაწერზეა.
router.get('/audit-logs', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისთვის ან მენეჯერისთვის!' });
  }
  try {
    // al.actor_id საჭიროა frontend-ისთვის — Manager PIN Override ლოგებში
    // ("მენეჯერმა (ID: X) დაადასტურა...") actor_name მარტო არ კმარა,
    // spec ცალსახად ID-ს ითხოვს.
    const result = await db.query(
      `SELECT
         al.id,
         al.action,
         al.actor_id,
         al.new_value,
         al.created_at,
         actor.name AS actor_name,
         target.name AS target_name,
         target.role AS target_role
       FROM audit_logs al
       LEFT JOIN users actor ON actor.id = al.actor_id
       LEFT JOIN users target ON target.id = al.target_id
       WHERE al.organization_id = $1
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [req.user?.organizationId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🗑 აუდიტის ლოგების სრული გასუფთავება — მხოლოდ ADMIN-ისთვის (Roadmap ეტაპი 1.5.2).
// განზრახ არ ვწერთ ამ მოქმედების საკუთარ თავზე აუდიტ-ლოგს — სწორედ ეს
// ცხრილი იშლება, ასეთი ჩანაწერი აზრს დაკარგავდა.
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE organization_id
// = $1` დაემატა. ამის გარეშე ეს ენდპოინტი (destructive, cross-tenant)
// ერთი org-ის ადმინს ყველა დანარჩენი org-ის მთელ audit-ისტორიასაც
// წაუშლიდა — GET-ის გვერდით ერთდროულად გასწორდა, რადგან ერთი და იმავე
// ცხრილის ორ endpoint-ს შორის ნახევრად-scoped მდგომარეობა აზრს
// მოკლებული იქნებოდა.
router.delete('/audit-logs', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს აქვს ისტორიის გასუფთავების უფლება!' });
  }

  try {
    await db.query('DELETE FROM audit_logs WHERE organization_id = $1', [req.user?.organizationId]);
    res.json({ success: true, message: 'აუდიტის ისტორია სრულად გასუფთავდა!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// პაროლის შეცვლა
router.put('/users/:id/password', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.trim().length < 4) return res.status(400).json({ error: 'მინიმუმ 4 სიმბოლო!' });

  try {
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedNewPassword, req.params.id]);
    res.json({ success: true, message: 'პაროლი შეიცვალა!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🔑 მენეჯერის PIN-კოდის დაყენება/შეცვლა — მხოლოდ ADMIN-ისთვის
// (Roadmap ეტაპი 2, Users Control პანელი). PIN აზუსტებულია მხოლოდ
// MANAGER როლისთვის — cashier/admin-ს ეს ველი არ სჭირდება.
router.put('/users/:id/pin', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს შეუძლია PIN-კოდის მართვა!' });
  }

  const { pin } = req.body;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN-კოდი უნდა შედგებოდეს ზუსტად 4 ციფრისგან!' });
  }

  try {
    const targetCheck = await db.query<Pick<User, 'id' | 'role'>>(
      'SELECT id, role FROM users WHERE id = $1',
      [req.params.id]
    );

    if (targetCheck.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    }

    if (targetCheck.rows[0].role !== 'manager') {
      return res.status(400).json({ error: 'PIN-კოდის დაყენება შესაძლებელია მხოლოდ MANAGER როლის მომხმარებლისთვის!' });
    }

    // 🔐 PIN არასდროს ინახება plain text-ად — იგივე bcrypt + 10 salt
    // rounds კონვენცია, რასაც password_hash იყენებს ამ ფაილში ყველგან.
    const hashedPin = await bcrypt.hash(pin, 10);

    const result = await db.query(
      `UPDATE users SET manager_pin = $1 WHERE id = $2
       RETURNING id, name AS username, role, (manager_pin IS NOT NULL) AS has_manager_pin`,
      [hashedPin, req.params.id]
    );

    // 🕵️ აუდიტის ლოგი: არასდროს ვწერთ PIN-ის მნიშვნელობას (ჰეშსაც კი) —
    // მხოლოდ ფაქტს, რომ ადმინმა (actor) ცვლილება შეიტანა კონკრეტულ
    // მენეჯერზე (target).
    await writeAuditLog(req.user?.id, req.params.id, 'manager-pin-update', 'updated');

    res.json({
      success: true,
      message: 'მენეჯერის PIN-კოდი წარმატებით განახლდა!',
      user: result.rows[0],
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'ბაზის შეცდომა: ' + getErrorMessage(err) });
  }
});

// წაშლა (Soft Delete)
router.delete('/users/:id', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  // 🆔 UUID მიგრაციის შემდეგ id-ები string-ებია — Number() შედარება
  // ყოველთვის false-ს დააბრუნებდა (NaN === NaN), ამიტომ პირდაპირი
  // string შედარება საკმარისია და სწორია.
  if (req.params.id === req.user?.id) return res.status(400).json({ error: 'საკუთარ თავს ვერ წაშლით!' });

  try {
    await db.query("UPDATE users SET status = 'inactive' WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: 'მომხმარებელი გახდა პასიური!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
