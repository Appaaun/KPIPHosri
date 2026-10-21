# Authorization

Immutable department UUIDs, not names, determine access. `requireUser` authenticates and loads current user/role/department state; `scope`, `departmentAccess`, `roleAccess`, `manageKpi`, `submitAccess`, and `approveAccess` enforce permissions. UI navigation is convenience only.

| Role             | Read approved aggregates | Draft/submission                          | Catalog | Administration  |
| ---------------- | ------------------------ | ----------------------------------------- | ------- | --------------- |
| SUPER_ADMIN      | All                      | Create, approve other author              | All     | All             |
| EXECUTIVE        | All                      | None                                      | Read    | None            |
| QUALITY_ADMIN    | All                      | Monitor, no approval                      | All     | Sync monitoring |
| DEPARTMENT_ADMIN | Own                      | Create, approve other author in own scope | Own     | No users        |
| DATA_ENTRY       | Own                      | Own drafts, submit                        | Read    | None            |
| VIEWER           | Own                      | None                                      | Read    | None            |

Every ID-based KPI read first loads its immutable department and checks access. Lists are filtered by server scope. User creation/role/reset is SUPER_ADMIN only. The last active SUPER_ADMIN is protected with a serialized transaction/advisory lock. Department changes cannot move an existing KPI between scopes. CSV validation checks each code and repeats checks during confirmation. Export uses the same scope/period/search/status as displayed results. Submitted and approved records cannot be edited. Self-approval is blocked for everyone, including SUPER_ADMIN.

Unit and HTTP smoke tests explicitly attempt pharmacy-to-nursing reads, updates, creation, and approval. The API returns 403. Session revocation and disabled-account checks are enforced on each request.
