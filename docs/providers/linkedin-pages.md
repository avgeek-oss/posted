# LinkedIn Pages

Connect company Pages to your team and publish text, images, GIFs, videos and link previews. Each selected Page becomes a separate connection. A sequence publishes as individual Page posts in order.

Use a separate LinkedIn application with approved **Community Management API** access. Keep the [LinkedIn member account](/providers/linkedin) application for personal profiles.

## Connect your Pages

<Steps>
  <Step title="Configure the provider">Add the required environment variables below to your Posted installation.</Step>
  <Step title="Sign in to LinkedIn">A team administrator opens **Connections → Add connection**, chooses **LinkedIn Pages**, and signs in as a LinkedIn Page administrator.</Step>
  <Step title="Choose Pages">After LinkedIn returns you to Posted, select the Pages to connect and click **Connect Pages**. Posted saves only your selection. Cancel leaves the connections unchanged.</Step>
  <Step title="Compose a post">Select the connected Pages in **Choose Accounts**, review their previews and publish or schedule your post.</Step>
</Steps>

## Required environment variables

Use the client ID and secret from the **LinkedIn Pages** application. Add the same values to the API and worker, then restart both services.

```dotenv
POSTED_LINKEDIN_PAGES_CLIENT_ID=YOUR_LINKEDIN_PAGES_CLIENT_ID
POSTED_LINKEDIN_PAGES_CLIENT_SECRET=YOUR_LINKEDIN_PAGES_CLIENT_SECRET
```

## Set up your LinkedIn Pages application

Open the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps). Create a new application associated with your company Page, including your privacy policy and logo. Request Community Management API access before adding other API products.

<Steps>
  <Step title="Verify the new application">
    Create a separate application for LinkedIn Pages and associate it with your company Page. Open **Settings** and click **Verify** (arrow 1). Copy the verification URL and have a Page super admin open it.

    <Frame caption="Verify the new application.">
      <img src="/assets/providers/linkedin-pages/01-verify-app@2x.png" alt="LinkedIn Pages setup: verify the new application." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Approve the Page association">
    The Page super admin checks the app and Page details, then clicks **Verify** (arrow 3).

    <Frame caption="Approve the Page association.">
      <img src="/assets/providers/linkedin-pages/02-page-approval@2x.png" alt="LinkedIn Pages setup: approve the page association." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Check verification">
    Return to the application settings. The Page should now show **Verified**.

    <Frame caption="Check verification.">
      <img src="/assets/providers/linkedin-pages/03-verified-app@2x.png" alt="LinkedIn Pages setup: check verification." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Request Community Management API access">
    Open **Products**, find **Community Management API**, and click **Request access** (arrow 4). Keep this application separate from the app used for personal LinkedIn connections.

    <Frame caption="Request Community Management API access.">
      <img src="/assets/providers/linkedin-pages/04-community-product@2x.png" alt="LinkedIn Pages setup: request community management api access." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Verify your business email">
    Enter your business email address and complete the verification code LinkedIn sends you.

    <Frame caption="Verify your business email.">
      <img src="/assets/providers/linkedin-pages/05-business-email@2x.png" alt="LinkedIn Pages setup: verify your business email." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Submit the access request">
    Read the terms. If you accept them, select the agreement checkbox and click **Request access**.

    <Frame caption="Submit the access request.">
      <img src="/assets/providers/linkedin-pages/06-request-access@2x.png" alt="LinkedIn Pages setup: submit the access request." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Open the access request form">
    Back in **Products**, click **Access request form** (arrow 6). Requesting the product alone does not complete the application.

    <Frame caption="Open the access request form.">
      <img src="/assets/providers/linkedin-pages/07-open-form@2x.png" alt="LinkedIn Pages setup: open the access request form." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Enter organization details">
    Complete the form with your organization’s registered name, website and business details.

    <Frame caption="Enter organization details.">
      <img src="/assets/providers/linkedin-pages/08-organization-details@2x.png" alt="LinkedIn Pages setup: enter organization details." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Describe your use cases">
    Select the primary use case and features that match the scope of your Posted use, then continue with **Next** (arrows 7–9). Describe currently available features accurately; future features can be identified as planned.

    <Frame caption="Describe your use cases.">
      <img src="/assets/providers/linkedin-pages/09-use-cases@2x.png" alt="LinkedIn Pages setup: describe your use cases." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Wait for LinkedIn review">
    Submit the completed form. Watch your business email for verification requests, follow-up questions and the approval decision. The confirmation below means the form was submitted; it does not mean API access is approved.

    <Frame caption="Wait for LinkedIn review.">
      <img src="/assets/providers/linkedin-pages/10-submitted@2x.png" alt="LinkedIn Pages setup: wait for linkedin review." width="1800" height="986" />
    </Frame>

  </Step>
  <Step title="Check review progress">
    In **Products**, click **Review in progress** to see the current stage. **Access Form Review** means LinkedIn is reviewing your submitted answers. Watch your business email for requests for more information. The 10–14 business day notice shown below is a possible follow-up window, not an approval deadline. Wait for approval before connecting Pages in Posted.

    <Frame caption="Check the status of your Community Management API access request.">
      <img src="/assets/providers/linkedin-pages/11-review-in-progress@2x.png" alt="LinkedIn Community Management API request showing Review in progress and Access Form Review." width="1800" height="984" />
    </Frame>

  </Step>
</Steps>

## Set the callback URL

In the new application's **Auth** tab, add this authorized redirect URL. Replace the origin with your Posted API URL, including `https://`.

```text Callback URL
{{POSTED_API_URL}}/api/social/callback/linkedin-pages
```

Posted requests `rw_organization_admin`, `w_organization_social` to discover Pages you manage and publish on their behalf. Pages with approved administrator or content administrator access appear in the chooser. Reconnect through **LinkedIn Pages** to renew access; existing Page connections keep their identity.

The Pages app does not need the OpenID Connect or Share on LinkedIn products used by personal-profile connections. Posted uses LinkedIn API version `202609`.

See [Publishing across accounts](/publishing-across-accounts) for media, sequences, reconnecting and troubleshooting. LinkedIn controls application approval and access tiers; see its [Community Management API guidance](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview).
