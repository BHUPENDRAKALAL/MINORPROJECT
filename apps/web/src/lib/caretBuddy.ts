import { createContext } from "react";
import type { SpriteName } from "../app/nav";

/**
 * Which character stands in for the text cursor in this part of the app (null = the normal cursor).
 * The auth pages set it; everywhere else inputs keep their plain cursor.
 */
export const CaretBuddyContext = createContext<SpriteName | null>(null);
