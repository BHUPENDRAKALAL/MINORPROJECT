import { Toaster } from "sonner";
import { useTheme } from "./theme";

/** Where toasts appear: bottom right, quiet, in the app's own colours (styled in ui.css). */
export function Toasts() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      visibleToasts={3}
      gap={8}
      offset={20}
      mobileOffset={{ bottom: 80 }}
      closeButton
      toastOptions={{ unstyled: false, className: "cy-toast", duration: 4500 }}
    />
  );
}
