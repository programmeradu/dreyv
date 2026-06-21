export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      public_api_contract_violations: {
        Row: {
          contract_id: string
          created_at: string
          errors: Json
          id: string
          payload_excerpt: Json
          severity: string
          subject: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          errors?: Json
          id?: string
          payload_excerpt?: Json
          severity?: string
          subject: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          errors?: Json
          id?: string
          payload_excerpt?: Json
          severity?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_contract_violations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "public_api_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_contracts: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          mode: string
          name: string
          schema_id: string
          schema_version: string
          subject: string
          subject_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          mode?: string
          name: string
          schema_id: string
          schema_version: string
          subject: string
          subject_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          mode?: string
          name?: string
          schema_id?: string
          schema_version?: string
          subject?: string
          subject_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_contracts_schema_id_fkey"
            columns: ["schema_id"]
            isOneToOne: false
            referencedRelation: "public_api_schemas"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_schema_versions: {
        Row: {
          breaking_changes: Json
          changelog: string | null
          compatibility: string
          created_at: string
          id: string
          json_schema: Json
          schema_hash: string
          schema_id: string
          user_id: string
          version: string
          yank_reason: string | null
          yanked_at: string | null
        }
        Insert: {
          breaking_changes?: Json
          changelog?: string | null
          compatibility?: string
          created_at?: string
          id?: string
          json_schema: Json
          schema_hash: string
          schema_id: string
          user_id: string
          version: string
          yank_reason?: string | null
          yanked_at?: string | null
        }
        Update: {
          breaking_changes?: Json
          changelog?: string | null
          compatibility?: string
          created_at?: string
          id?: string
          json_schema?: Json
          schema_hash?: string
          schema_id?: string
          user_id?: string
          version?: string
          yank_reason?: string | null
          yanked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_api_schema_versions_schema_id_fkey"
            columns: ["schema_id"]
            isOneToOne: false
            referencedRelation: "public_api_schemas"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_schemas: {
        Row: {
          created_at: string
          deprecated_at: string | null
          description: string | null
          id: string
          latest_version: string | null
          name: string
          namespace: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deprecated_at?: string | null
          description?: string | null
          id?: string
          latest_version?: string | null
          name: string
          namespace?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deprecated_at?: string | null
          description?: string | null
          id?: string
          latest_version?: string | null
          name?: string
          namespace?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_api_sla_credits: {
        Row: {
          created_at: string
          credit_pct: number
          id: string
          note: string | null
          observed: Json
          period_month: string
          status: string
          target: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_pct?: number
          id?: string
          note?: string | null
          observed?: Json
          period_month: string
          status?: string
          target?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credit_pct?: number
          id?: string
          note?: string | null
          observed?: Json
          period_month?: string
          status?: string
          target?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_api_sla_targets: {
        Row: {
          component_key: string
          created_at: string
          id: string
          latency_p95_ms: number
          tier: string | null
          updated_at: string
          uptime_target: number
          user_id: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          component_key: string
          created_at?: string
          id?: string
          latency_p95_ms: number
          tier?: string | null
          updated_at?: string
          uptime_target: number
          user_id?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          component_key?: string
          created_at?: string
          id?: string
          latency_p95_ms?: number
          tier?: string | null
          updated_at?: string
          uptime_target?: number
          user_id?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      public_api_status_incident_updates: {
        Row: {
          body: string
          created_at: string
          id: string
          incident_id: string
          posted_at: string
          status: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          incident_id: string
          posted_at?: string
          status: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          incident_id?: string
          posted_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_status_incident_updates_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "public_api_status_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_status_incidents: {
        Row: {
          component_ids: Json
          created_at: string
          id: string
          impact: string
          page_id: string
          resolved_at: string | null
          severity: string
          started_at: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          component_ids?: Json
          created_at?: string
          id?: string
          impact?: string
          page_id: string
          resolved_at?: string | null
          severity?: string
          started_at?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          component_ids?: Json
          created_at?: string
          id?: string
          impact?: string
          page_id?: string
          resolved_at?: string | null
          severity?: string
          started_at?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_status_incidents_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "public_api_status_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_status_maintenance: {
        Row: {
          body: string | null
          component_ids: Json
          created_at: string
          id: string
          page_id: string
          scheduled_end: string
          scheduled_start: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          component_ids?: Json
          created_at?: string
          id?: string
          page_id: string
          scheduled_end: string
          scheduled_start: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          component_ids?: Json
          created_at?: string
          id?: string
          page_id?: string
          scheduled_end?: string
          scheduled_start?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_status_maintenance_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "public_api_status_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_status_pages: {
        Row: {
          branding: Json
          components: Json
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          published_at: string | null
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branding?: Json
          components?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          published_at?: string | null
          slug: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branding?: Json
          components?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          published_at?: string | null
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_api_status_subscribers: {
        Row: {
          channel: string
          component_ids: Json
          confirm_token: string
          confirmed_at: string | null
          created_at: string
          id: string
          page_id: string
          target: string
          unsubscribed_at: string | null
        }
        Insert: {
          channel: string
          component_ids?: Json
          confirm_token: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          page_id: string
          target: string
          unsubscribed_at?: string | null
        }
        Update: {
          channel?: string
          component_ids?: Json
          confirm_token?: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          page_id?: string
          target?: string
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_api_status_subscribers_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "public_api_status_pages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
