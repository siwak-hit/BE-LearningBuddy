CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(50) NOT NULL,
    file_name   VARCHAR(50),
    file_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_chunks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_text   TEXT NOT NULL,
    chunk_index  INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_chunks_document_id ON document_chunks(document_id);

CREATE TABLE lms_course_routes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rest_endpoint  VARCHAR(255) NOT NULL,
    token          VARCHAR(255) NOT NULL,
    course_id      BIGINT NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moodle_students (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moodle_user_id BIGINT NOT NULL,
    fullname       VARCHAR(100),
    email          VARCHAR(255) NOT NULL,
    username       VARCHAR(100),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_moodle_students_user UNIQUE (moodle_user_id)
);

CREATE INDEX idx_moodle_students_email ON moodle_students(lower(email));

CREATE TABLE ai_response_cache (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_text  TEXT NOT NULL,
    answer_text    TEXT NOT NULL,
    embedding      TEXT,
    intent         VARCHAR(30),
    context_hash   VARCHAR(64),
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_response_cache_hash ON ai_response_cache(context_hash);

CREATE TABLE chat_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ
);

CREATE TABLE chat_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role          VARCHAR(20) NOT NULL,
    content       TEXT NOT NULL,
    is_understood BOOLEAN,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);

CREATE TABLE student_content_progress (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID,
    moodle_user_id   BIGINT NOT NULL,
    course_id        BIGINT NOT NULL,
    completed_cmids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    completion_total INTEGER NOT NULL DEFAULT 0,
    last_synced_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_progress_user_course UNIQUE (moodle_user_id, course_id)
);

CREATE INDEX idx_progress_user ON student_content_progress(moodle_user_id);
