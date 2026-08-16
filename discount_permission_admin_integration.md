# ფასდაკლების ჩართვა/გამორთვა მოლარისთვის — ინტეგრაციის გზამკვლევი

`UsersControl.tsx`-ის და `users`-ის backend route-ის ფაილები პროექტის ცოდნის ბაზაში არ იყო
თან დართული, ამიტომ ეს ორი ცვლილება ვერ ჩავწერე პირდაპირ — ქვემოთ ზუსტი, ჩასართავი
სნიპეტებია, `can_view_history`-ს არსებული პატერნის იდენტური სტილით. `sales.ts`, `Sales.tsx`
და მიგრაცია უკვე მზად არის ცალკე ფაილებში.

## 1. Backend — `GET /api/me` (სავარაუდოდ `auth.ts` ან `users.ts`)

სადაც უკვე ბრუნდება `can_view_history`, დაამატე იგივე queries-ში `can_use_discount`:

```ts
const result = await db.query(
  'SELECT id, name, role, can_view_history, can_use_discount FROM users WHERE id = $1',
  [req.user?.id]
);
res.json(result.rows[0]);
```

## 2. Backend — მენეჯერის/ადმინის მიერ ჩართვა/გამორთვა

სადაც უკვე ტოგლავს `can_view_history`-ს (სავარაუდოდ `PUT /api/users/:id` ან
`PATCH /api/users/:id/permissions`), დაამატე იგივე handler-ში:

```ts
router.patch('/users/:id/permissions', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  }

  const { can_view_history, can_use_discount } = req.body;
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (can_view_history !== undefined) {
    fields.push(`can_view_history = $${idx++}`);
    values.push(can_view_history);
  }
  if (can_use_discount !== undefined) {
    fields.push(`can_use_discount = $${idx++}`);
    values.push(can_use_discount);
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: 'არაფერი გასაახლებელი არ გამოგზავნილა' });
  }

  values.push(req.params.id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  res.json({ message: 'უფლებები განახლდა' });
});
```

თუ უკვე გაქვს ანალოგიური endpoint `can_view_history`-სთვის, უბრალოდ დაამატე
`can_use_discount` იმავე `UPDATE` query-ში — ცალკე route არ არის საჭირო.

## 3. Frontend — `UsersControl.tsx`

იქ, სადაც არის `can_view_history`-ს checkbox/toggle (მოლარეების სიის თითოეულ
მწკრივზე), დაამატე ანალოგიური:

```tsx
const toggleDiscountPermission = async (userId: number, current: boolean) => {
  try {
    await axios.patch(`http://localhost:5000/api/users/${userId}/permissions`, {
      can_use_discount: !current,
    });
    // განაახლე ლოკალური state, ისევე როგორც can_view_history-ის toggle-ის შემდეგ
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, can_use_discount: !current } : u));
  } catch (err) {
    console.error('ფასდაკლების უფლების განახლება ვერ მოხერხდა:', err);
  }
};

// JSX-ში, can_view_history-ის checkbox-ის გვერდით:
<label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
  <input
    type="checkbox"
    checked={user.can_use_discount !== false}
    onChange={() => toggleDiscountPermission(user.id, user.can_use_discount !== false)}
  />
  🏷️ ფასდაკლების უფლება
</label>
```

`User` interface-ს (თუ TS-ია) დაამატე:

```ts
interface User {
  // ... არსებული ველები
  can_view_history: boolean;
  can_use_discount: boolean;
}
```

## რატომ არის ასე დაცული

`can_view_history`-ს ანალოგიურად, ეს permission ორმაგადაა დაცული:

1. **Backend (ნამდვილი გარანტია):** `POST /payments` ფრეშად ამოწმებს ბაზაში
   `can_use_discount`-ს — არა JWT-დან — ასე რომ გამორთვა მომენტალურად ამოქმედდება,
   მოლარეს ტოკენის განახლების ან ხელახლა login-ის გარეშეც. იხ. `sales.ts`.
2. **Frontend (მხოლოდ UX):** `Sales.tsx` მალავს კალკულატორის UI-ს, თუ
   `can_use_discount === false`. თუ ვინმე backend-ს გვერდის ავლით directly მოუწოდებს
   discount-ით, 403 დაბრუნდება.

## ჩასატარებელი ნაბიჯები

1. გაუშვი `migration_add_discount_permission.sql` production DB-ზე.
2. ჩაანაცვლე `sales.ts` (ან უბრალოდ დაამატე POST /payments-ში ახალი permission-check
   ბლოკი, რომელიც ამ ფაილშია მონიშნული).
3. ჩაანაცვლე `Sales.tsx`.
4. ხელით დაამატე ზემოთ მოცემული 3 სნიპეტი `auth.ts`/`users.ts`-სა და
   `UsersControl.tsx`-ში (ან გამომიგზავნე ეს ფაილები, თუ გინდა ზუსტი diff).
