-- One row per approval stage, from docs/demo-spec.md section 2.3.
-- Columns are the fields of ApprovalRow in src/hubdemo/models.py.
-- The stage names and the number of stages come from the approval policy in
-- the scenario file at run time, so no stage name is written here.
CREATE TABLE [dbo].[approvals]
(
    [approval_id] NVARCHAR(64)   NOT NULL,
    [plan_id]     NVARCHAR(64)   NOT NULL,
    -- Stage name as written by the approval policy, for example stage_1.
    [stage]       NVARCHAR(32)   NOT NULL,
    -- Role or user principal name of the approver.
    [approver]    NVARCHAR(128)  NOT NULL,
    [decision]    NVARCHAR(16)   NOT NULL,
    [decided_at]  DATETIME2(0)   NULL,
    [comment]     NVARCHAR(1024) NULL,
    CONSTRAINT [PK_approvals] PRIMARY KEY ([approval_id]),
    CONSTRAINT [FK_approvals_plans] FOREIGN KEY ([plan_id])
        REFERENCES [dbo].[plans] ([plan_id]),
    CONSTRAINT [CK_approvals_decision] CHECK ([decision] IN (
        'pending', 'approved', 'rejected', 'expired'
    )),
    -- A plan has at most one row per stage.
    CONSTRAINT [UQ_approvals_plan_stage] UNIQUE ([plan_id], [stage])
);
