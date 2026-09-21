/** What other modules may use from `academics` (the layer check allows only an index or a service). */
export { getCurriculum, listClasses, listProgrammes, listSubjects, listTerminals, listYears } from "./queries";
export type { AcademicYearList, Curriculum, ProgrammeList, SchoolClassList, SubjectList, TerminalList } from "./schema";
