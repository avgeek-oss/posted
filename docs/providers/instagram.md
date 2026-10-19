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

Open [Meta for Developers](https://developers.facebook.com/apps/). You can add Instagram to an existing app that supports the use case, or create a new app. The account you connect must be a Business or Creator account.

<Steps>
  <Step title="Add the Instagram use case">
    Open your app's **Use cases** page and choose **Add use cases**. Select **Manage messaging & content on Instagram**, then save.

    <Frame caption="Add the Instagram use case to your Meta app.">
      <img src="/assets/providers/instagram/02-add-instagram-use-case@2x.png" alt="Meta Add more use cases dialog with Manage messaging and content on Instagram selected." width="1800" height="984" />
    </Frame>

    Choose **Customize** beside the Instagram use case.

    <Frame caption="Open the Instagram setup.">
      <img src="/assets/providers/instagram/03-customize-instagram@2x.png" alt="Meta Use cases page with an arrow pointing to Customize for Instagram." width="1800" height="984" />
    </Frame>

  </Step>
  <Step title="Save your Instagram app credentials">
    Open **API setup with Instagram login**. Copy the **Instagram App ID** and **Instagram App Secret** into the environment variables above. Use the credentials from this Instagram setup, even when your Meta app also has other use cases.

    Select **Add all required permissions** to complete the initial setup. We will check publishing access below.

    <Frame caption="Find the Instagram app credentials and add the initial permissions.">
      <img src="/assets/providers/instagram/04-instagram-app-credentials@2x.png" alt="Instagram API setup showing the Instagram App ID, masked secret and Add all required permissions button." width="1800" height="984" />
    </Frame>

  </Step>
  <Step title="Invite your test accounts">
    Under **Generate access tokens**, select **Add account** to invite the professional accounts you want to test with. Posted gets and stores the access token during sign-in. You can connect in Posted without generating or copying a token here.

    <Frame caption="Add an Instagram account for testing.">
      <img src="/assets/providers/instagram/05-add-account@2x.png" alt="Instagram API setup with initial permissions complete and an arrow pointing to Add account." width="1800" height="984" />
    </Frame>

    Select **Instagram tester**, enter the Instagram usernames and choose **Add**.

    <Frame caption="Send the tester invitations.">
      <img src="/assets/providers/instagram/06-invite-instagram-testers@2x.png" alt="Add people to your app dialog with Instagram tester selected and example usernames entered." width="1800" height="984" />
    </Frame>

    Each invited account opens Instagram's **Settings → Apps and websites → Tester invitations** and accepts the invitation.

    <Frame caption="Accept the invitation from the Instagram account.">
      <img src="/assets/providers/instagram/09-accept-tester-invitation@2x.png" alt="Instagram Apps and websites settings showing a tester invitation and its Accept button." width="1800" height="984" />
    </Frame>

  </Step>
  <Step title="Set up Instagram business login">
    Back in Meta, select **Set up** under **Set up Instagram business login**.

    You can leave **Configure webhooks** blank for Posted's publishing setup. Its **Verify token** field is for webhook verification. Enter the sign-in redirect URL in business login instead.

    <Frame caption="Open business login setup below the webhook settings.">
      <img src="/assets/providers/instagram/07-set-up-business-login@2x.png" alt="Instagram setup with empty webhook fields and an arrow pointing to Set up Instagram business login." width="1800" height="984" />
    </Frame>

    Add this **Redirect URL**, using your Posted API origin including `https://`, then save.

    ```text Redirect URL
    {{POSTED_API_URL}}/api/social/callback/instagram
    ```

    <Frame caption="Save the Posted sign-in redirect URL.">
      <img src="/assets/providers/instagram/08-save-redirect-url@2x.png" alt="Set up Instagram business login dialog with a blurred API origin, the Instagram callback path and an arrow pointing to Save." width="1800" height="984" />
    </Frame>

  </Step>
  <Step title="Check publishing permissions">
    Open **Permissions and features** and scroll to the Instagram permissions.

    <Frame caption="Find the Instagram permissions in your app.">
      <img src="/assets/providers/instagram/10-open-permissions@2x.png" alt="Meta Permissions and features page with an arrow indicating to scroll down to Instagram permissions." width="1800" height="984" />
    </Frame>

    Make sure `instagram_business_basic`, `instagram_business_content_publish` are added. Posted requests these when you connect an account. Select additional permissions based on the scope of your Posted use.

    <Frame caption="Enable profile and content publishing access.">
      <img src="/assets/providers/instagram/11-publishing-permissions@2x.png" alt="Instagram business basic and content publish permissions marked Ready for testing." width="1800" height="984" />
    </Frame>

  </Step>
  <Step title="Add account callbacks">
    In the Instagram business login settings, add the deauthorization and data deletion URLs. Posted verifies these requests with the Instagram app secret.

    ```text Deauthorization callback URL
    {{POSTED_API_URL}}/api/social/instagram/deauthorize
    ```

    ```text Data deletion callback URL
    {{POSTED_API_URL}}/api/social/instagram/data-deletion
    ```

  </Step>
  <Step title="Connect in Posted">
    Restart the API and worker after saving the environment variables. In Posted, open **Connections → Add connection → Instagram**, sign in and approve access.

    Standard Access is for professional accounts you own or manage and have added to the app. Complete Meta's App Review and Advanced Access requirements before connecting other accounts.

  </Step>
</Steps>

## What you can publish

Add one photo, up to ten photos in a carousel, or one video Reel. Captions can contain up to 2,200 characters, 30 hashtags and 20 mentions. Each post needs media; text-only posts and standalone link cards are unavailable. Links can remain in captions, but Instagram controls how they appear.

Posted prepares photos as JPEGs, removes metadata and crops images outside Instagram’s supported aspect ratios. Instagram can crop carousel photos to match the first photo. Photo descriptions support up to 1,000 characters. GIFs are converted to video Reels. Videos must be between three seconds and 15 minutes and fit Posted’s upload limit. Stories and mixed photo/video carousels are not included in this connection.

A sequence becomes separate posts in order. Instagram fetches prepared media through temporary signed URLs; originals remain in your S3 source. Posted waits for processing to finish before publishing and checks the account’s publishing quota. An uncertain publishing result stays blocked to avoid duplicates.

See [Publishing across accounts](/publishing-across-accounts) for shared workflows, reconnecting and troubleshooting. Posted uses Graph API `v26.0`; see Meta’s [Instagram login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) and [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) guides for provider requirements.
