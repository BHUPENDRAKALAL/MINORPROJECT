import type { NavItem } from "../../app/nav";
import { EmptyState, Tile } from "../../components/ui";
import { useTitle } from "../../lib/useTitle";

/** A page that has its route and place in the nav, but whose feature is not built yet. Says what will appear. */
export default function Placeholder({ item }: { item: NavItem }) {
  const title = item.title ?? item.label;
  useTitle(title);
  const family = item.family === "none" ? "lime" : item.family;
  return (
    <>
      <header className="page-head">
        <div className="section-head">
          <Tile icon={item.icon} family={item.family} />
          <h1 className="title">{title}</h1>
          <span className="pill">Coming soon</span>
        </div>
      </header>
      <EmptyState sprite={item.sprite ?? "smith"} family={family}>
        {item.empty ?? "This page is on its way."}
      </EmptyState>
    </>
  );
}
