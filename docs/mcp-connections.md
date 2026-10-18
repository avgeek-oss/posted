# MCP connections

Use the API origin's `/mcp` endpoint. Posted uses OAuth; MCP configuration does not need a static API key or bearer-token environment variable.

For Codex, add the following to `~/.codex/config.toml`, replacing the example API origin with your installation:

```toml
[mcp_servers.posted]
url = "https://posted-api.example.com/mcp"
```

Start the client's OAuth login. On Posted's shared approval form, check the application and choose **Read-only**, **Write** or **Administrator** yourself. The client cannot dictate the access level. Approve only a connection you started.

Access remains within your current role. Changing your role revokes the connection and requires reauthentication. Account Settings → MCP Connections shows the application, permissions and added time, with a revocation action. Codex is shown with the ChatGPT logo.

MCP supports reading providers, connections, drafts and delivery state; reserving, completing and checking private media uploads; saving drafts; and authorized posting operations. Request keys and versions have the same meaning as in REST. A media upload does not create a post. Ask the human to approve real publication before issuing a posting request.

See [REST reference](/api-reference/overview) for the shared publishing contracts and [security](/security) for grant boundaries.

## Tool reference

The **MCP reference** sidebar contains one illustrated page for every tool, with arguments, a JSON-RPC call, example result, permission requirements and retry behavior. Begin with [list_providers](/mcp-reference/list_providers) and [list_connections](/mcp-reference/list_connections); then [save_draft](/mcp-reference/save_draft) or [create_post](/mcp-reference/create_post) after the user confirms publication.

Only tools allowed by the current grant and team role are advertised. Read-only grants cannot mutate. An administrator tool also requires Administrator consent. Calls return JSON text plus `structuredContent`; a failed result sets `isError`. Use [request conventions](/api-reference/overview) for versions, request keys and media preparation.
