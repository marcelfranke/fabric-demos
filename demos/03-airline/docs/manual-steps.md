# Manual steps

Everything a person has to do by hand, because a script cannot do it or should not.

Rule 2 of `.github/copilot-instructions.md` also sends gaps here: if a platform call is not
documented on Microsoft Learn, the phase stops and records the gap in this file instead of guessing
an API.

| Step | Where | Why not automated | Documentation link | How to check |
| --- | --- | --- | --- | --- |
| Create the private GitHub repository for this kit and copy the kit into it | github.com | Creating a repository is an account action with its own owner, visibility and policy decisions. It is done once, before any phase runs. | https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository | The repository exists, is private, and `.github/workflows/ci.yml` sits at the repository root |
| Copy `config/env.example.yaml` to `config/env.demo.yaml` and fill in all 19 keys | Build machine | The file holds tenant, subscription, workspace, people and pricing values that belong to the person running the demo. `.gitignore` keeps the filled-in copy out of git on purpose. | `config/README.md` in this kit | `python scripts/check_prereqs.py --env demo` reports no missing keys and exits 0 |
| Run `az login` before any phase that touches Azure (phase 4 and later) | Build machine | Interactive sign-in. Rule 6: no secrets in the repository, credentials come from `DefaultAzureCredential` after `az login`. | https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli | `az account show` returns the expected tenant and subscription |
| Install the Fabric CLI (`pip install ms-fabric-cli`) on the build machine | Build machine | A build-machine prerequisite, not something a phase script should install into someone's environment. Not needed until phase 4. | https://learn.microsoft.com/en-us/rest/api/fabric/articles/fabric-command-line-interface | `fab --version` prints a version, and `python scripts/check_prereqs.py --env demo` shows the Fabric CLI as present |

## Known gaps

No gap from phase 0. Phase 0 calls no Microsoft SDK or REST API. It shells out to `az account show`
and `fab --version` only, and both commands are documented; the confirmed documentation URLs sit in
comments next to the calls in `scripts/check_prereqs.py`.

Points that are in preview, undocumented or contradictory but not yet blocking are tracked in
`verify-list.md`, not here. A point moves from there to here only when a phase stops on it.
