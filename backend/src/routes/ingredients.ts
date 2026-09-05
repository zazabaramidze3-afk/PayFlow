// backend/src/routes/ingredients.ts
//
// 🍲 HoReCa Module STEP 3.2 — რეცეპტი-საწყობი (BOM) (Roadmap "03.09.2026",
// migration 022). ორი დამოუკიდებელი resource:
//   1) ingredients-ის CRUD (ნედლეულის მართვა, admin/manager) — ცალკე
//      "ინგრედიენტები" გვერდიდან (Ingredients.tsx).
//   2) კონკრეტული პროდუქტის რეცეპტი (GET/PUT /products/:productId/recipe)
//      — Products.tsx-ის რედაქტირების ფორმის "🍲 რეცეპტი (BOM)" პანელიდან.
//
// Checkout-ის stock-decrement branch (routes/sales.ts) ცალკეა — ეს ფაილი
// მხოლოდ management/CRUD-ია, არა checkout-ის ლოგიკა.

import { Router, Response } from 'express';
import { authenticateToken } from './auth';
import { CustomRequest } from './checkShift';
import { requireAnyRole } from '../middleware/requireRole';
import { requireBusinessType } from '../middleware/requireBusinessType';
import { withOrgContext } from '../db';
import { Ingredient, RecipeItemWithIngredient } from '../types';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

// tables.ts/modifiers.ts-ის იგივე პატერნი — FK-constraint violation
// (ინგრედიენტი უკვე გამოყენებულია რომელიმე რეცეპტში) 409-ით ვაბრუნებთ.
const isForeignKeyViolation = (err: unknown): boolean => {
  const message = getErrorMessage(err);
  return message.includes('foreign key') || message.includes('violates');
};

// products.ts-ის uq_products_org_name-ის იგივე duplicate-name pattern.
const isUniqueViolation = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return code === '23505';
};

interface IngredientInput {
  name?: unknown;
  unit?: unknown;
  stock?: unknown;
}

function parseIngredientInput(body: IngredientInput): { name: string; unit: string; stock: number } | null {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  if (!name || !unit) return null;

  // 🩹 STEP 3.1-ის negative-price-delta ბაგის იგივე დაცვა — stock
  // არასდროს არ უნდა შეიქმნას/დარედაქტირდეს უარყოფითი მნიშვნელობით
  // (DB CHECK constraint-იც იცავს, migration 022, მაგრამ 400 400-ით
  // მკაფიო შეტყობინება frontend-ისთვის სჯობს generic 500-ს).
  const stockValue = body.stock === undefined || body.stock === null || body.stock === '' ? 0 : Number(body.stock);
  if (!Number.isFinite(stockValue) || stockValue < 0) return null;

  return { name, unit, stock: stockValue };
}

// ==========================================
// 🟢 GET /ingredients — ყველა ინგრედიენტი (management პანელი)
// ==========================================
router.get(
  '/ingredients',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<Ingredient>('SELECT * FROM ingredients ORDER BY name ASC')
      );
      res.json(result.rows);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ➕ POST /ingredients — ახალი ინგრედიენტის დამატება
