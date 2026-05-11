// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: purge-orphan-photos
//
// Deletes photos for inspections whose car has left inventory (sold, pulled,
// or otherwise removed from the active `inventory` table). Retains the
// `inspections` row + its `checklist` JSONB so historical damage/trend
// analysis still works.
//
// Trigger: scheduled daily via Supabase cron, or ad-hoc POST.
// Auth: requires `x-purge-secret` header matching PURGE_PHOTOS_SECRET edge secret.
//
// What it deletes per inspection:
//   1. All files in the `inspection-photos` storage bucket whose paths match
//      the inspection's photo rows
//   2. All `inspection_photos` rows for that inspection
//   3. Stamps `inspections.photos_purged_at = NOW()` so we don't reprocess
//
// Dry run: pass ?dry=1 to get a report without deleting.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SHARED_SECRET = Deno.env.get('PURGE_PHOTOS_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PHOTO_BUCKET = 'inspection-photos'

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  if (SHARED_SECRET && req.headers.get('x-purge-secret') !== SHARED_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Admin force-delete mode: POST { "mode":"force_delete", "inspection_ids":[...] }
  // Deletes storage files + inspection_photos rows + inspection row for each ID.
  // Bypasses the view entirely so it can clean up records that the normal
  // "car left inventory" flow won't touch (e.g. NULL-stock inspections).
  if (req.method === 'POST') {
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // no body -> fall through to scheduled-purge path below
    }
    if (body?.mode === 'force_delete' && Array.isArray(body.inspection_ids)) {
      return await forceDelete(supabase, body.inspection_ids, dry)
    }
  }

  // 1. Find inspections whose car has left inventory and still have photos.
  const { data: orphans, error: findErr } = await supabase
    .from('inspections_awaiting_photo_purge')
    .select('id, stock_number, vin, skipped_at, completed_at')

  if (findErr) {
    return json({ ok: false, error: findErr.message }, 500)
  }

  const summary = {
    dry,
    inspections_found: orphans?.length ?? 0,
    photos_deleted: 0,
    storage_files_deleted: 0,
    storage_failures: [] as string[],
    inspections_stamped: 0,
    details: [] as any[],
  }

  for (const insp of orphans ?? []) {
    // 2. Get the file_paths for every photo row.
    const { data: photos, error: photosErr } = await supabase
      .from('inspection_photos')
      .select('id, file_path')
      .eq('inspection_id', insp.id)

    if (photosErr) {
      summary.details.push({
        inspection_id: insp.id,
        stock: insp.stock_number,
        error: photosErr.message,
      })
      continue
    }

    const paths = (photos ?? []).map((p) => p.file_path).filter(Boolean)
    if (paths.length === 0) {
      // No photos rows — just stamp purged_at so the view stops returning this.
      if (!dry) {
        await supabase
          .from('inspections')
          .update({ photos_purged_at: new Date().toISOString() })
          .eq('id', insp.id)
        summary.inspections_stamped += 1
      }
      summary.details.push({
        inspection_id: insp.id,
        stock: insp.stock_number,
        photo_rows: 0,
        storage_files: 0,
      })
      continue
    }

    // 3. Delete storage files first. If storage deletion fails partway,
    //    leaving the inspection_photos rows intact lets us retry cleanly
    //    on the next run.
    let storageDeleted = 0
    if (!dry) {
      // Supabase storage remove() accepts an array of paths.
      const { data: removed, error: storageErr } = await supabase
        .storage
        .from(PHOTO_BUCKET)
        .remove(paths)
      if (storageErr) {
        summary.storage_failures.push(`${insp.id}: ${storageErr.message}`)
        continue
      }
      storageDeleted = removed?.length ?? 0
      summary.storage_files_deleted += storageDeleted
    } else {
      storageDeleted = paths.length
    }

    // 4. Delete the DB photo rows.
    if (!dry) {
      const { error: rowDelErr } = await supabase
        .from('inspection_photos')
        .delete()
        .eq('inspection_id', insp.id)
      if (rowDelErr) {
        summary.details.push({
          inspection_id: insp.id,
          stock: insp.stock_number,
          error: `row delete: ${rowDelErr.message}`,
        })
        continue
      }
      summary.photos_deleted += photos.length

      // 5. Stamp the purge time.
      await supabase
        .from('inspections')
        .update({ photos_purged_at: new Date().toISOString() })
        .eq('id', insp.id)
      summary.inspections_stamped += 1
    }

    summary.details.push({
      inspection_id: insp.id,
      stock: insp.stock_number,
      photo_rows: photos.length,
      storage_files: storageDeleted,
    })
  }

  return json({ ok: true, ...summary })
})

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function forceDelete(supabase: any, ids: string[], dry: boolean): Promise<Response> {
  const summary = {
    dry,
    mode: 'force_delete',
    requested: ids.length,
    storage_files_deleted: 0,
    photo_rows_deleted: 0,
    inspections_deleted: 0,
    errors: [] as any[],
    details: [] as any[],
  }

  for (const inspId of ids) {
    const { data: photos, error: photosErr } = await supabase
      .from('inspection_photos')
      .select('id, file_path')
      .eq('inspection_id', inspId)
    if (photosErr) {
      summary.errors.push({ inspection_id: inspId, step: 'list_photos', error: photosErr.message })
      continue
    }

    const paths = (photos ?? []).map((p: any) => p.file_path).filter(Boolean)
    let storageDeleted = 0

    if (paths.length && !dry) {
      const { data: removed, error: storageErr } = await supabase
        .storage.from(PHOTO_BUCKET).remove(paths)
      if (storageErr) {
        summary.errors.push({ inspection_id: inspId, step: 'storage_remove', error: storageErr.message })
        continue
      }
      storageDeleted = removed?.length ?? 0
      summary.storage_files_deleted += storageDeleted
    } else if (paths.length && dry) {
      storageDeleted = paths.length
    }

    if (!dry) {
      // inspection_photos has ON DELETE CASCADE from inspections, but
      // delete rows explicitly so the count is accurate and we don't
      // rely on trigger/cascade timing.
      const { error: rowDelErr } = await supabase
        .from('inspection_photos').delete().eq('inspection_id', inspId)
      if (rowDelErr) {
        summary.errors.push({ inspection_id: inspId, step: 'photo_rows_delete', error: rowDelErr.message })
        continue
      }
      summary.photo_rows_deleted += photos?.length ?? 0

      const { error: inspDelErr } = await supabase
        .from('inspections').delete().eq('id', inspId)
      if (inspDelErr) {
        summary.errors.push({ inspection_id: inspId, step: 'inspection_delete', error: inspDelErr.message })
        continue
      }
      summary.inspections_deleted += 1
    }

    summary.details.push({
      inspection_id: inspId,
      photo_rows: photos?.length ?? 0,
      storage_files: storageDeleted,
    })
  }

  return json({ ok: true, ...summary })
}
