import { BookOpen, CalendarDays, CalendarRange, ChartColumn, ChartPie, CircleCheck, ClipboardList, CreditCard, FileText, Globe, House, School, Settings, Settings2, Users, type LucideIcon } from "lucide-react";

import type { NavIcon } from "./nav";

/** Each menu entry's drawing, by the name its entry gives (D-088): the sidebar, the tab bar and the landing page share them. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  overview: House,
  classes: School,
  website: Globe,
  programs: BookOpen,
  terms: CalendarRange,
  setup: Settings2,
  people: Users,
  approvals: CircleCheck,
  admissions: ClipboardList,
  attendance: CalendarDays,
  classwork: FileText,
  fees: CreditCard,
  results: ChartColumn,
  reports: ChartPie,
  settings: Settings,
};
