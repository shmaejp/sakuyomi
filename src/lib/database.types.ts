
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "crops": {
                  Row: {
                    "created_at": string,"farm_id": string,"id": string,"name": string,"spoken_names": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"farm_id": string,"id"?: string,"name": string,"spoken_names"?: (string)[]
                  }
                  Update: {
                    "created_at"?: string,"farm_id"?: string,"id"?: string,"name"?: string,"spoken_names"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "crops_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    }
                  ]
                },"extraction_crops": {
                  Row: {
                    "crop_id": string | null,"extraction_id": string,"farm_id": string,"id": string,"spoken_as": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "crop_id"?: string | null,"extraction_id": string,"farm_id": string,"id"?: string,"spoken_as"?: string | null
                  }
                  Update: {
                    "crop_id"?: string | null,"extraction_id"?: string,"farm_id"?: string,"id"?: string,"spoken_as"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "extraction_crops_crop_id_fkey"
      columns: ["crop_id"]
isOneToOne: false
      referencedRelation: "crops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_crops_extraction_id_fkey"
      columns: ["extraction_id"]
isOneToOne: false
      referencedRelation: "extractions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_crops_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    }
                  ]
                },"extraction_fields": {
                  Row: {
                    "extraction_id": string,"farm_id": string,"field_id": string | null,"id": string,"spoken_as": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "extraction_id": string,"farm_id": string,"field_id"?: string | null,"id"?: string,"spoken_as"?: string | null
                  }
                  Update: {
                    "extraction_id"?: string,"farm_id"?: string,"field_id"?: string | null,"id"?: string,"spoken_as"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "extraction_fields_extraction_id_fkey"
      columns: ["extraction_id"]
isOneToOne: false
      referencedRelation: "extractions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_fields_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_fields_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "fields"
      referencedColumns: ["id"]
    }
                  ]
                },"extractions": {
                  Row: {
                    "body": string,"farm_id": string,"id": string,"kind": Database["public"]['Enums']["extraction_kind"],"position": number,"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"farm_id": string,"id"?: string,"kind": Database["public"]['Enums']["extraction_kind"],"position": number,"version_id": string
                  }
                  Update: {
                    "body"?: string,"farm_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["extraction_kind"],"position"?: number,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "extractions_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extractions_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "versions"
      referencedColumns: ["id"]
    }
                  ]
                },"farm_members": {
                  Row: {
                    "created_at": string,"display_name": string,"farm_id": string,"id": string,"left_at": string | null,"spoken_names": (string)[],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"farm_id": string,"id"?: string,"left_at"?: string | null,"spoken_names"?: (string)[],"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"farm_id"?: string,"id"?: string,"left_at"?: string | null,"spoken_names"?: (string)[],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "farm_members_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    }
                  ]
                },"farms": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fields": {
                  Row: {
                    "created_at": string,"farm_id": string,"id": string,"latitude": number | null,"longitude": number | null,"name": string,"retired_at": string | null,"spoken_names": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"farm_id": string,"id"?: string,"latitude"?: number | null,"longitude"?: number | null,"name": string,"retired_at"?: string | null,"spoken_names"?: (string)[]
                  }
                  Update: {
                    "created_at"?: string,"farm_id"?: string,"id"?: string,"latitude"?: number | null,"longitude"?: number | null,"name"?: string,"retired_at"?: string | null,"spoken_names"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "fields_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    }
                  ]
                },"records": {
                  Row: {
                    "audio_path": string | null,"created_at": string,"farm_id": string,"id": string,"recorded_at": string,"recorder_member_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audio_path"?: string | null,"created_at"?: string,"farm_id": string,"id": string,"recorded_at": string,"recorder_member_id": string
                  }
                  Update: {
                    "audio_path"?: string | null,"created_at"?: string,"farm_id"?: string,"id"?: string,"recorded_at"?: string,"recorder_member_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "records_recorder_member_id_fkey"
      columns: ["recorder_member_id"]
isOneToOne: false
      referencedRelation: "farm_members"
      referencedColumns: ["id"]
    }
                  ]
                },"versions": {
                  Row: {
                    "author": Database["public"]['Enums']["version_author"],"created_at": string,"farm_id": string,"id": string,"record_id": string,"transcript": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author": Database["public"]['Enums']["version_author"],"created_at"?: string,"farm_id": string,"id"?: string,"record_id": string,"transcript"?: string | null
                  }
                  Update: {
                    "author"?: Database["public"]['Enums']["version_author"],"created_at"?: string,"farm_id"?: string,"id"?: string,"record_id"?: string,"transcript"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "versions_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "versions_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "save_ai_version":
{ Args: { "items": Json,"target_record_id": string,"transcript": string }; Returns: string
                           }
          }
          Enums: {
            "extraction_kind": "observation"|"judgment"|"work","version_author": "ai"|"human"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "extraction_kind": ["observation", "judgment", "work"],"version_author": ["ai", "human"]
          }
        }
} as const
