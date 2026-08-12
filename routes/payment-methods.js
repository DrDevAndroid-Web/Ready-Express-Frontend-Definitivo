import express from 'express';
import { supabase } from '../config/supabase.js';
import { badRequest, notFound, created, success } from '../utils/http-error.js';
import { requireSupabaseUser } from '../middlewares/auth.js';

const router = express.Router();

const TABLE_NAME = 'payment_methods';

async function ensureTableExists() {
  try {
    await supabase.from(TABLE_NAME).select('id').limit(1);
  } catch (error) {
    if (error.code === 'PGRST116') {
      throw new Error(`La tabla ${TABLE_NAME} no existe en Supabase. Contacta al administrador.`);
    }
    throw error;
  }
}

// GET - Obtener todos los métodos de pago
router.get('/', async (_req, res, next) => {
  try {
    await ensureTableExists();

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .order('order_index', { ascending: true });

    if (error) throw error;

    return success(res, data || []);
  } catch (error) {
    return next(error);
  }
});

// POST - Crear nuevo método de pago
router.post('/', requireSupabaseUser, async (req, res, next) => {
  try {
    await ensureTableExists();

    const { method_name, account_number, instructions, image_url, is_active } = req.body;

    if (!method_name || !instructions) {
      return badRequest(res, 'method_name e instructions son requeridos');
    }

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert([
        {
          method_name: method_name.trim(),
          account_number: account_number?.trim() || null,
          instructions: instructions.trim(),
          image_url: image_url?.trim() || null,
          is_active: is_active !== false,
          order_index: 999
        }
      ])
      .select();

    if (error) throw error;

    return created(res, data?.[0] || {});
  } catch (error) {
    return next(error);
  }
});

// PATCH - Actualizar método de pago
router.patch('/:id', requireSupabaseUser, async (req, res, next) => {
  try {
    await ensureTableExists();

    const { id } = req.params;
    const { method_name, account_number, instructions, image_url, is_active } = req.body;

    const actualizar = {};
    if (method_name !== undefined) actualizar.method_name = method_name.trim();
    if (account_number !== undefined) actualizar.account_number = account_number?.trim() || null;
    if (instructions !== undefined) actualizar.instructions = instructions.trim();
    if (image_url !== undefined) actualizar.image_url = image_url?.trim() || null;
    if (is_active !== undefined) actualizar.is_active = is_active;

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update(actualizar)
      .eq('id', id)
      .select();

    if (error) throw error;

    if (!data?.length) {
      return notFound(res, 'Método de pago no encontrado');
    }

    return success(res, data[0]);
  } catch (error) {
    return next(error);
  }
});

// DELETE - Eliminar método de pago
router.delete('/:id', requireSupabaseUser, async (req, res, next) => {
  try {
    await ensureTableExists();

    const { id } = req.params;

    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('id', id);

    if (error) throw error;

    return success(res, { message: 'Método eliminado' });
  } catch (error) {
    return next(error);
  }
});

export default router;
