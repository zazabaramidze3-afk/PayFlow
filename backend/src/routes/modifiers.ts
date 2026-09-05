// backend/src/routes/modifiers.ts
//
// 🧩 HoReCa Module STEP 3.1 — მოდიფაიერები (Roadmap "03.09.2026", STEP 3,
// migration 021). ჯგუფების/ოფციების მართვა (admin/manager) + კონკრეტულ
// პროდუქტზე მიბმული მოდიფაიერების წაკითხვა (ნებისმიერი horeca user,
// OrderScreen.tsx-ს item-ის დამატებამდე სჭირდება).
//
// BOM (რეცეპტი-საწყობი) ცალკე, მომდევნო migration-ის საქმეა — ეს ფაილი
// მხოლოდ მოდიფაიერების scope-შია (roadmap-ის STEP 3-ის გამიჯნული
// ნაწილი).

import { Router, Response } from 'express';
import { authenticateToken } from './auth';
import { CustomRequest } from './checkShift';
import { requireAnyRole } from '../middleware/requireRole';
import { requireBusinessType } from '../middleware/requireBusinessType';
import { withOrgContext } from '../db';
import { ModifierGroup, ModifierOption, ModifierGroupWithOptions, ModifierSelectionType } from '../types';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

// tables.ts-ის იგივე პატერნი — FK-constraint violation (history-ს
// იცავს, თუ ჯგუფი/ოფცია უკვე გამოყენებულია არსებულ შეკვეთაში) 409-ით
// ვაბრუნებთ, ნაცვლად generic 500-ისა.
const isForeignKeyViolation = (err: unknown): boolean => {
  const message = getErrorMessage(err);
  return message.includes('foreign key') || message.includes('violates');
};

const VALID_SELECTION_TYPES: readonly ModifierSelectionType[] = ['single', 'multiple'];

interface GroupInput {
  name?: unknown;
  selectionType?: unknown;
  isRequired?: unknown;
}

function parseGroupInput(body: GroupInput): { name: string; selectionType: ModifierSelectionType; isRequired: boolean } | null {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return null;

  const selectionType = body.selectionType;
  if (typeof selectionType !== 'string' || !VALID_SELECTION_TYPES.includes(selectionType as ModifierSelectionType)) {
    return null;
  }

  return {
    name,
    selectionType: selectionType as ModifierSelectionType,
    isRequired: body.isRequired === true,
  };
}

