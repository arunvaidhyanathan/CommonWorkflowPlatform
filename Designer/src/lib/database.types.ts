// Auto-generated from the Supabase schema via mcp__supabase__generate_typescript_types.
// Regenerate after any migration that changes public schema shape.

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
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      approval_requests: {
        Row: {
          approver_id: string | null
          comment: string | null
          decided_at: string | null
          id: string
          requested_at: string
          requested_by: string | null
          status: string
          tenant_id: string
          version_id: string
          workflow_id: string
        }
        Insert: {
          approver_id?: string | null
          comment?: string | null
          decided_at?: string | null
          id?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          tenant_id: string
          version_id: string
          workflow_id: string
        }
        Update: {
          approver_id?: string | null
          comment?: string | null
          decided_at?: string | null
          id?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          tenant_id?: string
          version_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deployments: {
        Row: {
          deployed_at: string
          deployed_by: string | null
          flowable_deployment_id: string | null
          id: string
          status: string
          tenant_id: string
          workflow_version_id: string
        }
        Insert: {
          deployed_at?: string
          deployed_by?: string | null
          flowable_deployment_id?: string | null
          id?: string
          status?: string
          tenant_id: string
          workflow_version_id: string
        }
        Update: {
          deployed_at?: string
          deployed_by?: string | null
          flowable_deployment_id?: string | null
          id?: string
          status?: string
          tenant_id?: string
          workflow_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployments_deployed_by_fkey"
            columns: ["deployed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployments_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_schemas: {
        Row: {
          created_at: string
          form_key: string
          id: string
          json_schema: Json
          tenant_id: string
          version: number
        }
        Insert: {
          created_at?: string
          form_key: string
          id?: string
          json_schema: Json
          tenant_id: string
          version?: number
        }
        Update: {
          created_at?: string
          form_key?: string
          id?: string
          json_schema?: Json
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_schemas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: string
          status: string
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role: string
          status?: string
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          onboarding_dismissed_at: string | null
          role: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          onboarding_dismissed_at?: string | null
          role: string
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          onboarding_dismissed_at?: string | null
          role?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      workflow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          graph_json: Json
          id: string
          version_no: number
          workflow_id: string
          xml_content: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          graph_json: Json
          id?: string
          version_no: number
          workflow_id: string
          xml_content: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          graph_json?: Json
          id?: string
          version_no?: number
          workflow_id?: string
          xml_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          current_version_id: string | null
          definition_key: string
          description: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          name: string
          spec_type: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          definition_key: string
          description?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          name: string
          spec_type: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          definition_key?: string
          description?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          name?: string
          spec_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_role_claim: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      is_current_user_active: { Args: never; Returns: boolean }
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
