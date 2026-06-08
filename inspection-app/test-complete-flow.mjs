import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://yprihgygmreibcuybwoy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o',
  {
    auth: {
      persistSession: false
    }
  }
);

console.log('=== Testing Location Update Functionality ===\n');

// Test 1: Fetch vehicles that are stuck or need transport
console.log('1. Fetching vehicles that might be stuck or need transport...');
const { data: inventory, error: invError } = await supabase
  .from('inventory')
  .select('*')
  .limit(10);

if (invError) {
  console.error('Error fetching inventory:', invError);
  process.exit(1);
}

console.log(`Found ${inventory.length} vehicles in inventory`);

// Test 2: Check current locations
console.log('\n2. Checking current location data...');
const stockNumbers = inventory.map(v => v.stock_number);
const { data: locations, error: locError } = await supabase
  .from('vehicle_locations')
  .select('*')
  .in('stock_number', stockNumbers);

if (locError) {
  console.error('Error fetching locations:', locError);
} else {
  console.log(`Found ${locations ? locations.length : 0} location records`);
}

// Test 3: Test single location update
console.log('\n3. Testing single location update...');
const testVehicle = inventory[0];
if (testVehicle) {
  const testLocation = 'mechanic_section';
  console.log(`Updating ${testVehicle.stock_number} to ${testLocation}`);
  
  const { data: updateData, error: updateError } = await supabase
    .from('vehicle_locations')
    .upsert({
      stock_number: String(testVehicle.stock_number).trim(),
      vin: testVehicle.vehicle_vin || testVehicle.last_6_vin || '',
      physical_location: testLocation,
      physical_source: 'manual',
      location_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: {
        test: true,
        updated_via: 'test_script'
      }
    }, { onConflict: 'stock_number' })
    .select();

  if (updateError) {
    console.error('❌ Update failed:', updateError);
  } else {
    console.log('✅ Update successful:', updateData[0]);
  }
}

// Test 4: Test bulk location update
console.log('\n4. Testing bulk location update...');
const bulkVehicles = inventory.slice(1, 4);
if (bulkVehicles.length > 0) {
  console.log(`Bulk updating ${bulkVehicles.length} vehicles to 'body_shop'`);
  
  const bulkUpdates = bulkVehicles.map(v => ({
    stock_number: String(v.stock_number).trim(),
    vin: v.vehicle_vin || v.last_6_vin || '',
    physical_location: 'body_shop',
    physical_source: 'bulk_manual',
    location_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: {
      bulk_test: true,
      updated_via: 'test_script'
    }
  }));
  
  const { data: bulkData, error: bulkError } = await supabase
    .from('vehicle_locations')
    .upsert(bulkUpdates, { onConflict: 'stock_number' })
    .select();

  if (bulkError) {
    console.error('❌ Bulk update failed:', bulkError);
  } else {
    console.log('✅ Bulk update successful:', bulkData.length, 'vehicles updated');
    bulkData.forEach(d => {
      console.log(`   - ${d.stock_number}: ${d.physical_location}`);
    });
  }
}

// Test 5: Verify updates
console.log('\n5. Verifying all updates...');
const { data: finalLocations, error: finalError } = await supabase
  .from('vehicle_locations')
  .select('stock_number, physical_location, physical_source, location_updated_at')
  .in('stock_number', stockNumbers);

if (finalError) {
  console.error('Error verifying:', finalError);
} else {
  console.log('\nFinal locations:');
  finalLocations.forEach(loc => {
    console.log(`  ${loc.stock_number}: ${loc.physical_location} (${loc.physical_source})`);
  });
}

console.log('\n=== All tests completed ===');