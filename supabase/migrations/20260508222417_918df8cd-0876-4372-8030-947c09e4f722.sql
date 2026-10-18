CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    actor_role text,
    action text NOT NULL,
    target_type text,
    target_id text,
    summary text DEFAULT ''::text NOT NULL,
    old_values jsonb,
    new_values jsonb,
    severity public.activity_severity DEFAULT 'info'::public.activity_severity NOT NULL,
    ip_address text,
    user_agent text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_run_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    user_id uuid NOT NULL,
    step_index integer NOT NULL,
    step_type text NOT NULL,
    agent_name text DEFAULT 'main'::text NOT NULL,
    tool_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    attempt_count integer DEFAULT 0 NOT NULL,
    parent_step_id uuid,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    parent_message_id uuid,
    mode text DEFAULT 'edit'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    plan jsonb DEFAULT '[]'::jsonb NOT NULL,
    plan_approved boolean DEFAULT false NOT NULL,
    model text DEFAULT 'google/gemini-3-flash-preview'::text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    context_summary text,
    error_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    events jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_event_seq integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.agent_turn_continuations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    model text NOT NULL,
    conversation jsonb NOT NULL,
    files_changed jsonb DEFAULT '[]'::jsonb NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_turn_events (
    id bigint NOT NULL,
    continuation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    seq integer NOT NULL,
    event jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.agent_turn_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.agent_turn_events_id_seq OWNED BY public.agent_turn_events.id;

CREATE TABLE public.ai_response_cache (
    cache_key text NOT NULL,
    model text NOT NULL,
    response jsonb NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_hit_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL
);

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    variant text DEFAULT 'info'::text NOT NULL,
    link_url text DEFAULT ''::text,
    link_label text DEFAULT ''::text,
    is_active boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.app_build_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    build_id uuid NOT NULL,
    step_key text NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    detail text,
    step_order integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.app_builds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    platform public.build_platform DEFAULT 'android'::public.build_platform NOT NULL,
    status public.build_status DEFAULT 'queued'::public.build_status NOT NULL,
    version_name text DEFAULT '1.0.0'::text NOT NULL,
    version_code integer DEFAULT 1 NOT NULL,
    app_name text DEFAULT 'My App'::text NOT NULL,
    package_id text DEFAULT 'app.lovable.generated'::text NOT NULL,
    github_run_id text,
    github_run_url text,
    download_url text,
    file_size_bytes bigint,
    error_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.app_settings (
    id boolean DEFAULT true NOT NULL,
    site_name text DEFAULT 'SmartApp'::text NOT NULL,
    site_logo_url text DEFAULT ''::text NOT NULL,
    contact_email text DEFAULT ''::text NOT NULL,
    contact_phone text DEFAULT ''::text NOT NULL,
    vat_percent numeric DEFAULT 0 NOT NULL,
    invoice_prefix text DEFAULT 'INV'::text NOT NULL,
    order_auto_reject_days integer DEFAULT 7 NOT NULL,
    maintenance_mode boolean DEFAULT false NOT NULL,
    maintenance_message text DEFAULT 'We are doing scheduled maintenance. Please check back soon.'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_settings_singleton CHECK ((id = true))
);

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    mode text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chat_messages_mode_check CHECK ((mode = ANY (ARRAY['plan'::text, 'agent'::text, 'generate'::text, 'edit'::text, 'chat'::text]))),
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

CREATE TABLE public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    delta integer NOT NULL,
    balance_after integer NOT NULL,
    source public.credit_source NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    reference_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.faqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    answer text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.feature_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flag_key text NOT NULL,
    user_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invoice_number text NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    vat_percent numeric DEFAULT 0 NOT NULL,
    vat_amount numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'BDT'::text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    link text DEFAULT ''::text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.order_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    flag_type public.fraud_flag_type NOT NULL,
    severity public.activity_severity DEFAULT 'warn'::public.activity_severity NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    details jsonb,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    package_id uuid NOT NULL,
    package_name text NOT NULL,
    amount numeric(10,2) NOT NULL,
    credits integer NOT NULL,
    payment_method public.payment_method_type NOT NULL,
    sender_account text DEFAULT ''::text,
    transaction_id text DEFAULT ''::text,
    crypto_currency text DEFAULT ''::text,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    admin_notes text DEFAULT ''::text,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    promo_code text,
    promo_discount numeric DEFAULT 0 NOT NULL,
    promo_bonus_credits integer DEFAULT 0 NOT NULL,
    refunded_at timestamp with time zone,
    refund_reason text DEFAULT ''::text,
    refunded_credits integer DEFAULT 0,
    ip_address text,
    user_agent text,
    device_fingerprint text,
    needs_review boolean DEFAULT false NOT NULL,
    risk_score integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    price numeric(10,2) NOT NULL,
    credits integer NOT NULL,
    is_popular boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT packages_credits_check CHECK ((credits >= 0)),
    CONSTRAINT packages_price_check CHECK ((price >= (0)::numeric))
);

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.payment_method_type NOT NULL,
    label text NOT NULL,
    account_number text NOT NULL,
    instructions text DEFAULT ''::text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text,
    avatar_url text,
    bio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chat_mode text DEFAULT 'agent'::text NOT NULL,
    CONSTRAINT profiles_chat_mode_check CHECK ((chat_mode = ANY (ARRAY['agent'::text, 'plan'::text])))
);

