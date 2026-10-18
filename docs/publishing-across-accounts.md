# Publishing across accounts

Choose the connected accounts you want to publish to, then review each account's version before publishing or scheduling. Accounts belong to the team. Members can compose for connected accounts; administrators can add, reconnect or disconnect them.

## Posts, media and threads

Each post has its own text and attachment order. Account-specific changes apply only to that account and post. **Reset to master** restores the shared text and media after confirmation. See [Compose a post](/composer#customize-an-account) for the editing steps.

Images, GIFs and videos require an [S3 source](/configuration#s3-source). Posted keeps originals private and prepares delivery copies for each provider. Attach one GIF on its own, without other images or videos in the same post. Read [Add media](/composer#add-media) for upload limits, formats and attachment previews.

Each provider guide lists the limits enforced by Posted. Account permissions, access plans and provider quotas still apply. API and MCP clients can inspect the running installation's capabilities through [list_providers](/mcp-reference/list_providers).

For a sequence, Posted sends each account's posts in order. The next post waits for confirmation that the preceding post was published. Providers differ in whether they link replies or publish separate posts. Read [Compose threads](/threads#how-the-providers-publish-a-sequence) for those differences and the sequence editor.

## Reconnect and troubleshoot

### An account needs reauthentication

An administrator opens **Connections → Add connection**, chooses the provider and completes its sign-in and consent flow again. Connecting the same provider account refreshes its existing connection.

### A provider is missing

Ask the operator to check the provider's [required configuration](/configuration#social-providers) and redeploy the API and worker after saving the values. Only fully configured providers appear in **Add connection**.

### Authorization fails

Follow the provider's setup guide to check its callback URL or public OAuth metadata URLs. Use your installation's API origin, not its UI or documentation domain. Check any application permissions or approvals required by the provider.

### Some posts did not publish

Open [Publish history](/deliveries) to inspect each account and post. A confirmed publication stays published if another account fails. An **Uncertain** result needs provider-side inspection before another attempt. Delivery details explain when it is safe to [resume an interrupted sequence](/deliveries#resume-interrupted-publishing).

### Disconnect an account

An administrator can disconnect an account from **Connections** after confirmation. This prevents future publishing through it and leaves posts already published on the provider intact.
