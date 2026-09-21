/** All writes to the academic structure. Other modules import from here (or `index`), never from the files behind it. */
export * from "./years";
export type { Created, Done, Failure } from "./write";