CREATE TABLE public.project_error_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    file_path text DEFAULT ''::text NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    error_stack text DEFAULT ''::text NOT NULL,
    fix_summary text DEFAULT ''::text NOT NULL,
    fix_kind text DEFAULT 'auto-heal'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.project_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    path text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.project_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    category text DEFAULT 'preference'::text NOT NULL,
    content text NOT NULL,
    source text DEFAULT 'auto'::text NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.project_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    app_name text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    screens jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_models jsonb DEFAULT '[]'::jsonb NOT NULL,
    approved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id text,
    run_status text DEFAULT 'idle'::text NOT NULL,
    pending_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    completed_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_completed_path text,
    last_checkpoint_at timestamp with time zone
);

CREATE TABLE public.project_supabase_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    supabase_project_ref text NOT NULL,
    supabase_project_name text DEFAULT ''::text NOT NULL,
    supabase_org_id text,
    supabase_region text,
    anon_key_encrypted text,
    service_role_key_encrypted text,
    api_url text,
    schema_cache jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_cached_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pinned boolean DEFAULT false NOT NULL
);

CREATE TABLE public.promo_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    discount_type public.promo_discount_type NOT NULL,
    discount_value numeric NOT NULL,
    min_amount numeric DEFAULT 0 NOT NULL,
    max_discount numeric,
    usage_limit integer,
    per_user_limit integer DEFAULT 1 NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    applicable_package_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    bonus_credits integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_codes_discount_value_check CHECK ((discount_value > (0)::numeric))
);

