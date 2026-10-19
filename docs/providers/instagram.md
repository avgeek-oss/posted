# Instagram

Connect an Instagram **Business** or **Creator** account directly to Posted. Publish photos, photo carousels and video Reels with captions, or schedule them for later. A linked Facebook Page is not required for this login method.

## Connect your account

<Steps>
  <Step title="Configure the provider">Add the required environment variables below to your Posted installation.</Step>
  <Step title="Sign in to Instagram">A team administrator opens **Connections → Add connection**, selects **Instagram** and signs in with the professional account.</Step>
  <Step title="Allow access">Approve profile and publishing access. Instagram returns you to Posted and the account becomes available to your team.</Step>
  <Step title="Compose your post">Choose the account, add photos or a video and write the caption. Review the preview, then publish or schedule it.</Step>
</Steps>

Select **Instagram** to start the connection flow. Your professional account will appear alongside the team’s other connected accounts.

<Frame caption="Start an Instagram connection in Posted.">
  <img src="/assets/providers/instagram/01-add-connection@2x.png" alt="Posted Add connection dialog with Instagram selected as the provider." width="1440" height="1000" />
</Frame>

## Required environment variables

Use the **Instagram App ID** and **Instagram App Secret** shown in your app’s Instagram setup. Add the same values to the API and worker, then restart both services.

```dotenv
POSTED_INSTAGRAM_CLIENT_ID=YOUR_INSTAGRAM_APP_ID
POSTED_INSTAGRAM_CLIENT_SECRET=YOUR_INSTAGRAM_APP_SECRET
```

## Set up your Meta app

Open [Meta for Developers](https://developers.facebook.com/apps/). Use an app that supports Instagram or create one with the Instagram use case. Configure **API setup with Instagram login**.

<Steps>
  <Step title="Add your professional account">Add your Instagram account for testing. Switch a personal account to Business or Creator in Instagram before connecting it.</Step>
  <Step title="Set up business login">In Instagram’s business login settings, add the OAuth callback URL below. Copy the Instagram app credentials into your Posted installation.</Step>
  <Step title="Configure permissions">Posted requests `instagram_business_basic`, `instagram_business_content_publish`. Select additional permissions based on the scope of your Posted use.</Step>
  <Step title="Add lifecycle callbacks">Set the deauthorization and data deletion callbacks to the URLs below. Posted verifies these requests with the Instagram app secret.</Step>
  <Step title="Complete access requirements">Standard Access is for professional accounts you own or manage and have added to the app. Complete Meta’s App Review and Advanced Access requirements before connecting other accounts.</Step>
</Steps>

Replace the origin with your Posted API URL, including `https://`.

```text OAuth callback URL
{{POSTED_API_URL}}/api/social/callback/instagram
```

```text Deauthorization callback URL
{{POSTED_API_URL}}/api/social/instagram/deauthorize
```

```text Data deletion callback URL
{{POSTED_API_URL}}/api/social/instagram/data-deletion
```

## What you can publish

Add one photo, up to ten photos in a carousel, or one video Reel. Captions can contain up to 2,200 characters, 30 hashtags and 20 mentions. Each post needs media; text-only posts and standalone link cards are unavailable. Links can remain in captions, but Instagram controls how they appear.

Posted prepares photos as JPEGs, removes metadata and crops images outside Instagram’s supported aspect ratios. Instagram can crop carousel photos to match the first photo. Photo descriptions support up to 1,000 characters. GIFs are converted to video Reels. Videos must be between three seconds and 15 minutes and fit Posted’s upload limit. Stories and mixed photo/video carousels are not included in this connection.

A sequence becomes separate posts in order. Instagram fetches prepared media through temporary signed URLs; originals remain in your S3 source. Posted waits for processing to finish before publishing and checks the account’s publishing quota. An uncertain publishing result stays blocked to avoid duplicates.

See [Publishing across accounts](/publishing-across-accounts) for shared workflows, reconnecting and troubleshooting. Posted uses Graph API `v26.0`; see Meta’s [Instagram login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) and [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) guides for provider requirements.
