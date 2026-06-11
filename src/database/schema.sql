-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  school_name text,
  course_name text,
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT projects_pkey PRIMARY KEY (id)
);
CREATE TABLE public.widget_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  project_key text NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'floating'::text,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  position text NOT NULL DEFAULT 'bottom-right'::text,
  allowed_origin ARRAY NOT NULL DEFAULT '{}'::text[],
  read_dom_context boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  access_mode text NOT NULL DEFAULT 'both'::text,
  active_from timestamp with time zone,
  active_until timestamp with time zone,
  CONSTRAINT widget_configs_pkey PRIMARY KEY (id),
  CONSTRAINT widget_configs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  title text NOT NULL,
  topic text,
  file_name text,
  file_url text,
  file_type text,
  source_type text DEFAULT 'upload'::text,
  status text NOT NULL DEFAULT 'uploaded'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.document_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid,
  project_id uuid NOT NULL,
  chunk_text text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  topic text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT document_chunks_pkey PRIMARY KEY (id),
  CONSTRAINT document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id),
  CONSTRAINT document_chunks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  category text,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT faqs_pkey PRIMARY KEY (id),
  CONSTRAINT faqs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.activity_instructions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  activity_type text,
  title text NOT NULL,
  topic text,
  instruction text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline timestamp with time zone,
  completion_criteria text,
  confusing_points text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  default_page_type text DEFAULT 'course'::text,
  default_navigation_status text DEFAULT 'course_only'::text,
  default_target_url text,
  moodle_activity_type text,
  moodle_module_id integer,
  CONSTRAINT activity_instructions_pkey PRIMARY KEY (id),
  CONSTRAINT activity_instructions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.chat_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  session_key text NOT NULL UNIQUE,
  student_alias text,
  source_url text,
  course_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  CONSTRAINT chat_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT chat_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  role text NOT NULL,
  message text NOT NULL,
  context_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  intent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id)
);
CREATE TABLE public.moderation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid,
  message_id uuid,
  type text,
  severity text,
  status text DEFAULT 'detected'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT moderation_logs_pkey PRIMARY KEY (id),
  CONSTRAINT moderation_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id),
  CONSTRAINT moderation_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  role text NOT NULL DEFAULT 'teacher'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.page_question_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  page_type text NOT NULL,
  page_match_type text NOT NULL,
  page_match_value text NOT NULL,
  allowed_intents text,
  blocked_intents text,
  fallback_message text,
  priority integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT page_question_rules_pkey PRIMARY KEY (id),
  CONSTRAINT page_question_rules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.action_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  action_key text NOT NULL,
  intent text NOT NULL,
  trigger_keywords text,
  page_type text,
  response_message text NOT NULL,
  action_type text NOT NULL,
  action_label text,
  target_url text,
  target_selector text,
  step_order integer DEFAULT 1,
  next_action_key text,
  requires_confirmation boolean DEFAULT false,
  source_type text DEFAULT 'manual'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT action_rules_pkey PRIMARY KEY (id),
  CONSTRAINT action_rules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.question_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  page_type text NOT NULL,
  trigger_word text NOT NULL,
  suggestion_text text NOT NULL,
  intent text,
  action_key text,
  priority integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT question_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT question_suggestions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.page_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  page_type text NOT NULL,
  template_name text NOT NULL,
  match_url_contains text,
  match_title_contains text,
  match_heading_contains text,
  html_preview text,
  elements_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  tutorial_steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_suggestions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  accessibility_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT page_templates_pkey PRIMARY KEY (id),
  CONSTRAINT page_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.lms_course_routes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  class_code text NOT NULL,
  course_id integer NOT NULL,
  course_url text NOT NULL,
  course_title text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lms_course_routes_pkey PRIMARY KEY (id),
  CONSTRAINT lms_course_routes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.lms_activity_routes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  activity_instruction_id uuid,
  class_code text NOT NULL,
  course_id integer NOT NULL,
  activity_type text,
  activity_title text NOT NULL,
  moodle_activity_type text,
  moodle_module_id integer,
  activity_url text NOT NULL,
  source_page_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lms_activity_routes_pkey PRIMARY KEY (id),
  CONSTRAINT lms_activity_routes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT lms_activity_routes_activity_instruction_id_fkey FOREIGN KEY (activity_instruction_id) REFERENCES public.activity_instructions(id)
);
