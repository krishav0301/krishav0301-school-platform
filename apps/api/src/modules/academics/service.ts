/** All writes to the academic structure. Other modules import from here (or `index`), never from the files behind it. */
export * from "./years";
export * from "./programmes";
export * from "./sections";
export * from "./classes";
export * from "./subjects";
export * from "./curriculum";
export * from "./teaching";
export type { Created, Done, Failure } from "./write";
