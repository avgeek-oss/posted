# LinkedIn

Publish individual member posts to connected LinkedIn accounts. Multiple posts are sent in order as separate posts; Posted does not turn them into a LinkedIn reply thread.

## Connect an account

<Steps>
  <Step title="Configure the provider">Add the required environment variables below to your Posted installation.</Step>
  <Step title="Authorize the account">A team administrator opens **Connections → Add connection**, chooses **LinkedIn**, and completes the provider’s sign-in and consent flow.</Step>
  <Step title="Choose it in the composer">After returning to Posted, confirm that the account is Connected. Select it through **Choose Accounts**, review its preview and customize its text or media if needed.</Step>
</Steps>

## Required environment variables

Add these values to both the API and worker services, then restart them to apply the configuration.

```dotenv title="Environment variables"
POSTED_LINKEDIN_CLIENT_ID=YOUR_LINKEDIN_CLIENT_ID
POSTED_LINKEDIN_CLIENT_SECRET=YOUR_LINKEDIN_CLIENT_SECRET
```

## Application configuration

Enable identity and member-sharing access in your LinkedIn application. Posted publishes as the connected member. Organization pages are not supported.

Register this callback URL in your LinkedIn application:

```text title="Callback URL"
{{POSTED_API_URL}}/api/social/callback/linkedin
```

Posted requests `openid`, `profile`, `w_member_social`.

Posted uses LinkedIn API version `202609`. The version is managed by Posted and changes through application upgrades.

Follow the provider's [official authorization documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) to register your application and complete any approval steps.

## Limits enforced by Posted

| Content        | Posted behavior                  |
| -------------- | -------------------------------- |
| Text           | 3,000 characters per post        |
| Attachments    | Up to 20 images **or** one video |
| Video duration | 3–1,800 seconds                  |
| GIFs           | Animated GIF; one GIF per post   |
| Sequence       | Ordered individual posts         |

Read [Publishing across accounts](/publishing-across-accounts) for shared editing, media, thread and reconnection guidance.
