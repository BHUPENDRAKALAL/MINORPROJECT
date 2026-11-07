import { useEffect } from "react";
import { APP_NAME } from "./brand";

/** Sets the browser tab title: "<page> - <app name>". */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} - ${APP_NAME}`;
  }, [title]);
}
