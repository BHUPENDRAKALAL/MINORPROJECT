import type { Role } from "@cyrus/shared";

/** Foundry's icon set (src/vendor/foundry/icons). */
export type IconName =
  | "overview" | "brief" | "jobs" | "needs" | "responses" | "data" | "connections" | "activity"
  | "settings" | "panel" | "log" | "work" | "inputs" | "more" | "chevron" | "close" | "go" | "stuck";

/** Foundry's colour families. */
export type Family = "lime" | "ember" | "azure" | "orchid" | "sun" | "none";

/** Foundry's sprite sheets (src/vendor/foundry/sprites). */
export type SpriteName =
  | "apprentice" | "designer" | "reviewer" | "smith" | "shipped" | "blocked" | "ask" | "cheer" | "nod" | "wave";

export interface NavItem {
  /** Unique within a role; also the page's key. */
  key: string;
  to: string;
  label: string;
  icon: IconName;
  family: Family;
  /** Page heading. Defaults to the label. */
  title?: string;
  /** For pages not built yet: what will appear here (the empty state's words). */
  empty?: string;
  sprite?: SpriteName;
  /** Only these roles see the item (inside a shared nav such as the placement office's). */
  only?: Role[];
  /** Pages under this path also mark the item current (for an item whose own path is the area's home). */
  under?: string;
  /** Heading of the side-panel group the item sits in. Items without one sit in the top group, unlabelled. */
  group?: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** Splits a role's items into the side panel's groups, keeping their order (items of a group stay together). */
export function groupNav(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

/** The nav item is current on its own page and on the pages under it (a drive under Drives). */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
  const root = item.under ?? (item.to.split("/").length > 2 ? item.to : null);
  return root !== null && pathname.startsWith(root + "/");
}

export interface NavArea {
  /** Where this area's pages live. */
  base: string;
  /** Roles that may open this area. */
  roles: Role[];
  items: NavItem[];
}

export const STUDENT_AREA: NavArea = {
  base: "/student",
  roles: ["STUDENT"],
  items: [
    { key: "home", to: "/student", label: "Home", icon: "overview", family: "lime" },
    {
      key: "notifications", to: "/student/notifications", label: "Notifications", icon: "needs", family: "sun",
      empty: "Shortlists, round results, interview calls and messages from the placement office will show up here. Nothing new yet.",
      sprite: "smith",
    },
    {
      key: "drives", to: "/student/drives", label: "Drives", icon: "jobs", family: "azure", group: "Placements",
      empty: "Placement drives you are eligible for will be listed here, with dates, rounds and a button to opt in or out.",
      sprite: "designer",
    },
    {
      key: "profile", to: "/student/profile", label: "My profile", icon: "brief", family: "sun", group: "Placements",
      empty: "Your academic details, documents and resume will be here. Once you fill them in, the placement office checks them and marks your profile verified.",
      sprite: "apprentice",
    },
  ],
};

export const OFFICE_AREA: NavArea = {
  base: "/office",
  roles: ["TPO", "STAFF", "VOLUNTEER"],
  items: [
    {
      key: "overview", to: "/office", label: "Overview", icon: "overview", family: "lime",
      empty: "Today's numbers will be here: profiles waiting for review, drives running, students placed this season.",
      sprite: "smith",
    },
    { key: "notifications", to: "/office/notifications", label: "Notifications", icon: "needs", family: "sun" },
    {
      key: "review", to: "/office/review", label: "Review queue", icon: "responses", family: "orchid", group: "Students",
      empty: "Student profiles and change requests waiting for a check will line up here, oldest first.",
      sprite: "reviewer",
    },
    {
      key: "students", to: "/office/students", label: "Students", icon: "data", family: "azure", group: "Students",
      only: ["TPO", "STAFF"],
      empty: "Every registered student, with their branch, batch, verification and placement status, and filters to find them.",
      sprite: "apprentice",
    },
    {
      key: "drives", to: "/office/drives", label: "Drives", icon: "jobs", family: "lime", group: "Placements", only: ["TPO"],
      empty: "Placement drives from draft to results: eligibility, shortlists, rounds and offers.",
      sprite: "smith",
    },
    {
      key: "companies", to: "/office/companies", label: "Companies", icon: "connections", family: "azure", group: "Placements",
      empty: "Companies that have registered or been invited, and the ones waiting for your approval.",
      sprite: "designer",
    },
    {
      key: "calendar", to: "/office/calendar", label: "Calendar", icon: "log", family: "azure", group: "Placements",
      only: ["TPO", "STAFF"],
    },
    {
      key: "team", to: "/office/team", label: "Team", icon: "activity", family: "sun", group: "Administration", only: ["TPO"],
      empty: "Your placement staff and volunteers, what each of them may do, and invites you have sent.",
      sprite: "ask",
    },
    {
      key: "settings", to: "/office/settings", label: "Settings", icon: "settings", family: "none", group: "Administration", only: ["TPO"],
      empty: "Season settings, eligibility defaults and email templates will be managed here.",
      sprite: "apprentice",
    },
  ],
};

export const COMPANY_AREA: NavArea = {
  base: "/company",
  roles: ["COMPANY_HR"],
  items: [
    // HR's home is their drives list.
    { key: "drives", to: "/company", label: "Drives", icon: "jobs", family: "azure", under: "/company/drives" },
    { key: "notifications", to: "/company/notifications", label: "Notifications", icon: "needs", family: "sun" },
    {
      key: "team", to: "/company/team", label: "Team", icon: "activity", family: "sun", group: "Company",
      empty: "Colleagues and interviewers you invite will be listed here.",
      sprite: "ask",
    },
    {
      key: "profile", to: "/company/profile", label: "Company profile", icon: "brief", family: "orchid", group: "Company",
      title: "Company profile",
      empty: "Your company's details as students will see them: about, website, locations and the people to contact.",
      sprite: "reviewer",
    },
  ],
};

export const INTERVIEWER_AREA: NavArea = {
  base: "/interviewer",
  roles: ["INTERVIEWER"],
  items: [
    {
      key: "panel", to: "/interviewer", label: "My panels", icon: "panel", family: "orchid", under: "/panel",
      empty: "On interview day, the queue of students for your panel will appear here, with each student's profile and a form for your feedback.",
      sprite: "reviewer",
    },
    { key: "notifications", to: "/interviewer/notifications", label: "Notifications", icon: "needs", family: "sun" },
  ],
};

export const COORDINATOR_AREA: NavArea = {
  base: "/coordinator",
  roles: ["COORDINATOR"],
  items: [
    {
      key: "day", to: "/coordinator", label: "Drive day", icon: "log", family: "sun",
      empty: "On a drive day you will see attendance, the live interview queues and which rooms need someone.",
      sprite: "smith",
    },
  ],
};

export const SENIOR_AREA: NavArea = {
  base: "/senior",
  roles: ["PLACED_SENIOR"],
  items: [
    {
      key: "home", to: "/senior", label: "Home", icon: "overview", family: "lime",
      empty: "Ways to help juniors, such as answering questions and sharing interview experiences, will appear here.",
      sprite: "cheer",
    },
  ],
};

export const AREAS: NavArea[] = [STUDENT_AREA, OFFICE_AREA, COMPANY_AREA, INTERVIEWER_AREA, COORDINATOR_AREA, SENIOR_AREA];

export function areaForRole(role: Role): NavArea {
  return AREAS.find((a) => a.roles.includes(role)) ?? STUDENT_AREA;
}

/** The nav items a role sees. */
export function navFor(role: Role): NavItem[] {
  return areaForRole(role).items.filter((i) => !i.only || i.only.includes(role));
}

export function homeFor(role: Role): string {
  return areaForRole(role).base;
}
