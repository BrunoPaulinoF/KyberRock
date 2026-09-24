// Gerado por `supabase gen types` (projeto KyberRock). NAO editar a mao: regenerar com
// `npm run types` (ver README). Ver docs/web-api.md do repositorio principal.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          cloud_synced_at: string;
          code: string | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          is_system: boolean;
          name: string;
          omie_code: string | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          code?: string | null;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          is_system?: boolean;
          name: string;
          omie_code?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          code?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          name?: string;
          omie_code?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "accounts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      ai_assistant_settings: {
        Row: {
          api_key: string | null;
          id: boolean;
          is_enabled: boolean;
          model: string;
          provider: string;
          updated_at: string;
        };
        Insert: {
          api_key?: string | null;
          id?: boolean;
          is_enabled?: boolean;
          model?: string;
          provider?: string;
          updated_at?: string;
        };
        Update: {
          api_key?: string | null;
          id?: boolean;
          is_enabled?: boolean;
          model?: string;
          provider?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          after_json: Json | null;
          before_json: Json | null;
          company_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          reason: string | null;
          unit_id: string | null;
        };
        Insert: {
          action: string;
          after_json?: Json | null;
          before_json?: Json | null;
          company_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          reason?: string | null;
          unit_id?: string | null;
        };
        Update: {
          action?: string;
          after_json?: Json | null;
          before_json?: Json | null;
          company_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          reason?: string | null;
          unit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      billing_events: {
        Row: {
          company_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          invoice_id: string | null;
          message: string | null;
          payload: Json;
        };
        Insert: {
          company_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          payload?: Json;
        };
        Update: {
          company_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "billing_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_events_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "billing_invoices";
            referencedColumns: ["id"];
          }
        ];
      };
      billing_invoices: {
        Row: {
          addition_cents: number;
          amount_cents: number;
          base_amount_cents: number;
          blocked_at: string | null;
          boleto_attempts: number;
          boleto_barcode: string | null;
          boleto_error: string | null;
          boleto_expires_at: string | null;
          boleto_issued_at: string | null;
          boleto_payment_id: string | null;
          boleto_provider: string;
          boleto_status: string | null;
          boleto_url: string | null;
          cancel_reason: string | null;
          canceled_at: string | null;
          closing_date: string;
          company_id: string;
          created_at: string;
          discount_cents: number;
          due_date: string;
          full_period_days: number | null;
          id: string;
          is_prorated: boolean;
          notes: string | null;
          number: string;
          paid_amount_cents: number | null;
          paid_at: string | null;
          payment_method: string | null;
          period_end: string;
          period_start: string;
          prorated_days: number | null;
          reference_label: string;
          status: string;
          updated_at: string;
          whatsapp_attempts: number;
          whatsapp_error: string | null;
          whatsapp_sent_at: string | null;
          whatsapp_to: string | null;
        };
        Insert: {
          addition_cents?: number;
          amount_cents: number;
          base_amount_cents?: number;
          blocked_at?: string | null;
          boleto_attempts?: number;
          boleto_barcode?: string | null;
          boleto_error?: string | null;
          boleto_expires_at?: string | null;
          boleto_issued_at?: string | null;
          boleto_payment_id?: string | null;
          boleto_provider?: string;
          boleto_status?: string | null;
          boleto_url?: string | null;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          closing_date: string;
          company_id: string;
          created_at?: string;
          discount_cents?: number;
          due_date: string;
          full_period_days?: number | null;
          id?: string;
          is_prorated?: boolean;
          notes?: string | null;
          number?: string;
          paid_amount_cents?: number | null;
          paid_at?: string | null;
          payment_method?: string | null;
          period_end: string;
          period_start: string;
          prorated_days?: number | null;
          reference_label: string;
          status?: string;
          updated_at?: string;
          whatsapp_attempts?: number;
          whatsapp_error?: string | null;
          whatsapp_sent_at?: string | null;
          whatsapp_to?: string | null;
        };
        Update: {
          addition_cents?: number;
          amount_cents?: number;
          base_amount_cents?: number;
          blocked_at?: string | null;
          boleto_attempts?: number;
          boleto_barcode?: string | null;
          boleto_error?: string | null;
          boleto_expires_at?: string | null;
          boleto_issued_at?: string | null;
          boleto_payment_id?: string | null;
          boleto_provider?: string;
          boleto_status?: string | null;
          boleto_url?: string | null;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          closing_date?: string;
          company_id?: string;
          created_at?: string;
          discount_cents?: number;
          due_date?: string;
          full_period_days?: number | null;
          id?: string;
          is_prorated?: boolean;
          notes?: string | null;
          number?: string;
          paid_amount_cents?: number | null;
          paid_at?: string | null;
          payment_method?: string | null;
          period_end?: string;
          period_start?: string;
          prorated_days?: number | null;
          reference_label?: string;
          status?: string;
          updated_at?: string;
          whatsapp_attempts?: number;
          whatsapp_error?: string | null;
          whatsapp_sent_at?: string | null;
          whatsapp_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_invoices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      billing_requests: {
        Row: {
          claimed_at: string | null;
          claimed_by_device_id: string | null;
          company_id: string;
          created_at: string;
          id: string;
          operation_id: string;
          processed_at: string | null;
          requested_at: string;
          requested_by: string | null;
          result_message: string | null;
          status: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          claimed_at?: string | null;
          claimed_by_device_id?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          operation_id: string;
          processed_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          result_message?: string | null;
          status?: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          claimed_at?: string | null;
          claimed_by_device_id?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          operation_id?: string;
          processed_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          result_message?: string | null;
          status?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_requests_claimed_by_device_id_fkey";
            columns: ["claimed_by_device_id"];
            isOneToOne: false;
            referencedRelation: "device_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "weighing_operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      billing_settings: {
        Row: {
          auto_block_enabled: boolean;
          auto_boleto_enabled: boolean;
          auto_close_enabled: boolean;
          auto_whatsapp_enabled: boolean;
          default_closing_day: number;
          default_due_day: number;
          default_grace_days: number;
          id: boolean;
          invoice_description_template: string | null;
          issuer_document: string | null;
          issuer_email: string | null;
          issuer_name: string | null;
          issuer_phone: string | null;
          issuer_pix_key: string | null;
          mercado_pago_environment: string;
          updated_at: string;
          whatsapp_instance_name: string | null;
          whatsapp_message_template: string | null;
          whatsapp_status: string | null;
          whatsapp_url: string | null;
        };
        Insert: {
          auto_block_enabled?: boolean;
          auto_boleto_enabled?: boolean;
          auto_close_enabled?: boolean;
          auto_whatsapp_enabled?: boolean;
          default_closing_day?: number;
          default_due_day?: number;
          default_grace_days?: number;
          id?: boolean;
          invoice_description_template?: string | null;
          issuer_document?: string | null;
          issuer_email?: string | null;
          issuer_name?: string | null;
          issuer_phone?: string | null;
          issuer_pix_key?: string | null;
          mercado_pago_environment?: string;
          updated_at?: string;
          whatsapp_instance_name?: string | null;
          whatsapp_message_template?: string | null;
          whatsapp_status?: string | null;
          whatsapp_url?: string | null;
        };
        Update: {
          auto_block_enabled?: boolean;
          auto_boleto_enabled?: boolean;
          auto_close_enabled?: boolean;
          auto_whatsapp_enabled?: boolean;
          default_closing_day?: number;
          default_due_day?: number;
          default_grace_days?: number;
          id?: boolean;
          invoice_description_template?: string | null;
          issuer_document?: string | null;
          issuer_email?: string | null;
          issuer_name?: string | null;
          issuer_phone?: string | null;
          issuer_pix_key?: string | null;
          mercado_pago_environment?: string;
          updated_at?: string;
          whatsapp_instance_name?: string | null;
          whatsapp_message_template?: string | null;
          whatsapp_status?: string | null;
          whatsapp_url?: string | null;
        };
        Relationships: [];
      };
      cadastro_change_pings: {
        Row: {
          changed_at: string;
          company_id: string;
          source: string | null;
        };
        Insert: {
          changed_at?: string;
          company_id: string;
          source?: string | null;
        };
        Update: {
          changed_at?: string;
          company_id?: string;
          source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cadastro_change_pings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      carriers: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          document: string | null;
          id: string;
          is_active: boolean;
          name: string;
          omie_customer_id: number | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          document?: string | null;
          id: string;
          is_active?: boolean;
          name: string;
          omie_customer_id?: number | null;
          source?: string;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          document?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          omie_customer_id?: number | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "carriers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      companies: {
        Row: {
          billing_address_complement: string | null;
          billing_address_number: string | null;
          billing_address_street: string | null;
          billing_block_exempt: boolean;
          billing_city: string | null;
          billing_closing_day: number | null;
          billing_contact_name: string | null;
          billing_document: string | null;
          billing_due_day: number | null;
          billing_email: string | null;
          billing_enabled: boolean;
          billing_grace_days: number | null;
          billing_legal_name: string | null;
          billing_monthly_amount_cents: number | null;
          billing_neighborhood: string | null;
          billing_notes: string | null;
          billing_phone: string | null;
          billing_start_date: string | null;
          billing_state: string | null;
          billing_zipcode: string | null;
          created_at: string;
          desktop_activation_code: string | null;
          desktop_activation_code_hash: string | null;
          desktop_activation_code_rotated_at: string | null;
          document: string | null;
          id: string;
          is_active: boolean;
          legal_name: string;
          name: string;
          omie_app_key: string | null;
          omie_app_secret: string | null;
          payment_blocked: boolean;
          payment_blocked_at: string | null;
          payment_blocked_reason: string | null;
          price_change_password: string;
          updated_at: string;
        };
        Insert: {
          billing_address_complement?: string | null;
          billing_address_number?: string | null;
          billing_address_street?: string | null;
          billing_block_exempt?: boolean;
          billing_city?: string | null;
          billing_closing_day?: number | null;
          billing_contact_name?: string | null;
          billing_document?: string | null;
          billing_due_day?: number | null;
          billing_email?: string | null;
          billing_enabled?: boolean;
          billing_grace_days?: number | null;
          billing_legal_name?: string | null;
          billing_monthly_amount_cents?: number | null;
          billing_neighborhood?: string | null;
          billing_notes?: string | null;
          billing_phone?: string | null;
          billing_start_date?: string | null;
          billing_state?: string | null;
          billing_zipcode?: string | null;
          created_at?: string;
          desktop_activation_code?: string | null;
          desktop_activation_code_hash?: string | null;
          desktop_activation_code_rotated_at?: string | null;
          document?: string | null;
          id?: string;
          is_active?: boolean;
          legal_name: string;
          name: string;
          omie_app_key?: string | null;
          omie_app_secret?: string | null;
          payment_blocked?: boolean;
          payment_blocked_at?: string | null;
          payment_blocked_reason?: string | null;
          price_change_password?: string;
          updated_at?: string;
        };
        Update: {
          billing_address_complement?: string | null;
          billing_address_number?: string | null;
          billing_address_street?: string | null;
          billing_block_exempt?: boolean;
          billing_city?: string | null;
          billing_closing_day?: number | null;
          billing_contact_name?: string | null;
          billing_document?: string | null;
          billing_due_day?: number | null;
          billing_email?: string | null;
          billing_enabled?: boolean;
          billing_grace_days?: number | null;
          billing_legal_name?: string | null;
          billing_monthly_amount_cents?: number | null;
          billing_neighborhood?: string | null;
          billing_notes?: string | null;
          billing_phone?: string | null;
          billing_start_date?: string | null;
          billing_state?: string | null;
          billing_zipcode?: string | null;
          created_at?: string;
          desktop_activation_code?: string | null;
          desktop_activation_code_hash?: string | null;
          desktop_activation_code_rotated_at?: string | null;
          document?: string | null;
          id?: string;
          is_active?: boolean;
          legal_name?: string;
          name?: string;
          omie_app_key?: string | null;
          omie_app_secret?: string | null;
          payment_blocked?: boolean;
          payment_blocked_at?: string | null;
          payment_blocked_reason?: string | null;
          price_change_password?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_carriers: {
        Row: {
          carrier_id: string;
          cloud_synced_at: string;
          company_id: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          carrier_id: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          customer_id: string;
          id: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          carrier_id?: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          customer_id?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_carriers_carrier_id_fkey";
            columns: ["carrier_id"];
            isOneToOne: false;
            referencedRelation: "carriers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_carriers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_carriers_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_credit_balances: {
        Row: {
          balance_cents: number;
          company_id: string | null;
          customer_id: string;
          last_synced_at: string | null;
          omie_source_json: Json | null;
          updated_at: string;
        };
        Insert: {
          balance_cents?: number;
          company_id?: string | null;
          customer_id: string;
          last_synced_at?: string | null;
          omie_source_json?: Json | null;
          updated_at?: string;
        };
        Update: {
          balance_cents?: number;
          company_id?: string | null;
          customer_id?: string;
          last_synced_at?: string | null;
          omie_source_json?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_credit_balances_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_balances_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: true;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_credit_movements: {
        Row: {
          amount_cents: number;
          balance_after_cents: number;
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          id: string;
          movement_type: string;
          omie_title_id: number | null;
          operation_id: string | null;
          reason: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          balance_after_cents: number;
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          id: string;
          movement_type: string;
          omie_title_id?: number | null;
          operation_id?: string | null;
          reason?: string | null;
          source?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          balance_after_cents?: number;
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          movement_type?: string;
          omie_title_id?: number | null;
          operation_id?: string | null;
          reason?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_credit_movements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_movements_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_freight_rules: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          product_id: string | null;
          rule_json: Json;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          product_id?: string | null;
          rule_json?: Json;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          product_id?: string | null;
          rule_json?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_freight_rules_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_freight_rules_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_freight_rules_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_future_billing_invoices: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          nfe_number: string;
          product_id: string | null;
          total_weight_kg: number | null;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          nfe_number: string;
          product_id?: string | null;
          total_weight_kg?: number | null;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          nfe_number?: string;
          product_id?: string | null;
          total_weight_kg?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_future_billing_invoices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_future_billing_invoices_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_future_billing_invoices_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_price_tables: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          price_table_id: string;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          price_table_id: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          price_table_id?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_price_tables_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_price_tables_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_price_tables_price_table_id_fkey";
            columns: ["price_table_id"];
            isOneToOne: false;
            referencedRelation: "price_tables";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_special_prices: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          product_id: string;
          sync_version: number;
          unit: string;
          unit_price_cents: number;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          product_id: string;
          sync_version?: number;
          unit?: string;
          unit_price_cents: number;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          product_id?: string;
          sync_version?: number;
          unit?: string;
          unit_price_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_special_prices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_special_prices_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_special_prices_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_vehicles: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          updated_at: string;
          vehicle_id: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          updated_at?: string;
          vehicle_id: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_vehicles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      customers: {
        Row: {
          address_complement: string | null;
          address_number: string | null;
          address_street: string | null;
          city: string | null;
          cloud_synced_at: string;
          commercial_published_at: string | null;
          company_id: string;
          contact_name: string | null;
          country: string | null;
          country_code: string | null;
          created_at: string;
          credit_account_enabled: boolean | null;
          credit_boleto_days: number | null;
          credit_closing_day: number | null;
          credit_closing_weekday: number | null;
          credit_limit_cents: number | null;
          credit_mode: string;
          credit_periodicity: string | null;
          credit_second_boleto_days: number | null;
          credit_second_closing_day: number | null;
          customer_type: string | null;
          default_carrier_id: string | null;
          default_freight_modality: string | null;
          default_payment_method_id: string | null;
          default_payment_term_id: string | null;
          deleted_at: string | null;
          document: string | null;
          email: string | null;
          homepage: string | null;
          ibge_city_code: string | null;
          ibge_state_code: string | null;
          id: string;
          is_active: boolean;
          is_foreign: boolean;
          is_individual: boolean;
          last_synced_at: string | null;
          legal_name: string;
          municipal_registration: string | null;
          neighborhood: string | null;
          nf_required: boolean | null;
          observations: string | null;
          omie_billing_blocked: boolean;
          omie_customer_id: number | null;
          omie_integration_code: string | null;
          omie_updated_at: string | null;
          open_receivables_cents: number;
          phone: string | null;
          phone_secondary: string | null;
          salesperson_id: number | null;
          state: string | null;
          state_registration: string | null;
          tags_json: Json | null;
          trade_name: string;
          updated_at: string;
          zipcode: string | null;
        };
        Insert: {
          address_complement?: string | null;
          address_number?: string | null;
          address_street?: string | null;
          city?: string | null;
          cloud_synced_at?: string;
          commercial_published_at?: string | null;
          company_id: string;
          contact_name?: string | null;
          country?: string | null;
          country_code?: string | null;
          created_at?: string;
          credit_account_enabled?: boolean | null;
          credit_boleto_days?: number | null;
          credit_closing_day?: number | null;
          credit_closing_weekday?: number | null;
          credit_limit_cents?: number | null;
          credit_mode?: string;
          credit_periodicity?: string | null;
          credit_second_boleto_days?: number | null;
          credit_second_closing_day?: number | null;
          customer_type?: string | null;
          default_carrier_id?: string | null;
          default_freight_modality?: string | null;
          default_payment_method_id?: string | null;
          default_payment_term_id?: string | null;
          deleted_at?: string | null;
          document?: string | null;
          email?: string | null;
          homepage?: string | null;
          ibge_city_code?: string | null;
          ibge_state_code?: string | null;
          id: string;
          is_active?: boolean;
          is_foreign?: boolean;
          is_individual?: boolean;
          last_synced_at?: string | null;
          legal_name: string;
          municipal_registration?: string | null;
          neighborhood?: string | null;
          nf_required?: boolean | null;
          observations?: string | null;
          omie_billing_blocked?: boolean;
          omie_customer_id?: number | null;
          omie_integration_code?: string | null;
          omie_updated_at?: string | null;
          open_receivables_cents?: number;
          phone?: string | null;
          phone_secondary?: string | null;
          salesperson_id?: number | null;
          state?: string | null;
          state_registration?: string | null;
          tags_json?: Json | null;
          trade_name: string;
          updated_at?: string;
          zipcode?: string | null;
        };
        Update: {
          address_complement?: string | null;
          address_number?: string | null;
          address_street?: string | null;
          city?: string | null;
          cloud_synced_at?: string;
          commercial_published_at?: string | null;
          company_id?: string;
          contact_name?: string | null;
          country?: string | null;
          country_code?: string | null;
          created_at?: string;
          credit_account_enabled?: boolean | null;
          credit_boleto_days?: number | null;
          credit_closing_day?: number | null;
          credit_closing_weekday?: number | null;
          credit_limit_cents?: number | null;
          credit_mode?: string;
          credit_periodicity?: string | null;
          credit_second_boleto_days?: number | null;
          credit_second_closing_day?: number | null;
          customer_type?: string | null;
          default_carrier_id?: string | null;
          default_freight_modality?: string | null;
          default_payment_method_id?: string | null;
          default_payment_term_id?: string | null;
          deleted_at?: string | null;
          document?: string | null;
          email?: string | null;
          homepage?: string | null;
          ibge_city_code?: string | null;
          ibge_state_code?: string | null;
          id?: string;
          is_active?: boolean;
          is_foreign?: boolean;
          is_individual?: boolean;
          last_synced_at?: string | null;
          legal_name?: string;
          municipal_registration?: string | null;
          neighborhood?: string | null;
          nf_required?: boolean | null;
          observations?: string | null;
          omie_billing_blocked?: boolean;
          omie_customer_id?: number | null;
          omie_integration_code?: string | null;
          omie_updated_at?: string | null;
          open_receivables_cents?: number;
          phone?: string | null;
          phone_secondary?: string | null;
          salesperson_id?: number | null;
          state?: string | null;
          state_registration?: string | null;
          tags_json?: Json | null;
          trade_name?: string;
          updated_at?: string;
          zipcode?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      daily_report_dispatches: {
        Row: {
          company_id: string;
          dispatched_at: string;
          id: string;
          last_error: string | null;
          recipients_count: number;
          report_date: string;
          schedule_hour: number | null;
          status: string;
          unit_id: string;
        };
        Insert: {
          company_id: string;
          dispatched_at?: string;
          id?: string;
          last_error?: string | null;
          recipients_count: number;
          report_date: string;
          schedule_hour?: number | null;
          status: string;
          unit_id: string;
        };
        Update: {
          company_id?: string;
          dispatched_at?: string;
          id?: string;
          last_error?: string | null;
          recipients_count?: number;
          report_date?: string;
          schedule_hour?: number | null;
          status?: string;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_report_dispatches_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_report_dispatches_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      device_registrations: {
        Row: {
          app_version: string | null;
          app_version_seen_at: string | null;
          color: string | null;
          company_id: string;
          created_at: string;
          device_number: number | null;
          executes_web_operations: boolean;
          health_collected_at: string | null;
          health_last_error: string | null;
          health_oldest_pending_at: string | null;
          health_queue_blocked: number | null;
          health_queue_pending: number | null;
          id: string;
          installation_id: string | null;
          is_active: boolean;
          is_price_master: boolean;
          last_seen_at: string | null;
          name: string;
          token_hash: string;
          unit_id: string;
          update_channel: string;
          update_notice_seen_at: string | null;
          update_notice_sent_at: string | null;
          update_notice_version: string | null;
          updated_at: string;
          web_executor_seen_at: string | null;
        };
        Insert: {
          app_version?: string | null;
          app_version_seen_at?: string | null;
          color?: string | null;
          company_id: string;
          created_at?: string;
          device_number?: number | null;
          executes_web_operations?: boolean;
          health_collected_at?: string | null;
          health_last_error?: string | null;
          health_oldest_pending_at?: string | null;
          health_queue_blocked?: number | null;
          health_queue_pending?: number | null;
          id: string;
          installation_id?: string | null;
          is_active?: boolean;
          is_price_master?: boolean;
          last_seen_at?: string | null;
          name: string;
          token_hash: string;
          unit_id: string;
          update_channel?: string;
          update_notice_seen_at?: string | null;
          update_notice_sent_at?: string | null;
          update_notice_version?: string | null;
          updated_at?: string;
          web_executor_seen_at?: string | null;
        };
        Update: {
          app_version?: string | null;
          app_version_seen_at?: string | null;
          color?: string | null;
          company_id?: string;
          created_at?: string;
          device_number?: number | null;
          executes_web_operations?: boolean;
          health_collected_at?: string | null;
          health_last_error?: string | null;
          health_oldest_pending_at?: string | null;
          health_queue_blocked?: number | null;
          health_queue_pending?: number | null;
          id?: string;
          installation_id?: string | null;
          is_active?: boolean;
          is_price_master?: boolean;
          last_seen_at?: string | null;
          name?: string;
          token_hash?: string;
          unit_id?: string;
          update_channel?: string;
          update_notice_seen_at?: string | null;
          update_notice_sent_at?: string | null;
          update_notice_version?: string | null;
          updated_at?: string;
          web_executor_seen_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "device_registrations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_registrations_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      driver_carriers: {
        Row: {
          carrier_id: string;
          cloud_synced_at: string;
          company_id: string | null;
          created_at: string;
          driver_id: string;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          carrier_id: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          driver_id: string;
          id: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          carrier_id?: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_carriers_carrier_id_fkey";
            columns: ["carrier_id"];
            isOneToOne: false;
            referencedRelation: "carriers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_carriers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_carriers_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          }
        ];
      };
      drivers: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          document: string | null;
          id: string;
          is_active: boolean;
          is_independent: boolean;
          name: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          document?: string | null;
          id: string;
          is_active?: boolean;
          is_independent?: boolean;
          name: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          document?: string | null;
          id?: string;
          is_active?: boolean;
          is_independent?: boolean;
          name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      financial_report_dispatches: {
        Row: {
          company_id: string;
          dispatched_at: string;
          id: string;
          last_error: string | null;
          recipients_count: number;
          report_date: string;
          schedule_hour: number | null;
          status: string;
        };
        Insert: {
          company_id: string;
          dispatched_at?: string;
          id?: string;
          last_error?: string | null;
          recipients_count: number;
          report_date: string;
          schedule_hour?: number | null;
          status: string;
        };
        Update: {
          company_id?: string;
          dispatched_at?: string;
          id?: string;
          last_error?: string | null;
          recipients_count?: number;
          report_date?: string;
          schedule_hour?: number | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_report_dispatches_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      loading_requests: {
        Row: {
          closed_at: string | null;
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_name: string;
          driver_name: string;
          entry_weight_kg: number | null;
          id: string;
          loader_completed_at: string | null;
          operation_id: string;
          plate: string;
          product_description: string;
          status: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          closed_at?: string | null;
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_name: string;
          driver_name: string;
          entry_weight_kg?: number | null;
          id: string;
          loader_completed_at?: string | null;
          operation_id: string;
          plate: string;
          product_description: string;
          status: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          closed_at?: string | null;
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_name?: string;
          driver_name?: string;
          entry_weight_kg?: number | null;
          id?: string;
          loader_completed_at?: string | null;
          operation_id?: string;
          plate?: string;
          product_description?: string;
          status?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "loading_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loading_requests_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "weighing_operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loading_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      omie_missing_documents: {
        Row: {
          company_id: string;
          detected_at: string;
          id: string;
          last_seen_at: string;
          omie_order_id: number;
          operation_id: string | null;
          order_type: string;
        };
        Insert: {
          company_id: string;
          detected_at?: string;
          id?: string;
          last_seen_at?: string;
          omie_order_id: number;
          operation_id?: string | null;
          order_type: string;
        };
        Update: {
          company_id?: string;
          detected_at?: string;
          id?: string;
          last_seen_at?: string;
          omie_order_id?: number;
          operation_id?: string | null;
          order_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "omie_missing_documents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      operation_request_pings: {
        Row: {
          requested_at: string;
          unit_id: string;
        };
        Insert: {
          requested_at?: string;
          unit_id: string;
        };
        Update: {
          requested_at?: string;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operation_request_pings_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: true;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      operation_requests: {
        Row: {
          claimed_at: string | null;
          claimed_by_device_id: string | null;
          company_id: string;
          created_at: string;
          id: string;
          kind: string;
          operation_id: string;
          payload: Json;
          print_message: string | null;
          print_status: string | null;
          processed_at: string | null;
          requested_at: string;
          requested_by: string | null;
          requested_by_name: string | null;
          result: Json | null;
          result_message: string | null;
          status: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          claimed_at?: string | null;
          claimed_by_device_id?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          operation_id: string;
          payload?: Json;
          print_message?: string | null;
          print_status?: string | null;
          processed_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          result?: Json | null;
          result_message?: string | null;
          status?: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          claimed_at?: string | null;
          claimed_by_device_id?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          operation_id?: string;
          payload?: Json;
          print_message?: string | null;
          print_status?: string | null;
          processed_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          result?: Json | null;
          result_message?: string | null;
          status?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operation_requests_claimed_by_device_id_fkey";
            columns: ["claimed_by_device_id"];
            isOneToOne: false;
            referencedRelation: "device_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      payment_methods: {
        Row: {
          alias: string | null;
          cloud_synced_at: string;
          code: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          is_customer_credit: boolean;
          is_system: boolean;
          is_wallet: boolean;
          name: string;
          omie_code: string | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          alias?: string | null;
          cloud_synced_at?: string;
          code: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          is_customer_credit?: boolean;
          is_system?: boolean;
          is_wallet?: boolean;
          name: string;
          omie_code?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          alias?: string | null;
          cloud_synced_at?: string;
          code?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          is_customer_credit?: boolean;
          is_system?: boolean;
          is_wallet?: boolean;
          name?: string;
          omie_code?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_methods_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      payment_terms: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          name: string;
          omie_code: string | null;
          rules_json: Json;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          name: string;
          omie_code?: string | null;
          rules_json?: Json;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          omie_code?: string | null;
          rules_json?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_terms_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      price_password_failures: {
        Row: {
          attempted_at: string;
          company_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          attempted_at?: string;
          company_id: string;
          id?: string;
          user_id: string;
        };
        Update: {
          attempted_at?: string;
          company_id?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "price_password_failures_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_password_failures_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      price_table_items: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          price_table_id: string;
          product_id: string;
          unit: string;
          unit_price_cents: number;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          price_table_id: string;
          product_id: string;
          unit?: string;
          unit_price_cents: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          price_table_id?: string;
          product_id?: string;
          unit?: string;
          unit_price_cents?: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "price_table_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_table_items_price_table_id_fkey";
            columns: ["price_table_id"];
            isOneToOne: false;
            referencedRelation: "price_tables";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_table_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      price_tables: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "price_tables_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      print_receipts: {
        Row: {
          cloud_synced_at: string;
          content_snapshot_json: Json;
          copy_number: number;
          created_at: string;
          device_number: number | null;
          error_message: string | null;
          id: string;
          operation_id: string;
          printed_at: string | null;
          printer_name: string | null;
          receipt_number: number;
          status: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          cloud_synced_at?: string;
          content_snapshot_json?: Json;
          copy_number?: number;
          created_at?: string;
          device_number?: number | null;
          error_message?: string | null;
          id: string;
          operation_id: string;
          printed_at?: string | null;
          printer_name?: string | null;
          receipt_number: number;
          status: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          cloud_synced_at?: string;
          content_snapshot_json?: Json;
          copy_number?: number;
          created_at?: string;
          device_number?: number | null;
          error_message?: string | null;
          id?: string;
          operation_id?: string;
          printed_at?: string | null;
          printer_name?: string | null;
          receipt_number?: number;
          status?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "print_receipts_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "weighing_operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_receipts_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      product_default_prices: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          product_id: string;
          sync_version: number;
          unit: string;
          unit_price_cents: number;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          is_active?: boolean;
          product_id: string;
          sync_version?: number;
          unit?: string;
          unit_price_cents: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          product_id?: string;
          sync_version?: number;
          unit?: string;
          unit_price_cents?: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_default_prices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_default_prices_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      products: {
        Row: {
          blocked: boolean;
          brand: string | null;
          cest: string | null;
          cloud_synced_at: string;
          code: string;
          company_id: string;
          created_at: string;
          depth_m: number | null;
          description: string;
          detailed_description: string | null;
          ean: string | null;
          family_code: string | null;
          family_description: string | null;
          fiscal_recommendations_json: Json | null;
          gross_weight_kg: number | null;
          height_m: number | null;
          icms_origin: string | null;
          id: string;
          internal_notes: string | null;
          is_active: boolean;
          item_type: string | null;
          model: string | null;
          ncm: string | null;
          net_weight_kg: number | null;
          omie_integration_code: string | null;
          omie_product_id: number | null;
          tracks_stock: boolean;
          unit: string;
          unit_price_cents: number | null;
          updated_at: string;
          updated_from_omie_at: string | null;
          width_m: number | null;
        };
        Insert: {
          blocked?: boolean;
          brand?: string | null;
          cest?: string | null;
          cloud_synced_at?: string;
          code: string;
          company_id: string;
          created_at?: string;
          depth_m?: number | null;
          description: string;
          detailed_description?: string | null;
          ean?: string | null;
          family_code?: string | null;
          family_description?: string | null;
          fiscal_recommendations_json?: Json | null;
          gross_weight_kg?: number | null;
          height_m?: number | null;
          icms_origin?: string | null;
          id: string;
          internal_notes?: string | null;
          is_active?: boolean;
          item_type?: string | null;
          model?: string | null;
          ncm?: string | null;
          net_weight_kg?: number | null;
          omie_integration_code?: string | null;
          omie_product_id?: number | null;
          tracks_stock?: boolean;
          unit?: string;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_from_omie_at?: string | null;
          width_m?: number | null;
        };
        Update: {
          blocked?: boolean;
          brand?: string | null;
          cest?: string | null;
          cloud_synced_at?: string;
          code?: string;
          company_id?: string;
          created_at?: string;
          depth_m?: number | null;
          description?: string;
          detailed_description?: string | null;
          ean?: string | null;
          family_code?: string | null;
          family_description?: string | null;
          fiscal_recommendations_json?: Json | null;
          gross_weight_kg?: number | null;
          height_m?: number | null;
          icms_origin?: string | null;
          id?: string;
          internal_notes?: string | null;
          is_active?: boolean;
          item_type?: string | null;
          model?: string | null;
          ncm?: string | null;
          net_weight_kg?: number | null;
          omie_integration_code?: string | null;
          omie_product_id?: number | null;
          tracks_stock?: boolean;
          unit?: string;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_from_omie_at?: string | null;
          width_m?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      quotations: {
        Row: {
          company_id: string;
          consumed_operation_id: string | null;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          estimated_quantity_kg: number;
          id: string;
          notes: string | null;
          payment_term_id: string | null;
          product_id: string;
          status: string;
          sync_version: number;
          unit_price_cents: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          consumed_operation_id?: string | null;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          estimated_quantity_kg: number;
          id: string;
          notes?: string | null;
          payment_term_id?: string | null;
          product_id: string;
          status?: string;
          sync_version?: number;
          unit_price_cents: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          consumed_operation_id?: string | null;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          estimated_quantity_kg?: number;
          id?: string;
          notes?: string | null;
          payment_term_id?: string | null;
          product_id?: string;
          status?: string;
          sync_version?: number;
          unit_price_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_consumed_operation_id_fkey";
            columns: ["consumed_operation_id"];
            isOneToOne: false;
            referencedRelation: "weighing_operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      report_channel_settings: {
        Row: {
          company_id: string;
          smtp_host: string | null;
          smtp_password: string | null;
          smtp_port: number | null;
          smtp_sender: string | null;
          smtp_user: string | null;
          updated_at: string;
          whatsapp_instance_name: string | null;
          whatsapp_instance_token: string | null;
          whatsapp_status: string | null;
          whatsapp_url: string | null;
        };
        Insert: {
          company_id: string;
          smtp_host?: string | null;
          smtp_password?: string | null;
          smtp_port?: number | null;
          smtp_sender?: string | null;
          smtp_user?: string | null;
          updated_at?: string;
          whatsapp_instance_name?: string | null;
          whatsapp_instance_token?: string | null;
          whatsapp_status?: string | null;
          whatsapp_url?: string | null;
        };
        Update: {
          company_id?: string;
          smtp_host?: string | null;
          smtp_password?: string | null;
          smtp_port?: number | null;
          smtp_sender?: string | null;
          smtp_user?: string | null;
          updated_at?: string;
          whatsapp_instance_name?: string | null;
          whatsapp_instance_token?: string | null;
          whatsapp_status?: string | null;
          whatsapp_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_channel_settings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      report_recipients: {
        Row: {
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          display_name: string | null;
          email: string | null;
          financial_schedule_time: string | null;
          id: string;
          is_active: boolean;
          report_types: string;
          schedule_frequency: string;
          schedule_time: string;
          send_email: boolean;
          send_financial: boolean;
          send_whatsapp: boolean;
          updated_at: string;
          whatsapp_phone: string | null;
        };
        Insert: {
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          display_name?: string | null;
          email?: string | null;
          financial_schedule_time?: string | null;
          id?: string;
          is_active?: boolean;
          report_types?: string;
          schedule_frequency?: string;
          schedule_time?: string;
          send_email?: boolean;
          send_financial?: boolean;
          send_whatsapp?: boolean;
          updated_at?: string;
          whatsapp_phone?: string | null;
        };
        Update: {
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          display_name?: string | null;
          email?: string | null;
          financial_schedule_time?: string | null;
          id?: string;
          is_active?: boolean;
          report_types?: string;
          schedule_frequency?: string;
          schedule_time?: string;
          send_email?: boolean;
          send_financial?: boolean;
          send_whatsapp?: boolean;
          updated_at?: string;
          whatsapp_phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_recipients_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      units: {
        Row: {
          avg_quarry_minutes: number | null;
          company_id: string;
          created_at: string;
          desktop_activation_code: string | null;
          desktop_activation_code_hash: string | null;
          desktop_activation_code_rotated_at: string | null;
          desktop_publishable_key: string | null;
          id: string;
          is_active: boolean;
          name: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          avg_quarry_minutes?: number | null;
          company_id: string;
          created_at?: string;
          desktop_activation_code?: string | null;
          desktop_activation_code_hash?: string | null;
          desktop_activation_code_rotated_at?: string | null;
          desktop_publishable_key?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          avg_quarry_minutes?: number | null;
          company_id?: string;
          created_at?: string;
          desktop_activation_code?: string | null;
          desktop_activation_code_hash?: string | null;
          desktop_activation_code_rotated_at?: string | null;
          desktop_publishable_key?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      user_password_vault: {
        Row: {
          ciphertext: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ciphertext: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ciphertext?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_password_vault_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      user_profiles: {
        Row: {
          company_id: string;
          created_at: string;
          device_id: string | null;
          email: string;
          id: string;
          is_active: boolean;
          name: string;
          requires_price_password: boolean;
          role: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          device_id?: string | null;
          email: string;
          id: string;
          is_active?: boolean;
          name: string;
          requires_price_password?: boolean;
          role: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          device_id?: string | null;
          email?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          requires_price_password?: boolean;
          role?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_profiles_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "device_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_profiles_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      vehicle_carriers: {
        Row: {
          carrier_id: string;
          cloud_synced_at: string;
          company_id: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          updated_at: string;
          vehicle_id: string;
        };
        Insert: {
          carrier_id: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          id: string;
          is_active?: boolean;
          updated_at?: string;
          vehicle_id: string;
        };
        Update: {
          carrier_id?: string;
          cloud_synced_at?: string;
          company_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicle_carriers_carrier_id_fkey";
            columns: ["carrier_id"];
            isOneToOne: false;
            referencedRelation: "carriers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicle_carriers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicle_carriers_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          }
        ];
      };
      vehicles: {
        Row: {
          carrier_id: string | null;
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          plate: string;
          updated_at: string;
        };
        Insert: {
          carrier_id?: string | null;
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          description?: string | null;
          id: string;
          is_active?: boolean;
          plate: string;
          updated_at?: string;
        };
        Update: {
          carrier_id?: string | null;
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          plate?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_carrier_id_fkey";
            columns: ["carrier_id"];
            isOneToOne: false;
            referencedRelation: "carriers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      weighing_operations: {
        Row: {
          applied_price_table_id: string | null;
          applied_price_table_item_id: string | null;
          applied_price_table_name: string | null;
          base_unit_price_cents: number | null;
          cancel_reason: string | null;
          carrier_id: string | null;
          carrier_name: string | null;
          closed_at: string | null;
          cloud_synced_at: string;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          deduct_freight_from_credit: boolean;
          device_id: string | null;
          driver_name: string | null;
          entry_weight_kg: number | null;
          exit_weight_kg: number | null;
          freight_credit_debit_cents: number;
          freight_json: string | null;
          freight_total_cents: number;
          freight_type: string;
          future_billing_invoice_id: string | null;
          future_billing_nfe_number: string | null;
          id: string;
          net_weight_kg: number | null;
          omie_advance_settle_cents: number | null;
          omie_billing_message: string | null;
          omie_billing_status: string | null;
          omie_invoice_number: string | null;
          omie_sales_order_id: number | null;
          omie_service_order_id: number | null;
          operation_code: number | null;
          operation_type: string;
          payment_method_id: string | null;
          payment_term_id: string | null;
          plate: string | null;
          price_savings_percent: number | null;
          price_unit: string;
          product_credit_debit_cents: number;
          product_description: string | null;
          product_id: string | null;
          product_total_cents: number | null;
          quotation_id: string | null;
          settle_from_advance: boolean | null;
          status: string;
          synced_at: string | null;
          total_cents: number | null;
          unit_id: string;
          unit_price_cents: number | null;
          updated_at: string;
          wallet_settled_at: string | null;
          wallet_settlement_due_date: string | null;
          wallet_settlement_method_id: string | null;
          wallet_settlement_note: string | null;
        };
        Insert: {
          applied_price_table_id?: string | null;
          applied_price_table_item_id?: string | null;
          applied_price_table_name?: string | null;
          base_unit_price_cents?: number | null;
          cancel_reason?: string | null;
          carrier_id?: string | null;
          carrier_name?: string | null;
          closed_at?: string | null;
          cloud_synced_at?: string;
          company_id: string;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          deduct_freight_from_credit?: boolean;
          device_id?: string | null;
          driver_name?: string | null;
          entry_weight_kg?: number | null;
          exit_weight_kg?: number | null;
          freight_credit_debit_cents?: number;
          freight_json?: string | null;
          freight_total_cents?: number;
          freight_type?: string;
          future_billing_invoice_id?: string | null;
          future_billing_nfe_number?: string | null;
          id: string;
          net_weight_kg?: number | null;
          omie_advance_settle_cents?: number | null;
          omie_billing_message?: string | null;
          omie_billing_status?: string | null;
          omie_invoice_number?: string | null;
          omie_sales_order_id?: number | null;
          omie_service_order_id?: number | null;
          operation_code?: number | null;
          operation_type: string;
          payment_method_id?: string | null;
          payment_term_id?: string | null;
          plate?: string | null;
          price_savings_percent?: number | null;
          price_unit?: string;
          product_credit_debit_cents?: number;
          product_description?: string | null;
          product_id?: string | null;
          product_total_cents?: number | null;
          quotation_id?: string | null;
          settle_from_advance?: boolean | null;
          status: string;
          synced_at?: string | null;
          total_cents?: number | null;
          unit_id: string;
          unit_price_cents?: number | null;
          updated_at?: string;
          wallet_settled_at?: string | null;
          wallet_settlement_due_date?: string | null;
          wallet_settlement_method_id?: string | null;
          wallet_settlement_note?: string | null;
        };
        Update: {
          applied_price_table_id?: string | null;
          applied_price_table_item_id?: string | null;
          applied_price_table_name?: string | null;
          base_unit_price_cents?: number | null;
          cancel_reason?: string | null;
          carrier_id?: string | null;
          carrier_name?: string | null;
          closed_at?: string | null;
          cloud_synced_at?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          deduct_freight_from_credit?: boolean;
          device_id?: string | null;
          driver_name?: string | null;
          entry_weight_kg?: number | null;
          exit_weight_kg?: number | null;
          freight_credit_debit_cents?: number;
          freight_json?: string | null;
          freight_total_cents?: number;
          freight_type?: string;
          future_billing_invoice_id?: string | null;
          future_billing_nfe_number?: string | null;
          id?: string;
          net_weight_kg?: number | null;
          omie_advance_settle_cents?: number | null;
          omie_billing_message?: string | null;
          omie_billing_status?: string | null;
          omie_invoice_number?: string | null;
          omie_sales_order_id?: number | null;
          omie_service_order_id?: number | null;
          operation_code?: number | null;
          operation_type?: string;
          payment_method_id?: string | null;
          payment_term_id?: string | null;
          plate?: string | null;
          price_savings_percent?: number | null;
          price_unit?: string;
          product_credit_debit_cents?: number;
          product_description?: string | null;
          product_id?: string | null;
          product_total_cents?: number | null;
          quotation_id?: string | null;
          settle_from_advance?: boolean | null;
          status?: string;
          synced_at?: string | null;
          total_cents?: number | null;
          unit_id?: string;
          unit_price_cents?: number | null;
          updated_at?: string;
          wallet_settled_at?: string | null;
          wallet_settlement_due_date?: string | null;
          wallet_settlement_method_id?: string | null;
          wallet_settlement_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "weighing_operations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weighing_operations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weighing_operations_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "device_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weighing_operations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weighing_operations_quotation_id_fkey";
            columns: ["quotation_id"];
            isOneToOne: false;
            referencedRelation: "quotations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weighing_operations_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
      whatsapp_connection_links: {
        Row: {
          company_id: string;
          connected_at: string | null;
          created_at: string;
          device_id: string | null;
          expires_at: string;
          id: string;
          last_opened_at: string | null;
          open_count: number;
          revoked_at: string | null;
          token_hash: string;
          unit_id: string | null;
        };
        Insert: {
          company_id: string;
          connected_at?: string | null;
          created_at?: string;
          device_id?: string | null;
          expires_at: string;
          id?: string;
          last_opened_at?: string | null;
          open_count?: number;
          revoked_at?: string | null;
          token_hash: string;
          unit_id?: string | null;
        };
        Update: {
          company_id?: string;
          connected_at?: string | null;
          created_at?: string;
          device_id?: string | null;
          expires_at?: string;
          id?: string;
          last_opened_at?: string | null;
          open_count?: number;
          revoked_at?: string | null;
          token_hash?: string;
          unit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_connection_links_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_connection_links_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "device_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_connection_links_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assign_device_number: { Args: { p_device_id: string }; Returns: number };
      delete_company: {
        Args: { target_company_id: string };
        Returns: undefined;
      };
      delete_unit: { Args: { target_unit_id: string }; Returns: undefined };
      desktop_pull_cadastro_delta: {
        Args: { p_company_id: string; p_limit?: number; p_since: string };
        Returns: Json;
      };
      get_cron_secret: { Args: never; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {}
  }
} as const;
