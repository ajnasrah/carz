// Finishing a car: what "it's done here" means, in one place.
//
// Two things can say a car is finished. The Telegram groups say it — a VIN typed
// in body_shop_out, a key tag photographed at the wash line — and now the app
// says it too, when a person clears a photo the key-tag reader could not read
// (api/washline-queue.js).
//
// Those two must mean exactly the same thing, or the app becomes a second,
// slightly different way to finish a car and the board starts disagreeing with
// itself about which ones are done. So the logic lives here and both import it,
// rather than the endpoint reimplementing three RPC calls that drift.
//
// Lifted out of api/telegram.js unchanged when the wash line queue needed it.

// Groups that mark work FINISHED rather than started: the car's body shop job
// closes and it moves on to the next place. body_shop_out is typed VINs; the
// wash line photographs the key tag instead — same meaning, different medium.
export const FINISH_STATIONS = {
  body_shop_out: 'wash_line',   // out of Jorge's, on to be washed
  wash_line: 'front',           // washed — it's a front line car now
};

// A car finished at a shop: close whatever shop jobs are open on it and move it
// to wherever finishing there sends it next.
//
// All three halves are independent on purpose. Most wash line cars never saw
// either shop, so a null from a close RPC is the normal case, not a failure —
// and a car that was never in inventory (a fresh buy) still gets its location,
// which is how anyone finds it on the lot.
//
// The mechanic job closes here for the same reason the body shop's does: a car
// at the wash line is finished with every shop, and a card left open on it would
// keep reporting a repaired car as waiting on brakes. Held jobs are skipped by
// the RPC itself, so parking a car still means parked.
export async function finishCar(db, vin6, locationCode, eventIso) {
  const body = await closeBodyShopJob(db, vin6, eventIso);
  const mech = await closeMechanicJob(db, vin6, eventIso);
  const moved = await updateLocation(db, vin6, locationCode, eventIso);
  return { bodyShopClosed: !!body, mechanicClosed: !!mech, moved };
}

// Close this car's open body shop job, stamped with the message time so the age
// clock measures the real stay. Never throws into the webhook.
export async function closeBodyShopJob(db, vin6, eventIso) {
  const { data, error } = await db.rpc('close_body_shop_job', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('close_body_shop_job failed for', vin6, error.message || error);
  else if (data) console.log('closed body shop job for', vin6);
  return error ? null : data;
}

// Close this car's open mechanic job and everything still open on it. Same
// contract as the body shop's: stamped with the message time, held jobs skipped,
// never throws into the webhook.
export async function closeMechanicJob(db, vin6, eventIso) {
  const { data, error } = await db.rpc('close_mechanic_job', { p_vin6: vin6, p_event: eventIso });
  if (error) console.error('close_mechanic_job failed for', vin6, error.message || error);
  else if (data) console.log('closed mechanic job for', vin6);
  return error ? null : data;
}

// Newest-event-time wins; never moves a car backward; doesn't bump unchanged status.
export async function updateLocation(db, vin6, locationCode, eventIso) {
  const { data: rows } = await db.rpc('lookup_vin_by_last6', { last6: vin6 });
  const v = Array.isArray(rows) ? rows[0] : rows;
  if (!v?.stock_number) { console.warn('no inventory match for', vin6); return false; }

  const { data: existing } = await db.from('vehicle_locations')
    .select('physical_location, location_updated_at').eq('stock_number', v.stock_number).maybeSingle();
  if (existing?.location_updated_at && new Date(existing.location_updated_at) >= new Date(eventIso)) return false;
  if (existing?.physical_location === locationCode) return false;

  await db.from('vehicle_locations').upsert({
    stock_number: v.stock_number,
    vin: v.vehicle_vin || null,
    physical_location: locationCode,
    physical_source: 'telegram',
    location_updated_at: eventIso,
  }, { onConflict: 'stock_number' });
  return true;
}
