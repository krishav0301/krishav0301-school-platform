import { BriefcaseBusiness, CalendarCheck, CalendarDays, Clock, Info, Megaphone, Newspaper, type LucideIcon } from "lucide-react";

import type { Kind } from "./model";

/** Each kind's icon (D-098). The icon carries the kind as well as the colour, so colour is never the only sign. */
export const KIND_ICON: Record<Kind, LucideIcon> = {
  post: Newspaper,
  notice: Megaphone,
  holiday: CalendarDays,
  event: CalendarCheck,
  vacancy: BriefcaseBusiness,
  information: Info,
  routine: Clock,
};
