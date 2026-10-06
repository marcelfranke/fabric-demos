-- One row per dispatched action, from docs/demo-spec.md section 2.3.
-- Columns are the fields of ActionRow in src/hubdemo/models.py.
-- Rows are written only by the dispatch_actions function, which refuses to
-- write unless every stage the approval policy requires has an approved row in
-- dbo.approvals for the plan. That check is built in phase 7 and lives in the
-- function, not in an agent.
-- [text] is quoted because text is an old T-SQL type name.
CREATE TABLE [dbo].[actions]
(
    [action_id] NVARCHAR(64)   NOT NULL,
    [plan_id]   NVARCHAR(64)   NOT NULL,
    -- Role or user principal name the action was sent to.
    [recipient] NVARCHAR(128)  NOT NULL,
    [text]      NVARCHAR(MAX)  NOT NULL,
    [sent_at]   DATETIME2(0)   NOT NULL,
    [status]    NVARCHAR(32)   NOT NULL,
    CONSTRAINT [PK_actions] PRIMARY KEY ([action_id]),
    CONSTRAINT [FK_actions_plans] FOREIGN KEY ([plan_id])
        REFERENCES [dbo].[plans] ([plan_id])
);
