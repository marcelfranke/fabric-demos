-- One row per refused dispatch attempt, from docs/demo-spec.md section 2.3.
-- Columns are the fields of SecurityEventRow in src/hubdemo/models.py.
-- A row here means dispatch_actions declined to write to dbo.actions, either
-- because the approvals were missing or because the caller was not allowed.
CREATE TABLE [dbo].[security_events]
(
    [security_event_id] NVARCHAR(64)   NOT NULL,
    [plan_id]           NVARCHAR(64)   NOT NULL,
    -- Who made the attempt: an agent, a user principal name or an app identity.
    [caller]            NVARCHAR(128)  NOT NULL,
    [reason]            NVARCHAR(512)  NOT NULL,
    [occurred_at]       DATETIME2(0)   NOT NULL,
    CONSTRAINT [PK_security_events] PRIMARY KEY ([security_event_id]),
    CONSTRAINT [FK_security_events_plans] FOREIGN KEY ([plan_id])
        REFERENCES [dbo].[plans] ([plan_id])
);
