-- One row per proposed plan, from docs/demo-spec.md section 2.3.
-- Columns are the fields of PlanRow in src/hubdemo/models.py.
-- The six allowed statuses are PLAN_STATUSES in the same file.
CREATE TABLE [dbo].[plans]
(
    [plan_id]     NVARCHAR(64)   NOT NULL,
    -- Who proposed the plan: the rules engine, the operations agent or the
    -- planner agent.
    [proposed_by] NVARCHAR(64)   NOT NULL,
    [created_at]  DATETIME2(0)   NOT NULL,
    -- JSON, one option per onward flight, for example {"SIN": "hold"}.
    [options]     NVARCHAR(MAX)  NOT NULL,
    -- JSON. Computed in code by the rules engine, never by a model.
    [outcome]     NVARCHAR(MAX)  NOT NULL,
    [status]      NVARCHAR(32)   NOT NULL,
    CONSTRAINT [PK_plans] PRIMARY KEY ([plan_id]),
    CONSTRAINT [CK_plans_status] CHECK ([status] IN (
        'proposed', 'awaiting_approval', 'rejected',
        'expired', 'dispatched', 'superseded'
    ))
);
