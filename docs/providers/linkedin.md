# LinkedIn

Publish individual member posts to connected LinkedIn accounts. Multiple posts are sent in order as separate posts; Posted does not turn them into a LinkedIn reply thread.

## Connect an account

<Steps>
  <Step title="Configure the provider">The installation operator supplies `POSTED_LINKEDIN_CLIENT_ID` and `POSTED_LINKEDIN_CLIENT_SECRET` to both API and worker. Enable the identity and member-sharing access needed by Posted in your LinkedIn application. This integration publishes as the authorized member; it does not provide organization-page publishing.</Step>
  <Step title="Authorize the account">A team administrator opens **Connections → Add connection**, chooses **LinkedIn**, and completes the provider’s sign-in and consent flow.</Step>
  <Step title="Choose it in the composer">After returning to Posted, confirm that the account is Connected. Select it through **Choose Accounts**, review its preview and customize its text or media if needed.</Step>
</Steps>

Accounts belong to the team. Connecting the same provider account again refreshes the existing connection. Members can compose for connected accounts; only administrators can add or disconnect them.

## Application configuration

Register the exact API callback in your provider application:

```text
https://posted-api.example.com/api/social/callback/linkedin
```

Replace the example origin with your API origin. For the hosted installation, it is `https://posted-api.avgeek.ltd/api/social/callback/linkedin`.

Posted requests `openid profile w_member_social`. Enable the identity and member-sharing access needed by Posted in your LinkedIn application. This integration publishes as the authorized member; it does not provide organization-page publishing.

Set `POSTED_LINKEDIN_API_VERSION` to the API version supported by your installation. Posted 0.2.0 uses `202609`; keep the value synchronized on API and worker.

See [configuration](/configuration) for the shared runtime environment and [Towbar provider setup](/providers#configure-the-hosted-installation-in-towbar) for private value entry and Bluesky key generation. Follow the provider's [official authorization documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) for its registration and approval process.

## Limits enforced by Posted

| Content        | Posted behavior                  |
| -------------- | -------------------------------- |
| Text           | 3,000 characters per post        |
| Attachments    | Up to 20 images **or** one video |
| Video duration | 3–1,800 seconds                  |
| Sequence       | Ordered individual posts         |

These are Posted’s current delivery limits. Use [list_providers](/mcp-reference/list_providers) or the provider API endpoint to inspect the running installation’s capabilities. Uploaded originals are prepared for the provider at delivery time; provider account permissions and quotas still apply.

## Posts, media and threads

Use images or one video for each post. For a sequence, account previews keep individual posts visually separate. Later posts still wait for the preceding item on that account to publish successfully.

Each post has independent text and attachment order. Account-specific edits affect only that account and post. **Reset to master** restores text and media inheritance after confirmation. Image or video publishing requires [private media storage](/configuration#private-media-storage).

```mermaid
flowchart LR
  draft["Write shared content"] --> account["Review LinkedIn account"]
  account --> ready["Validate text and media"]
  ready --> publish["Confirm publishing or schedule"]
  publish --> outcome["Read per-post delivery results"]
```

Read [Compose a post](/composer) for single posts and [Compose threads](/threads) for insertion, ordering, reply links and failure handling.

## Reconnect and troubleshoot

If the account needs reauthentication, an administrator repeats the official authorization flow. If LinkedIn is missing from Add connection, ask the operator to check the complete provider configuration and deploy the saved runtime values. A callback mismatch must be corrected in the provider application using the API origin, not the UI or documentation domain.

Inspect [Publish history](/deliveries) for each account's result. A confirmed provider publication stays published if another account fails. An **Uncertain** result needs provider-side inspection before another posting request. Disconnecting prevents later use of the account and does not remove existing provider posts.
