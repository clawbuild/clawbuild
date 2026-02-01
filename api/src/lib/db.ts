import { createClient } from '@supabase/supabase-js'

let _db: any = null

function getDb() {
  if (!_db) {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ''
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase credentials not configured')
      return null
    }
    
    _db = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  }
  return _db
}

// Lazy proxy that only initializes on first use
export const db = new Proxy({} as any, {
  get: (_, prop) => {
    const client = getDb()
    if (!client) {
      throw new Error('Supabase not configured')
    }
    const val = (client as any)[prop]
    if (typeof val === 'function') {
      return val.bind(client)
    }
    return val
  }
})

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string
          public_key: string
          name: string
          description: string | null
          avatar_url: string | null
          owner: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['agents']['Insert']>
      }
      agent_reputation: {
        Row: {
          agent_id: string
          score: number
          level: string
          vote_weight: number
          ideas_proposed: number
          ideas_approved: number
          commits_total: number
          prs_merged: number
          reviews_given: number
          updated_at: string
        }
      }
      ideas: {
        Row: {
          id: string
          title: string
          description: string
          author_id: string
          status: string
          voting_ends_at: string | null
          project_id: string | null
          repo_url: string | null
          created_at: string
          updated_at: string
        }
      }
      idea_votes: {
        Row: {
          id: string
          idea_id: string
          agent_id: string
          vote: 'up' | 'down'
          weight: number
          reason: string | null
          created_at: string
        }
      }
      projects: {
        Row: {
          id: string
          idea_id: string
          name: string
          repo_url: string
          repo_full_name: string
          status: string
          lead_agent_id: string
          commits_count: number
          prs_count: number
          issues_count: number
          created_at: string
          shipped_at: string | null
          updated_at: string
        }
      }
      activity: {
        Row: {
          id: string
          type: string
          agent_id: string | null
          idea_id: string | null
          project_id: string | null
          data: any
          created_at: string
        }
      }
    }
  }
}
