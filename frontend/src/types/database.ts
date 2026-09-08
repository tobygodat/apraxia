export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      home_appearance: {
        Row: { user_id: string; title: string; cover_image: string | null; cover_position_x: number; cover_position_y: number }
        Insert: { user_id?: string; title?: string; cover_image?: string | null; cover_position_x?: number; cover_position_y?: number }
        Update: { user_id?: string; title?: string; cover_image?: string | null; cover_position_x?: number; cover_position_y?: number }
        Relationships: []
      }
      google_calendar_connections: {
        Row: {
          connection_state: Database["public"]["Enums"]["google_calendar_connection_state"]
          created_at: string
          display_email: string | null
          google_account_id: string | null
          granted_scopes: string[]
          id: string
          last_successful_refresh_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_state?: Database["public"]["Enums"]["google_calendar_connection_state"]
          created_at?: string
          display_email?: string | null
          google_account_id?: string | null
          granted_scopes?: string[]
          id?: string
          last_successful_refresh_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_state?: Database["public"]["Enums"]["google_calendar_connection_state"]
          created_at?: string
          display_email?: string | null
          google_account_id?: string | null
          granted_scopes?: string[]
          id?: string
          last_successful_refresh_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_preferences: {
        Row: {
          background_color: string | null
          calendar_id: string
          created_at: string
          display_name: string
          foreground_color: string | null
          id: string
          is_visible: boolean
          last_seen_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          background_color?: string | null
          calendar_id: string
          created_at?: string
          display_name: string
          foreground_color?: string | null
          id?: string
          is_visible?: boolean
          last_seen_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          background_color?: string | null
          calendar_id?: string
          created_at?: string
          display_name?: string
          foreground_color?: string | null
          id?: string
          is_visible?: boolean
          last_seen_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ideas: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          legacy_id: string | null
          project_id: string | null
          search_vector: unknown
          source: Database["public"]["Enums"]["record_source"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_id?: string | null
          project_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_id?: string | null
          project_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ideas_project_same_owner"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          creator: string | null
          deleted_at: string | null
          id: string
          legacy_id: string | null
          media_type: Database["public"]["Enums"]["media_type"]
          notes: string | null
          rating: number | null
          release_year: number | null
          search_vector: unknown
          source: Database["public"]["Enums"]["record_source"]
          status: Database["public"]["Enums"]["media_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          creator?: string | null
          deleted_at?: string | null
          id?: string
          legacy_id?: string | null
          media_type: Database["public"]["Enums"]["media_type"]
          notes?: string | null
          rating?: number | null
          release_year?: number | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["media_status"]
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          creator?: string | null
          deleted_at?: string | null
          id?: string
          legacy_id?: string | null
          media_type?: Database["public"]["Enums"]["media_type"]
          notes?: string | null
          rating?: number | null
          release_year?: number | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["media_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          legacy_id: string | null
          search_vector: unknown
          source: Database["public"]["Enums"]["record_source"]
          status: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          legacy_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          legacy_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_date: string | null
          due_time: string | null
          id: string
          legacy_id: string | null
          project_id: string | null
          search_vector: unknown
          source: Database["public"]["Enums"]["record_source"]
          text: string
          today_rank: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          legacy_id?: string | null
          project_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          text: string
          today_rank?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          legacy_id?: string | null
          project_id?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["record_source"]
          text?: string
          today_rank?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_project_same_owner"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      begin_calendar_oauth_attempt: {
        Args: {
          p_code_verifier: string
          p_expires_at: string
          p_redirect_uri: string
          p_state_hash: string
          p_verified_user_id: string
        }
        Returns: Json
      }
      begin_calendar_oauth_transaction: {
        Args: {
          p_expires_at: string
          p_redirect_uri: string
          p_state_hash: string
          p_verified_user_id: string
        }
        Returns: Json
      }
      clear_calendar_credentials: {
        Args: {
          p_expected_updated_at?: string
          p_state: Database["public"]["Enums"]["google_calendar_connection_state"]
          p_verified_user_id: string
        }
        Returns: boolean
      }
      consume_calendar_oauth_attempt: {
        Args: {
          p_redirect_uri: string
          p_state_hash: string
          p_verified_user_id: string
        }
        Returns: Json
      }
      consume_calendar_oauth_transaction: {
        Args: {
          p_redirect_uri: string
          p_state_hash: string
          p_verified_user_id: string
        }
        Returns: Json
      }
      get_today_todos_page: {
        Args: {
          p_limit?: number
          p_local_date: string
          p_offset?: number
          p_snapshot_token?: string
        }
        Returns: Json
      }
      read_calendar_credentials: {
        Args: { p_verified_user_id: string }
        Returns: Json
      }
      reorder_today_todos: {
        Args: { p_local_date: string; p_todo_ids: string[] }
        Returns: Json
      }
      restore_record: {
        Args: {
          p_deleted_at: string
          p_record_id: string
          p_record_type: Database["public"]["Enums"]["orbitos_record_type"]
        }
        Returns: boolean
      }
      save_calendar_credentials: {
        Args: {
          p_connection_id: string
          p_envelope: string
          p_expected_updated_at: string
          p_key_version: number
          p_scopes: string[]
          p_verified_user_id: string
        }
        Returns: boolean
      }
      search_records: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          record_id: string
          record_type: Database["public"]["Enums"]["orbitos_record_type"]
          relevance: number
          snippet: string
          title: string
          total_count: number
          updated_at: string
        }[]
      }
      soft_delete_record: {
        Args: {
          p_record_id: string
          p_record_type: Database["public"]["Enums"]["orbitos_record_type"]
        }
        Returns: string
      }
      sync_calendar_preferences: {
        Args: { p_calendars: Json; p_verified_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      google_calendar_connection_state:
        | "connected"
        | "reconnect_required"
        | "disconnected"
      media_status: "saved" | "in_progress" | "finished"
      media_type: "book" | "movie"
      orbitos_record_type: "todo" | "idea" | "media" | "project"
      project_status: "active" | "someday" | "completed" | "archived"
      record_source: "manual" | "migration"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      google_calendar_connection_state: [
        "connected",
        "reconnect_required",
        "disconnected",
      ],
      media_status: ["saved", "in_progress", "finished"],
      media_type: ["book", "movie"],
      orbitos_record_type: ["todo", "idea", "media", "project"],
      project_status: ["active", "someday", "completed", "archived"],
      record_source: ["manual", "migration"],
    },
  },
} as const
