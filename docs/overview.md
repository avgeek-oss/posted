# About Posted

Posted is a self-hosted social media scheduler for X, LinkedIn, Bluesky and Threads. Connect accounts to your team, write a single post or ordered sequence, tailor text and media for each account and publish now or schedule it for later.

Drafts let you keep incomplete ideas without creating delivery jobs. Scheduled posts can be edited until delivery starts. Publish History records a separate result for each selected account, including partial success and uncertain outcomes.

An installation runs three version-matched containers: API, worker and UI. PostgreSQL stores accounts, drafts, schedules and delivery state. Optional private S3-compatible storage enables images and videos; optional SMTP handles account emails. Social publishing requires your own approved provider applications.

<CardGroup cols={2}>
  <Card title="Compose a post" icon="square-pen" href="/composer">Write shared and account-specific text, add media and review previews.</Card>
  <Card title="Install Posted" icon="server" href="/installation">Run published containers with PostgreSQL and two HTTPS origins.</Card>
  <Card title="Connect accounts" icon="link" href="/connections">Add team-owned social accounts through official OAuth.</Card>
  <Card title="Connect an agent" icon="plug" href="/mcp-connections">Approve an OAuth MCP connection at the access level you choose.</Card>
</CardGroup>

Posted's source is Apache-2.0 licensed. Provider terms, access plans and application approval apply separately. See [security](/security) for the boundaries of an installation.

Start with [installation](/installation) if you are hosting Posted, or [compose a post](/composer) if your team already has an installation. Read [compose threads](/threads) for linked replies, [account and team access](/authentication) for roles, or [API keys](/api-keys) and [MCP connections](/mcp-connections) to connect a client.