// ==========================================
router.post(
  '/ingredients',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const parsed = parseIngredientInput(req.body as IngredientInput);
    if (!parsed) {
      return res.status(400).json({ error: 'name, unit და non-negative stock სავალდებულოა' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<Ingredient>(
          `INSERT INTO ingredients (organization_id, name, unit, stock)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [req.user?.organizationId, parsed.name, parsed.unit, parsed.stock]
        )
      );
      res.status(201).json(result.rows[0]);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'ამ სახელით ინგრედიენტი უკვე არსებობს' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /ingredients/:id — რედაქტირება
// ==========================================
router.put(
  '/ingredients/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const parsed = parseIngredientInput(req.body as IngredientInput);
    if (!parsed) {
      return res.status(400).json({ error: 'name, unit და non-negative stock სავალდებულოა' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<Ingredient>(
          `UPDATE ingredients SET name = $1, unit = $2, stock = $3
           WHERE id = $4 AND organization_id = $5 RETURNING *`,
          [parsed.name, parsed.unit, parsed.stock, req.params.id, req.user?.organizationId]
        )
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ინგრედიენტი ვერ მოიძებნა' });
      }
      res.json(result.rows[0]);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'ამ სახელით ინგრედიენტი უკვე არსებობს' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 📥 PATCH /ingredients/:id/restock — მარაგის შევსება (products.ts-ის
// PATCH /products/:id/restock-ის ანალოგიური, ატომური increment)
// ==========================================
router.patch(
  '/ingredients/:id/restock',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const quantityToAdd = Number((req.body as { quantityToAdd?: unknown }).quantityToAdd);
    if (!Number.isFinite(quantityToAdd) || quantityToAdd <= 0) {
      return res.status(400).json({ error: 'რაოდენობა უნდა იყოს დადებითი რიცხვი' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<Ingredient>(
          'UPDATE ingredients SET stock = stock + $1 WHERE id = $2 AND organization_id = $3 RETURNING *',
          [quantityToAdd, req.params.id, req.user?.organizationId]
        )
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ინგრედიენტი ვერ მოიძებნა' });
      }
      res.json({ success: true, ingredient: result.rows[0] });
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🗑️ DELETE /ingredients/:id
// ==========================================
router.delete(
  '/ingredients/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query('DELETE FROM ingredients WHERE id = $1 AND organization_id = $2 RETURNING id', [
          req.params.id,
          req.user?.organizationId,
        ])
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'ინგრედიენტი ვერ მოიძებნა' });
      }
      res.status(204).send();
    } catch (err: unknown) {
      if (isForeignKeyViolation(err)) {
        return res.status(409).json({ error: 'ეს ინგრედიენტი უკვე გამოყენებულია რომელიმე რეცეპტში — წაშლა შეუძლებელია' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🟢 GET /products/:productId/recipe — ამ პროდუქტის რეცეპტი
// ==========================================
router.get(
  '/products/:productId/recipe',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'productId არავალიდურია' });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, async (client) => {
        const productCheck = await client.query<{ is_recipe_based: boolean }>(
          'SELECT is_recipe_based FROM products WHERE id = $1 AND organization_id = $2',
          [productId, req.user?.organizationId]
        );
        if (productCheck.rows.length === 0) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        const itemsResult = await client.query<RecipeItemWithIngredient>(
          `SELECT ri.product_id, ri.ingredient_id, ri.quantity_required, ing.name AS ingredient_name, ing.unit AS ingredient_unit
           FROM recipe_items ri
           JOIN ingredients ing ON ing.id = ri.ingredient_id
           WHERE ri.product_id = $1
           ORDER BY ing.name ASC`,
          [productId]
        );

        return { isRecipeBased: productCheck.rows[0].is_recipe_based, items: itemsResult.rows };
      });

      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /products/:productId/recipe — რეცეპტის სრული ჩანაცვლება
// ==========================================
// modifiers.ts-ის PUT /modifiers/products/:productId-ის იგივე pattern —
// delete-all + re-insert ერთ ტრანზაქციაში, isRecipeBased-ის ერთდროული
// განახლებით.
router.put(
  '/products/:productId/recipe',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'productId არავალიდურია' });
    }

    const { isRecipeBased, items } = req.body as { isRecipeBased?: unknown; items?: unknown };
    if (typeof isRecipeBased !== 'boolean') {
      return res.status(400).json({ error: 'isRecipeBased სავალდებულოა (boolean)' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items უნდა იყოს მასივი (შეიძლება ცარიელი)' });
    }

    interface ParsedItem { ingredientId: string; quantityRequired: number; }
    const parsedItems: ParsedItem[] = [];
    for (const raw of items) {
      const item = raw as { ingredientId?: unknown; quantityRequired?: unknown };
      const ingredientId = typeof item.ingredientId === 'string' ? item.ingredientId : '';
      const quantityRequired = Number(item.quantityRequired);
      if (!ingredientId || !Number.isFinite(quantityRequired) || quantityRequired <= 0) {
        return res.status(400).json({ error: 'ყოველ item-ს სჭირდება ingredientId და დადებითი quantityRequired' });
      }
      parsedItems.push({ ingredientId, quantityRequired });
    }

    try {
      await withOrgContext(req.user?.organizationId, async (client) => {
        const productCheck = await client.query(
          'SELECT id FROM products WHERE id = $1 AND organization_id = $2',
          [productId, req.user?.organizationId]
        );
        if (productCheck.rows.length === 0) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        if (parsedItems.length > 0) {
          const ingredientIds = parsedItems.map((i) => i.ingredientId);
          const ingredientCheck = await client.query(
            'SELECT id FROM ingredients WHERE id = ANY($1) AND organization_id = $2',
            [ingredientIds, req.user?.organizationId]
          );
          if (ingredientCheck.rows.length !== new Set(ingredientIds).size) {
            throw new Error('INVALID_INGREDIENT');
          }
        }

        await client.query('UPDATE products SET is_recipe_based = $1 WHERE id = $2', [isRecipeBased, productId]);
        await client.query('DELETE FROM recipe_items WHERE product_id = $1', [productId]);

        if (parsedItems.length > 0) {
          const values = parsedItems.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
          const params: (string | number)[] = [productId];
          for (const item of parsedItems) {
            params.push(item.ingredientId, item.quantityRequired);
          }
          await client.query(
            `INSERT INTO recipe_items (product_id, ingredient_id, quantity_required) VALUES ${values}`,
            params
          );
        }
      });

      res.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
      }
      if (err instanceof Error && err.message === 'INVALID_INGREDIENT') {
        return res.status(400).json({ error: 'ერთ-ერთი ინგრედიენტი არავალიდურია' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

export default router;
