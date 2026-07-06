export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Citation {
  kb_entry_id?:     string
  evidence_doc_id?: string
  title:            string
  section?:         string
  relevance:        string
}

// When the Supabase project is live, regenerate with:
//   npx supabase gen types typescript --project-id YOUR_REF > lib/supabase/types.ts
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id:         string
          email:      string
          role:       'rep' | 'admin'
          full_name:  string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id:          string
          email:       string
          role?:       'rep' | 'admin'
          full_name?:  string | null
          avatar_url?: string | null
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      kb_entries: {
        Row: {
          id:             string
          domain:         string
          question:       string
          answer:         string
          citations:      Json
          tier:           'public' | 'public_review' | 'nda_gated'
          confidence:     'high' | 'medium' | 'gap'
          status:         'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
          internal_notes: string | null
          version:        number
          approved_by:    string | null
          approved_at:    string | null
          created_at:     string
          updated_at:     string
        }
        Insert: {
          id?:             string
          domain:          string
          question:        string
          answer:          string
          citations?:      Json
          tier?:           'public' | 'public_review' | 'nda_gated'
          confidence?:     'high' | 'medium' | 'gap'
          status?:         'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
          internal_notes?: string | null
          approved_by?:    string | null
          approved_at?:    string | null
          embedding?:      string | null
        }
        Update: Partial<Database['public']['Tables']['kb_entries']['Insert']>
        Relationships: [
          { foreignKeyName: 'kb_entries_approved_by_fkey'; columns: ['approved_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      evidence_docs: {
        Row: {
          id:         string
          title:      string
          section:    string | null
          content:    string
          nda_gated:  boolean
          source_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?:         string
          title:       string
          section?:    string | null
          content:     string
          nda_gated?:  boolean
          source_url?: string | null
          embedding?:  string | null
        }
        Update: Partial<Database['public']['Tables']['evidence_docs']['Insert']>
        Relationships: []
      }
      questionnaires: {
        Row: {
          id:               string
          name:             string
          customer:         string | null
          source_format:    'excel' | 'word' | 'pdf' | 'paste' | 'portal'
          file_path:        string | null
          status:           'pending' | 'processing' | 'answering' | 'complete' | 'failed'
          progress:         Json
          inngest_event_id: string | null
          error_message:    string | null
          uploaded_by:      string | null
          created_at:       string
          updated_at:       string
        }
        Insert: {
          id?:               string
          name:              string
          customer?:         string | null
          source_format:     'excel' | 'word' | 'pdf' | 'paste' | 'portal'
          file_path?:        string | null
          status?:           'pending' | 'processing' | 'answering' | 'complete' | 'failed'
          progress?:         Json
          inngest_event_id?: string | null
          error_message?:    string | null
          uploaded_by?:      string | null
        }
        Update: Partial<Database['public']['Tables']['questionnaires']['Insert']>
        Relationships: [
          { foreignKeyName: 'questionnaires_uploaded_by_fkey'; columns: ['uploaded_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      questions: {
        Row: {
          id:               string
          questionnaire_id: string
          raw_text:         string
          normalized_text:  string | null
          location_ref:     string | null
          sequence_index:   number
          dedupe_group:     string | null
          created_at:       string
        }
        Insert: {
          id?:               string
          questionnaire_id:  string
          raw_text:          string
          normalized_text?:  string | null
          location_ref?:     string | null
          sequence_index:    number
          dedupe_group?:     string | null
        }
        Update: Partial<Database['public']['Tables']['questions']['Insert']>
        Relationships: [
          { foreignKeyName: 'questions_questionnaire_id_fkey'; columns: ['questionnaire_id']; isOneToOne: false; referencedRelation: 'questionnaires'; referencedColumns: ['id'] }
        ]
      }
      answers: {
        Row: {
          id:                  string
          question_id:         string
          kb_entry_id:         string | null
          answer_text:         string
          answer_type:         'grounded' | 'gap_standard' | 'gap_nda' | 'gap_in_progress'
          citations:           Json
          confidence:          'high' | 'medium' | 'gap'
          tier:                'public' | 'public_review' | 'nda_gated'
          status:              'draft' | 'pending_review' | 'approved' | 'rejected'
          source:              'ai' | 'kb' | 'human'
          routed_to_devsecops: boolean
          generation_metadata: Json
          created_at:          string
          updated_at:          string
        }
        Insert: {
          id?:                  string
          question_id:          string
          kb_entry_id?:         string | null
          answer_text:          string
          answer_type:          'grounded' | 'gap_standard' | 'gap_nda' | 'gap_in_progress'
          citations?:           Json
          confidence:           'high' | 'medium' | 'gap'
          tier:                 'public' | 'public_review' | 'nda_gated'
          status?:              'draft' | 'pending_review' | 'approved' | 'rejected'
          source?:              'ai' | 'kb' | 'human'
          routed_to_devsecops?: boolean
          generation_metadata?: Json
        }
        Update: Partial<Database['public']['Tables']['answers']['Insert']>
        Relationships: [
          { foreignKeyName: 'answers_question_id_fkey'; columns: ['question_id']; isOneToOne: false; referencedRelation: 'questions'; referencedColumns: ['id'] },
          { foreignKeyName: 'answers_kb_entry_id_fkey'; columns: ['kb_entry_id']; isOneToOne: false; referencedRelation: 'kb_entries'; referencedColumns: ['id'] }
        ]
      }
      review_queue: {
        Row: {
          id:         string
          answer_id:  string
          reason:     'low_confidence' | 'no_match' | 'nda_gated' | 'in_progress' | 'edited' | 'manual'
          assignee:   string | null
          status:     'open' | 'in_review' | 'resolved' | 'dismissed'
          notes:      string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?:       string
          answer_id: string
          reason:    'low_confidence' | 'no_match' | 'nda_gated' | 'in_progress' | 'edited' | 'manual'
          assignee?: string | null
          status?:   'open' | 'in_review' | 'resolved' | 'dismissed'
          notes?:    string | null
        }
        Update: Partial<Database['public']['Tables']['review_queue']['Insert']>
        Relationships: [
          { foreignKeyName: 'review_queue_answer_id_fkey'; columns: ['answer_id']; isOneToOne: false; referencedRelation: 'answers'; referencedColumns: ['id'] }
        ]
      }
      audit_log: {
        Row: {
          id:          string
          actor_id:    string
          action:      string
          entity_type: string
          entity_id:   string
          metadata:    Json
          created_at:  string
        }
        Insert: {
          id?:         string
          actor_id:    string
          action:      string
          entity_type: string
          entity_id:   string
          metadata?:   Json
        }
        Update: never
        Relationships: [
          { foreignKeyName: 'audit_log_actor_id_fkey'; columns: ['actor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
    }
    Views:   { [_ in never]: never }
    Functions: {
      hybrid_search: {
        Args: {
          query_embedding:  string
          query_text:       string
          match_count?:     number
          semantic_weight?: number
          keyword_weight?:  number
          rrf_k?:           number
        }
        Returns: Array<{
          id:            string
          domain:        string
          question:      string
          answer:        string
          citations:     Json
          tier:          string
          confidence:    string
          rrf_score:     number
          semantic_rank: number
          keyword_rank:  number
        }>
      }
      increment_progress: {
        Args: {
          p_questionnaire_id: string
          p_routed:           boolean
        }
        Returns: undefined
      }
      get_user_role: {
        Args: Record<string, never>
        Returns: string
      }
      search_evidence_docs: {
        Args: {
          query_embedding: string
          match_count?:    number
        }
        Returns: Array<{
          id:         string
          title:      string
          section:    string | null
          content:    string
          source_url: string | null
          nda_gated:  boolean
          similarity: number
        }>
      }
    }
    Enums:          { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type ProfileRow        = Database['public']['Tables']['profiles']['Row']
export type KbEntryRow        = Database['public']['Tables']['kb_entries']['Row']
export type QuestionnaireRow  = Database['public']['Tables']['questionnaires']['Row']
export type QuestionRow       = Database['public']['Tables']['questions']['Row']
export type AnswerRow         = Database['public']['Tables']['answers']['Row']
export type ReviewQueueRow    = Database['public']['Tables']['review_queue']['Row']
