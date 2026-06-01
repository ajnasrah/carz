import { supabase } from './supabase'

const PRIMARY_ADMIN_PHONE = '+19018319661'
const PRIMARY_ADMIN_NAME = 'Primary Admin'

export async function ensurePrimaryAdmin() {
  try {
    // Check if primary admin exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', PRIMARY_ADMIN_PHONE)
      .single()

    if (existingProfile) {
      // Ensure they have admin role
      if (existingProfile.role !== 'admin') {
        await supabase
          .from('profiles')
          .update({ role: 'admin' })
          .eq('phone', PRIMARY_ADMIN_PHONE)
      }
      return existingProfile
    }

    // Create primary admin if doesn't exist
    const { data: newProfile, error } = await supabase
      .from('profiles')
      .insert({
        phone: PRIMARY_ADMIN_PHONE,
        name: PRIMARY_ADMIN_NAME,
        role: 'admin',
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create primary admin:', error)
      return null
    }

    // Also add to allowed_users
    await supabase
      .from('allowed_users')
      .upsert({
        phone: PRIMARY_ADMIN_PHONE,
        name: PRIMARY_ADMIN_NAME,
        role: 'admin'
      })

    return newProfile
  } catch (error) {
    console.error('Error ensuring primary admin:', error)
    return null
  }
}

export function isPrimaryAdmin(phone) {
  const normalizedPhone = phone?.replace(/\D/g, '')
  return normalizedPhone === '9018319661' || phone === PRIMARY_ADMIN_PHONE
}

export async function getAdminStats() {
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, created_at')

    const { data: recentActions } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    return {
      totalUsers: profiles?.length || 0,
      adminCount: profiles?.filter(p => p.role === 'admin').length || 0,
      inspectorCount: profiles?.filter(p => p.role === 'inspector').length || 0,
      recentActions: recentActions || []
    }
  } catch (error) {
    console.error('Error getting admin stats:', error)
    return {
      totalUsers: 0,
      adminCount: 0,
      inspectorCount: 0,
      recentActions: []
    }
  }
}