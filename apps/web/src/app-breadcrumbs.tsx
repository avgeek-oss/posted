import { createContext, useContext, type ReactNode } from "react";
import type { AppShellBreadcrumbItems } from "@avgeek-oss/design-system/layouts/application-shell-types";
import {
  isAccountSection,
  settingsHref,
  settingsTitles,
} from "./settings-navigation.js";
const BreadcrumbContext = createContext<AppShellBreadcrumbItems>([
  { label: "Home", href: "/" },
]);
export const usePageBreadcrumbs = () => useContext(BreadcrumbContext);
export function AppBreadcrumbs({
  title,
  section,
  items: suppliedItems,
  children,
}: {
  title: string;
  section?: string;
  items?: AppShellBreadcrumbItems;
  children: ReactNode;
}) {
  const items: AppShellBreadcrumbItems =
    suppliedItems ??
    (section
      ? [
          {
            label: isAccountSection(section)
              ? "Account Settings"
              : "Team Settings",
            href: settingsHref(
              isAccountSection(section) ? "profile" : "general",
            ),
          },
          { label: settingsTitles[section] ?? title },
        ]
      : [{ label: title }]);
  return (
    <BreadcrumbContext.Provider value={items}>
      {children}
    </BreadcrumbContext.Provider>
  );
}
