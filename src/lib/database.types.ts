
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
                },"events": {
                  Row: {
                    "farm_id": string,"id": string,"kind": Database["public"]['Enums']["event_kind"],"member_id": string,"occurred_at": string,"record_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "farm_id": string,"id"?: string,"kind": Database["public"]['Enums']["event_kind"],"member_id": string,"occurred_at"?: string,"record_id"?: string | null
                  }
                  Update: {
                    "farm_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["event_kind"],"member_id"?: string,"occurred_at"?: string,"record_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "farm_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"extraction_crops": {
                  Row: {
                    "crop_id": string | null,"extraction_id": string,"farm_id": string,"id": string,"position": number,"spoken_as": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "crop_id"?: string | null,"extraction_id": string,"farm_id": string,"id"?: string,"position": number,"spoken_as"?: string | null
                  }
                  Update: {
                    "crop_id"?: string | null,"extraction_id"?: string,"farm_id"?: string,"id"?: string,"position"?: number,"spoken_as"?: string | null
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
                    "extraction_id": string,"farm_id": string,"field_id": string | null,"id": string,"position": number,"spoken_as": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "extraction_id": string,"farm_id": string,"field_id"?: string | null,"id"?: string,"position": number,"spoken_as"?: string | null
                  }
                  Update: {
                    "extraction_id"?: string,"farm_id"?: string,"field_id"?: string | null,"id"?: string,"position"?: number,"spoken_as"?: string | null
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
                },"extraction_varieties": {
                  Row: {
                    "extraction_id": string,"farm_id": string,"id": string,"position": number,"spoken_as": string | null,"variety_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "extraction_id": string,"farm_id": string,"id"?: string,"position": number,"spoken_as"?: string | null,"variety_id"?: string | null
                  }
                  Update: {
                    "extraction_id"?: string,"farm_id"?: string,"id"?: string,"position"?: number,"spoken_as"?: string | null,"variety_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "extraction_varieties_extraction_id_fkey"
      columns: ["extraction_id"]
isOneToOne: false
      referencedRelation: "extractions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_varieties_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_varieties_variety_id_fkey"
      columns: ["variety_id"]
isOneToOne: false
      referencedRelation: "varieties"
      referencedColumns: ["id"]
    }
                  ]
                },"extractions": {
                  Row: {
                    "body": string,"farm_id": string,"id": string,"judge_member_id": string | null,"kind": Database["public"]['Enums']["extraction_kind"],"performed_on": string,"position": number,"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"farm_id": string,"id"?: string,"judge_member_id"?: string | null,"kind": Database["public"]['Enums']["extraction_kind"],"performed_on": string,"position": number,"version_id": string
                  }
                  Update: {
                    "body"?: string,"farm_id"?: string,"id"?: string,"judge_member_id"?: string | null,"kind"?: Database["public"]['Enums']["extraction_kind"],"performed_on"?: string,"position"?: number,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "extractions_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extractions_judge_member_id_fkey"
      columns: ["judge_member_id"]
isOneToOne: false
      referencedRelation: "farm_members"
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
                },"grounds": {
                  Row: {
                    "body": string | null,"farm_id": string,"id": string,"judgment_id": string,"observation_id": string | null,"position": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"farm_id": string,"id"?: string,"judgment_id": string,"observation_id"?: string | null,"position": number
                  }
                  Update: {
                    "body"?: string | null,"farm_id"?: string,"id"?: string,"judgment_id"?: string,"observation_id"?: string | null,"position"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "grounds_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grounds_judgment_id_fkey"
      columns: ["judgment_id"]
isOneToOne: false
      referencedRelation: "extractions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grounds_observation_id_fkey"
      columns: ["observation_id"]
isOneToOne: false
      referencedRelation: "extractions"
      referencedColumns: ["id"]
    }
                  ]
                },"record_metrics": {
                  Row: {
                    "created_at": string,"farm_id": string,"id": string,"input_tokens": number,"output_tokens": number,"record_id": string,"structuring_seconds": number,"total_seconds": number,"transcription_cost_usd": number | null,"transcription_seconds": number | null,"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"farm_id": string,"id"?: string,"input_tokens": number,"output_tokens": number,"record_id": string,"structuring_seconds": number,"total_seconds": number,"transcription_cost_usd"?: number | null,"transcription_seconds"?: number | null,"version_id": string
                  }
                  Update: {
                    "created_at"?: string,"farm_id"?: string,"id"?: string,"input_tokens"?: number,"output_tokens"?: number,"record_id"?: string,"structuring_seconds"?: number,"total_seconds"?: number,"transcription_cost_usd"?: number | null,"transcription_seconds"?: number | null,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_metrics_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_metrics_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_metrics_version_id_fkey"
      columns: ["version_id"]
isOneToOne: true
      referencedRelation: "versions"
      referencedColumns: ["id"]
    }
                  ]
                },"records": {
                  Row: {
                    "audio_path": string | null,"farm_id": string,"id": string,"latitude": number | null,"location_accuracy_meters": number | null,"longitude": number | null,"photo_paths": (string)[],"received_at": string,"recorded_at": string,"recorder_member_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audio_path"?: string | null,"farm_id": string,"id": string,"latitude"?: number | null,"location_accuracy_meters"?: number | null,"longitude"?: number | null,"photo_paths"?: (string)[],"received_at"?: string,"recorded_at": string,"recorder_member_id": string
                  }
                  Update: {
                    "audio_path"?: string | null,"farm_id"?: string,"id"?: string,"latitude"?: number | null,"location_accuracy_meters"?: number | null,"longitude"?: number | null,"photo_paths"?: (string)[],"received_at"?: string,"recorded_at"?: string,"recorder_member_id"?: string
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
                },"varieties": {
                  Row: {
                    "created_at": string,"crop_id": string,"farm_id": string,"id": string,"name": string,"spoken_names": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"crop_id": string,"farm_id": string,"id"?: string,"name": string,"spoken_names"?: (string)[]
                  }
                  Update: {
                    "created_at"?: string,"crop_id"?: string,"farm_id"?: string,"id"?: string,"name"?: string,"spoken_names"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "varieties_crop_id_farm_id_fkey"
      columns: ["crop_id","farm_id"]
isOneToOne: false
      referencedRelation: "crops"
      referencedColumns: ["id","farm_id"]
    },{
      foreignKeyName: "varieties_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
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
                },"work_materials": {
                  Row: {
                    "amount": string | null,"dilution": string | null,"farm_id": string,"id": string,"name": string,"position": number,"work_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: string | null,"dilution"?: string | null,"farm_id": string,"id"?: string,"name": string,"position": number,"work_id": string
                  }
                  Update: {
                    "amount"?: string | null,"dilution"?: string | null,"farm_id"?: string,"id"?: string,"name"?: string,"position"?: number,"work_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_materials_farm_id_fkey"
      columns: ["farm_id"]
isOneToOne: false
      referencedRelation: "farms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_materials_work_id_fkey"
      columns: ["work_id"]
isOneToOne: false
      referencedRelation: "extractions"
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
{ Args: { "items": Json,"metrics": Json,"target_record_id": string,"transcript"?: string }; Returns: string
                           }
          }
          Enums: {
            "event_kind": "record","extraction_kind": "observation"|"judgment"|"work","version_author": "ai"|"human"
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
            "event_kind": ["record"],"extraction_kind": ["observation", "judgment", "work"],"version_author": ["ai", "human"]
          }
        }
} as const
