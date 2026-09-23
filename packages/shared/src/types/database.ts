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
      alert_contacts: {
        Row: {
          channel: string
          created_at: string
          destination: string
          enabled: boolean
          id: string
          role: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          destination: string
          enabled?: boolean
          id?: string
          role: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          destination?: string
          enabled?: boolean
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          channel: string
          contact_id: string
          created_at: string
          id: string
          incident_id: string
          status: string
        }
        Insert: {
          channel: string
          contact_id: string
          created_at?: string
          id?: string
          incident_id: string
          status?: string
        }
        Update: {
          channel?: string
          contact_id?: string
          created_at?: string
          id?: string
          incident_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "alert_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      device_state: {
        Row: {
          current_gas: number | null
          device_id: string
          health: string
          last_seen: string | null
          updated_at: string
        }
        Insert: {
          current_gas?: number | null
          device_id: string
          health?: string
          last_seen?: string | null
          updated_at?: string
        }
        Update: {
          current_gas?: number | null
          device_id?: string
          health?: string
          last_seen?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_state_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          device_key: string
          firmware_version: string | null
          flat_id: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          device_key: string
          firmware_version?: string | null
          flat_id: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          device_key?: string
          firmware_version?: string | null
          flat_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
        ]
      }
      flats: {
        Row: {
          created_at: string
          floor: number | null
          id: string
          number: string
          tower_id: string
        }
        Insert: {
          created_at?: string
          floor?: number | null
          id?: string
          number: string
          tower_id: string
        }
        Update: {
          created_at?: string
          floor?: number | null
          id?: string
          number?: string
          tower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flats_tower_id_fkey"
            columns: ["tower_id"]
            isOneToOne: false
            referencedRelation: "towers"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: string
          incident_id: string
          payload: Json | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: string
          incident_id: string
          payload?: Json | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: string
          incident_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          device_id: string
          id: string
          resolved_at: string | null
          severity: string
          started_at: string
          state: string
        }
        Insert: {
          device_id: string
          id?: string
          resolved_at?: string | null
          severity: string
          started_at?: string
          state?: string
        }
        Update: {
          device_id?: string
          id?: string
          resolved_at?: string | null
          severity?: string
          started_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          flat_id: string | null
          id: string
          role: string
          society_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          flat_id?: string | null
          id?: string
          role: string
          society_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          flat_id?: string | null
          id?: string
          role?: string
          society_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      readings: {
        Row: {
          created_at: string
          device_id: string
          gas_raw: number | null
          gas_value: number | null
          humidity: number | null
          id: string
          recorded_at: string
          sequence: number
          temperature: number | null
        }
        Insert: {
          created_at?: string
          device_id: string
          gas_raw?: number | null
          gas_value?: number | null
          humidity?: number | null
          id?: string
          recorded_at: string
          sequence: number
          temperature?: number | null
        }
        Update: {
          created_at?: string
          device_id?: string
          gas_raw?: number | null
          gas_value?: number | null
          humidity?: number | null
          id?: string
          recorded_at?: string
          sequence?: number
          temperature?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      societies: {
        Row: {
          city: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      towers: {
        Row: {
          created_at: string
          id: string
          name: string
          society_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          society_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "towers_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_flat_ids: { Args: never; Returns: string[] }
      user_society_ids: { Args: never; Returns: string[] }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {},
  },
} as const
