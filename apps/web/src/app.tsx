import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppLayout,
  AppShell,
  ApplicationSidebar,
  ApplicationNavbar,
  RouteProvider,
  PortalProvider,
  ThemeSwitcher,
  Link,
  TooltipText,
  SuspendedAppProvider,
  toast,
  useTheme,
} from "@posted/web-design-system";
import {
  BackendUnavailable,
  useBackendReconnect,
} from "@avgeek-oss/design-system/patterns/feedback/backend-unavailable";
import { OverlaySuspensionScope } from "@avgeek-oss/design-system/overlays/overlay-suspension";
import { SecondarySidebarLayout } from "@avgeek-oss/design-system/navigation/secondary-sidebar";
import { usePersistentAppSidebar } from "@avgeek-oss/design-system/layouts/app-shell";
import type {
  AppShellBreadcrumbItems,
  SidebarLinkConfig,
} from "@avgeek-oss/design-system/layouts/application-shell-types";
import {
  DashboardSquare01Icon,
  Link01Icon,
  Calendar03Icon,
  QuillWrite01Icon,
  UserAccountIcon,
  UserGroupIcon,
  QuillWrite02Icon,
} from "@hugeicons/core-free-icons";
import {
  SettingsNavigation,
  settingsTitles,
  settingsRoute,
} from "./settings-navigation.js";
import { AppBreadcrumbs } from "./app-breadcrumbs.js";
import { PostedMark, postedBrand, postedVersion } from "./brand.js";
import { AccountMenu } from "./account-menu.js";
import { HelpPage, helpTitles } from "./help-page.js";
import { ErrorPage } from "./error-page.js";
import {
  isFrontendLoadError,
  reloadOutdatedFrontend,
} from "./frontend-load.js";
import {
  api,
  ApiError,
  errorText,
  hasSessionResponse,
  initializeNavigation,
  navigate,
  navigationIndex,
  requestNavigation,
  type Session,
} from "./api.js";
import { readStartup, isBackendUnavailable } from "./startup.js";
import { HomePage } from "./home-page.js";
import { useResource } from "./use-resource.js";
import type { PostCounts } from "../../../packages/contracts/src/index.js";
const ConnectionsPage = lazy(() =>
  import("./connections-page.js").then((m) => ({ default: m.ConnectionsPage })),
);
const ProviderAuthorizationPage = lazy(() =>
  import("./provider-authorization-page.js").then((m) => ({
    default: m.ProviderAuthorizationPage,
  })),
);
const PostsPage = lazy(() =>
  import("./posts-page.js").then((m) => ({ default: m.PostsPage })),
);
const DraftsPage = lazy(() =>
  import("./drafts-page.js").then((m) => ({ default: m.DraftsPage })),
);
const PostDetailsPage = lazy(() =>
  import("./post-details-page.js").then((m) => ({
    default: m.PostDetailsPage,
  })),
);
const ComposerPage = lazy(() =>
  import("./composer-page.js").then((m) => ({ default: m.ComposerPage })),
);
const Auth = lazy(() => import("./auth.js").then((m) => ({ default: m.Auth })));
const SettingsPage = lazy(() =>
  import("./settings.js").then((m) => ({ default: m.SettingsPage })),
);
const AppConsent = lazy(() =>
  import("./app-consent.js").then((m) => ({ default: m.AppConsent })),
);
function usePath() {
  const [path, setPath] = useState(
    window.location.pathname + window.location.search + window.location.hash,
  );
  useEffect(() => {
    initializeNavigation();
    let currentPath =
      window.location.pathname + window.location.search + window.location.hash;
    let currentIndex = navigationIndex() ?? 0;
    let restoration: { index: number; restored: () => void } | null = null;
    const listener = () => {
      currentPath =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      currentIndex = navigationIndex() ?? currentIndex;
      setPath(currentPath);
    };
    const pop = () => {
      const targetPath =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      const targetIndex = navigationIndex();
      if (restoration) {
        if (targetIndex === restoration.index) {
          const complete = restoration.restored;
          restoration = null;
          complete();
        }
        return;
      }
      if (targetIndex !== null && targetIndex !== currentIndex) {
        const delta = targetIndex - currentIndex;
        let restored = false;
        let proceed = false;
        const resume = () => {
          proceed = true;
          if (restored) window.history.go(delta);
        };
        if (!requestNavigation(targetPath, resume)) {
          restoration = {
            index: currentIndex,
            restored: () => {
              restored = true;
              if (proceed) window.history.go(delta);
            },
          };
          window.history.go(-delta);
          return;
        }
      } else {
        const targetState = window.history.state;
        const resume = () => {
          window.history.replaceState(targetState, "", targetPath);
          listener();
        };
        if (!requestNavigation(targetPath, resume)) {
          window.history.replaceState(
            { postedNavigationIndex: currentIndex },
            "",
            currentPath,
          );
          return;
        }
      }
      listener();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("posted:navigate", listener);
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("posted:navigate", listener);
      window.removeEventListener("hashchange", listener);
    };
  }, []);
  return path;
}
export function App() {
  const location = usePath();
  const path = location.split(/[?#]/)[0] ?? "/";
  const section = settingsRoute(path);
  const editId = path.match(/^\/posts\/([^/]+)\/edit$/)?.[1];
  const draftId = path.match(/^\/drafts\/([0-9a-f-]{36})\/edit$/i)?.[1];
  const detailsId = path.match(/^\/posts\/([0-9a-f-]{36})$/i)?.[1];
  const postId = editId ?? detailsId;
  const postBreadcrumbs: AppShellBreadcrumbItems | undefined = postId
    ? [
        {
          label: editId ? "Scheduled Posts" : "Publish History",
          href: editId ? "/posts/scheduled" : "/posts/history",
        },
        {
          label: postId.slice(0, 8),
          href: editId ? `/posts/${postId}` : undefined,
          content: (
            <TooltipText tooltip={postId}>
              {editId ? (
                <Link
                  href={`/posts/${postId}`}
                  className="font-mono no-underline"
                >
                  {postId.slice(0, 8)}
                </Link>
              ) : (
                <span className="font-mono">{postId.slice(0, 8)}</span>
              )}
            </TooltipText>
          ),
        },
        ...(editId ? [{ label: "Edit Schedule" }] : []),
      ]
    : draftId
      ? [
          { label: "Pending Drafts", href: "/posts/drafts" },
          {
            label: draftId.slice(0, 8),
            content: (
              <TooltipText tooltip={draftId}>
                <span className="font-mono">{draftId.slice(0, 8)}</span>
              </TooltipText>
            ),
          },
          { label: "Edit Draft" },
        ]
      : undefined;
  const routeTitle = draftId
    ? "Edit Draft"
    : path === "/posts/drafts"
      ? "Pending Drafts"
      : section
        ? settingsTitles[section]
        : path === "/connections"
          ? "Connections"
          : path === "/posts/scheduled"
            ? "Scheduled Posts"
            : path === "/posts/history"
              ? "Publish History"
              : editId
                ? "Edit Schedule"
                : detailsId
                  ? "Delivery details"
                  : path === "/posts/new"
                    ? "Create post"
                    : path === "/connections/authorize"
                      ? "Authorize Posted"
                      : (helpTitles[path] ?? "Dashboard");
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [expired, setExpired] = useState(false);
  const [draft, setDraft] = useState("");
  const counts = useResource<PostCounts>(
    session && !expired ? "/posts/counts" : null,
    5000,
  );
  useEffect(() => {
    window.addEventListener("posted:posts-changed", counts.refresh);
    return () =>
      window.removeEventListener("posted:posts-changed", counts.refresh);
  }, [counts.refresh]);
  const appContainer = useRef<HTMLDivElement>(null);
  const sidebarState = usePersistentAppSidebar("posted:sidebar-open");
  const { resolvedTheme: theme } = useTheme();
  useEffect(() => {
    if (session) document.title = `${routeTitle} · Posted`;
  }, [routeTitle, session]);
  async function initial(signal: AbortSignal) {
    try {
      const result = await readStartup(signal);
      if (signal.aborted) return false;
      setSetup(result.status.setupRequired);
      setEmailConfigured(result.status.emailDeliveryConfigured);
      setSession(result.session);
      setUnavailable(false);
      setLoadError("");
      return true;
    } catch (error) {
      if (!signal.aborted) {
        setUnavailable(isBackendUnavailable(error));
        setLoadError(errorText(error));
      }
      return false;
    } finally {
      if (!signal.aborted) setReady(true);
    }
  }
  useEffect(() => {
    const request = new AbortController();
    void initial(request.signal);
    const expire = () => setExpired(true);
    window.addEventListener("posted:expired", expire);
    return () => {
      request.abort();
      window.removeEventListener("posted:expired", expire);
    };
  }, []);
  useBackendReconnect(unavailable && !session, initial);
  useEffect(() => {
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", postedBrand.themeColor[theme]);
  }, [theme]);
  async function refresh() {
    try {
      const next = await api<Session>("/auth/me", undefined, "GET", {
        validateResponse: hasSessionResponse,
      });
      setSession(next);
    } catch (error) {
      toast.danger(errorText(error));
    }
  }
  function acceptSession(next: Session) {
    if (session && session.user.id !== next.user.id) setDraft("");
    setSession(next);
    setExpired(false);
    setSetup(false);
    if (
      path === "/login" ||
      path.startsWith("/invite") ||
      path.startsWith("/recover")
    )
      navigate("/");
  }
  async function reconcileIdentity() {
    try {
      acceptSession(
        await api<Session>("/auth/me", undefined, "GET", {
          validateResponse: hasSessionResponse,
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        setExpired(false);
        setDraft("");
      } else throw error;
    }
  }
  function signOut() {
    const perform = () => {
      void api("/auth/logout", {}, "POST")
        .then(() => {
          setSession(null);
          setExpired(false);
          setDraft("");
          navigate("/");
        })
        .catch((error) => toast.danger(errorText(error)));
    };
    if (requestNavigation("/", perform)) perform();
  }
  const authView = (
    <Suspense fallback={null}>
      <Auth
        key={location}
        setup={setup}
        emailDeliveryConfigured={emailConfigured}
        onSession={acceptSession}
        onIdentityChanged={reconcileIdentity}
        focusEmail={expired}
      />
    </Suspense>
  );
  if (unavailable && !session) return <BackendUnavailable appName="Posted" />;
  if (!ready) return <main aria-busy className="min-h-dvh" />;
  if (
    [
      "/invite",
      "/recover",
      "/verify-email",
      "/confirm-email-change",
      "/verification-email",
    ].includes(path)
  )
    return authView;
  if (!session)
    return loadError ? (
      <ErrorPage
        title="Posted could not load"
        description={loadError}
        onRetry={() => void initial(AbortSignal.timeout(20_000))}
        showHome={false}
      />
    ) : (
      authView
    );
  if (path === "/oauth/consent")
    return expired ? (
      authView
    ) : (
      <Suspense fallback={null}>
        <AppConsent session={session} />
      </Suspense>
    );
  if (path === "/connections/authorize")
    return expired ? (
      authView
    ) : (
      <Suspense fallback={null}>
        <ProviderAuthorizationPage />
      </Suspense>
    );
  const admin = session.user.role === "admin";
  const editable = session.user.role !== "viewer";
  const nav = (
    label: string,
    href: string,
    icon: SidebarLinkConfig["icon"],
    count?: number,
  ): SidebarLinkConfig => ({
    id: href,
    href,
    label,
    icon,
    kind: "link",
    badge:
      count === undefined
        ? undefined
        : { value: count, label: `${label}: ${count}` },
    activePath:
      href === "/posts/drafts" && draftId
        ? "/drafts"
        : href.startsWith("/settings/")
          ? "/settings"
          : href.startsWith("/team-settings/")
            ? "/team-settings"
            : href,
  });
  const brand = {
    id: "posted",
    accessibleLabel: "Posted",
    title: "Posted",
    logo: <PostedMark />,
  };
  const sidebar = (
    <ApplicationSidebar
      config={{
        accessibleLabel: "Team navigation",
        homeHref: "/",
        brand,
        brandVersion: postedVersion,
        groups: [
          {
            id: "overview",
            label: "Overview",
            items: [
              nav("Dashboard", "/", DashboardSquare01Icon),
              nav("Connections", "/connections", Link01Icon),
            ],
          },
          {
            id: "posts",
            label: "Posts",
            items: [
              nav("Publish History", "/posts/history", QuillWrite01Icon),
              nav(
                "Pending Drafts",
                "/posts/drafts",
                QuillWrite02Icon,
                counts.value?.drafts,
              ),
              nav(
                "Scheduled Posts",
                "/posts/scheduled",
                Calendar03Icon,
                counts.value?.scheduled,
              ),
            ],
          },
          {
            id: "settings",
            label: "Settings",
            items: [
              nav("Account Settings", "/settings/profile", UserAccountIcon),
              ...(admin
                ? [
                    nav(
                      "Team Settings",
                      "/team-settings/general",
                      UserGroupIcon,
                    ),
                  ]
                : []),
            ],
          },
        ],
        footerContent: (
          <AccountMenu
            name={session.user.name}
            email={session.user.email}
            teamName={session.workspace.name}
            onLogout={signOut}
          />
        ),
      }}
    />
  );
  let page: ReactNode;
  if (section)
    page = (
      <SettingsPage
        section={section}
        session={session}
        emailDeliveryConfigured={emailConfigured}
        onRefresh={() => void refresh()}
      />
    );
  else if (path === "/" || path === "/login")
    page = (
      <HomePage
        name={session.user.name}
        text={draft}
        onChange={setDraft}
        canEdit={editable}
        onContinue={() => navigate("/posts/new")}
      />
    );
  else if (path === "/connections")
    page = <ConnectionsPage canManage={admin} session={session} />;
  else if (path === "/posts/scheduled" || path === "/posts/history")
    page = (
      <PostsPage
        key={path}
        view={path.endsWith("history") ? "history" : "scheduled"}
        session={session}
      />
    );
  else if (path === "/posts/drafts") page = <DraftsPage session={session} />;
  else if (path === "/posts/new" || editId || draftId)
    page = (
      <ComposerPage
        key={editId ?? draftId ?? "new"}
        postId={editId}
        draftId={draftId}
        initialText={draft}
        canEdit={editable}
        session={session}
        onSubmitted={() => setDraft("")}
      />
    );
  else if (detailsId)
    page = (
      <PostDetailsPage key={detailsId} postId={detailsId} session={session} />
    );
  else if (helpTitles[path]) page = <HelpPage path={path} />;
  else page = <ErrorPage code="404" />;
  return (
    <>
      {expired && authView}
      <OverlaySuspensionScope
        key={`${session.user.id}:${session.workspace.id}`}
        isSuspended={expired}
      >
        <SuspendedAppProvider value={expired}>
          <div
            ref={appContainer}
            hidden={expired}
            inert={expired}
            aria-hidden={expired}
            data-authenticated-app
          >
            <PortalProvider getContainer={() => appContainer.current}>
              <RouteProvider pathname={path} navigate={navigate}>
                <AppShell
                  contentWidth="broad"
                  policy={{ kind: "product", toasts: false }}
                >
                  <AppBreadcrumbs
                    title={routeTitle ?? "Posted"}
                    section={section}
                    items={postBreadcrumbs}
                  >
                    <a
                      href="#main-content"
                      className="sr-only focus:not-sr-only"
                    >
                      Skip to content
                    </a>
                    <AppLayout
                      navigate={navigate}
                      sidebar={sidebar}
                      toggleShortcut
                      {...sidebarState}
                      navbar={
                        <ApplicationNavbar
                          config={{ homeHref: "/", brand }}
                          hasSidebar
                          sidebarOpen={sidebarState.sidebarOpen}
                          onSidebarToggle={() =>
                            sidebarState.onSidebarOpenChange(
                              !sidebarState.sidebarOpen,
                            )
                          }
                          actions={<ThemeSwitcher />}
                        />
                      }
                    >
                      <SecondarySidebarLayout>
                        {section && <SettingsNavigation section={section} />}
                        <AppShell.Content
                          id="main-content"
                          tabIndex={-1}
                          className="outline-none"
                          variant="broad"
                        >
                          <Suspense fallback={null}>{page}</Suspense>
                        </AppShell.Content>
                      </SecondarySidebarLayout>
                    </AppLayout>
                  </AppBreadcrumbs>
                </AppShell>
              </RouteProvider>
            </PortalProvider>
          </div>
        </SuspendedAppProvider>
      </OverlaySuspensionScope>
    </>
  );
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; loadFailed: boolean }
> {
  state = { failed: false, loadFailed: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, loadFailed: isFrontendLoadError(error) };
  }
  componentDidCatch(error: unknown) {
    if (isFrontendLoadError(error)) void reloadOutdatedFrontend();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.state.loadFailed ? (
      <ErrorPage
        code="Load error"
        title="Unable to open this page"
        description="This page could not finish loading. Reload to try again. If you had an unfinished edit, check it before continuing."
      />
    ) : (
      <ErrorPage />
    );
  }
}
