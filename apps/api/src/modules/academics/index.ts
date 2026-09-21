/** What other modules may use from `academics` (the layer check allows only an index or a service). */
export { listClasses, listProgrammes, listTerminals, listYears } from "./queries";
export type { AcademicYearList, ProgrammeList, SchoolClassList, TerminalList } from "./schema";
