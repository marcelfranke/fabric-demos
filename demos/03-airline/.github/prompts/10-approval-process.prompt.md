---
description: "Phase 10: Approval process"
---
# Phase 10: Approval process

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** A two-stage approval in Teams, driven by the policy, that is the only path to dispatching actions.

## Task

Build the approval workflow as an Azure Logic App defined in Bicep. Fetch the Teams connector reference (action "Post adaptive card and wait for a response"), the Logic Apps security article (authorization policy on the request trigger, managed identity with an audience on HTTP actions) and the Bicep reference for Logic Apps and API connections.

1. `infra/approval.bicep`: the Logic App `logic-hub-approval` with an HTTP trigger protected by Microsoft Entra authentication, a Teams connection, and a managed identity.
2. Workflow:
   - input: `plan_id`
   - read the plan with `get_run_record`; set the plan to `awaiting_approval`
   - for each required stage, in order: post the adaptive card to the approver from the configuration and wait, up to the timeout in the policy; store the answer with `record_decision`, with the person who answered the card as approver, taken from the response of the Teams action. If the response does not identify who answered, stop and report it; do not fall back to the name in the configuration
   - a rejection or a timeout ends the workflow; post "Nothing was sent" to the channel
   - after the last approval call `dispatch_actions` and post the list of actions to the channel
3. `infra/approval/cards/plan_card.json`: headline, one line per connection, the two summary sentences from the rules engine, the stage ("Approval 1 of 2"), and the buttons Approve and Reject. No free-text field that changes the plan.
4. Changing a plan happens in conversation with the planner agent, which creates a new plan and submits it again; the old plan becomes `superseded` and its card says so.
5. Replace the stub in `submit_plan_for_approval` with the call to this workflow.
6. `scripts/simulate_approval.py --plan <id> [--reject-at <stage>]`: records decisions and dispatches without Teams, marked as simulated, for tests.
7. Live tests: full approval leads to the expected number of actions; a rejection at either stage leads to none; a timeout (short in the test environment) leads to none; dispatch without approval is refused.
8. `docs/approval.md`: a sequence diagram and the policy in plain words. Mention the low-code alternative, multistage approvals in Copilot Studio agent flows, as an option that is in preview.

## Done when

- The live tests pass.
- In Teams, the duty manager and then the operations control manager each receive a card, and the channel shows the actions after the second approval.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Authorise the Teams connection of the Logic App once with a dedicated demo account. The Teams connector signs in as a user; it does not use a managed identity.
- Grant the identity the Logic App uses to call the Fabric functions the permission to run them (see the result of phase 7).

## Documentation to fetch first

- [Microsoft Teams connector reference](https://learn.microsoft.com/connectors/teams/)
- [Adaptive cards in Teams flows](https://learn.microsoft.com/power-automate/overview-adaptive-cards)
- [Secure access and data in Azure Logic Apps](https://learn.microsoft.com/azure/logic-apps/set-up-security-permissions)
- [Multistage approvals in Copilot Studio agent flows (alternative)](https://learn.microsoft.com/microsoft-copilot-studio/flows-advanced-approvals)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