CREATE TABLE public.promo_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promo_id uuid NOT NULL,
    user_id uuid NOT NULL,
    order_id uuid,
    discount_amount numeric DEFAULT 0 NOT NULL,
    bonus_credits integer DEFAULT 0 NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.supabase_operation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    supabase_project_ref text,
    operation text NOT NULL,
    status text DEFAULT 'success'::text NOT NULL,
    request_summary text DEFAULT ''::text NOT NULL,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid,
    sender_type public.support_sender_type NOT NULL,
    sender_email text,
    body text NOT NULL,
    attachment_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subject text NOT NULL,
    status public.support_ticket_status DEFAULT 'open'::public.support_ticket_status NOT NULL,
    priority public.support_ticket_priority DEFAULT 'normal'::public.support_ticket_priority NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_preview text DEFAULT ''::text NOT NULL,
    last_sender public.support_sender_type DEFAULT 'user'::public.support_sender_type NOT NULL,
    user_unread_count integer DEFAULT 0 NOT NULL,
    admin_unread_count integer DEFAULT 0 NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_bans (
    user_id uuid NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    banned_by uuid NOT NULL,
    banned_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_credits (
    user_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    total_purchased integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_credits_balance_check CHECK ((balance >= 0))
);

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_supabase_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_token_encrypted text NOT NULL,
    refresh_token_encrypted text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    supabase_user_id text,
    supabase_email text,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_turn_events ALTER COLUMN id SET DEFAULT nextval('public.agent_turn_events_id_seq'::regclass);

ALTER TABLE ONLY public.activity_logs ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_run_steps ADD CONSTRAINT agent_run_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_runs ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_turn_continuations ADD CONSTRAINT agent_turn_continuations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_turn_events ADD CONSTRAINT agent_turn_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ai_response_cache ADD CONSTRAINT ai_response_cache_pkey PRIMARY KEY (cache_key);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_build_steps ADD CONSTRAINT app_build_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_builds ADD CONSTRAINT app_builds_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.credit_transactions ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.faqs ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feature_flags ADD CONSTRAINT feature_flags_flag_key_user_id_key UNIQUE (flag_key, user_id);
ALTER TABLE ONLY public.feature_flags ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.order_flags ADD CONSTRAINT order_flags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.packages ADD CONSTRAINT packages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_methods ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.project_error_history ADD CONSTRAINT project_error_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_files ADD CONSTRAINT project_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_files ADD CONSTRAINT project_files_project_id_path_key UNIQUE (project_id, path);
ALTER TABLE ONLY public.project_memory ADD CONSTRAINT project_memory_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_plans ADD CONSTRAINT project_plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_plans ADD CONSTRAINT project_plans_project_id_key UNIQUE (project_id);
ALTER TABLE ONLY public.project_supabase_links ADD CONSTRAINT project_supabase_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_supabase_links ADD CONSTRAINT project_supabase_links_project_id_key UNIQUE (project_id);
ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.promo_codes ADD CONSTRAINT promo_codes_code_key UNIQUE (code);
ALTER TABLE ONLY public.promo_codes ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.promo_redemptions ADD CONSTRAINT promo_redemptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.supabase_operation_logs ADD CONSTRAINT supabase_operation_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_messages ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_tickets ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_bans ADD CONSTRAINT user_bans_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.user_bans ADD CONSTRAINT user_bans_user_id_unique UNIQUE (user_id);
ALTER TABLE ONLY public.user_credits ADD CONSTRAINT user_credits_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE ONLY public.user_supabase_connections ADD CONSTRAINT user_supabase_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_supabase_connections ADD CONSTRAINT user_supabase_connections_user_id_key UNIQUE (user_id);

CREATE INDEX idx_activity_logs_action ON public.activity_logs USING btree (action);
CREATE INDEX idx_activity_logs_actor ON public.activity_logs USING btree (actor_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs USING btree (created_at DESC);
CREATE INDEX idx_activity_logs_severity ON public.activity_logs USING btree (severity);
CREATE INDEX idx_activity_logs_target ON public.activity_logs USING btree (target_type, target_id);
CREATE INDEX idx_agent_run_steps_run ON public.agent_run_steps USING btree (run_id, step_index);
CREATE INDEX idx_agent_run_steps_user ON public.agent_run_steps USING btree (user_id, created_at DESC);
CREATE INDEX idx_agent_runs_status ON public.agent_runs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
CREATE INDEX idx_agent_runs_user_project ON public.agent_runs USING btree (user_id, project_id, created_at DESC);
CREATE INDEX idx_agent_turn_continuations_project ON public.agent_turn_continuations USING btree (project_id, created_at DESC);
CREATE INDEX idx_agent_turn_continuations_user ON public.agent_turn_continuations USING btree (user_id, created_at DESC);
CREATE INDEX idx_agent_turn_events_continuation ON public.agent_turn_events USING btree (continuation_id, seq);
CREATE INDEX idx_ai_cache_expires ON public.ai_response_cache USING btree (expires_at);
CREATE INDEX idx_announcements_active ON public.announcements USING btree (is_active, starts_at, expires_at, sort_order);
CREATE INDEX idx_app_build_steps_build ON public.app_build_steps USING btree (build_id, step_order);
CREATE INDEX idx_app_builds_project ON public.app_builds USING btree (project_id, created_at DESC);
CREATE INDEX idx_app_builds_run ON public.app_builds USING btree (github_run_id);
CREATE INDEX idx_app_builds_user ON public.app_builds USING btree (user_id, created_at DESC);
CREATE INDEX idx_chat_messages_project_created ON public.chat_messages USING btree (project_id, created_at);
CREATE INDEX idx_credit_tx_created ON public.credit_transactions USING btree (created_at DESC);
CREATE INDEX idx_credit_tx_source ON public.credit_transactions USING btree (source);
CREATE INDEX idx_credit_tx_user ON public.credit_transactions USING btree (user_id, created_at DESC);
CREATE INDEX idx_faqs_active ON public.faqs USING btree (is_active, category, sort_order);
CREATE INDEX idx_feature_flags_user_key ON public.feature_flags USING btree (user_id, flag_key) WHERE (enabled = true);
CREATE INDEX idx_files_project ON public.project_files USING btree (project_id);
CREATE INDEX idx_messages_project ON public.chat_messages USING btree (project_id, created_at);
CREATE INDEX idx_msgs_ticket ON public.support_messages USING btree (ticket_id, created_at);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id) WHERE (read = false);
CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_order_flags_order ON public.order_flags USING btree (order_id);
CREATE INDEX idx_order_flags_resolved ON public.order_flags USING btree (resolved, created_at DESC);
CREATE INDEX idx_order_flags_type ON public.order_flags USING btree (flag_type);
CREATE INDEX idx_order_flags_user ON public.order_flags USING btree (user_id);
CREATE INDEX idx_orders_ip_address ON public.orders USING btree (ip_address) WHERE (ip_address IS NOT NULL);
CREATE INDEX idx_orders_needs_review ON public.orders USING btree (needs_review) WHERE (needs_review = true);
CREATE INDEX idx_orders_sender_account ON public.orders USING btree (sender_account) WHERE ((sender_account IS NOT NULL) AND (sender_account <> ''::text));
CREATE INDEX idx_orders_transaction_id ON public.orders USING btree (transaction_id) WHERE ((transaction_id IS NOT NULL) AND (transaction_id <> ''::text));
CREATE INDEX idx_project_memory_agent_lookup ON public.project_memory USING btree (project_id, category) WHERE (source = 'agent'::text);
CREATE UNIQUE INDEX idx_project_memory_dedup ON public.project_memory USING btree (project_id, lower(content));
CREATE INDEX idx_project_memory_project ON public.project_memory USING btree (project_id, created_at DESC);
CREATE INDEX idx_project_supabase_links_user ON public.project_supabase_links USING btree (user_id);
CREATE INDEX idx_projects_user ON public.projects USING btree (user_id, updated_at DESC);
CREATE INDEX idx_promo_active ON public.promo_codes USING btree (is_active, expires_at);
CREATE INDEX idx_promo_code ON public.promo_codes USING btree (code);
CREATE INDEX idx_promo_red_promo ON public.promo_redemptions USING btree (promo_id);
CREATE INDEX idx_promo_red_user ON public.promo_redemptions USING btree (user_id);
CREATE INDEX idx_supabase_operation_logs_project ON public.supabase_operation_logs USING btree (project_id, created_at DESC);
CREATE INDEX idx_supabase_operation_logs_user ON public.supabase_operation_logs USING btree (user_id, created_at DESC);
CREATE INDEX idx_tickets_status ON public.support_tickets USING btree (status, last_message_at DESC);
CREATE INDEX idx_tickets_user ON public.support_tickets USING btree (user_id, last_message_at DESC);
CREATE INDEX invoices_order_id_idx ON public.invoices USING btree (order_id);
CREATE INDEX invoices_user_id_idx ON public.invoices USING btree (user_id);
CREATE INDEX project_error_history_project_idx ON public.project_error_history USING btree (project_id, created_at DESC);
CREATE INDEX project_plans_run_status_idx ON public.project_plans USING btree (run_status);
CREATE INDEX projects_pinned_updated_idx ON public.projects USING btree (pinned DESC, updated_at DESC);
CREATE UNIQUE INDEX uq_app_build_steps ON public.app_build_steps USING btree (build_id, step_key);