// ==========================================
// 🟢 GET /modifiers/groups — ყველა ჯგუფი + ოფციები (management პანელი)
// ==========================================
router.get(
  '/modifiers/groups',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const groups = await withOrgContext(req.user?.organizationId, async (client) => {
        const groupsResult = await client.query<ModifierGroup>(
          'SELECT * FROM modifier_groups ORDER BY name ASC'
        );
        const optionsResult = await client.query<ModifierOption>(
          `SELECT mo.* FROM modifier_options mo
           JOIN modifier_groups mg ON mg.id = mo.modifier_group_id
           ORDER BY mo.name ASC`
        );

        const optionsByGroup = new Map<string, ModifierOption[]>();
        for (const option of optionsResult.rows) {
          const list = optionsByGroup.get(option.modifier_group_id) ?? [];
          list.push(option);
          optionsByGroup.set(option.modifier_group_id, list);
        }

        const result: ModifierGroupWithOptions[] = groupsResult.rows.map((group) => ({
          ...group,
          options: optionsByGroup.get(group.id) ?? [],
        }));
        return result;
      });

      res.json(groups);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ➕ POST /modifiers/groups — ახალი ჯგუფის შექმნა
// ==========================================
router.post(
  '/modifiers/groups',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const parsed = parseGroupInput(req.body as GroupInput);
    if (!parsed) {
      return res.status(400).json({ error: 'name და selectionType (single/multiple) სავალდებულოა' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<ModifierGroup>(
          `INSERT INTO modifier_groups (organization_id, name, selection_type, is_required)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [req.user?.organizationId, parsed.name, parsed.selectionType, parsed.isRequired]
        )
      );
      res.status(201).json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /modifiers/groups/:id — ჯგუფის რედაქტირება
// ==========================================
router.put(
  '/modifiers/groups/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const parsed = parseGroupInput(req.body as GroupInput);
    if (!parsed) {
      return res.status(400).json({ error: 'name და selectionType (single/multiple) სავალდებულოა' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<ModifierGroup>(
          `UPDATE modifier_groups SET name = $1, selection_type = $2, is_required = $3
           WHERE id = $4 AND organization_id = $5 RETURNING *`,
          [parsed.name, parsed.selectionType, parsed.isRequired, req.params.id, req.user?.organizationId]
        )
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ჯგუფი ვერ მოიძებნა' });
      }
      res.json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🗑️ DELETE /modifiers/groups/:id
// ==========================================
router.delete(
  '/modifiers/groups/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query('DELETE FROM modifier_groups WHERE id = $1 AND organization_id = $2 RETURNING id', [
          req.params.id,
          req.user?.organizationId,
        ])
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'ჯგუფი ვერ მოიძებნა' });
      }
      res.status(204).send();
    } catch (err: unknown) {
      if (isForeignKeyViolation(err)) {
        return res.status(409).json({ error: 'ეს ჯგუფი უკვე გამოყენებულია არსებულ შეკვეთებში — წაშლა შეუძლებელია' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ➕ POST /modifiers/groups/:groupId/options — ახალი ოფცია ჯგუფში
// ==========================================
router.post(
  '/modifiers/groups/:groupId/options',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const { name, priceDelta } = req.body as { name?: unknown; priceDelta?: unknown };
    const nameValue = typeof name === 'string' ? name.trim() : '';
    if (!nameValue) {
      return res.status(400).json({ error: 'name სავალდებულოა' });
    }
    const priceDeltaValue = priceDelta === undefined || priceDelta === null || priceDelta === '' ? 0 : Number(priceDelta);
    if (!Number.isFinite(priceDeltaValue)) {
      return res.status(400).json({ error: 'priceDelta არავალიდურია' });
    }

    try {
      const option = await withOrgContext(req.user?.organizationId, async (client) => {
        // 🔐 ჯგუფი ამ org-ს ეკუთვნის — RLS-იც იცავს, მაგრამ 404-ის
        // მკაფიო შეტყობინებისთვის აქაც ვამოწმებთ (orders.ts-ის იგივე
        // "ანქერ-შემოწმების" პატერნი).
        const groupCheck = await client.query('SELECT id FROM modifier_groups WHERE id = $1 AND organization_id = $2', [
          req.params.groupId,
          req.user?.organizationId,
        ]);
        if (groupCheck.rows.length === 0) {
          throw new Error('GROUP_NOT_FOUND');
        }

        const result = await client.query<ModifierOption>(
          `INSERT INTO modifier_options (modifier_group_id, name, price_delta)
           VALUES ($1, $2, $3) RETURNING *`,
          [req.params.groupId, nameValue, priceDeltaValue]
        );
        return result.rows[0];
      });

      res.status(201).json(option);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'GROUP_NOT_FOUND') {
        return res.status(404).json({ error: 'ჯგუფი ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /modifiers/options/:id — ოფციის რედაქტირება
// ==========================================
router.put(
  '/modifiers/options/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const { name, priceDelta } = req.body as { name?: unknown; priceDelta?: unknown };
    const nameValue = typeof name === 'string' ? name.trim() : '';
    if (!nameValue) {
      return res.status(400).json({ error: 'name სავალდებულოა' });
    }
    const priceDeltaValue = priceDelta === undefined || priceDelta === null || priceDelta === '' ? 0 : Number(priceDelta);
    if (!Number.isFinite(priceDeltaValue)) {
      return res.status(400).json({ error: 'priceDelta არავალიდურია' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<ModifierOption>(
          `UPDATE modifier_options mo SET name = $1, price_delta = $2
           FROM modifier_groups mg
           WHERE mo.modifier_group_id = mg.id AND mo.id = $3 AND mg.organization_id = $4
           RETURNING mo.*`,
          [nameValue, priceDeltaValue, req.params.id, req.user?.organizationId]
        )
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ოფცია ვერ მოიძებნა' });
      }
      res.json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🗑️ DELETE /modifiers/options/:id
// ==========================================
router.delete(
  '/modifiers/options/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query(
          `DELETE FROM modifier_options mo
           USING modifier_groups mg
           WHERE mo.modifier_group_id = mg.id AND mo.id = $1 AND mg.organization_id = $2
           RETURNING mo.id`,
          [req.params.id, req.user?.organizationId]
        )
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'ოფცია ვერ მოიძებნა' });
      }
      res.status(204).send();
    } catch (err: unknown) {
      if (isForeignKeyViolation(err)) {
        return res.status(409).json({ error: 'ეს ოფცია უკვე გამოყენებულია არსებულ შეკვეთებში — წაშლა შეუძლებელია' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🟢 GET /modifiers/products/:productId — ამ პროდუქტზე მიბმული ჯგუფები
// ==========================================
// ნებისმიერი horeca user-ისთვის (cashier-ისთვისაც) — OrderScreen.tsx-ს
// item-ის დამატებამდე სჭირდება, არა მხოლოდ management პანელს.
router.get(
  '/modifiers/products/:productId',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'productId არავალიდურია' });
    }

    try {
      const groups = await withOrgContext(req.user?.organizationId, async (client) => {
        const productCheck = await client.query('SELECT id FROM products WHERE id = $1 AND organization_id = $2', [
          productId,
          req.user?.organizationId,
        ]);
        if (productCheck.rows.length === 0) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        const groupsResult = await client.query<ModifierGroup>(
          `SELECT mg.* FROM modifier_groups mg
           JOIN product_modifier_groups pmg ON pmg.modifier_group_id = mg.id
           WHERE pmg.product_id = $1
           ORDER BY mg.name ASC`,
          [productId]
        );
        const optionsResult = await client.query<ModifierOption>(
          `SELECT mo.* FROM modifier_options mo
           JOIN product_modifier_groups pmg ON pmg.modifier_group_id = mo.modifier_group_id
           WHERE pmg.product_id = $1
           ORDER BY mo.name ASC`,
          [productId]
        );

        const optionsByGroup = new Map<string, ModifierOption[]>();
        for (const option of optionsResult.rows) {
          const list = optionsByGroup.get(option.modifier_group_id) ?? [];
          list.push(option);
          optionsByGroup.set(option.modifier_group_id, list);
        }

        const result: ModifierGroupWithOptions[] = groupsResult.rows.map((group) => ({
          ...group,
          options: optionsByGroup.get(group.id) ?? [],
        }));
        return result;
      });

      res.json(groups);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /modifiers/products/:productId — მიბმული ჯგუფების სრული ჩანაცვლება
// ==========================================
// Products.tsx-ის რედაქტირების ფორმიდან: modifierGroupIds — ამ პროდუქტზე
// უნდა დარჩეს ზუსტად ეს ჯგუფები (delete-all + re-insert, ერთ
// ტრანზაქციაში — `withOrgContext`-ის `BEGIN`/`COMMIT` ამას უზრუნველყოფს).
router.put(
  '/modifiers/products/:productId',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'productId არავალიდურია' });
    }

    const { modifierGroupIds } = req.body as { modifierGroupIds?: unknown };
    if (!Array.isArray(modifierGroupIds) || modifierGroupIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'modifierGroupIds უნდა იყოს string[] (შეიძლება ცარიელი)' });
    }
    const groupIds = modifierGroupIds as string[];

    try {
      await withOrgContext(req.user?.organizationId, async (client) => {
        const productCheck = await client.query('SELECT id FROM products WHERE id = $1 AND organization_id = $2', [
          productId,
          req.user?.organizationId,
        ]);
        if (productCheck.rows.length === 0) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        if (groupIds.length > 0) {
          const groupCheck = await client.query('SELECT id FROM modifier_groups WHERE id = ANY($1) AND organization_id = $2', [
            groupIds,
            req.user?.organizationId,
          ]);
          if (groupCheck.rows.length !== groupIds.length) {
            throw new Error('INVALID_GROUP');
          }
        }

        await client.query('DELETE FROM product_modifier_groups WHERE product_id = $1', [productId]);

        if (groupIds.length > 0) {
          const values = groupIds.map((_, i) => `($1, $${i + 2})`).join(', ');
          await client.query(`INSERT INTO product_modifier_groups (product_id, modifier_group_id) VALUES ${values}`, [
            productId,
            ...groupIds,
          ]);
        }
      });

      res.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
      }
      if (err instanceof Error && err.message === 'INVALID_GROUP') {
        return res.status(400).json({ error: 'ერთ-ერთი ჯგუფი არავალიდურია' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

export default router;
