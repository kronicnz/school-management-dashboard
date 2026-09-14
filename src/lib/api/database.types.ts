import type { Session } from "@supabase/supabase-js"

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      students: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string | null
          phone: string | null
          date_of_birth: string | null
          grade_level: string | null
          class_id: string | null
          parent_name: string | null
          parent_phone: string | null
          enrollment_date: string | null
          status: string | null
          created_at: string | null
          updated_at: string | null
          org_unit_path: string | null
          room_number: string | null
          year_group: string | null
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email?: string | null
          phone?: string | null
          date_of_birth?: string | null
          grade_level?: string | null
          class_id?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          enrollment_date?: string | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
          org_unit_path?: string | null
          room_number?: string | null
          year_group?: string | null
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string | null
          phone?: string | null
          date_of_birth?: string | null
          grade_level?: string | null
          class_id?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          enrollment_date?: string | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
          org_unit_path?: string | null
          room_number?: string | null
          year_group?: string | null
        }
      }
      classes: {
        Row: {
          id: string
          name: string
          grade_level: string | null
          subject: string | null
          room_number: string | null
          capacity: number | null
          school_year: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          grade_level?: string | null
          subject?: string | null
          room_number?: string | null
          capacity?: number | null
          school_year?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          grade_level?: string | null
          subject?: string | null
          room_number?: string | null
          capacity?: number | null
          school_year?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      staff: {
        Row: {
          id: string
          profile_id: string | null
          first_name: string
          last_name: string
          email: string
          phone: string | null
          role: string | null
          department: string | null
          hire_date: string | null
          status: string | null
          org_unit_path: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          profile_id?: string | null
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          role?: string | null
          department?: string | null
          hire_date?: string | null
          status?: string | null
          org_unit_path?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string | null
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          role?: string | null
          department?: string | null
          hire_date?: string | null
          status?: string | null
          org_unit_path?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      assets: {
        Row: {
          id: string
          asset_tag: string
          name: string
          category: string | null
          model: string | null
          serial_number: string | null
          status: string | null
          assigned_to: string | null
          assigned_to_type: string | null
          location: string | null
          purchase_date: string | null
          purchase_cost: number | null
          condition: string | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          asset_tag: string
          name: string
          category?: string | null
          model?: string | null
          serial_number?: string | null
          status?: string | null
          assigned_to?: string | null
          assigned_to_type?: string | null
          location?: string | null
          purchase_date?: string | null
          purchase_cost?: number | null
          condition?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          asset_tag?: string
          name?: string
          category?: string | null
          model?: string | null
          serial_number?: string | null
          status?: string | null
          assigned_to?: string | null
          assigned_to_type?: string | null
          location?: string | null
          purchase_date?: string | null
          purchase_cost?: number | null
          condition?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      attendance: {
        Row: {
          id: string
          student_id: string | null
          class_id: string | null
          date: string
          status: string
          notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          student_id?: string | null
          class_id?: string | null
          date: string
          status: string
          notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string | null
          class_id?: string | null
          date?: string
          status?: string
          notes?: string | null
          created_at?: string | null
        }
      }
      subjects: {
        Row: {
          id: string
          name: string
          code: string | null
          description: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          code?: string | null
          description?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          code?: string | null
          description?: string | null
          created_at?: string | null
        }
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          org_unit_path: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          org_unit_path?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          org_unit_path?: string | null
          updated_at?: string | null
        }
      }
      user_roles: {
        Row: {
          id: string
          profile_id: string
          role: string
          active: boolean
          effective_from: string | null
          effective_to: string | null
          granted_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          role: string
          active?: boolean
          effective_from?: string | null
          effective_to?: string | null
          granted_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          role?: string
          active?: boolean
          effective_from?: string | null
          effective_to?: string | null
          granted_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      class_staff_assignments: {
        Row: {
          id: string
          class_id: string
          staff_profile_id: string
          assignment_role: string
          effective_from: string | null
          effective_to: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          class_id: string
          staff_profile_id: string
          assignment_role: string
          effective_from?: string | null
          effective_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          class_id?: string
          staff_profile_id?: string
          assignment_role?: string
          effective_from?: string | null
          effective_to?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      teacher_student_scope: {
        Row: {
          id: string
          teacher_id: string
          student_id: string
          source: string
          is_excluded: boolean
          effective_from: string | null
          effective_to: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          teacher_id: string
          student_id: string
          source: string
          is_excluded?: boolean
          effective_from?: string | null
          effective_to?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          teacher_id?: string
          student_id?: string
          source?: string
          is_excluded?: boolean
          effective_from?: string | null
          effective_to?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      incident_categories: {
        Row: {
          id: string
          code: string
          name: string
          is_positive: boolean
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          is_positive?: boolean
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          is_positive?: boolean
          active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      incidents: {
        Row: {
          id: string
          student_id: string
          category_id: string
          created_by: string
          assigned_to: string | null
          occurred_at: string
          reported_at: string
          severity: string
          status: string
          visibility: string
          sensitivity_review_requested: boolean
          description: string
          action_taken: string | null
          resolution_summary: string | null
          is_deleted: boolean
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          student_id: string
          category_id: string
          created_by: string
          assigned_to?: string | null
          occurred_at: string
          reported_at?: string
          severity?: string
          status?: string
          visibility?: string
          sensitivity_review_requested?: boolean
          description: string
          action_taken?: string | null
          resolution_summary?: string | null
          is_deleted?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          category_id?: string
          created_by?: string
          assigned_to?: string | null
          occurred_at?: string
          reported_at?: string
          severity?: string
          status?: string
          visibility?: string
          sensitivity_review_requested?: boolean
          description?: string
          action_taken?: string | null
          resolution_summary?: string | null
          is_deleted?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      incident_comments: {
        Row: {
          id: string
          incident_id: string
          author_id: string
          content: string
          visibility: string
          is_deleted: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          incident_id: string
          author_id: string
          content: string
          visibility?: string
          is_deleted?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          incident_id?: string
          author_id?: string
          content?: string
          visibility?: string
          is_deleted?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      incident_audit_log: {
        Row: {
          id: number
          incident_id: string
          action: string
          changed_by: string | null
          changed_at: string
          before_data: Json | null
          after_data: Json | null
          context: Json | null
        }
        Insert: {
          id?: number
          incident_id: string
          action: string
          changed_by?: string | null
          changed_at?: string
          before_data?: Json | null
          after_data?: Json | null
          context?: Json | null
        }
        Update: {
          id?: number
          incident_id?: string
          action?: string
          changed_by?: string | null
          changed_at?: string
          before_data?: Json | null
          after_data?: Json | null
          context?: Json | null
        }
      }
      incident_retention_rules: {
        Row: {
          id: string
          category_id: string | null
          severity: string
          retain_for_interval: unknown
          archive_after_interval: unknown
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id?: string | null
          severity: string
          retain_for_interval: unknown
          archive_after_interval: unknown
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          category_id?: string | null
          severity?: string
          retain_for_interval?: unknown
          archive_after_interval?: unknown
          active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      incident_emergency_access_grants: {
        Row: {
          id: string
          grantee_user_id: string
          student_id: string | null
          incident_id: string | null
          reason: string
          granted_by: string
          granted_at: string
          expires_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          grantee_user_id: string
          student_id?: string | null
          incident_id?: string | null
          reason: string
          granted_by: string
          granted_at?: string
          expires_at?: string
          revoked_at?: string | null
        }
        Update: {
          id?: string
          grantee_user_id?: string
          student_id?: string | null
          incident_id?: string | null
          reason?: string
          granted_by?: string
          granted_at?: string
          expires_at?: string
          revoked_at?: string | null
        }
      }
      incident_export_audit_log: {
        Row: {
          id: number
          requested_by: string
          student_id: string
          case_reference: string
          reason: string
          exported_at: string
          row_count: number
          payload: Json
        }
        Insert: {
          id?: number
          requested_by: string
          student_id: string
          case_reference: string
          reason: string
          exported_at?: string
          row_count?: number
          payload: Json
        }
        Update: {
          id?: number
          requested_by?: string
          student_id?: string
          case_reference?: string
          reason?: string
          exported_at?: string
          row_count?: number
          payload?: Json
        }
      }
      incident_students: {
        Row: {
          id: string
          incident_id: string
          student_id: string
          tagged_by: string
          tagged_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          incident_id: string
          student_id: string
          tagged_by: string
          tagged_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          incident_id?: string
          student_id?: string
          tagged_by?: string
          tagged_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      incident_follow_ups: {
        Row: {
          id: string
          incident_id: string
          author_id: string
          assigned_to: string | null
          due_at: string | null
          completed_at: string | null
          status: string
          notes: string
          next_action: string | null
          visibility: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          incident_id: string
          author_id: string
          assigned_to?: string | null
          due_at?: string | null
          completed_at?: string | null
          status?: string
          notes: string
          next_action?: string | null
          visibility?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          incident_id?: string
          author_id?: string
          assigned_to?: string | null
          due_at?: string | null
          completed_at?: string | null
          status?: string
          notes?: string
          next_action?: string | null
          visibility?: string
          created_at?: string
          updated_at?: string
        }
      }
      incident_email_dispatch_log: {
        Row: {
          id: number
          incident_id: string
          sender_id: string
          recipients: Json
          template_key: string
          subject: string
          merged_payload: Json
          status: string
          error: string | null
          provider_message_id: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: number
          incident_id: string
          sender_id: string
          recipients: Json
          template_key: string
          subject: string
          merged_payload?: Json
          status?: string
          error?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          incident_id?: string
          sender_id?: string
          recipients?: Json
          template_key?: string
          subject?: string
          merged_payload?: Json
          status?: string
          error?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
      }
      ticket_categories: {
        Row: {
          id: string
          code: string
          name: string
          active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      ticket_templates: {
        Row: {
          id: string
          category_id: string
          code: string
          name: string
          description: string | null
          active: boolean
          version: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id: string
          code: string
          name: string
          description?: string | null
          active?: boolean
          version?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          category_id?: string
          code?: string
          name?: string
          description?: string | null
          active?: boolean
          version?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      ticket_template_steps: {
        Row: {
          id: string
          template_id: string
          step_key: string
          label: string
          sort_order: number
          config: Json
          required: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          template_id: string
          step_key: string
          label: string
          sort_order?: number
          config?: Json
          required?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          template_id?: string
          step_key?: string
          label?: string
          sort_order?: number
          config?: Json
          required?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      tickets: {
        Row: {
          id: string
          ticket_number: string
          requester_id: string
          category_id: string
          template_id: string
          template_version: number
          template_snapshot: Json
          assigned_to: string | null
          assigned_by: string | null
          status: string
          priority: string
          close_requested_at: string | null
          closed_by_requester_at: string | null
          title: string
          summary: string | null
          submission_payload: Json
          device_context: Json
          request_context: Json
          is_deleted: boolean
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticket_number?: string
          requester_id?: string
          category_id: string
          template_id: string
          template_version?: number
          template_snapshot?: Json
          assigned_to?: string | null
          assigned_by?: string | null
          status?: string
          priority?: string
          close_requested_at?: string | null
          closed_by_requester_at?: string | null
          title: string
          summary?: string | null
          submission_payload?: Json
          device_context?: Json
          request_context?: Json
          is_deleted?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          ticket_number?: string
          requester_id?: string
          category_id?: string
          template_id?: string
          template_version?: number
          template_snapshot?: Json
          assigned_to?: string | null
          assigned_by?: string | null
          status?: string
          priority?: string
          close_requested_at?: string | null
          closed_by_requester_at?: string | null
          title?: string
          summary?: string | null
          submission_payload?: Json
          device_context?: Json
          request_context?: Json
          is_deleted?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      ticket_comments: {
        Row: {
          id: string
          ticket_id: string
          author_id: string
          comment_type: string
          is_close_request: boolean
          content: string
          is_deleted: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          author_id?: string
          comment_type?: string
          is_close_request?: boolean
          content: string
          is_deleted?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          ticket_id?: string
          author_id?: string
          comment_type?: string
          is_close_request?: boolean
          content?: string
          is_deleted?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      ticket_attachments: {
        Row: {
          id: string
          ticket_id: string
          uploaded_by: string
          storage_path: string
          file_name: string
          mime_type: string | null
          file_size: number | null
          visibility: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          uploaded_by?: string
          storage_path: string
          file_name: string
          mime_type?: string | null
          file_size?: number | null
          visibility?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          ticket_id?: string
          uploaded_by?: string
          storage_path?: string
          file_name?: string
          mime_type?: string | null
          file_size?: number | null
          visibility?: string
          created_at?: string
          updated_at?: string
        }
      }
      ticket_audit_log: {
        Row: {
          id: number
          ticket_id: string
          action: string
          changed_by: string | null
          before_data: Json | null
          after_data: Json | null
          context: Json | null
          changed_at: string
        }
        Insert: {
          id?: number
          ticket_id: string
          action: string
          changed_by?: string | null
          before_data?: Json | null
          after_data?: Json | null
          context?: Json | null
          changed_at?: string
        }
        Update: {
          id?: number
          ticket_id?: string
          action?: string
          changed_by?: string | null
          before_data?: Json | null
          after_data?: Json | null
          context?: Json | null
          changed_at?: string
        }
      }
      ticket_notifications: {
        Row: {
          id: string
          ticket_id: string
          recipient_id: string
          channel: string
          event_type: string
          delivered_at: string | null
          status: string
          payload: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          recipient_id: string
          channel: string
          event_type: string
          delivered_at?: string | null
          status?: string
          payload?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          ticket_id?: string
          recipient_id?: string
          channel?: string
          event_type?: string
          delivered_at?: string | null
          status?: string
          payload?: Json
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      effective_teacher_student_scope: {
        Row: {
          teacher_id: string | null
          student_id: string | null
        }
      }
    }
    Functions: {
      soft_delete_incident: {
        Args: {
          p_incident_id: string
          p_reason: string
        }
        Returns: Database["public"]["Tables"]["incidents"]["Row"]
      }
      restore_incident: {
        Args: {
          p_incident_id: string
          p_reason: string
        }
        Returns: Database["public"]["Tables"]["incidents"]["Row"]
      }
      set_incident_visibility: {
        Args: {
          p_incident_id: string
          p_visibility: string
          p_reason: string
        }
        Returns: Database["public"]["Tables"]["incidents"]["Row"]
      }
      export_student_incidents: {
        Args: {
          p_student_id: string
          p_case_reference: string
          p_reason: string
        }
        Returns: Json
      }
      retention_due_report: {
        Args: {
          p_as_of?: string
        }
        Returns: {
          incident_id: string
          category_id: string
          severity: string
          archive_due_at: string
          dispose_due_at: string
          should_archive: boolean
          should_dispose: boolean
        }[]
      }
      incident_management_report: {
        Args: {
          p_as_of?: string
        }
        Returns: {
          total_count: number
          open_count: number
          in_review_count: number
          resolved_count: number
          closed_count: number
          status_counts: Json
          severity_counts: Json
          visibility_counts: Json
          assignment_counts: Json
          tagged_student_count: number
          overdue_follow_up_count: number
        }[]
      }
      list_incident_assignees: {
        Args: Record<string, never>
        Returns: {
          profile_id: string
          email: string
          full_name: string | null
          org_unit_path: string | null
          roles: Json
        }[]
      }
      is_student_in_effective_scope: {
        Args: {
          p_teacher_id: string
          p_student_id: string
        }
        Returns: boolean
      }
      is_it_admin: {
        Args: {
          p_user_id?: string
        }
        Returns: boolean
      }
      is_it_staff: {
        Args: {
          p_user_id?: string
        }
        Returns: boolean
      }
      is_ticket_requester: {
        Args: {
          p_ticket_id: string
          p_user_id?: string
        }
        Returns: boolean
      }
      is_ticket_assignee: {
        Args: {
          p_ticket_id: string
          p_user_id?: string
        }
        Returns: boolean
      }
      dashboard_stats_for_tier: {
        Args: {
          p_tier?: string
        }
        Returns: Json
      }
      create_ticket_from_template: {
        Args: {
          p_template_code: string
          p_title: string
          p_summary?: string
          p_priority?: string
          p_submission_payload?: Json
          p_device_context?: Json
          p_request_context?: Json
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      assign_ticket: {
        Args: {
          p_ticket_id: string
          p_assigned_to: string | null
          p_reason?: string
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      claim_ticket: {
        Args: {
          p_ticket_id: string
          p_reason?: string
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      transition_ticket_status: {
        Args: {
          p_ticket_id: string
          p_status: string
          p_reason?: string
          p_override?: boolean
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      request_ticket_close: {
        Args: {
          p_ticket_id: string
          p_comment?: string
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      add_ticket_comment: {
        Args: {
          p_ticket_id: string
          p_content: string
          p_comment_type?: string
          p_is_close_request?: boolean
        }
        Returns: Database["public"]["Tables"]["ticket_comments"]["Row"]
      }
      archive_ticket: {
        Args: {
          p_ticket_id: string
          p_reason?: string
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      restore_ticket: {
        Args: {
          p_ticket_id: string
          p_reason?: string
        }
        Returns: Database["public"]["Tables"]["tickets"]["Row"]
      }
      ticket_management_report: {
        Args: {
          p_as_of?: string
        }
        Returns: {
          total_count: number
          new_count: number
          assigned_count: number
          in_progress_count: number
          pending_user_count: number
          resolved_count: number
          closed_count: number
          archived_count: number
          unassigned_count: number
          status_counts: Json
          priority_counts: Json
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}

export type Student = Database["public"]["Tables"]["students"]["Row"]
export type StudentInsert = Database["public"]["Tables"]["students"]["Insert"]
export type StudentUpdate = Database["public"]["Tables"]["students"]["Update"]
export type Class = Database["public"]["Tables"]["classes"]["Row"]
export type ClassInsert = Database["public"]["Tables"]["classes"]["Insert"]
export type ClassUpdate = Database["public"]["Tables"]["classes"]["Update"]
export type Staff = Database["public"]["Tables"]["staff"]["Row"]
export type StaffInsert = Database["public"]["Tables"]["staff"]["Insert"]
export type StaffUpdate = Database["public"]["Tables"]["staff"]["Update"]
export type Asset = Database["public"]["Tables"]["assets"]["Row"]
export type AssetInsert = Database["public"]["Tables"]["assets"]["Insert"]
export type AssetUpdate = Database["public"]["Tables"]["assets"]["Update"]
export type Attendance = Database["public"]["Tables"]["attendance"]["Row"]
export type AttendanceInsert = Database["public"]["Tables"]["attendance"]["Insert"]
export type AttendanceUpdate = Database["public"]["Tables"]["attendance"]["Update"]
export type Subject = Database["public"]["Tables"]["subjects"]["Row"]
export type SubjectInsert = Database["public"]["Tables"]["subjects"]["Insert"]
export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"]
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]
export type UserRole = Database["public"]["Tables"]["user_roles"]["Row"]
export type UserRoleInsert = Database["public"]["Tables"]["user_roles"]["Insert"]
export type UserRoleUpdate = Database["public"]["Tables"]["user_roles"]["Update"]
export type IncidentCategory = Database["public"]["Tables"]["incident_categories"]["Row"]
export type IncidentCategoryInsert = Database["public"]["Tables"]["incident_categories"]["Insert"]
export type Incident = Database["public"]["Tables"]["incidents"]["Row"]
export type IncidentInsert = Database["public"]["Tables"]["incidents"]["Insert"]
export type IncidentUpdate = Database["public"]["Tables"]["incidents"]["Update"]
export type IncidentComment = Database["public"]["Tables"]["incident_comments"]["Row"]
export type IncidentCommentInsert = Database["public"]["Tables"]["incident_comments"]["Insert"]
export type IncidentCommentUpdate = Database["public"]["Tables"]["incident_comments"]["Update"]
export type IncidentStudent = Database["public"]["Tables"]["incident_students"]["Row"]
export type IncidentStudentInsert = Database["public"]["Tables"]["incident_students"]["Insert"]
export type IncidentStudentUpdate = Database["public"]["Tables"]["incident_students"]["Update"]
export type IncidentFollowUp = Database["public"]["Tables"]["incident_follow_ups"]["Row"]
export type IncidentFollowUpInsert = Database["public"]["Tables"]["incident_follow_ups"]["Insert"]
export type IncidentFollowUpUpdate = Database["public"]["Tables"]["incident_follow_ups"]["Update"]
export type IncidentEmailDispatchLog = Database["public"]["Tables"]["incident_email_dispatch_log"]["Row"]
export type IncidentEmailDispatchLogInsert = Database["public"]["Tables"]["incident_email_dispatch_log"]["Insert"]
export type IncidentEmailDispatchLogUpdate = Database["public"]["Tables"]["incident_email_dispatch_log"]["Update"]
export type TicketCategory = Database["public"]["Tables"]["ticket_categories"]["Row"]
export type TicketCategoryInsert = Database["public"]["Tables"]["ticket_categories"]["Insert"]
export type TicketCategoryUpdate = Database["public"]["Tables"]["ticket_categories"]["Update"]
export type TicketTemplate = Database["public"]["Tables"]["ticket_templates"]["Row"]
export type TicketTemplateInsert = Database["public"]["Tables"]["ticket_templates"]["Insert"]
export type TicketTemplateUpdate = Database["public"]["Tables"]["ticket_templates"]["Update"]
export type TicketTemplateStep = Database["public"]["Tables"]["ticket_template_steps"]["Row"]
export type TicketTemplateStepInsert = Database["public"]["Tables"]["ticket_template_steps"]["Insert"]
export type TicketTemplateStepUpdate = Database["public"]["Tables"]["ticket_template_steps"]["Update"]
export type Ticket = Database["public"]["Tables"]["tickets"]["Row"]
export type TicketInsert = Database["public"]["Tables"]["tickets"]["Insert"]
export type TicketUpdate = Database["public"]["Tables"]["tickets"]["Update"]
export type TicketComment = Database["public"]["Tables"]["ticket_comments"]["Row"]
export type TicketCommentInsert = Database["public"]["Tables"]["ticket_comments"]["Insert"]
export type TicketCommentUpdate = Database["public"]["Tables"]["ticket_comments"]["Update"]
export type TicketAttachment = Database["public"]["Tables"]["ticket_attachments"]["Row"]
export type TicketAttachmentInsert = Database["public"]["Tables"]["ticket_attachments"]["Insert"]
export type TicketAttachmentUpdate = Database["public"]["Tables"]["ticket_attachments"]["Update"]
export type TicketAuditLog = Database["public"]["Tables"]["ticket_audit_log"]["Row"]
export type TicketAuditLogInsert = Database["public"]["Tables"]["ticket_audit_log"]["Insert"]
export type TicketAuditLogUpdate = Database["public"]["Tables"]["ticket_audit_log"]["Update"]
export type TicketNotification = Database["public"]["Tables"]["ticket_notifications"]["Row"]
export type TicketNotificationInsert = Database["public"]["Tables"]["ticket_notifications"]["Insert"]
export type TicketNotificationUpdate = Database["public"]["Tables"]["ticket_notifications"]["Update"]

// Auth types
export interface AuthUser {
  id: string
  email: string | null
  full_name: string | null
  org_unit_path: string | null
  roles: string[]
  user_metadata?: Record<string, unknown>
}

export type AuthContextType = {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

export interface IncidentManagementReport {
  total_count: number
  open_count: number
  in_review_count: number
  resolved_count: number
  closed_count: number
  status_counts: Json
  severity_counts: Json
  visibility_counts: Json
  assignment_counts: Json
  tagged_student_count: number
  overdue_follow_up_count: number
}

export interface TicketManagementReport {
  total_count: number
  new_count: number
  assigned_count: number
  in_progress_count: number
  pending_user_count: number
  resolved_count: number
  closed_count: number
  archived_count: number
  unassigned_count: number
  status_counts: Json
  priority_counts: Json
}
